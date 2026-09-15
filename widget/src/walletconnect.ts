// WalletConnect — for wallets with no browser extension to detect (Ledger
// via Ledger Live, mobile wallets, etc). Unlike the EIP-6963/TIP-6963
// discovery used elsewhere, there's nothing to "discover" here: this is
// always offered as one static option, and clicking it opens a QR code the
// user scans with their wallet app to pair. Once paired, the resulting
// provider speaks the same EIP-1193 `request()` interface as an injected
// wallet, so it plugs directly into evm.ts's existing connectWallet() —
// no separate signing/sending code needed for this path.

import { EthereumProvider } from "@walletconnect/ethereum-provider";
import { CHAINS } from "./chains";

const PROJECT_ID = "4349396716b760fb97595764b42753fa";

let wcProvider: Awaited<ReturnType<typeof EthereumProvider.init>> | null = null;

/**
 * Opens WalletConnect's own QR modal, waits for the user to scan and
 * approve with their wallet app, and returns the connected address. The
 * caller still passes the resulting provider through evm.ts's
 * connectWallet() to make it the active EVM provider.
 */
export async function connectWalletConnect(): Promise<{ address: string; provider: any }> {
  if (!wcProvider) {
    const rpcMap: Record<number, string> = {};
    for (const c of CHAINS) rpcMap[c.id] = c.rpcUrls[0];

    wcProvider = await EthereumProvider.init({
      projectId: PROJECT_ID,
      chains: [1], // required "home" chain — Ethereum mainnet
      optionalChains: CHAINS.map((c) => c.id),
      rpcMap,
      showQrModal: true,
      // Belt-and-suspenders alongside the CSS override in index.ts — this
      // modal defaults to z-index 9999, well below our payment overlay's
      // 99999, so it rendered completely hidden behind our own modal.
      qrModalOptions: { themeVariables: { "--wcm-z-index": "2147483647" } },
      metadata: {
        name: "CryptoPay",
        description: "Complete your payment",
        url: typeof window !== "undefined" ? window.location.origin : "",
        icons: [],
      },
    });
  }

  const accounts: string[] = await wcProvider.enable();
  if (!accounts || accounts.length === 0) throw new Error("No accounts returned from WalletConnect.");
  return { address: accounts[0], provider: wcProvider };
}

/** Tears down the WalletConnect session so the next connect starts fresh (a new QR, not a silently-reused session). */
export function disconnectWalletConnect(): void {
  wcProvider?.disconnect().catch(() => {
    // session may already be dead — fine, we're clearing our reference regardless
  });
  wcProvider = null;
}
