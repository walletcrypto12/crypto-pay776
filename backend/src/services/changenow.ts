/**
 * changenow.ts
 * Wraps ChangeNOW's instant-exchange API — the USDT-TRC20 settlement path,
 * for chains Li.Fi has no reach into (Tron isn't EVM-compatible). The buyer
 * sends to a deposit address ChangeNOW controls; ChangeNOW converts using
 * their own liquidity and pays out USDT-TRC20 to OUR OWN Tron relayer wallet
 * (not the client directly) — the relayer then forwards it on to the client
 * via CryptoPayForwarderTron, adding the on-chain memo. See tron.ts.
 *
 * All endpoint shapes below were verified against the live API, not assumed.
 */

const API_KEY = process.env.CHANGENOW_API_KEY;
const BASE = "https://api.changenow.io/v2";

export function isChangeNowConfigured(): boolean {
  return !!API_KEY;
}

async function cnFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-changenow-api-key": API_KEY ?? "",
      ...((opts.headers as Record<string, string>) ?? {}),
    },
  });
  const data = (await res.json()) as { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || `ChangeNOW HTTP ${res.status}`);
  return data;
}

export interface ExchangeEstimate {
  fromAmount: number;
  toAmount: number;
  depositFee: number;
  withdrawalFee: number;
}

/** Quote: how much USDT-TRC20 a given amount of some coin converts to right now. */
export async function getEstimate(
  fromCurrency: string,
  fromNetwork: string,
  fromAmount: number
): Promise<ExchangeEstimate> {
  const q = new URLSearchParams({
    fromCurrency,
    fromNetwork,
    toCurrency: "usdt",
    toNetwork: "trx",
    fromAmount: String(fromAmount),
    flow: "standard",
  });
  return cnFetch(`/exchange/estimated-amount?${q.toString()}`);
}

export interface CreatedExchange {
  id: string;
  payinAddress: string; // buyer sends their coin here
  payoutAddress: string; // our relayer's Tron address — where ChangeNOW pays out
  fromAmount: number;
  toAmount: number;
}

/** Opens an exchange — buyer's coin → USDT-TRC20, paid out to our relayer wallet. */
export async function createExchange(
  fromCurrency: string,
  fromNetwork: string,
  fromAmount: number,
  relayerTronAddress: string
): Promise<CreatedExchange> {
  return cnFetch("/exchange", {
    method: "POST",
    body: JSON.stringify({
      fromCurrency,
      fromNetwork,
      toCurrency: "usdt",
      toNetwork: "trx",
      fromAmount,
      flow: "standard",
      address: relayerTronAddress,
    }),
  });
}

export interface ExchangeStatus {
  id: string;
  status: string; // "waiting" | "confirming" | "exchanging" | "sending" | "finished" | "failed" | "refunded" | "verifying"
  amountTo: number | null;
  payinHash: string | null;
  payoutHash: string | null;
}

export async function getExchangeStatus(id: string): Promise<ExchangeStatus> {
  return cnFetch(`/exchange/by-id?id=${encodeURIComponent(id)}`);
}

export function isExchangeFinished(status: ExchangeStatus): boolean {
  return status.status === "finished";
}

export function isExchangeDead(status: ExchangeStatus): boolean {
  return status.status === "failed" || status.status === "refunded";
}
