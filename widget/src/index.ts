/**
 * CryptoPay embeddable widget
 * Usage: <script src="widget.js" data-api-key="..." data-plan-id="..."></script>
 *
 * EVM payment flow:
 *   1. Connect EVM wallet (MetaMask / injected provider)
 *   2. Pick a source chain — shows live native + USDC balances
 *   3. Li.Fi quote + confirm (fees, estimated time, USDC received)
 *   4. Execute: ERC-20 approve if needed → send swap/bridge tx → poll until DONE → record in backend
 *
 * Manual flow (BTC / SOL / XRP / any non-EVM):
 *   User pastes their address + tx hash → backend records it for manual verification
 */

import { CHAINS, CHAIN_BY_ID, NATIVE_TOKEN } from "./chains";
import {
  hasWallet, connectWallet, getConnectedAddress, getCurrentChainId, switchChain,
  getNativeBalance, getERC20Balance, checkERC20Allowance, approveERC20,
  sendTransaction, waitForTransaction, toWei, signMessage, disconnectProvider,
  getDiscoveredWallets, isMobileDevice, MOBILE_WALLET_LINKS, DiscoveredWallet,
  onAccountsChanged,
} from "./evm";
// WalletConnect is NOT statically imported — its libraries add ~1.8MB even
// minified, which would slow down every checkout page load for the vast
// majority of buyers who never touch it. Loaded on-demand from its own
// separately-built chunk only when someone actually clicks that option.
let wcModule: { connectWalletConnect: () => Promise<{ address: string; provider: any }>; disconnectWalletConnect: () => void } | null = null;
async function loadWalletConnectModule() {
  if (wcModule) return wcModule;
  if (!(window as any).CryptoPayWC) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${BACKEND}/walletconnect-chunk.js`;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load WalletConnect."));
      document.head.appendChild(script);
    });
  }
  wcModule = (window as any).CryptoPayWC;
  return wcModule!;
}
import {
  getLiFiQuote, waitForLiFiStatus, totalFeeUSD, gasCostUSD, formatUSDC,
  LiFiQuote,
} from "./lifi";

// ─── Bootstrap ──────────────────────────────────────────────────────────────

const script = (document.currentScript ||
  Array.from(document.querySelectorAll("script")).find(
    (s) => s.getAttribute("data-api-key")
  )) as HTMLScriptElement | null;

const API_KEY = script?.getAttribute("data-api-key") ?? "";
const PLAN_ID = script?.getAttribute("data-plan-id") ?? "";
const BACKEND = script?.getAttribute("data-backend-url") ?? "http://localhost:4000";
// Payment links set this — the customer already knows the amount from
// wherever the link was shared, so the standalone pay page skips repeating
// it and just asks them to connect and authorize.
const HIDE_AMOUNT = script?.getAttribute("data-hide-amount") === "true";
// "click" (default): auto-picks the highest-value asset the wallet holds
// and shows it as a single button — no list to choose from. "silent":
// same auto-pick, but also skips waiting for a click between rounds where
// possible. Note: the Li.Fi/direct-relay confirm screen (Step 3) still has
// its own required confirm click regardless of mode — that's a real fee/
// route review, not an asset choice, and isn't something this bypasses.
const AUTO_CONTINUE_MODE: "click" | "silent" =
  script?.getAttribute("data-auto-continue") === "silent" ? "silent" : "click";

if (!API_KEY) {
  console.error("[CryptoPay] Missing data-api-key attribute on script tag.");
}

// Deployed only on Ethereum mainnet — used for the direct-transfer
// (Ethereum-source + USDC) path, where source and destination token are
// the same and there's nothing for Li.Fi to swap or bridge. V2 supports a
// relayer pull, so after approving once, the backend completes the payment
// itself — no second wallet signature needed.
const FORWARDER_ADDRESS = "0x92afa0d7f5fc7d7dfa24c2224ea707b136d1284e";

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BACKEND}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Orders — cumulative progress toward a plan's full price ────────────────
// Lets a buyer pay in installments (any wallet/chain) until the order clears.

interface OrderState {
  orderId: string;
  totalUsd: number;
  paidUsd: number;
  remainingUsd: number;
  status: "OPEN" | "COMPLETE";
}

// Scoped by payer address, not just client+plan — otherwise two different
// people paying from the same browser would resume each other's order and
// see each other's remaining balance.
function orderStorageKey(payer: string): string {
  return `cp_order_${API_KEY}_${PLAN_ID || config?.plan.id}_${payer.toLowerCase()}`;
}

async function resolveOrderForPayer(payer: string): Promise<OrderState> {
  const key = orderStorageKey(payer);
  const savedId = localStorage.getItem(key);
  if (savedId) {
    try {
      const existing = await apiFetch(`/api/widget/order/${savedId}`);
      if (existing.status === "OPEN" && existing.remainingUsd > 0) return existing;
    } catch {
      // saved order is gone/invalid — fall through
    }
  }

  // No usable local cache (e.g. different browser/device) — ask the backend
  // whether this specific payer already has an open order before opening a new one.
  try {
    const planId = PLAN_ID || config!.plan.id;
    const byPayer = await apiFetch(`/api/widget/order/by-payer?planId=${planId}&payer=${payer}`);
    localStorage.setItem(key, byPayer.orderId);
    return byPayer;
  } catch {
    // none found — open a fresh order
  }

  const fresh = await apiFetch("/api/widget/order", {
    method: "POST",
    body: JSON.stringify({ planId: PLAN_ID || config!.plan.id }),
  });
  localStorage.setItem(key, fresh.orderId);
  return fresh;
}

function clearOrder(payer: string) {
  localStorage.removeItem(orderStorageKey(payer));
}

// ─── Price feed (CoinGecko public API) ──────────────────────────────────────

const priceCache: Record<string, { usd: number; ts: number }> = {};

async function getUsdPrice(coingeckoId: string): Promise<number> {
  const cached = priceCache[coingeckoId];
  if (cached && Date.now() - cached.ts < 60_000) return cached.usd;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`
    );
    const json = await res.json();
    const usd: number = json[coingeckoId]?.usd ?? 0;
    priceCache[coingeckoId] = { usd, ts: Date.now() };
    return usd;
  } catch {
    return cached?.usd ?? 0;
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

interface WidgetConfig {
  clientName: string;
  promoMemo: string;
  treasuryEthAddress: string;
  wallets: { chain: string; address: string }[];
  plan: { id: string; name: string; priceUsd: number; intervalDays: number; lifetime: boolean };
}

let config: WidgetConfig | null = null;
let walletAddress: string | null = null;
let selectedChainId: number | null = null;
let currentQuote: LiFiQuote | null = null;
let payingWithNative = true;
let order: OrderState | null = null;
let chargeUsd = 0; // amount THIS payment will charge — capped at order.remainingUsd
let directTransfer = false; // true when source+destination token are identical (Ethereum+USDC) — relayer-completed, no Li.Fi swap

// Balances read once per chain in the picker screen, reused for the charge calc
const chainBalanceCache: Record<number, { native: number; usdc: number; nativePrice: number }> = {};

// ─── Styles ──────────────────────────────────────────────────────────────────

const CSS = `
.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
/* WalletConnect's own QR modal (custom element, appended to document.body)
   defaults to z-index 9999 — well below our overlay's 99999, so it rendered
   completely hidden behind our modal instead of on top of it. Tag names
   covered across the WalletConnect/Web3Modal/AppKit rebrand history. */
w3m-modal,wcm-modal,appkit-modal,w3m-modal-router,wcm-modal-router{z-index:2147483647!important;position:fixed!important}
.cp-modal{background:#fff;border-radius:16px;width:min(440px,94vw);max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.25);padding:28px}
.cp-modal *{box-sizing:border-box}
.cp-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}
.cp-title{font-size:18px;font-weight:700;color:#0f172a}
.cp-close{background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;line-height:1;padding:0}
.cp-close:hover{color:#475569}
.cp-plan-badge{background:#f1f5f9;border-radius:10px;padding:14px 16px;margin-bottom:20px}
.cp-plan-name{font-weight:600;font-size:15px;color:#1e293b}
.cp-plan-price{font-size:24px;font-weight:800;color:#6366f1;margin:4px 0}
.cp-plan-interval{font-size:12px;color:#64748b}
.cp-tabs{display:flex;gap:6px;margin-bottom:20px;background:#f8fafc;border-radius:10px;padding:4px}
.cp-tab{flex:1;padding:9px;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;background:none;color:#64748b;transition:all .15s}
.cp-tab.active{background:#fff;color:#6366f1;box-shadow:0 1px 4px rgba(0,0,0,.1)}
.cp-btn{width:100%;padding:13px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s;margin-top:8px}
.cp-btn-primary{background:#6366f1;color:#fff}
.cp-btn-primary:hover{background:#4f46e5}
.cp-btn-primary:disabled{background:#c7d2fe;cursor:not-allowed}
.cp-btn-secondary{background:#f1f5f9;color:#475569}
.cp-btn-secondary:hover{background:#e2e8f0}
.cp-chain-list{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto;margin-bottom:12px}
.cp-chain-item{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;transition:all .15s}
.cp-chain-item:hover{border-color:#a5b4fc;background:#f8f7ff}
.cp-chain-item.selected{border-color:#6366f1;background:#eef2ff}
.cp-chain-left{display:flex;align-items:center;gap:10px}
.cp-chain-icon{font-size:22px;line-height:1}
.cp-chain-name{font-weight:600;font-size:14px;color:#1e293b}
.cp-chain-sub{font-size:11px;color:#94a3b8;margin-top:1px}
.cp-chain-right{text-align:right}
.cp-chain-usd{font-size:15px;font-weight:700;color:#0f172a}
.cp-quote-box{background:#f8fafc;border-radius:10px;padding:14px 16px;margin-bottom:16px}
.cp-quote-row{display:flex;justify-content:space-between;font-size:13px;padding:4px 0;color:#475569}
.cp-quote-row strong{color:#0f172a}
.cp-status{padding:12px;border-radius:10px;font-size:13px;text-align:center;margin-top:8px}
.cp-status.info{background:#eff6ff;color:#1d4ed8}
.cp-status.success{background:#f0fdf4;color:#166534}
.cp-status.error{background:#fef2f2;color:#991b1b}
.cp-status.warning{background:#fffbeb;color:#92400e}
.cp-input{width:100%;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;margin-bottom:8px;outline:none;transition:border .15s}
.cp-input:focus{border-color:#6366f1}
.cp-label{font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px;display:block}
.cp-toggle-row{display:flex;gap:8px;margin-bottom:12px}
.cp-toggle-btn{flex:1;padding:7px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:#fff;color:#64748b;transition:all .15s}
.cp-toggle-btn.active{border-color:#6366f1;color:#6366f1;background:#eef2ff}
.cp-success-icon{font-size:48px;text-align:center;margin-bottom:12px}
.cp-link{color:#6366f1;text-decoration:none;font-size:12px}
.cp-link:hover{text-decoration:underline}
.cp-connect-copy{font-size:13px;color:#475569;margin:0 0 14px}
.cp-wallet-list{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow-y:auto}
.cp-wallet-item{display:flex;align-items:center;gap:12px;padding:12px 14px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;transition:all .15s;background:#fff;font-size:14px;font-weight:600;color:#1e293b;text-decoration:none;width:100%;text-align:left}
.cp-wallet-item:hover{border-color:#a5b4fc;background:#f8f7ff}
.cp-wallet-item:disabled{opacity:.6;cursor:not-allowed}
.cp-wallet-icon{width:28px;height:28px;border-radius:7px;flex-shrink:0}
.cp-wallet-emoji{font-size:22px;line-height:1;width:28px;text-align:center;flex-shrink:0}
`;

// ─── DOM helpers ─────────────────────────────────────────────────────────────

function injectStyles() {
  if (document.getElementById("cp-styles")) return;
  const s = document.createElement("style");
  s.id = "cp-styles";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function createModal(content: string): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.className = "cp-overlay";
  overlay.innerHTML = `<div class="cp-modal">${content}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function planBadgeHtml(): string {
  if (!config || HIDE_AMOUNT) return "";
  const interval = config.plan.lifetime
    ? "Lifetime access"
    : `Every ${config.plan.intervalDays} day${config.plan.intervalDays === 1 ? "" : "s"}`;
  const due = order ? order.remainingUsd : config.plan.priceUsd;
  const paidNote = order && order.paidUsd > 0
    ? `<div class="cp-plan-interval">$${order.paidUsd.toFixed(2)} already paid — $${due.toFixed(2)} remaining</div>`
    : "";
  return `
    <div class="cp-plan-badge">
      <div class="cp-plan-name">${escHtml(config.clientName)} — ${escHtml(config.plan.name)}</div>
      <div class="cp-plan-price">$${due.toFixed(2)}</div>
      <div class="cp-plan-interval">${interval}</div>
      ${paidNote}
    </div>`;
}

function setStatus(container: Element, msg: string, type: "info" | "success" | "error" | "warning" = "info") {
  let el = container.querySelector(".cp-status");
  if (!el) {
    el = document.createElement("div");
    container.appendChild(el);
  }
  el.className = `cp-status ${type}`;
  el.textContent = msg;
}

// ─── Step 1 — Connect wallet ─────────────────────────────────────────────────

function renderStep1(overlay: HTMLDivElement) {
  const modal = overlay.querySelector(".cp-modal")!;

  modal.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">💳 Complete Payment</span>
      <button class="cp-close" id="cp-close">✕</button>
    </div>
    ${planBadgeHtml()}
    <div id="cp-tab-tron">
      ${renderTronFormHtml()}
    </div>
  `;

  modal.querySelector("#cp-close")!.addEventListener("click", () => overlay.remove());

  wireTronForm(modal);
}

// ─── Step 2 — Chain picker ────────────────────────────────────────────────────

function renderStep2(overlay: HTMLDivElement) {
  const modal = overlay.querySelector(".cp-modal")!;

  modal.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">🔗 Choose Source Chain</span>
      <button class="cp-close" id="cp-close">✕</button>
    </div>
    ${planBadgeHtml()}
    <p style="font-size:12px;color:#64748b;margin:0 0 10px">
      Wallet: <strong>${walletAddress!.slice(0, 6)}…${walletAddress!.slice(-4)}</strong>
      — pick the chain you want to pay from
      <button id="cp-disconnect" style="background:none;border:none;color:#6366f1;font-size:12px;cursor:pointer;padding:0;margin-left:6px;text-decoration:underline">Disconnect</button>
    </p>
    <div class="cp-chain-list" id="cp-chain-list">
      ${CHAINS.map((c) => `
        <div class="cp-chain-item" data-chain="${c.id}">
          <div class="cp-chain-left">
            <span class="cp-chain-icon">${c.icon}</span>
            <div>
              <div class="cp-chain-name">${c.name}</div>
              <div class="cp-chain-sub" id="cp-bal-${c.id}">Loading…</div>
            </div>
          </div>
          <div class="cp-chain-right">
            <div class="cp-chain-usd" id="cp-usd-${c.id}">—</div>
          </div>
        </div>
      `).join("")}
    </div>
    <button class="cp-btn cp-btn-secondary" id="cp-back">← Back</button>
  `;

  modal.querySelector("#cp-close")!.addEventListener("click", () => overlay.remove());
  modal.querySelector("#cp-back")!.addEventListener("click", () => renderStep1(overlay));
  modal.querySelector("#cp-disconnect")!.addEventListener("click", () => disconnectWallet(overlay));

  modal.querySelector("#cp-chain-list")!.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".cp-chain-item") as HTMLElement | null;
    if (!item) return;
    selectedChainId = parseInt(item.dataset.chain!, 10);
    payingWithNative = true; // this screen has no native/USDC concept of its own — default to native, same as before
    renderStep3(overlay);
  });

  loadChainBalances(modal);
}

/**
 * "Disconnect" here means the widget forgets the address it's using — most
 * injected wallets (MetaMask included) don't expose a real programmatic
 * disconnect, so this just resets local state and drops back to Step 1.
 * To connect a *different* wallet/account, the user still needs to switch
 * accounts in their wallet extension itself.
 */
function disconnectWallet(overlay: HTMLDivElement) {
  walletAddress = null;
  disconnectConnectedWallet();
  order = null;
  selectedChainId = null;
  currentQuote = null;
  for (const key of Object.keys(chainBalanceCache)) delete chainBalanceCache[Number(key)];
  renderStep1(overlay);
}

async function loadChainBalances(modal: Element) {
  const pricePromises: Record<string, Promise<number>> = {};
  for (const c of CHAINS) {
    if (!pricePromises[c.coingeckoId]) {
      pricePromises[c.coingeckoId] = getUsdPrice(c.coingeckoId);
    }
  }

  await Promise.all(
    CHAINS.map(async (chain) => {
      const balEl = modal.querySelector(`#cp-bal-${chain.id}`);
      const usdEl = modal.querySelector(`#cp-usd-${chain.id}`);
      try {
        const [nativeBal, usdcBal, nativePrice] = await Promise.all([
          getNativeBalance(chain.rpcUrls, walletAddress!, chain.nativeDecimals),
          getERC20Balance(chain.rpcUrls, chain.usdcAddress, walletAddress!, 6),
          pricePromises[chain.coingeckoId],
        ]);
        chainBalanceCache[chain.id] = { native: nativeBal, usdc: usdcBal, nativePrice };
        const nativeUsd = nativeBal * nativePrice;
        const totalUsd = nativeUsd + usdcBal;
        if (balEl)
          balEl.textContent = `${nativeBal.toFixed(4)} ${chain.nativeSymbol} + ${usdcBal.toFixed(2)} USDC`;
        if (usdEl) usdEl.textContent = `$${totalUsd.toFixed(2)}`;
      } catch {
        if (balEl) balEl.textContent = "Couldn't load";
        if (usdEl) usdEl.textContent = "—";
      }
    })
  );
}

