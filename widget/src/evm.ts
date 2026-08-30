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

/** JSON-RPC call to a public RPC endpoint — returns the `result` field */
async function rpcCall(rpc: string, method: string, params: unknown[]): Promise<string> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  return json.result as string;
}

// ── Wallet connection ────────────────────────────────────────────────────────

export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/** Request wallet access; returns the connected address (checksummed) */
export async function connectWallet(): Promise<string> {
  if (!window.ethereum) throw new Error("No EVM wallet detected. Please install MetaMask.");
  const accounts: string[] = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts || accounts.length === 0) throw new Error("No accounts returned from wallet.");
  return accounts[0];
}

/** Returns the currently connected address without prompting */
export async function getConnectedAddress(): Promise<string | null> {
  if (!window.ethereum) return null;
  try {
    const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
    return accounts.length > 0 ? accounts[0] : null;
  } catch {
    return null;
  }
}

// ── Chain management ─────────────────────────────────────────────────────────

/** Returns the wallet's current chainId (decimal integer) */
export async function getCurrentChainId(): Promise<number> {
  const hex: string = await window.ethereum.request({ method: "eth_chainId" });
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
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainHex }],
    });
  } catch (err: any) {
    // Error 4902 = chain not added to wallet yet — try to add it
    if (err.code === 4902 && addChainParams) {
      await window.ethereum.request({
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
export async function getNativeBalance(rpc: string, address: string, decimals = 18): Promise<number> {
  const hex = await rpcCall(rpc, "eth_getBalance", [address, "latest"]);
  return hexWeiToDecimal(hex, decimals);
}

/** Returns an ERC-20 token balance in full decimal units */
export async function getERC20Balance(
  rpc: string,
  tokenAddress: string,
  userAddress: string,
  decimals: number
): Promise<number> {
  // balanceOf(address) — selector 0x70a08231
  const data = "0x70a08231" + pad32(userAddress);
  const hex = await rpcCall(rpc, "eth_call", [
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
  rpc: string,
  tokenAddress: string,
  owner: string,
  spender: string,
  decimals: number
): Promise<number> {
  // allowance(address,address) — selector 0xdd62ed3e
  const data = "0xdd62ed3e" + pad32(owner) + pad32(spender);
  const hex = await rpcCall(rpc, "eth_call", [
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
  const accounts: string[] = await window.ethereum.request({ method: "eth_accounts" });
  const txHash: string = await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to: tokenAddress, data }],
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

  const txHash: string = await window.ethereum.request({
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
  rpc: string,
  txHash: string,
  intervalMs = 3000,
  timeoutMs = 120_000
): Promise<TxReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await rpcCall(rpc, "eth_getTransactionReceipt", [txHash]).catch(() => null);
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
