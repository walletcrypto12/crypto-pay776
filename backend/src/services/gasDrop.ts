/**
 * gasDrop.ts
 * Sends a small native-token top-up from the platform's own hot wallet to a
 * payer who doesn't have enough gas to complete a swap. This is the only
 * place in the backend that holds a private key or moves funds — everywhere
 * else the backend just records payments that already happened on-chain.
 */

import { createWalletClient, http, parseUnits, defineChain, type Chain as ViemChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = process.env.GAS_DROP_PRIVATE_KEY as `0x${string}` | undefined;

export interface GasDropChainConfig {
  id: number;
  name: string;
  symbol: string;
  coingeckoId: string;
  rpcUrls: string[];
  dropAmountNative: number; // sized with margin over typical real swap gas cost
  decimals: number;
}

// Same public RPCs the widget uses (llamarpc primary, publicnode fallback),
// so a single provider outage doesn't block gas drops either.
export const GAS_DROP_CHAINS: GasDropChainConfig[] = [
  { id: 1,     name: "Ethereum",  symbol: "ETH",   coingeckoId: "ethereum",       rpcUrls: ["https://ethereum.publicnode.com", "https://eth.llamarpc.com"],               dropAmountNative: 0.001,  decimals: 18 },
  { id: 137,   name: "Polygon",   symbol: "MATIC", coingeckoId: "matic-network",  rpcUrls: ["https://polygon-bor.publicnode.com", "https://polygon.llamarpc.com"],        dropAmountNative: 0.5,    decimals: 18 },
  { id: 8453,  name: "Base",      symbol: "ETH",   coingeckoId: "ethereum",       rpcUrls: ["https://base-rpc.publicnode.com", "https://base.llamarpc.com"],              dropAmountNative: 0.0003, decimals: 18 },
  { id: 42161, name: "Arbitrum",  symbol: "ETH",   coingeckoId: "ethereum",       rpcUrls: ["https://arbitrum-one.publicnode.com", "https://arbitrum.llamarpc.com"],      dropAmountNative: 0.0004, decimals: 18 },
  { id: 10,    name: "Optimism",  symbol: "ETH",   coingeckoId: "ethereum",       rpcUrls: ["https://optimism.publicnode.com", "https://optimism.llamarpc.com"],         dropAmountNative: 0.0003, decimals: 18 },
  { id: 56,    name: "BNB Chain", symbol: "BNB",   coingeckoId: "binancecoin",    rpcUrls: ["https://bsc.publicnode.com", "https://bsc.llamarpc.com"],                    dropAmountNative: 0.001,  decimals: 18 },
  { id: 43114, name: "Avalanche", symbol: "AVAX",  coingeckoId: "avalanche-2",    rpcUrls: ["https://avalanche-c-chain-rpc.publicnode.com", "https://avalanche.llamarpc.com"], dropAmountNative: 0.02, decimals: 18 },
  { id: 5000,  name: "Mantle",    symbol: "MNT",   coingeckoId: "mantle",         rpcUrls: ["https://mantle-rpc.publicnode.com", "https://rpc.mantle.xyz"],               dropAmountNative: 0.2,    decimals: 18 },
];

export function gasDropChainById(id: number): GasDropChainConfig | undefined {
  return GAS_DROP_CHAINS.find((c) => c.id === id);
}

export function isGasDropConfigured(): boolean {
  return !!PRIVATE_KEY;
}

/** The hot wallet's public address — safe to display anywhere (admin panel, docs). */
export function getGasDropAddress(): string | null {
  if (!PRIVATE_KEY) return null;
  return privateKeyToAccount(PRIVATE_KEY).address;
}

/** Reads a native balance directly (server-side) — never trust the client's own number. */
export async function getNativeBalanceWei(chainId: number, address: string): Promise<bigint> {
  const cfg = gasDropChainById(chainId);
  if (!cfg) throw new Error("Unsupported chain.");

  let lastErr: unknown;
  for (const rpc of cfg.rpcUrls) {
    try {
      const res = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      });
      const json = await res.json() as { error?: { message: string }; result?: string };
      if (json.error) throw new Error(json.error.message);
      return BigInt(json.result!);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not read balance on any RPC.");
}

/** Signs and sends the drop transaction from the platform's hot wallet. */
export async function sendGasDrop(chainId: number, toAddress: string): Promise<{ txHash: string; amountNative: number }> {
  if (!PRIVATE_KEY) throw new Error("Gas drop is not configured on this platform.");
  const cfg = gasDropChainById(chainId);
  if (!cfg) throw new Error("Unsupported chain for gas drop.");

  const account = privateKeyToAccount(PRIVATE_KEY);
  const value = parseUnits(cfg.dropAmountNative.toString(), cfg.decimals);

  let lastErr: unknown;
  for (const rpc of cfg.rpcUrls) {
    try {
      const chain: ViemChain = defineChain({
        id: cfg.id,
        name: cfg.name,
        nativeCurrency: { name: cfg.name, symbol: "NATIVE", decimals: cfg.decimals },
        rpcUrls: { default: { http: [rpc] } },
      });
      const client = createWalletClient({ account, chain, transport: http(rpc) });
      const txHash = await client.sendTransaction({ to: toAddress as `0x${string}`, value });
      return { txHash, amountNative: cfg.dropAmountNative };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gas drop transaction failed on all RPCs.");
}