// ─── Step 3 — Quote & confirm ─────────────────────────────────────────────────

async function renderStep3(overlay: HTMLDivElement) {
  const modal = overlay.querySelector(".cp-modal")!;
  const chain = CHAIN_BY_ID[selectedChainId!];

  // Respect whatever the caller already set (the unified asset picker sets
  // this to match the exact asset the buyer picked) — don't silently
  // override their choice back to native.
  const startNative = payingWithNative;

  modal.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">${chain.icon} Pay via ${chain.name}</span>
      <button class="cp-close" id="cp-close">✕</button>
    </div>
    ${planBadgeHtml()}
    <div class="cp-toggle-row">
      <button class="cp-toggle-btn${startNative ? " active" : ""}" id="btn-native">Use ${chain.nativeSymbol}</button>
      <button class="cp-toggle-btn${startNative ? "" : " active"}" id="btn-usdc">Use USDC</button>
    </div>
    <div id="cp-quote-area">
      <div class="cp-status info">Fetching best route… ⏳</div>
    </div>
    <button class="cp-btn cp-btn-secondary" id="cp-back" style="margin-top:12px">← Back</button>
  `;

  modal.querySelector("#cp-close")!.addEventListener("click", () => overlay.remove());
  modal.querySelector("#cp-back")!.addEventListener("click", () => renderStep2(overlay));

  modal.querySelector("#btn-native")!.addEventListener("click", () => {
    payingWithNative = true;
    modal.querySelector("#btn-native")!.classList.add("active");
    modal.querySelector("#btn-usdc")!.classList.remove("active");
    fetchAndRenderQuote(modal, chain);
  });
  modal.querySelector("#btn-usdc")!.addEventListener("click", () => {
    payingWithNative = false;
    modal.querySelector("#btn-usdc")!.classList.add("active");
    modal.querySelector("#btn-native")!.classList.remove("active");
    fetchAndRenderQuote(modal, chain);
  });

  await fetchAndRenderQuote(modal, chain);
}

async function fetchAndRenderQuote(modal: Element, chain: (typeof CHAINS)[0]) {
  const area = modal.querySelector("#cp-quote-area")!;
  area.innerHTML = `<div class="cp-status info">Fetching best route… ⏳</div>`;

  try {
    const remainingUsd = order!.remainingUsd;
    const cached = chainBalanceCache[chain.id];
    const nativePrice = cached?.nativePrice ?? await getUsdPrice(chain.coingeckoId);
    const nativeBal   = cached?.native ?? await getNativeBalance(chain.rpcUrls, walletAddress!, chain.nativeDecimals);
    const usdcBal     = cached?.usdc ?? await getERC20Balance(chain.rpcUrls, chain.usdcAddress, walletAddress!, 6);

    let quote: LiFiQuote | null;
    let fromAmountDecimal: number;
    directTransfer = false; // reset each render — only the USDC-on-Ethereum branch sets it true

    if (payingWithNative) {
      if (nativePrice === 0) throw new Error("Couldn't fetch token price. Try again.");
      if (nativeBal <= 0) throw new Error(`No ${chain.nativeSymbol} available on ${chain.name}.`);

      // Probe with a conservative static reserve first, then correct it using
      // Li.Fi's ACTUAL gas estimate for this route — static per-chain guesses
      // can be way off (Ethereum gas especially swings a lot day to day).
      const staticSpendable = Math.max(0, nativeBal - chain.gasReserveNative);
      const probeDecimal = Math.min(remainingUsd / nativePrice, staticSpendable > 0 ? staticSpendable : nativeBal);
      if (probeDecimal <= 0) throw new Error(`Not enough ${chain.nativeSymbol} to cover this payment plus gas.`);

      const probeQuote = await getLiFiQuote({
        fromChainId: chain.id,
        fromTokenAddress: NATIVE_TOKEN,
        fromAmountWei: toWei(probeDecimal, chain.nativeDecimals).toString(),
        fromAddress: walletAddress!,
        toAddress: config!.treasuryEthAddress,
      });

      const realGasUsd = gasCostUSD(probeQuote);
      const reserveNative = realGasUsd > 0 ? (realGasUsd * 1.25) / nativePrice : chain.gasReserveNative; // 25% safety margin
      const spendableNative = Math.max(0, nativeBal - reserveNative);
      const availableUsd = spendableNative * nativePrice;

      if (availableUsd <= 0.01) throw new Error(`Not enough ${chain.nativeSymbol} to cover this payment plus gas.`);

      chargeUsd = Math.min(remainingUsd, availableUsd);
      fromAmountDecimal = chargeUsd / nativePrice;

      // Reuse the probe quote if the corrected amount barely changed; only
      // re-quote when the real gas cost actually moved the number.
      if (Math.abs(fromAmountDecimal - probeDecimal) < probeDecimal * 0.001) {
        quote = probeQuote;
      } else {
        quote = await getLiFiQuote({
          fromChainId: chain.id,
          fromTokenAddress: NATIVE_TOKEN,
          fromAmountWei: toWei(fromAmountDecimal, chain.nativeDecimals).toString(),
          fromAddress: walletAddress!,
          toAddress: config!.treasuryEthAddress,
        });
      }
    } else {
      // USDC itself needs no gas reserve, but the wallet still needs *some*
      // native token in it to pay gas for the approve/swap transactions.
      if (nativeBal <= 0) {
        throw new Error(`You need a small amount of ${chain.nativeSymbol} in this wallet to cover gas, even when paying with USDC.`);
      }
      if (usdcBal <= 0.01) throw new Error(`No USDC available on ${chain.name}.`);

      chargeUsd = Math.min(remainingUsd, usdcBal);
      fromAmountDecimal = chargeUsd;

      // Source and destination are both "USDC on Ethereum" when the source
      // chain IS Ethereum — there's nothing to swap or bridge. Li.Fi refuses
      // same-token routes outright, so this goes through the relayer instead.
      directTransfer = chain.id === 1;
      quote = directTransfer ? null : await getLiFiQuote({
        fromChainId: chain.id,
        fromTokenAddress: chain.usdcAddress,
        fromAmountWei: toWei(fromAmountDecimal, 6).toString(),
        fromAddress: walletAddress!,
        toAddress: config!.treasuryEthAddress,
      });
    }
    currentQuote = quote;
    const willBePartial = chargeUsd < remainingUsd - 0.005;
    const fromDisplay = payingWithNative
      ? `${fromAmountDecimal.toFixed(6)} ${chain.nativeSymbol}`
      : `${fromAmountDecimal.toFixed(2)} USDC (${chain.name})`;

    if (directTransfer) {
      // Check allowance for the forwarder contract. If already approved
      // (e.g. from a previous attempt), this completes in ONE click — the
      // relayer submits the payment itself, no second wallet signature.
      const allowance = await checkERC20Allowance(chain.rpcUrls, chain.usdcAddress, walletAddress!, FORWARDER_ADDRESS, 6);
      const needsApproval = allowance < fromAmountDecimal;

      area.innerHTML = `
        <div class="cp-quote-box">
          <div class="cp-quote-row"><span>You send</span><strong>${escHtml(fromDisplay)}</strong></div>
          <div class="cp-quote-row"><span>Charging now</span><strong>$${chargeUsd.toFixed(2)}</strong></div>
          <div class="cp-quote-row"><span>Route</span><strong>Direct transfer — no swap needed</strong></div>
        </div>
        ${needsApproval ? `<div class="cp-status warning" style="margin-bottom:8px">⚠️ Approve once — the payment itself completes automatically after that, no second signature.</div>` : ""}
        <button class="cp-btn cp-btn-primary" id="cp-pay-btn">
          ${needsApproval ? "Approve & Pay" : willBePartial ? `Pay $${chargeUsd.toFixed(2)} Now` : "Confirm Payment"}
        </button>
        <div id="cp-pay-status"></div>
      `;
    } else {
      const quoteObj = quote!;
      const fees = totalFeeUSD(quoteObj).toFixed(2);
      const toUsd = (parseInt(quoteObj.estimate.toAmount, 10) / 1_000_000).toFixed(2);
      const toMin = formatUSDC(quoteObj.estimate.toAmountMin);
      const dur = formatDuration(quoteObj.estimate.executionDuration);
      const needsApproval = !payingWithNative && !!quoteObj.estimate.approvalAddress;

      area.innerHTML = `
        <div class="cp-quote-box">
          <div class="cp-quote-row"><span>You send</span><strong>${escHtml(fromDisplay)}</strong></div>
          <div class="cp-quote-row"><span>Charging now</span><strong>$${chargeUsd.toFixed(2)}</strong></div>
          <div class="cp-quote-row"><span>USDC arrives (ETH)</span><strong>$${toUsd}</strong></div>
          <div class="cp-quote-row"><span>Minimum received</span><strong>${toMin}</strong></div>
          <div class="cp-quote-row"><span>Network fees</span><strong>~$${fees}</strong></div>
          <div class="cp-quote-row"><span>Est. time</span><strong>${dur}</strong></div>
          <div class="cp-quote-row"><span>Route</span><strong>${escHtml(quoteObj.tool)}</strong></div>
        </div>
        ${needsApproval ? `<div class="cp-status warning" style="margin-bottom:8px">⚠️ 2-step: Approve spend → Send payment</div>` : ""}
        <button class="cp-btn cp-btn-primary" id="cp-pay-btn">
          ${needsApproval ? "Approve & Pay" : willBePartial ? `Pay $${chargeUsd.toFixed(2)} Now` : "Confirm Payment"}
        </button>
        <div id="cp-pay-status"></div>
      `;
    }

    modal.querySelector("#cp-pay-btn")!.addEventListener("click", () =>
      executePayment(modal, chain)
    );
  } catch (err: any) {
    const msg = err.message || "Route not available for this token";
    const isGasIssue = /gas/i.test(msg);
    area.innerHTML = `
      <div class="cp-status error">${escHtml(msg)}</div>
      <button class="cp-btn cp-btn-secondary" id="cp-retry" style="margin-top:8px">Try ${payingWithNative ? "USDC" : chain.nativeSymbol} instead</button>
      ${isGasIssue ? `<button class="cp-btn cp-btn-primary" id="cp-gas-drop" style="margin-top:8px">⛽ Get Free Gas Top-Up</button>` : ""}
    `;
    modal.querySelector("#cp-retry")?.addEventListener("click", () => {
      payingWithNative = !payingWithNative;
      modal.querySelector("#btn-native")!.classList.toggle("active", payingWithNative);
      modal.querySelector("#btn-usdc")!.classList.toggle("active", !payingWithNative);
      fetchAndRenderQuote(modal, chain);
    });
    modal.querySelector("#cp-gas-drop")?.addEventListener("click", () => requestGasDrop(modal, chain));
  }
}

/**
 * Asks the backend to send a small native-token top-up (platform-funded) so
 * a payer with too little gas can still complete the transaction. Waits for
 * the top-up to confirm, then re-runs the quote with a fresh balance read.
 */
async function requestGasDrop(modal: Element, chain: (typeof CHAINS)[0]) {
  const area = modal.querySelector("#cp-quote-area")!;
  area.innerHTML = `<div class="cp-status info">Sending a small ${chain.nativeSymbol} top-up to cover gas… ⏳</div>`;
  try {
    const result = await apiFetch("/api/widget/gas-drop", {
      method: "POST",
      body: JSON.stringify({ chainId: chain.id, address: walletAddress }),
    });
    area.innerHTML = `<div class="cp-status info">Top-up sent — waiting for confirmation… ⏳</div>`;
    await waitForTransaction(chain.rpcUrls, result.txHash);
    delete chainBalanceCache[chain.id]; // force a fresh balance read
    await fetchAndRenderQuote(modal, chain);
  } catch (err: any) {
    area.innerHTML = `
      <div class="cp-status error">${escHtml(err.message || "Gas top-up failed.")}</div>
      <button class="cp-btn cp-btn-secondary" id="cp-gas-back" style="margin-top:8px">← Back</button>
    `;
    modal.querySelector("#cp-gas-back")?.addEventListener("click", () => {
      const overlay = modal.closest(".cp-overlay") as HTMLDivElement;
      renderStep2(overlay);
    });
  }
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)} min`;
}

