/**
 * relayer.ts
 * Completes a payment on the payer's behalf using a pre-existing ERC-20
 * allowance to CryptoPayForwarderV2's payTokenFrom function — no second
 * wallet signature required from the user once they've approved once.
 * This is the only place besides gasDrop.ts where the backend holds a key
 * that moves funds — here specifically funds a user has already approved.
 */

import { createWalletClient, createPublicClient, http, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as `0x${string}` | undefined;

export const FORWARDER_V2_ADDRESS = "0x92afa0d7f5fc7d7dfa24c2224ea707b136d1284e";
export const USDC_ETH_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const USDT_ETH_ADDRESS = "0xdac17f958d2ee523a2206206994597c13d831ec7";

const FORWARDER_ABI = [
  {
    name: "payTokenFrom",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "memo", type: "string" },
    ],
    outputs: [],
  },
] as const;

const ERC20_ALLOWANCE_ABI = [
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const mainnet = defineChain({
  id: 1,
  name: "Ethereum",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://ethereum.publicnode.com", "https://eth.llamarpc.com"] } },
});

export function isRelayerConfigured(): boolean {
  return !!PRIVATE_KEY;
}

/** The relayer's public address — safe to display anywhere (admin panel, docs). */
export function getRelayerAddress(): string | null {
  if (!PRIVATE_KEY) return null;
  return privateKeyToAccount(PRIVATE_KEY).address;
}

/** Reads the live on-chain allowance the payer has granted the forwarder — verify before relaying. */
export async function getForwarderAllowance(owner: string, token: string = USDC_ETH_ADDRESS): Promise<bigint> {
  const publicClient = createPublicClient({ chain: mainnet, transport: http() });
  return publicClient.readContract({
    address: token as `0x${string}`,
    abi: ERC20_ALLOWANCE_ABI,
    functionName: "allowance",
    args: [owner as `0x${string}`, FORWARDER_V2_ADDRESS as `0x${string}`],
  });
}

export async function relayPayment(
  from: string,
  to: string,
  amountWei: bigint,
  memo: string,
  token: string = USDC_ETH_ADDRESS
): Promise<{ txHash: string }> {
  if (!PRIVATE_KEY) throw new Error("Relayer is not configured on this platform.");

  const account = privateKeyToAccount(PRIVATE_KEY);
  const wallet = createWalletClient({ account, chain: mainnet, transport: http() });
  const publicClient = createPublicClient({ chain: mainnet, transport: http() });

  const txHash = await wallet.writeContract({
    address: FORWARDER_V2_ADDRESS as `0x${string}`,
    abi: FORWARDER_ABI,
    functionName: "payTokenFrom",
    args: [token as `0x${string}`, from as `0x${string}`, to as `0x${string}`, amountWei, memo],
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}
