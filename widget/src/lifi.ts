// Li.Fi REST API wrapper — no SDK, direct fetch only

import { USDC_ETH_ADDRESS, NATIVE_TOKEN } from "./chains";

const LIFI_API = "https://li.quest/v1";
const INTEGRATOR = "CryptoPay";
const SLIPPAGE = 0.005; // 0.5%
const ETH_CHAIN_ID = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LiFiQuoteParams {
  fromChainId: number;      // Source chain (e.g. 137 for Polygon)
  fromTokenAddress: string; // Token user is paying with (NATIVE_TOKEN or ERC-20)
  fromAmountWei: string;    // Amount in smallest unit (wei / token base unit), as decimal string
  fromAddress: string;      // User's wallet address
  toAddress: string;        // Recipient (the client's ETH treasury address)
}

export interface LiFiQuote {
  transactionRequest: {
    from: string;
    to: string;
    data: string;
    value: string;     // hex
    gasLimit: string;  // hex
    chainId: number;
  };
  estimate: {
    approvalAddress?: string;  // Token spender to approve (present for ERC-20 source)
    fromAmount: string;        // Source amount (wei)
    toAmount: string;          // How much USDC arrives (6 decimals)
    toAmountMin: string;       // Minimum USDC after slippage
    executionDuration: number; // Seconds
    feeCosts?: { amountUSD: string }[];
    gasCosts?: { amountUSD: string }[];
  };
  action: {
    fromToken: { symbol: string; decimals: number };
    toToken: { symbol: string; decimals: number };
    fromChainId: number;
    toChainId: number;
  };
  tool: string;  // Route name (e.g. "stargate", "across", "lifi")
}

export type LiFiStatus = "PENDING" | "DONE" | "FAILED" | "NOT_FOUND" | "INVALID";

export interface LiFiStatusResult {
  status: LiFiStatus;
  substatus?: string;
  receiving?: {
    txHash?: string;
    amount?: string;    // USDC received (wei)
  };
}

// ── Quote ─────────────────────────────────────────────────────────────────────

/**
 * Fetch a Li.Fi cross-chain swap/bridge quote.
 * Always routes to USDC on Ethereum mainnet.
 */
export async function getLiFiQuote(params: LiFiQuoteParams): Promise<LiFiQuote> {
  const url = new URL(`${LIFI_API}/quote`);
  url.searchParams.set("fromChain", String(params.fromChainId));
  url.searchParams.set("toChain", String(ETH_CHAIN_ID));
  url.searchParams.set("fromToken", params.fromTokenAddress);
  url.searchParams.set("toToken", USDC_ETH_ADDRESS);
  url.searchParams.set("fromAmount", params.fromAmountWei);
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("toAddress", params.toAddress);
  url.searchParams.set("slippage", String(SLIPPAGE));
  url.searchParams.set("integrator", INTEGRATOR);
  // Prefer direct bridges when on Ethereum; aggregated routes on other chains
  url.searchParams.set("order", "RECOMMENDED");

  const res = await fetch(url.toString());
  if (!res.ok) {
    let msg = `Li.Fi API error ${res.status}`;
    try {
      const err = await res.json();
      msg = err.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<LiFiQuote>;
}

// ── Status polling ────────────────────────────────────────────────────────────

/**
 * Check a Li.Fi bridge/swap transaction's status.
 * Poll this every ~5 s until status is "DONE" or "FAILED".
 */
export async function getLiFiStatus(
  txHash: string,
  fromChainId: number
): Promise<LiFiStatusResult> {
  const url = new URL(`${LIFI_API}/status`);
  url.searchParams.set("txHash", txHash);
  url.searchParams.set("fromChain", String(fromChainId));
  url.searchParams.set("toChain", String(ETH_CHAIN_ID));

  const res = await fetch(url.toString());
  if (!res.ok) {
    // 404 means not yet indexed — treat as PENDING
    if (res.status === 404) return { status: "NOT_FOUND" };
    return { status: "PENDING" };
  }
  return res.json() as Promise<LiFiStatusResult>;
}

/**
 * Poll Li.Fi status until DONE or FAILED (or timeout).
 * Calls `onProgress` on each tick with the raw status object.
 * Returns the final status result.
 */
export async function waitForLiFiStatus(
  txHash: string,
  fromChainId: number,
  onProgress: (s: LiFiStatusResult) => void,
  intervalMs = 5000,
  timeoutMs = 600_000  // 10 minutes — bridges can be slow
): Promise<LiFiStatusResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getLiFiStatus(txHash, fromChainId);
    onProgress(result);
    if (result.status === "DONE" || result.status === "FAILED") return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: "FAILED", substatus: "TIMEOUT" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Compute total fee cost in USD from a quote estimate */
export function totalFeeUSD(quote: LiFiQuote): number {
  let total = 0;
  for (const f of quote.estimate.feeCosts ?? []) total += parseFloat(f.amountUSD || "0");
  for (const g of quote.estimate.gasCosts ?? []) total += parseFloat(g.amountUSD || "0");
  return total;
}

/** True when the from-token is the native coin (ETH, MATIC, BNB, …) */
export function isNativeToken(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN.toLowerCase();
}

/** Format a USDC amount (6 decimals) as "$X.XX" */
export function formatUSDC(amountWei: string): string {
  const n = parseInt(amountWei, 10) / 1_000_000;
  return "$" + n.toFixed(2);
}