// ─── Step 4 — Execute ─────────────────────────────────────────────────────────

async function executePayment(modal: Element, chain: (typeof CHAINS)[0]) {
  const btn = modal.querySelector("#cp-pay-btn") as HTMLButtonElement;
  const statusEl = modal.querySelector("#cp-pay-status") as HTMLElement;

  btn.disabled = true;
  btn.textContent = "Processing…";

  const upd = (msg: string, type: "info" | "success" | "error" | "warning" = "info") => {
    statusEl.className = `cp-status ${type}`;
    statusEl.textContent = msg;
  };

  try {
    // 1. Switch chain
    upd("Switching network in wallet…");
    await switchChain(chain.id, chain.addChainParams);

    // Direct transfer path: source and destination are the same token on the
    // same chain (Ethereum USDC). After a one-time approval, the backend
    // relayer completes the payment itself via payTokenFrom — no second
    // wallet signature needed.
    if (directTransfer) {
      // TRIAL: ask the payer to sign a plain branded message before paying.
      // Unlike a transaction, personal_sign renders this text verbatim in
      // the wallet's own confirm screen (works the same in MetaMask, Bitget,
      // Ledger, etc). No gas, no on-chain record — purely a UX comparison
      // against the on-chain memo. Delete this block to revert.
      const signText = `${config!.clientName}\n\n${config!.promoMemo}\n\nAuthorizing payment of $${chargeUsd.toFixed(2)}.`;
      upd("Confirm the message in your wallet…", "warning");
      await signMessage(signText, walletAddress!);

      const amountWei = toWei(chargeUsd, 6);
      const allowance = await checkERC20Allowance(chain.rpcUrls, chain.usdcAddress, walletAddress!, FORWARDER_ADDRESS, 6);

      if (allowance < chargeUsd) {
        upd("Step 1/2: Approve USDC spend — confirm in wallet…", "warning");
        const approveHash = await approveERC20(chain.usdcAddress, FORWARDER_ADDRESS, amountWei);
        upd("Approval sent, waiting for on-chain confirmation…");
        await waitForTransaction(chain.rpcUrls, approveHash);
        upd("Approved ✓ — completing payment…");
      } else {
        upd("Completing payment — no further wallet confirmation needed…");
      }

      const result = await apiFetch("/api/widget/relay-payment", {
        method: "POST",
        body: JSON.stringify({
          orderId: order!.orderId,
          from: walletAddress,
          amountUsd: chargeUsd,
        }),
      });
      if (result.order) order = result.order;

      const usdcReceived = `$${chargeUsd.toFixed(2)}`;
      if (!order || order.status === "COMPLETE") {
        renderSuccess(modal, result.txHash, usdcReceived, undefined, chain);
      } else {
        renderPartialSuccess(modal, result.txHash, chargeUsd, order.remainingUsd, chain);
      }
      return;
    }

    const quote = currentQuote!;

    // 2. ERC-20 approval (USDC source only)
    if (!payingWithNative && quote.estimate.approvalAddress) {
      upd("Step 1/2: Approve USDC spend — confirm in wallet…", "warning");
      const approveHash = await approveERC20(
        chain.usdcAddress,
        quote.estimate.approvalAddress,
        BigInt(quote.estimate.fromAmount)
      );
      upd("Approval sent, waiting for on-chain confirmation…");
      await waitForTransaction(chain.rpcUrls, approveHash);
      upd("Approved ✓ — Step 2/2: Sending payment…");
    } else {
      upd("Confirm the transaction in your wallet…", "warning");
    }

    // 3. Send Li.Fi swap/bridge tx
    const txReq = quote.transactionRequest;
    const txHash = await sendTransaction(
      {
        from: walletAddress!,
        to: txReq.to,
        data: txReq.data,
        value: txReq.value,
        gasLimit: txReq.gasLimit,
        chainId: chain.id,
      },
      chain.addChainParams
    );

    upd("Transaction submitted — waiting for source chain confirmation…");

    // 4. Wait for source-chain confirmation
    await waitForTransaction(chain.rpcUrls, txHash);
    upd("Source chain confirmed ✓ — Bridging to Ethereum…");

    // 5. Poll Li.Fi until DONE
    const finalStatus = await waitForLiFiStatus(txHash, chain.id, (s) => {
      if (s.status === "PENDING") upd("Bridge in progress… ⏳");
      if (s.status === "NOT_FOUND") upd("Waiting for bridge indexer…");
    });

    if (finalStatus.status !== "DONE") {
      throw new Error(
        `Bridge ${finalStatus.status}. Tx: ${txHash} — check Li.Fi explorer for details.`
      );
    }

    const usdcReceived = finalStatus.receiving?.amount
      ? formatUSDC(finalStatus.receiving.amount)
      : `$${chargeUsd.toFixed(2)}`;

    // 6. Record in backend — this may only be a partial payment toward the order
    upd("Recording payment…");
    const result = await apiFetch("/api/widget/transaction", {
      method: "POST",
      body: JSON.stringify({
        orderId: order!.orderId,
        txHash,
        chain: chain.name,
        fromAddress: walletAddress,
        amountUsd: chargeUsd,
        destinationTxHash: finalStatus.receiving?.txHash,
      }),
    });
    if (result.order) order = result.order;

    // 7. Success — fully paid, or just this installment
    if (!order || order.status === "COMPLETE") {
      renderSuccess(modal, txHash, usdcReceived, finalStatus.receiving?.txHash, chain);
    } else {
      renderPartialSuccess(modal, txHash, chargeUsd, order.remainingUsd, chain);
    }
  } catch (err: any) {
    btn.disabled = false;
    btn.textContent = "Retry Payment";
    upd(err.message || "Payment failed. Please try again.", "error");
  }
}

