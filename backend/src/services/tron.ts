/**
 * tron.ts
 * Completes USDT-TRC20 payments settled via ChangeNOW (see changenow.ts).
 * ChangeNOW pays out directly to this platform's own Tron wallet — unlike
 * the Ethereum relayer, this wallet owns the funds outright (no allowance
 * pull needed). It forwards them on to the client's wallet in two steps:
 * a plain transfer into CryptoPayForwarderTron, then a forwardToken call
 * that completes delivery and emits the on-chain memo.
 */

import { TronWeb } from "tronweb";

const PRIVATE_KEY = process.env.TRON_RELAYER_PRIVATE_KEY;

export const FORWARDER_TRON_ADDRESS = "TBLJHVFgNPsg2KF28GnY9EqhrtLvhAoTUG";
export const FORWARDER_TRON_V2_ADDRESS = "TQBDBbz4tnaRWzxZwTLHVWH8NkYC69zyj9";
export const USDT_TRC20_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

const TRC20_ABI = [
  {
    outputs: [{ type: "bool" }],
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    stateMutability: "Nonpayable",
    type: "Function",
  },
  {
    outputs: [{ type: "uint256" }],
    inputs: [{ name: "who", type: "address" }],
    name: "balanceOf",
    stateMutability: "View",
    type: "Function",
  },
  {
    outputs: [{ type: "uint256" }],
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    stateMutability: "View",
    type: "Function",
  },
] as const;

const FORWARDER_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
    ],
    name: "forwardToken",
    outputs: [],
    stateMutability: "Nonpayable",
    type: "Function",
  },
] as const;

const FORWARDER_V2_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
    ],
    name: "payTokenFrom",
    outputs: [],
    stateMutability: "Nonpayable",
    type: "Function",
  },
] as const;

function getTronWeb(): TronWeb {
  return new TronWeb({ fullHost: "https://api.trongrid.io", privateKey: PRIVATE_KEY });
}

export function isTronRelayerConfigured(): boolean {
  return !!PRIVATE_KEY;
}

/** The relayer's public address — safe to display anywhere (admin panel, docs). */
export function getTronRelayerAddress(): string | null {
  if (!PRIVATE_KEY) return null;
  return (getTronWeb().defaultAddress.base58 as string) || null;
}

export async function getTronRelayerBalance(): Promise<bigint> {
  const tronWeb = getTronWeb();
  const balance = await tronWeb.trx.getBalance(tronWeb.defaultAddress.base58 as string);
  return BigInt(balance);
}

async function waitForTronConfirmation(
  tronWeb: TronWeb,
  txHash: string,
  intervalMs = 3000,
  timeoutMs = 60_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await tronWeb.trx.getTransactionInfo(txHash).catch(() => null);
    if (info && info.id) {
      if (info.receipt?.result !== "SUCCESS") {
        throw new Error(`Tron deposit transaction failed: ${info.receipt?.result ?? "unknown"}`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Tron deposit transaction not confirmed within ${timeoutMs / 1000}s`);
}

/**
 * Moves USDT-TRC20 the relayer received (from ChangeNOW's payout) on to the
 * client's wallet, with a permanent on-chain memo. Two on-chain steps:
 * deposit into the forwarder contract, then forwardToken completes delivery.
 */
export async function relayTronPayment(
  clientAddress: string,
  amountUnits: bigint, // USDT-TRC20 has 6 decimals, same as USDC
  memo: string
): Promise<{ depositTxHash: string; forwardTxHash: string }> {
  if (!PRIVATE_KEY) throw new Error("Tron relayer is not configured on this platform.");

  const tronWeb = getTronWeb();
  const usdt = await tronWeb.contract(TRC20_ABI as any, USDT_TRC20_ADDRESS);
  const forwarder = await tronWeb.contract(FORWARDER_ABI as any, FORWARDER_TRON_ADDRESS);

  const depositTxHash: string = await usdt
    .transfer(FORWARDER_TRON_ADDRESS, amountUnits.toString())
    .send({ feeLimit: 200_000_000 });

  // Wait for the deposit to actually confirm before forwarding — otherwise
  // forwardToken could execute before the contract has the balance to send.
  await waitForTronConfirmation(tronWeb, depositTxHash);

  const forwardTxHash: string = await forwarder
    .forwardToken(USDT_TRC20_ADDRESS, clientAddress, amountUnits.toString(), memo)
    .send({ feeLimit: 200_000_000 });

  return { depositTxHash, forwardTxHash };
}

/**
 * Reads the live on-chain allowance a payer has granted CryptoPayForwarderTronV2
 * — verify before relaying, never trust the client's own claim.
 */
export async function getForwarderTronAllowance(owner: string): Promise<bigint> {
  const tronWeb = getTronWeb();
  const usdt = await tronWeb.contract(TRC20_ABI as any, USDT_TRC20_ADDRESS);
  const allowance = await usdt.allowance(owner, FORWARDER_TRON_V2_ADDRESS).call();
  return BigInt(allowance.toString());
}

/**
 * Completes a payment using a pre-existing USDT-TRC20 allowance — for a
 * buyer who already holds the exact asset the merchant wants and has
 * approved CryptoPayForwarderTronV2 once. No ChangeNOW conversion, no
 * deposit-then-forward hop — the relayer pulls directly and pays its own
 * energy, mirroring the Ethereum relayer's payTokenFrom.
 */
export async function relayTronPaymentFrom(
  from: string,
  to: string,
  amountUnits: bigint,
  memo: string
): Promise<{ txHash: string }> {
  if (!PRIVATE_KEY) throw new Error("Tron relayer is not configured on this platform.");

  const tronWeb = getTronWeb();
  const forwarder = await tronWeb.contract(FORWARDER_V2_ABI as any, FORWARDER_TRON_V2_ADDRESS);

  const txHash: string = await forwarder
    .payTokenFrom(USDT_TRC20_ADDRESS, from, to, amountUnits.toString(), memo)
    .send({ feeLimit: 200_000_000 });

  await waitForTronConfirmation(tronWeb, txHash);
  return { txHash };
}
