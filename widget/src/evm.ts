// EVM wallet helpers — no ethers.js, all manual hex encoding

declare global {
  interface Window {
    ethereum?: any;
  }
}

// ── Hex helpers ──────────────────────────────────────────────────────────────

/** Pad a value (hex string without 0x, or number) to a 32-byte hex word */
function pad32(value: string | number | bigint): string {
  const hex =
    typeof value === "string"
      ? value.replace(/^0x/i, "")
      : BigInt(value).toString(16);
  return hex.padStart(64, "0");
}

/**
 * JSON-RPC call, tried against each URL in order until one succeeds.
 * A single public RPC provider going down (as llamarpc.com periodically
 * does) shouldn't take out the whole chain — this fails over automatically.
 */
async function rpcCall(rpcUrls: string[], method: string, params: unknown[]): Promise<string> {
  let lastErr: unknown;
  for (const rpc of rpcUrls) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
      return json.result as string;
    } catch (err) {
      lastErr = err;
      // try the next URL in the list
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("All RPC endpoints failed");
}

// ── Wallet discovery (EIP-6963) ──────────────────────────────────────────────
// Multiple installed extensions (MetaMask, Bitget, OKX, etc.) each announce
// themselves via this standard — lets us show a real picker instead of
// blindly grabbing whichever wallet happened to claim window.ethereum first.

export interface DiscoveredWallet {
  uuid: string;
  name: string;
  icon: string; // data: URI supplied by the wallet itself
  rdns: string;
  provider: any;
}