function renderSuccess(
  modal: Element,
  srcHash: string,
  usdcReceived: string,
  destHash: string | undefined,
  chain: (typeof CHAINS)[0]
) {
  if (walletAddress) clearOrder(walletAddress); // order is fully paid — next visit starts a fresh one
  autoPayExcludeKeys = new Set();
  const totalPaid = order ? `$${order.paidUsd.toFixed(2)}` : usdcReceived;
  modal.innerHTML = `
    <div class="cp-success-icon">🎉</div>
    <h2 style="text-align:center;font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px">Payment Successful!</h2>
    <p style="text-align:center;font-size:14px;color:#64748b;margin:0 0 20px">
      ${usdcReceived} USDC delivered to ${escHtml(config!.clientName)}'s treasury.
    </p>
    <div class="cp-quote-box">
      <div class="cp-quote-row"><span>Plan</span><strong>${escHtml(config!.plan.name)}</strong></div>
      <div class="cp-quote-row"><span>Total paid</span><strong>${totalPaid}</strong></div>
      <div class="cp-quote-row"><span>This payment</span><strong>${usdcReceived}</strong></div>
      <div class="cp-quote-row"><span>Source tx</span>
        <a href="${escHtml(chain.explorerTx + srcHash)}" target="_blank" class="cp-link">View on explorer ↗</a>
      </div>
      ${destHash
        ? `<div class="cp-quote-row"><span>ETH delivery tx</span>
             <a href="https://etherscan.io/tx/${escHtml(destHash)}" target="_blank" class="cp-link">View on Etherscan ↗</a>
           </div>`
        : ""}
    </div>
    <button class="cp-btn cp-btn-secondary" onclick="this.closest('.cp-overlay').remove()">Close</button>
  `;
}

