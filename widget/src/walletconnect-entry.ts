// Separate bundle entry point — WalletConnect's client libraries add ~1.8MB
// even minified, which would slow down every single checkout page load for
// the vast majority of buyers who never touch it. Built standalone and
// lazy-loaded (see loadWalletConnectModule in index.ts) only when someone
// actually clicks the WalletConnect option.
import { connectWalletConnect, disconnectWalletConnect } from "./walletconnect";

(window as any).CryptoPayWC = { connectWalletConnect, disconnectWalletConnect };
