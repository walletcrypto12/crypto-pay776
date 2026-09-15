export interface ChainConfig {
  id: number;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpcUrls: string[];        // tried in order — automatic failover if one is down
  lifiId: string;           // Li.Fi chain identifier
  usdcAddress: string;      // Native USDC on this chain
  usdtAddress?: string;     // Canonical USDT on this chain — only set where verified (decimals vary by chain, e.g. BSC uses 18)
  coingeckoId: string;      // For price lookup
  icon: string;
  explorerTx: string;       // https://.../<txhash>
  gasReserveNative: number; // native units held back to cover gas on this chain
  cnCurrency: string;       // ChangeNOW ticker for this chain's native currency
  cnNetwork: string;        // ChangeNOW network id for this chain's native currency
  addChainParams: {         // For wallet_addEthereumChain
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
}

export const CHAINS: ChainConfig[] = [
  {
    id: 1,
    name: "Ethereum",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrls: ["https://eth.llamarpc.com", "https://ethereum.publicnode.com"],
    lifiId: "ETH",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    usdtAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
    coingeckoId: "ethereum",
    icon: "⟠",
    explorerTx: "https://etherscan.io/tx/",
    gasReserveNative: 0.004,
    cnCurrency: "eth",
    cnNetwork: "eth",
    addChainParams: {
      chainName: "Ethereum Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://eth.llamarpc.com"],
      blockExplorerUrls: ["https://etherscan.io"],
    },
  },
  {
    id: 137,
    name: "Polygon",
    nativeSymbol: "MATIC",
    nativeDecimals: 18,
    rpcUrls: ["https://polygon.llamarpc.com", "https://polygon-bor.publicnode.com"],
    lifiId: "POL",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    coingeckoId: "matic-network",
    icon: "⬡",
    explorerTx: "https://polygonscan.com/tx/",
    gasReserveNative: 1,
    cnCurrency: "matic",
    cnNetwork: "matic",
    addChainParams: {
      chainName: "Polygon Mainnet",
      nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
      rpcUrls: ["https://polygon.llamarpc.com"],
      blockExplorerUrls: ["https://polygonscan.com"],
    },
  },
  {
    id: 8453,
    name: "Base",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrls: ["https://base.llamarpc.com", "https://base-rpc.publicnode.com"],
    lifiId: "BAS",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    coingeckoId: "ethereum",
    icon: "🔵",
    explorerTx: "https://basescan.org/tx/",
    gasReserveNative: 0.0008,
    cnCurrency: "eth",
    cnNetwork: "base",
    addChainParams: {
      chainName: "Base",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://base.llamarpc.com"],
      blockExplorerUrls: ["https://basescan.org"],
    },
  },
  {
    id: 42161,
    name: "Arbitrum",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrls: ["https://arbitrum.llamarpc.com", "https://arbitrum-one.publicnode.com"],
    lifiId: "ARB",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    coingeckoId: "ethereum",
    icon: "🔷",
    explorerTx: "https://arbiscan.io/tx/",
    gasReserveNative: 0.001,
    cnCurrency: "eth",
    cnNetwork: "arbitrum",
    addChainParams: {
      chainName: "Arbitrum One",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://arbitrum.llamarpc.com"],
      blockExplorerUrls: ["https://arbiscan.io"],
    },
  },
  {
    id: 10,
    name: "Optimism",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    rpcUrls: ["https://optimism.llamarpc.com", "https://optimism.publicnode.com"],
    lifiId: "OPT",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    coingeckoId: "ethereum",
    icon: "🔴",
    explorerTx: "https://optimistic.etherscan.io/tx/",
    gasReserveNative: 0.0008,
    cnCurrency: "eth",
    cnNetwork: "op",
    addChainParams: {
      chainName: "Optimism",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: ["https://optimism.llamarpc.com"],
      blockExplorerUrls: ["https://optimistic.etherscan.io"],
    },
  },
  {
    id: 56,
    name: "BNB Chain",
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    rpcUrls: ["https://bsc.llamarpc.com", "https://bsc.publicnode.com"],
    lifiId: "BSC",
    usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    coingeckoId: "binancecoin",
    icon: "💛",
    explorerTx: "https://bscscan.com/tx/",
    gasReserveNative: 0.003,
    cnCurrency: "bnb",
    cnNetwork: "bsc",
    addChainParams: {
      chainName: "BNB Smart Chain",
      nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
      rpcUrls: ["https://bsc.llamarpc.com"],
      blockExplorerUrls: ["https://bscscan.com"],
    },
  },
  {
    id: 43114,
    name: "Avalanche",
    nativeSymbol: "AVAX",
    nativeDecimals: 18,
    rpcUrls: ["https://avalanche.llamarpc.com", "https://avalanche-c-chain-rpc.publicnode.com"],
    lifiId: "AVA",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    coingeckoId: "avalanche-2",
    icon: "🔺",
    explorerTx: "https://snowtrace.io/tx/",
    gasReserveNative: 0.05,
    cnCurrency: "avax",
    cnNetwork: "cchain",
    addChainParams: {
      chainName: "Avalanche C-Chain",
      nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
      rpcUrls: ["https://avalanche.llamarpc.com"],
      blockExplorerUrls: ["https://snowtrace.io"],
    },
  },
  {
    id: 5000,
    name: "Mantle",
    nativeSymbol: "MNT",
    nativeDecimals: 18,
    rpcUrls: ["https://rpc.mantle.xyz", "https://mantle-rpc.publicnode.com"],
    lifiId: "MNT",
    usdcAddress: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
    coingeckoId: "mantle",
    icon: "🟢",
    explorerTx: "https://explorer.mantle.xyz/tx/",
    gasReserveNative: 0.5,
    cnCurrency: "mnt",
    cnNetwork: "mnt",
    addChainParams: {
      chainName: "Mantle",
      nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
      rpcUrls: ["https://rpc.mantle.xyz"],
      blockExplorerUrls: ["https://explorer.mantle.xyz"],
    },
  },
];

export const CHAIN_BY_ID = Object.fromEntries(CHAINS.map((c) => [c.id, c]));

// Ethereum mainnet USDC — the destination for all payments
export const USDC_ETH_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const USDC_DECIMALS = 6;

// Li.Fi uses this as the "native token" address on each chain
export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";