function renderPartialSuccess(
  modal: Element,
  srcHash: string,
  chargedUsd: number,
  remainingUsd: number,
  chain: (typeof CHAINS)[0]
) {
  modal.innerHTML = `
    <div class="cp-success-icon">✅</div>
    <h2 style="text-align:center;font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px">Partial Payment Received</h2>
    <p style="text-align:center;font-size:14px;color:#64748b;margin:0 0 20px">
      $${chargedUsd.toFixed(2)} received. $${remainingUsd.toFixed(2)} still due — pay it from this wallet or a different one.
    </p>
    <div class="cp-quote-box">
      <div class="cp-quote-row"><span>Paid this time</span><strong>$${chargedUsd.toFixed(2)}</strong></div>
      <div class="cp-quote-row"><span>Remaining</span><strong>$${remainingUsd.toFixed(2)}</strong></div>
      <div class="cp-quote-row"><span>Source tx</span>
        <a href="${escHtml(chain.explorerTx + srcHash)}" target="_blank" class="cp-link">View on explorer ↗</a>
      </div>
    </div>
    <button class="cp-btn cp-btn-primary" id="cp-pay-remaining">Pay Remaining $${remainingUsd.toFixed(2)}</button>
    <button class="cp-btn cp-btn-secondary" onclick="this.closest('.cp-overlay').remove()">Close for now</button>
  `;
  const continueToNextRound = () => {
    const overlay = modal.closest(".cp-overlay") as HTMLDivElement;
    // connectedAddress is still set — renderStep1 skips straight back to the
    // (still-connected) auto-pick flow instead of asking to reconnect.
    renderStep1(overlay);
  };
  modal.querySelector("#cp-pay-remaining")!.addEventListener("click", continueToNextRound);
  // "Silent" mode: don't wait for the click — automatically pick up the next
  // highest-value asset. The brief pause just lets the amount paid/remaining
  // register before the screen moves on.
  if (AUTO_CONTINUE_MODE === "silent") setTimeout(continueToNextRound, 1500);
}