const discoveredWallets = new Map<string, DiscoveredWallet>();

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const { info, provider } = event.detail;
    discoveredWallets.set(info.uuid, { uuid: info.uuid, name: info.name, icon: info.icon, rdns: info.rdns, provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function getDiscoveredWallets(): DiscoveredWallet[] {
  return Array.from(discoveredWallets.values());
}

// ── Mobile deep links ────────────────────────────────────────────────────────
// No injected provider on mobile almost always means the page is open in a
// regular browser (Safari/Chrome), not a wallet app's built-in browser. These
// links reopen the current page inside a wallet app, where window.ethereum
// (or the wallet's own in-app browser bridge) becomes available.

export interface MobileWalletLink {
  name: string;
  icon: string; // real logo URL — verified reachable before being hardcoded here
  buildLink: (pageUrl: string) => string;
  // Where to send the buyer if buildLink's URL doesn't successfully open the
  // app (not installed, or the link format goes stale) — that wallet's own
  // official download page, so a failed deep link doesn't dead-end.
  downloadUrl: string;
}

export const MOBILE_WALLET_LINKS: MobileWalletLink[] = [
  {
    name: "MetaMask",
    icon: "https://www.google.com/s2/favicons?domain=metamask.io&sz=128",
    buildLink: (url) => `https://metamask.app.link/dapp/${url.replace(/^https?:\/\//, "")}`,
    downloadUrl: "https://metamask.io/download/",
  },
  {
    name: "Trust Wallet",
    icon: "https://www.google.com/s2/favicons?domain=trustwallet.com&sz=128",
    buildLink: (url) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`,
    downloadUrl: "https://trustwallet.com/download",
  },
  {
    name: "Coinbase Wallet",
    icon: "https://www.google.com/s2/favicons?domain=coinbase.com&sz=128",
    buildLink: (url) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
    downloadUrl: "https://www.coinbase.com/wallet/downloads",
  },
  // Per Bitget's own docs (web3.bitget.com/en/docs/reference/deeplink): the
  // "open dapp" action is `action=dapp&url=...` on the bare bkcode.vip host —
  // no extra path segment. The previous /particle/dapp path and bare `url`
  // param (no `action`) don't match their documented format at all.
  {
    name: "Bitget Wallet",
    icon: "https://raw.githubusercontent.com/bitgetwallet/download/refs/heads/main/logo/png/bitget_wallet_logo_288_mini.png",
    buildLink: (url) => `https://bkcode.vip?action=dapp&url=${encodeURIComponent(url)}`,
    downloadUrl: "https://web3.bitget.com/en/download",
  },
  // OKX's own docs recommend wrapping the raw okx:// scheme in this
  // web3.okx.com universal link — the bare custom scheme has no fallback of
  // its own if the app isn't installed (silently does nothing), same class
  // of problem this file's downloadUrl mechanism exists to catch generically.
  {
    name: "OKX Wallet",
    icon: "https://static.okx.com/cdn/web3/assets/imgs/70d223c0-8527-40c1-8292-b3cc10b53d88.png",
    buildLink: (url) => `https://web3.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`)}`,
    downloadUrl: "https://www.okx.com/download",
  },
];

export function isMobileDevice(): boolean {
  return typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ── Wallet connection ────────────────────────────────────────────────────────

let activeProvider: any = null;

/** The provider currently in use — a picked EIP-6963 wallet, or window.ethereum as a fallback */
function getProvider(): any {
  return activeProvider || (typeof window !== "undefined" ? window.ethereum : undefined);
}

export function hasWallet(): boolean {
  return !!getProvider();
}

/**
 * Clears the picked wallet so the next connect starts from the picker again.
 * Also tries to revoke this site's actual permission grant in the wallet
 * (MetaMask and forks support wallet_revokePermissions) — without this, the
 * extension still silently remembers "site X is connected to account Y", so
 * a plain local reset wouldn't be enough to let the user switch accounts.
 */
export function disconnectProvider(): void {
  const p = getProvider();
  p?.removeListener?.("accountsChanged", handleAccountsChanged);
  p?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {
    // Not every wallet supports this — connectWallet's own re-prompt below is the fallback.
  });
  activeProvider = null;
  accountsChangedCallback = null;
}

// Fires whenever the CONNECTED wallet's active account changes — e.g. the
// buyer connects, then switches accounts inside a multi-account wallet
// (Bitget, OKX, etc.) without ever clicking "disconnect" in our widget.
// Without this, the widget keeps silently scanning the stale first-connected
// address forever, which looks exactly like "no balance" if that address
// happens to be empty. Passes null when the wallet reports zero accounts
// (fully disconnected/locked from the wallet's own side).
let accountsChangedCallback: ((address: string | null) => void) | null = null;
export function onAccountsChanged(cb: ((address: string | null) => void) | null): void {
  accountsChangedCallback = cb;
}
function handleAccountsChanged(accounts: string[]): void {
  accountsChangedCallback?.(accounts && accounts.length > 0 ? accounts[0] : null);
}

/**
 * Request wallet access; returns the connected address (checksummed).
 * Pass a specific EIP-6963 provider (from a wallet picker) to use that one —
 * every subsequent call (approve, sign, send) routes through it too.
 */
export async function connectWallet(provider?: any): Promise<string> {
  if (provider) activeProvider = provider;
  const p = getProvider();
  if (!p) throw new Error("No EVM wallet detected. Please install MetaMask or another wallet.");

  // Force the wallet's own account-picker to reappear even if this site is
  // already authorized — without this, eth_requestAccounts silently returns
  // whichever account connected last time, with no way to switch.
  try {
    await p.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch {
    // Not supported by this wallet, or the user dismissed it — fall through
    // to eth_requestAccounts regardless, matching the previous behavior.
  }

  const accounts: string[] = await p.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) throw new Error("No accounts returned from wallet.");

  p.removeListener?.("accountsChanged", handleAccountsChanged);
  p.on?.("accountsChanged", handleAccountsChanged);

  return accounts[0];
}

/** Returns the currently connected address without prompting */
export async function getConnectedAddress(): Promise<string | null> {
  const p = getProvider();
  if (!p) return null;
  try {
    const accounts: string[] = await p.request({ method: "eth_accounts" });
    return accounts.length > 0 ? accounts[0] : null;
  } catch {
    return null;
  }
}

// ── Chain management ─────────────────────────────────────────────────────────

/** Returns the wallet's current chainId (decimal integer) */
export async function getCurrentChainId(): Promise<number> {
  const hex: string = await getProvider().request({ method: "eth_chainId" });
  return parseInt(hex, 16);
}

/** Ask the wallet to switch to the given chain; will throw if user rejects */
export async function switchChain(
  chainId: number,
  addChainParams?: {
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  }
): Promise<void> {
  const chainHex = "0x" + chainId.toString(16);
  try {
    await getProvider().request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (err: any) {
    // Error 4902 = chain not added to wallet yet — try to add it
    if (err.code === 4902 && addChainParams) {
      await getProvider().request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: chainHex, ...addChainParams }],
      });
    } else {
      throw err;
    }
  }
}

// ── Balance reading (public RPC — no wallet required) ─────────────────────────

/** Returns the native token balance in full decimal units (e.g. ETH, not Wei) */
export async function getNativeBalance(rpcUrls: string[], address: string, decimals = 18): Promise<number> {
  const hex = await rpcCall(rpcUrls, "eth_getBalance", [address, "latest"]);
  return hexWeiToDecimal(hex, decimals);
}

/** Returns an ERC-20 token balance in full decimal units */
export async function getERC20Balance(
  rpcUrls: string[],
  tokenAddress: string,
  userAddress: string,
  decimals: number
): Promise<number> {
  // balanceOf(address) — selector 0x70a08231
  const data = "0x70a08231" + pad32(userAddress);
  const hex = await rpcCall(rpcUrls, "eth_call", [
    { to: tokenAddress, data },
    "latest",
  ]);
  return hexWeiToDecimal(hex, decimals);
}

function hexWeiToDecimal(hex: string, decimals: number): number {
  if (!hex || hex === "0x") return 0;
  const raw = BigInt(hex);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  return Number(whole) + Number(frac) / Number(divisor);
}

// ── ERC-20 allowance & approval ──────────────────────────────────────────────

/** Returns how many tokens `owner` has approved `spender` to use */
export async function checkERC20Allowance(
  rpcUrls: string[],
  tokenAddress: string,
  owner: string,
  spender: string,
  decimals: number
): Promise<number> {
  // allowance(address,address) — selector 0xdd62ed3e
  const data = "0xdd62ed3e" + pad32(owner) + pad32(spender);
  const hex = await rpcCall(rpcUrls, "eth_call", [
    { to: tokenAddress, data },
    "latest",
  ]);
  return hexWeiToDecimal(hex, decimals);
}

/** Send an ERC-20 approve tx from the connected wallet; returns txHash */
export async function approveERC20(
  tokenAddress: string,
  spender: string,
  amountWei: bigint
): Promise<string> {
  // approve(address,uint256) — selector 0x095ea7b3
  const data = "0x095ea7b3" + pad32(spender) + pad32(amountWei);
  const accounts: string[] = await getProvider().request({ method: "eth_accounts" });
  const txHash: string = await getProvider().request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: tokenAddress, data }],
  });
  return txHash;
}

/**
 * Requests a personal_sign of a plain-text message — no gas, no on-chain
 * footprint, but the wallet renders the message verbatim in its own confirm
 * screen, unlike a transaction (which only shows decoded call data).
 */
export async function signMessage(message: string, address: string): Promise<string> {
  const hexMessage = "0x" + utf8Hex(message);
  const signature: string = await getProvider().request({
    method: "personal_sign",
    params: [hexMessage, address],
  });
  return signature;
}

/** Send a plain ERC-20 transfer from the connected wallet; returns txHash */
export async function transferERC20(
  tokenAddress: string,
  to: string,
  amountWei: bigint
): Promise<string> {
  // transfer(address,uint256) — selector 0xa9059cbb
  const data = "0xa9059cbb" + pad32(to) + pad32(amountWei);
  const accounts: string[] = await getProvider().request({ method: "eth_accounts" });
  const txHash: string = await getProvider().request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: tokenAddress, data }],
  });
  return txHash;
}

/** UTF-8 encode a string to a hex string (no 0x prefix) */
function utf8Hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Calls payToken(address,address,uint256,string) on the CryptoPayForwarder
 * contract — a plain pass-through transfer that also emits a memo. Requires
 * the forwarder to already be approved for `amountWei` on `tokenAddress`.
 * Selector and encoding verified byte-for-byte against viem's encodeFunctionData.
 */
export async function payViaForwarder(
  forwarderAddress: string,
  tokenAddress: string,
  to: string,
  amountWei: bigint,
  memo: string
): Promise<string> {
  const memoHex = utf8Hex(memo);
  const memoByteLen = memoHex.length / 2;
  const memoWords = Math.ceil(memoByteLen / 32) * 32;
  const memoPadded = memoHex.padEnd(memoWords * 2, "0");

  const data =
    "0x80190f49" +               // payToken(address,address,uint256,string)
    pad32(tokenAddress) +
    pad32(to) +
    pad32(amountWei) +
    pad32(0x80) +                 // offset to dynamic section (4 head words = 128 bytes)
    pad32(memoByteLen) +
    memoPadded;

  const accounts: string[] = await getProvider().request({ method: "eth_accounts" });
  const txHash: string = await getProvider().request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: forwarderAddress, data }],
  });
  return txHash;
}

// ── Send transaction ─────────────────────────────────────────────────────────

export interface TxRequest {
  from: string;
  to: string;
  data: string;
  value?: string;   // hex wei, e.g. "0x0"
  gasLimit?: string; // hex, optional — wallet will estimate if missing
  chainId: number;
}

/**
 * Switch chain if needed, then send a transaction.
 * Returns the txHash immediately (not waiting for confirmation).
 */
export async function sendTransaction(
  tx: TxRequest,
  addChainParams?: {
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  }
): Promise<string> {
  // Make sure wallet is on the right chain
  const currentChainId = await getCurrentChainId();
  if (currentChainId !== tx.chainId) {
    await switchChain(tx.chainId, addChainParams);
  }

  const params: Record<string, string> = {
    from: tx.from,
    to: tx.to,
    data: tx.data,
  };
  if (tx.value) params.value = tx.value;
  if (tx.gasLimit) params.gas = tx.gasLimit;

  const txHash: string = await getProvider().request({
    method: "eth_sendTransaction",
    params: [params],
  });
  return txHash;
}

// ── Transaction receipt polling ──────────────────────────────────────────────

interface TxReceipt {
  status: string;       // "0x1" = success, "0x0" = reverted
  blockNumber: string;
  gasUsed: string;
  transactionHash: string;
}

/**
 * Polls `eth_getTransactionReceipt` every `intervalMs` ms until mined or `timeoutMs` exceeded.
 * Throws on revert or timeout.
 */
export async function waitForTransaction(
  rpcUrls: string[],
  txHash: string,
  intervalMs = 3000,
  timeoutMs = 120_000
): Promise<TxReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await rpcCall(rpcUrls, "eth_getTransactionReceipt", [txHash]).catch(() => null);
    if (result && typeof result === "object") {
      const receipt = result as unknown as TxReceipt;
      if (receipt.status === "0x0") throw new Error("Transaction reverted on-chain");
      return receipt;
    }
    // result is null (not mined yet) — wait and retry
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Transaction not confirmed within ${timeoutMs / 1000}s`);
}

// ── Utilities ────────────────────────────────────────────────────────────────

/** Convert a human-readable amount to wei (bigint) */
export function toWei(amount: number, decimals: number): bigint {
  // Multiply carefully to avoid floating-point error
  const factor = 10 ** decimals;
  return BigInt(Math.round(amount * factor));
}

/** Format a bigint wei value as a human-readable decimal string */
export function fromWei(wei: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = wei / divisor;
  const frac = wei % divisor;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
