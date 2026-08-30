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
  getNativeBalance, getERC20Balance, approveERC20,
  sendTransaction, waitForTransaction, toWei,
} from "./evm";
import {
  getLiFiQuote, waitForLiFiStatus, totalFeeUSD, formatUSDC,
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

if (!API_KEY) {
  console.error("[CryptoPay] Missing data-api-key attribute on script tag.");
}

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
  treasuryEthAddress: string;
  plan: { id: string; name: string; priceUsd: number; intervalDays: number; lifetime: boolean };
}

let config: WidgetConfig | null = null;
let walletAddress: string | null = null;
let selectedChainId: number | null = null;
let currentQuote: LiFiQuote | null = null;
let payingWithNative = true;

// ─── Styles ──────────────────────────────────────────────────────────────────

const CSS = `
.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
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
  if (!config) return "";
  const interval = config.plan.lifetime
    ? "Lifetime access"
    : `Every ${config.plan.intervalDays} day${config.plan.intervalDays === 1 ? "" : "s"}`;
  return `
    <div class="cp-plan-badge">
      <div class="cp-plan-name">${escHtml(config.clientName)} — ${escHtml(config.plan.name)}</div>
      <div class="cp-plan-price">$${config.plan.priceUsd.toFixed(2)}</div>
      <div class="cp-plan-interval">${interval}</div>
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
  const walletAvail = hasWallet();

  modal.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">💳 Complete Payment</span>
      <button class="cp-close" id="cp-close">✕</button>
    </div>
    ${planBadgeHtml()}
    <div class="cp-tabs">
      <button class="cp-tab active" data-tab="evm">EVM Wallet</button>
      <button class="cp-tab" data-tab="manual">BTC / SOL / XRP</button>
    </div>
    <div id="cp-tab-evm">
      ${walletAvail
        ? `<p style="font-size:13px;color:#475569;margin:0 0 14px">Connect MetaMask or any EVM wallet. We'll convert your tokens to USDC on Ethereum automatically.</p>
           <button class="cp-btn cp-btn-primary" id="cp-connect-btn">🔗 Connect Wallet</button>
           <div id="cp-connect-status"></div>`
        : `<div class="cp-status warning">No EVM wallet detected. Install <a href="https://metamask.io" target="_blank" class="cp-link">MetaMask</a> or open in a wallet browser.</div>`
      }
    </div>
    <div id="cp-tab-manual" style="display:none">
      ${renderManualFormHtml()}
    </div>
  `;

  modal.querySelector("#cp-close")!.addEventListener("click", () => overlay.remove());

  // Tab switching
  modal.querySelectorAll(".cp-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      modal.querySelectorAll(".cp-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      const target = (tab as HTMLElement).dataset.tab;
      (modal.querySelector("#cp-tab-evm") as HTMLElement).style.display = target === "evm" ? "" : "none";
      (modal.querySelector("#cp-tab-manual") as HTMLElement).style.display = target === "manual" ? "" : "none";
    });
  });

  // Connect wallet
  const connectBtn = modal.querySelector("#cp-connect-btn") as HTMLButtonElement | null;
  const connectStatus = modal.querySelector("#cp-connect-status");
  connectBtn?.addEventListener("click", async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting…";
    try {
      walletAddress = await connectWallet();
      renderStep2(overlay);
    } catch (err: any) {
      connectBtn.disabled = false;
      connectBtn.textContent = "🔗 Connect Wallet";
      if (connectStatus) {
        connectStatus.className = "cp-status error";
        connectStatus.textContent = err.message || "Failed to connect.";
      }
    }
  });

  // Manual form
  modal.querySelector("#cp-manual-form")?.addEventListener("submit", handleManualSubmit(overlay));
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

  modal.querySelector("#cp-chain-list")!.addEventListener("click", (e) => {
    const item = (e.target as HTMLElement).closest(".cp-chain-item") as HTMLElement | null;
    if (!item) return;
    selectedChainId = parseInt(item.dataset.chain!, 10);
    renderStep3(overlay);
  });

  loadChainBalances(modal);
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
          getNativeBalance(chain.rpc, walletAddress!, chain.nativeDecimals),
          getERC20Balance(chain.rpc, chain.usdcAddress, walletAddress!, 6),
          pricePromises[chain.coingeckoId],
        ]);
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

  modal.innerHTML = `
    <div class="cp-header">
      <span class="cp-title">${chain.icon} Pay via ${chain.name}</span>
      <button class="cp-close" id="cp-close">✕</button>
    </div>
    ${planBadgeHtml()}
    <div class="cp-toggle-row">
      <button class="cp-toggle-btn active" id="btn-native">Use ${chain.nativeSymbol}</button>
      <button class="cp-toggle-btn" id="btn-usdc">Use USDC</button>
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

  payingWithNative = true;
  await fetchAndRenderQuote(modal, chain);
}