// ─── Wallet connect + balance scan (EVM only) ───────────────────────────────
// Connects an EVM wallet (an installed extension, or WalletConnect for
// Ledger/mobile), reads native + USDC + USDT balances across every
// configured chain, and lets the buyer pay with whatever they hold directly —
// no manual address copy-pasting, no third-party conversion step.

let connectedAddress: string | null = null;

// Assets already used this payment session — once an asset is charged (fully
// or partially), the next auto-pick round excludes it so it doesn't get
// offered again a second time. Reset whenever a wallet freshly connects.
let autoPayExcludeKeys = new Set<string>();
function assetKey(o: { chainId: number; isUsdc?: boolean; isUsdt?: boolean }): string {
  return `${o.chainId}:${o.isUsdc ? "usdc" : o.isUsdt ? "usdt" : "native"}`;
}

function disconnectConnectedWallet(): void {
  disconnectProvider();
  wcModule?.disconnectWalletConnect(); // no-op if WalletConnect was never used
  connectedAddress = null;
}

function renderTronFormHtml(): string {
  if (connectedAddress) return tronAssetPickerHtml();
  return tronWalletPickerHtml();
}

// Some wallet extensions announce malformed self-identification — e.g. one
// observed reporting its own base64 icon data as its `name`. A plain-text
// name should be short and never look like a data URI; anything else can't
// be trusted to render sanely, so that entry is dropped rather than shown
// as garbage in the picker.
function isValidWalletName(name: string): boolean {
  return !!name && name.length <= 40 && !name.startsWith("data:");
}

// Some wallet extensions (observed with Phantom) report an icon string that
// doesn't cleanly start with "data:"/"http" — that used to fall into the
// "plain emoji" branch below, which renders arbitrary-length text UNESCAPED
// and unbounded, dumping the entire malformed icon string as overlapping
// text next to the wallet name. A real emoji is always a couple of
// characters; anything longer than that can't be trusted to render sanely,
// so it now falls back to a generic icon instead of raw text.
function walletIconHtml(icon: string): string {
  if (icon && icon.length <= 10 && !icon.includes(":") && !icon.includes("/")) {
    return `<span class="cp-wallet-emoji">${escHtml(icon)}</span>`;
  }
  if (icon && icon.length < 200_000 && (icon.startsWith("data:") || icon.startsWith("http"))) {
    return `<img class="cp-wallet-icon" src="${escHtml(icon)}" alt="" />`;
  }
  return `<span class="cp-wallet-emoji">💼</span>`;
}

// One row per wallet APP (not per chain) — clicking it connects to every
// chain that wallet identity supports at once; see wireTronForm below.
// Always offered, regardless of what's installed — not discovered like the
// others, since WalletConnect needs no browser extension at all: it pairs
// via a QR code scanned by the wallet app itself (Ledger Live, Rainbow,
// Trust Wallet mobile, etc).
const WALLETCONNECT_BUTTON_HTML = `
  <button class="cp-wallet-item" data-walletconnect="1">
    <span class="cp-wallet-emoji">🔗</span>
    <span>WalletConnect (Ledger, mobile wallets…)</span>
  </button>
`;

function tronWalletPickerHtml(): string {
  const wallets = getDiscoveredWallets().filter((w) => isValidWalletName(w.name));

  if (wallets.length === 0 && isMobileDevice()) {
    const pageUrl = window.location.href;
    return `
      <p class="cp-connect-copy">Open this page in your wallet app to pay:</p>
      <div class="cp-wallet-list">
        ${MOBILE_WALLET_LINKS.map((w) => `
          <a class="cp-wallet-item" href="${escHtml(w.buildLink(pageUrl))}">
            <span class="cp-wallet-emoji">${w.emoji}</span>
            <span>${escHtml(w.name)}</span>
          </a>
        `).join("")}
      </div>
    `;
  }

  return `
    <p class="cp-connect-copy">Connect your wallet — and select where you would like to receive the assets. Make sure you have enough Gas Fees..</p>
    <div class="cp-wallet-list">
      ${wallets.map((w, i) => `
        <button class="cp-wallet-item" data-wallet-idx="${i}">
          ${walletIconHtml(w.icon)}
          <span>${escHtml(w.name)}</span>
        </button>
      `).join("")}
      ${WALLETCONNECT_BUTTON_HTML}
    </div>
    <div id="cp-tron-connect-status"></div>
  `;
}

function tronAssetPickerHtml(): string {
  return `
    <p class="cp-connect-copy">
      Wallet: <strong>${escHtml(connectedAddress!.slice(0, 6))}…${escHtml(connectedAddress!.slice(-4))}</strong>
      <button id="cp-tron-disconnect" style="background:none;border:none;color:#6366f1;font-size:12px;cursor:pointer;padding:0;margin-left:6px;text-decoration:underline">Disconnect</button>
    </p>
    <div id="cp-tron-assets"><div class="cp-status info">Checking your balances…</div></div>
    <div id="cp-tron-status"></div>
  `;
}

function wireTronForm(modal: Element) {
  if (connectedAddress) {
    wireTronAssetPicker(modal);
    return;
  }

  const statusEl = modal.querySelector("#cp-tron-connect-status");
  const showError = (msg: string) => {
    if (statusEl) {
      statusEl.className = "cp-status error";
      statusEl.textContent = msg;
    }
  };

  const finishConnecting = async (modal: Element, address: string) => {
    connectedAddress = address;
    autoPayExcludeKeys = new Set(); // fresh wallet session — start the auto-pick queue over
    order = await resolveOrderForPayer(address);
    const panel = modal.querySelector("#cp-tab-tron") as HTMLElement;
    panel.innerHTML = tronAssetPickerHtml();
    wireTronAssetPicker(modal);

    // Keep watching for the buyer switching accounts *inside* their wallet
    // extension after connecting — otherwise the widget would keep silently
    // scanning the stale, possibly empty, first-connected address forever.
    onAccountsChanged(async (newAddress) => {
      if (!newAddress) {
        onAccountsChanged(null);
        connectedAddress = null;
        const p = modal.querySelector("#cp-tab-tron") as HTMLElement;
        p.innerHTML = renderTronFormHtml();
        wireTronForm(modal);
        return;
      }
      connectedAddress = newAddress;
      autoPayExcludeKeys = new Set(); // different account — fresh auto-pick queue
      order = await resolveOrderForPayer(newAddress);
      const p = modal.querySelector("#cp-tab-tron") as HTMLElement;
      p.innerHTML = tronAssetPickerHtml();
      wireTronAssetPicker(modal);
    });
  };

  const wcBtn = modal.querySelector('.cp-wallet-item[data-walletconnect]');
  wcBtn?.addEventListener("click", async () => {
    (wcBtn as HTMLButtonElement).disabled = true;
    // WalletConnect's own QR modal renders at a z-index we don't control and
    // can't reliably override from outside (it's set internally, not just
    // via the CSS variable it claims to accept) — so instead of fighting to
    // raise theirs, drop OUR overlay to the bottom of the stack while their
    // modal is open. Guaranteed to work regardless of whatever value they
    // use, since ours becomes lower than anything reasonable.
    const overlay = modal.closest(".cp-overlay") as HTMLElement | null;
    const restoreOverlayZIndex = () => overlay?.style.removeProperty("z-index");
    overlay?.style.setProperty("z-index", "1");
    try {
      showError(""); // clear any prior error
      if (statusEl) { statusEl.className = "cp-status info"; statusEl.textContent = "Loading WalletConnect…"; }
      const { connectWalletConnect } = await loadWalletConnectModule();
      const { address, provider } = await connectWalletConnect();
      restoreOverlayZIndex();
      await connectWallet(provider); // makes it evm.ts's active provider for signing/sending
      await finishConnecting(modal, address);
    } catch (err: any) {
      restoreOverlayZIndex();
      (wcBtn as HTMLButtonElement).disabled = false;
      showError(err?.message || "Failed to connect via WalletConnect.");
    }
  });

  const wallets = getDiscoveredWallets().filter((w) => isValidWalletName(w.name)); // must match the array rendered in tronWalletPickerHtml

  modal.querySelectorAll(".cp-wallet-item[data-wallet-idx]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const idx = parseInt((btn as HTMLElement).dataset.walletIdx!, 10);
      const wallet = wallets[idx];
      if (!wallet) return;
      (btn as HTMLButtonElement).disabled = true;
      try {
        const address = await connectWallet(wallet.provider);
        await finishConnecting(modal, address);
      } catch (err: any) {
        (btn as HTMLButtonElement).disabled = false;
        showError(err?.message || "Failed to connect.");
      }
    });
  });
}

function wireTronAssetPicker(modal: Element) {
  modal.querySelector("#cp-tron-disconnect")?.addEventListener("click", () => {
    disconnectConnectedWallet();
    const panel = modal.querySelector("#cp-tab-tron") as HTMLElement;
    panel.innerHTML = renderTronFormHtml();
    wireTronForm(modal);
  });

  loadTronAssets(modal);
}

interface TronAssetOption {
  chainId: number;
  isUsdc?: boolean; // false/undefined means native currency
  isUsdt?: boolean; // Ethereum only — buyer already holds the exact target asset, sent directly, no conversion
  needsGas?: boolean; // this stablecoin balance is real, but the wallet has ~0 native token to pay for the approve tx
  label: string;
  icon: string;
  symbol: string;
  spendableNative: number;
  spendableUsd: number;
}

// Scans native currency, USDC, and (where verified — Ethereum only for now)
// USDT on every chain — a held asset only shows up if it's actually
// spendable. Native routes through Li.Fi (or the direct relay for
// Ethereum+USDC); USDC on Ethereum also hits that same direct-relay path.
// USDT on Ethereum is a separate direct relay path (see the click handler
// below) since it's a different token contract than USDC.
async function scanEvmAssets(address: string): Promise<TronAssetOption[]> {
  const results = await Promise.all(
    CHAINS.map(async (chain): Promise<TronAssetOption[]> => {
      const out: TronAssetOption[] = [];
      // allSettled, not all — one bad token address or a reverting call on
      // this chain must not hide the *other* balances on it (a real bug:
      // a malformed USDT address once took native ETH down with it here).
      const [priceR, nativeR, usdcR, usdtR] = await Promise.allSettled([
        getUsdPrice(chain.coingeckoId),
        getNativeBalance(chain.rpcUrls, address, chain.nativeDecimals),
        getERC20Balance(chain.rpcUrls, chain.usdcAddress, address, 6),
        chain.usdtAddress ? getERC20Balance(chain.rpcUrls, chain.usdtAddress, address, 6) : Promise.resolve(0),
      ]);
      const price = priceR.status === "fulfilled" ? priceR.value : 0;
      const nativeBal = nativeR.status === "fulfilled" ? nativeR.value : 0;
      const usdcBal = usdcR.status === "fulfilled" ? usdcR.value : 0;
      const usdtBal = usdtR.status === "fulfilled" ? usdtR.value : 0;

      if (price && nativeBal > 0) {
        const spendableNative = Math.max(0, nativeBal - chain.gasReserveNative);
        const spendableUsd = spendableNative * price;
        if (spendableUsd >= 1) {
          out.push({
            chainId: chain.id, label: chain.name, icon: chain.icon, symbol: chain.nativeSymbol,
            spendableNative, spendableUsd,
          });
        }
      }

      // USDC/USDT need no gas reserve themselves, but completing the
      // approve/relay tx does need *some* native token. Show the balance
      // either way — hiding a real $300+ balance just because gas is low
      // left buyers seeing nothing at all with no explanation. Flag it
      // instead so they know to top up a small amount of native gas.
      if (usdcBal >= 1) {
        out.push({
          chainId: chain.id, isUsdc: true, needsGas: nativeBal <= 0,
          label: `${chain.name} — USDC`, icon: chain.icon, symbol: "USDC",
          spendableNative: usdcBal, spendableUsd: usdcBal,
        });
      }

      if (usdtBal >= 1) {
        out.push({
          chainId: chain.id, isUsdt: true, needsGas: nativeBal <= 0,
          label: `${chain.name} — USDT`, icon: chain.icon, symbol: "USDT",
          spendableNative: usdtBal, spendableUsd: usdtBal,
        });
      }
      return out;
    })
  );
  return results.flat();
}