async function fetchAndRenderQuote(modal: Element, chain: (typeof CHAINS)[0]) {
  const area = modal.querySelector("#cp-quote-area")!;
  area.innerHTML = `<div class="cp-status info">Fetching best route… ⏳</div>`;

  try {
    const fromToken = payingWithNative ? NATIVE_TOKEN : chain.usdcAddress;
    const tokenPrice = payingWithNative ? await getUsdPrice(chain.coingeckoId) : 1.0;
    if (tokenPrice === 0) throw new Error("Couldn't fetch token price. Try again.");

    const priceUsd = config!.plan.priceUsd;
    const fromAmountDecimal = priceUsd / tokenPrice;
    const fromAmountWei = toWei(
      fromAmountDecimal,
      payingWithNative ? chain.nativeDecimals : 6
    ).toString();

    const quote = await getLiFiQuote({
      fromChainId: chain.id,
      fromTokenAddress: fromToken,
      fromAmountWei,
      fromAddress: walletAddress!,
      toAddress: config!.treasuryEthAddress,
    });
    currentQuote = quote;

    const fees = totalFeeUSD(quote).toFixed(2);
    const toUsd = (parseInt(quote.estimate.toAmount, 10) / 1_000_000).toFixed(2);
    const toMin = formatUSDC(quote.estimate.toAmountMin);
    const dur = formatDuration(quote.estimate.executionDuration);
    const fromDisplay = payingWithNative
      ? `${fromAmountDecimal.toFixed(6)} ${chain.nativeSymbol}`
      : `${fromAmountDecimal.toFixed(2)} USDC (${chain.name})`;
    const needsApproval = !payingWithNative && !!quote.estimate.approvalAddress;

    area.innerHTML = `
      <div class="cp-quote-box">
        <div class="cp-quote-row"><span>You send</span><strong>${escHtml(fromDisplay)}</strong></div>
        <div class="cp-quote-row"><span>USDC arrives (ETH)</span><strong>$${toUsd}</strong></div>
        <div class="cp-quote-row"><span>Minimum received</span><strong>${toMin}</strong></div>
        <div class="cp-quote-row"><span>Network fees</span><strong>~$${fees}</strong></div>
        <div class="cp-quote-row"><span>Est. time</span><strong>${dur}</strong></div>
        <div class="cp-quote-row"><span>Route</span><strong>${escHtml(quote.tool)}</strong></div>
      </div>
      ${needsApproval ? `<div class="cp-status warning" style="margin-bottom:8px">⚠️ 2-step: Approve spend → Send payment</div>` : ""}
      <button class="cp-btn cp-btn-primary" id="cp-pay-btn">
        ${needsApproval ? "Approve & Pay" : "Confirm Payment"}
      </button>
      <div id="cp-pay-status"></div>
    `;

    modal.querySelector("#cp-pay-btn")!.addEventListener("click", () =>
      executePayment(modal, chain)
    );
  } catch (err: any) {
    area.innerHTML = `
      <div class="cp-status error">${escHtml(err.message || "Route not available for this token")}</div>
      <button class="cp-btn cp-btn-secondary" id="cp-retry" style="margin-top:8px">Try ${payingWithNative ? "USDC" : chain.nativeSymbol} instead</button>
    `;
    modal.querySelector("#cp-retry")?.addEventListener("click", () => {
      payingWithNative = !payingWithNative;
      modal.querySelector("#btn-native")!.classList.toggle("active", payingWithNative);
      modal.querySelector("#btn-usdc")!.classList.toggle("active", !payingWithNative);
      fetchAndRenderQuote(modal, chain);
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
  const quote = currentQuote!;

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

    // 2. ERC-20 approval (USDC source only)
    if (!payingWithNative && quote.estimate.approvalAddress) {
      upd("Step 1/2: Approve USDC spend — confirm in wallet…", "warning");
      const approveHash = await approveERC20(
        chain.usdcAddress,
        quote.estimate.approvalAddress,
        BigInt(quote.estimate.fromAmount)
      );
      upd("Approval sent, waiting for on-chain confirmation…");
      await waitForTransaction(chain.rpc, approveHash);
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
    await waitForTransaction(chain.rpc, txHash);
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
      : `$${config!.plan.priceUsd.toFixed(2)}`;

    // 6. Record in backend
    upd("Recording payment…");
    await apiFetch("/api/widget/transaction", {
      method: "POST",
      body: JSON.stringify({
        planId: PLAN_ID || config!.plan.id,
        txHash,
        chain: chain.name,
        fromAddress: walletAddress,
        amountUsd: config!.plan.priceUsd,
        destinationTxHash: finalStatus.receiving?.txHash,
      }),
    });

    // 7. Success
    renderSuccess(modal, txHash, usdcReceived, finalStatus.receiving?.txHash, chain);
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
  modal.innerHTML = `
    <div class="cp-success-icon">🎉</div>
    <h2 style="text-align:center;font-size:20px;font-weight:800;color:#0f172a;margin:0 0 8px">Payment Successful!</h2>
    <p style="text-align:center;font-size:14px;color:#64748b;margin:0 0 20px">
      ${usdcReceived} USDC delivered to ${escHtml(config!.clientName)}'s treasury.
    </p>
    <div class="cp-quote-box">
      <div class="cp-quote-row"><span>Plan</span><strong>${escHtml(config!.plan.name)}</strong></div>
      <div class="cp-quote-row"><span>USDC received</span><strong>${usdcReceived}</strong></div>
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

// ─── Manual payment form ──────────────────────────────────────────────────────

function renderManualFormHtml(): string {
  return `
    <form id="cp-manual-form">
      <label class="cp-label">Chain</label>
      <select class="cp-input" name="chain" required>
        <option value="">Select chain…</option>
        <option value="BTC">Bitcoin (BTC)</option>
        <option value="SOL">Solana (SOL)</option>
        <option value="XRP">XRP Ledger</option>
      </select>
      <label class="cp-label">Your sending address</label>
      <input class="cp-input" name="fromAddress" placeholder="Your wallet address" required />
      <label class="cp-label">Transaction hash</label>
      <input class="cp-input" name="txHash" placeholder="Paste tx hash after sending" required />
      <p style="font-size:11px;color:#94a3b8;margin:0 0 8px">
        Send exactly <strong>$${config?.plan.priceUsd.toFixed(2) ?? "…"}</strong> to the wallet address shown in the merchant's checkout. Paste the transaction hash above after sending.
      </p>
      <button type="submit" class="cp-btn cp-btn-primary">Submit for Verification</button>
      <div id="cp-manual-status"></div>
    </form>
  `;
}

function handleManualSubmit(overlay: HTMLDivElement) {
  return async (e: Event) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const data = new FormData(form);
    const chain = data.get("chain") as string;
    const fromAddress = data.get("fromAddress") as string;
    const txHash = data.get("txHash") as string;
    const statusEl = form.querySelector("#cp-manual-status") as HTMLElement;
    const btn = form.querySelector("button[type=submit]") as HTMLButtonElement;

    btn.disabled = true;
    btn.textContent = "Submitting…";
    try {
      await apiFetch("/api/widget/transaction", {
        method: "POST",
        body: JSON.stringify({
          planId: PLAN_ID || config!.plan.id,
          txHash,
          chain,
          fromAddress,
          amountUsd: config!.plan.priceUsd,
        }),
      });
      statusEl.className = "cp-status success";
      statusEl.textContent = "✓ Submitted! Your payment will be verified by the merchant.";
      btn.textContent = "Submitted ✓";
    } catch (err: any) {
      btn.disabled = false;
      btn.textContent = "Submit for Verification";
      statusEl.className = "cp-status error";
      statusEl.textContent = err.message || "Submission failed. Try again.";
    }
  };
}

// ─── Open widget ─────────────────────────────────────────────────────────────

async function openWidget() {
  injectStyles();

  if (!config) {
    try {
      const data = await apiFetch(`/api/widget/config?planId=${PLAN_ID}`);
      config = {
        clientName: data.clientName,
        treasuryEthAddress: data.treasuryEthAddress,
        plan: data.plan,
      };
    } catch (err: any) {
      alert("CryptoPay: Failed to load payment config — " + err.message);
      return;
    }
  }

  walletAddress = await getConnectedAddress();
  const overlay = createModal("");
  walletAddress ? renderStep2(overlay) : renderStep1(overlay);
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