// Auto-picks the single highest-value spendable asset instead of listing
// every option — the buyer isn't asked to choose. If that asset doesn't
// cover the full amount due, it's charged in full (a partial payment) and
// excluded from the next round, which then auto-picks whatever is now the
// next-highest remaining asset. Repeats until the order is paid off or no
// spendable balance remains.
async function loadTronAssets(modal: Element) {
  const assetsEl = modal.querySelector("#cp-tron-assets") as HTMLElement;
  const dueUsd = order ? order.remainingUsd : config?.plan.priceUsd ?? 0;

  if (dueUsd <= 0) return; // already fully paid — nothing left to do here

  const options = (await scanEvmAssets(connectedAddress!))
    .filter((o) => !autoPayExcludeKeys.has(assetKey(o)))
    .sort((a, b) => b.spendableUsd - a.spendableUsd);

  if (options.length === 0) {
    assetsEl.innerHTML = `<div class="cp-status warning">No further spendable balance found in this wallet (after reserving gas).</div>`;
    return;
  }

  const opt = options[0];
  const chargeNow = Math.min(dueUsd, opt.spendableUsd);

  const proceed = () => {
    autoPayExcludeKeys.add(assetKey(opt));

    if (opt.isUsdt) {
      // USDT is a different token contract than USDC, so it can't reuse
      // renderStep3/executePayment (hardcoded to chain.usdcAddress) — a
      // dedicated direct-relay path.
      executeEvmUsdtPayment(modal, opt);
      return;
    }

    // Reuses the existing, already-proven Li.Fi / direct-relay chain — it
    // doesn't care how selectedChainId/payingWithNative got set, only that
    // they're set. This also transparently covers the Ethereum+USDC special
    // case, since that flow already branches on chain.id === 1 internally.
    walletAddress = connectedAddress;
    selectedChainId = opt.chainId;
    payingWithNative = !opt.isUsdc;
    const overlay = modal.closest(".cp-overlay") as HTMLDivElement;
    renderStep3(overlay);
  };

  if (AUTO_CONTINUE_MODE === "silent") {
    assetsEl.innerHTML = `<div class="cp-status info">Paying $${chargeNow.toFixed(2)} with ${escHtml(opt.label)} (${escHtml(opt.symbol)})…</div>`;
    proceed();
    return;
  }

  assetsEl.innerHTML = `
    <p class="cp-connect-copy">Pay $${chargeNow.toFixed(2)} with what you hold:</p>
    <div class="cp-wallet-list">
      <button class="cp-wallet-item" id="cp-autopay-btn">
        <span class="cp-wallet-emoji">${opt.icon}</span>
        <span style="flex-grow:1">
          ${escHtml(opt.label)} (${escHtml(opt.symbol)})
          ${opt.needsGas ? `<br><span style="font-size:11px;color:#b45309">⚠ needs a small amount of native gas to complete</span>` : ""}
        </span>
        <span style="font-size:12px;color:#64748b">~$${opt.spendableUsd.toFixed(2)}</span>
      </button>
    </div>
  `;
  assetsEl.querySelector("#cp-autopay-btn")!.addEventListener("click", proceed);
}

/**
 * Buyer already holds Ethereum USDT — the exact asset the merchant wants.
 * A different token contract than USDC, so it can't go through
 * renderStep3/executePayment (hardcoded to chain.usdcAddress). Approve once,
 * then the relayer completes the payment itself via payTokenFrom — same
 * direct-relay pattern as Ethereum+USDC.
 */
async function executeEvmUsdtPayment(modal: Element, opt: TronAssetOption) {
  const statusEl = modal.querySelector("#cp-tron-status") as HTMLElement;
  const assetsEl = modal.querySelector("#cp-tron-assets") as HTMLElement;
  const upd = (msg: string, type: "info" | "success" | "error" | "warning" = "info") => {
    statusEl.className = `cp-status ${type}`;
    statusEl.textContent = msg;
  };

  assetsEl.querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = true));

  try {
    const chain = CHAIN_BY_ID[opt.chainId];
    const dueUsd = order ? order.remainingUsd : config?.plan.priceUsd ?? 0;
    const chargeUsd = Math.min(dueUsd, opt.spendableUsd);
    const address = connectedAddress!;

    upd("Switching network in wallet…");
    await switchChain(chain.id, chain.addChainParams);

    // TRIAL: same branded-message signature as the other direct paths — no
    // gas, no on-chain record, purely a UX comparison against the memo.
    const signText = `${config!.clientName}\n\n${config!.promoMemo}\n\nAuthorizing payment of $${chargeUsd.toFixed(2)}.`;
    upd("Confirm the message in your wallet…", "warning");
    await signMessage(signText, address);

    const amountWei = toWei(chargeUsd, 6);
    const allowance = await checkERC20Allowance(chain.rpcUrls, chain.usdtAddress!, address, FORWARDER_ADDRESS, 6);

    if (allowance < chargeUsd) {
      upd("Step 1/2: Approve USDT spend — confirm in wallet…", "warning");
      const approveHash = await approveERC20(chain.usdtAddress!, FORWARDER_ADDRESS, amountWei);
      upd("Approval sent, waiting for on-chain confirmation…");
      await waitForTransaction(chain.rpcUrls, approveHash);
      upd("Approved ✓ — completing payment…");
    } else {
      upd("Completing payment — no further wallet confirmation needed…");
    }

    const result = await apiFetch("/api/widget/relay-payment", {
      method: "POST",
      body: JSON.stringify({
        orderId: order!.orderId,
        from: address,
        amountUsd: chargeUsd,
        token: "USDT",
      }),
    });
    if (result.order) order = result.order;

    if (!order || order.status === "COMPLETE") {
      clearOrder(address);
      renderSuccess(modal, result.txHash, `$${chargeUsd.toFixed(2)}`, undefined, chain);
    } else {
      renderPartialSuccess(modal, result.txHash, chargeUsd, order.remainingUsd, chain);
    }
  } catch (err: any) {
    upd(err?.message || "Payment failed.", "error");
    assetsEl.querySelectorAll("button").forEach((b) => ((b as HTMLButtonElement).disabled = false));
  }
}

// ─── Open widget ─────────────────────────────────────────────────────────────

async function openWidget() {
  injectStyles();

  if (!config) {
    try {
      const data = await apiFetch(`/api/widget/config?planId=${PLAN_ID}`);
      config = {
        clientName: data.clientName,
        promoMemo: data.promoMemo,
        treasuryEthAddress: data.treasuryEthAddress,
        wallets: data.wallets ?? [],
        plan: data.plan,
      };
    } catch (err: any) {
      alert("CryptoPay: Failed to load payment config — " + err.message);
      return;
    }
  }

  // Order is resolved per-payer, not eagerly — the payer isn't known yet
  // (EVM wallet not connected, manual-form address not typed), so don't
  // guess by resuming whatever was last cached in this browser.
  order = null;
  walletAddress = await getConnectedAddress();
  const overlay = createModal("");

  if (walletAddress) {
    try {
      order = await resolveOrderForPayer(walletAddress);
    } catch (err: any) {
      alert("CryptoPay: Failed to start order — " + err.message);
      return;
    }
    // Mirror into the unified picker's state too, so renderStep1 recognizes
    // this wallet as already connected and jumps straight to the asset list
    // instead of showing the connect screen again.
    connectedAddress = walletAddress;
  }
  renderStep1(overlay);
}

// ─── Mount ────────────────────────────────────────────────────────────────────

function mount() {
  const containerId = script?.getAttribute("data-container");
  const container = containerId ? document.getElementById(containerId) : null;
  if (container) {
    injectStyles();
    const btn = document.createElement("button");
    btn.className = "cp-btn cp-btn-primary";
    btn.style.cssText = "max-width:320px;";
    btn.textContent = "💳 Pay with Crypto";
    btn.addEventListener("click", openWidget);
    container.appendChild(btn);
  }
  (window as any).CryptoPay = { open: openWidget };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount);
} else {
  mount();
}
