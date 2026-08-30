export interface ChainConfig {
  id: number;
  name: string;
  nativeSymbol: string;
  nativeDecimals: number;
  rpc: string;
  lifiId: string;           // Li.Fi chain identifier
  usdcAddress: string;      // Native USDC on this chain
  coingeckoId: string;      // For price lookup
  icon: string;
  explorerTx: string;       // https://.../<txhash>
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
    rpc: "https://eth.llamarpc.com",
    lifiId: "ETH",
    usdcAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    coingeckoId: "ethereum",
    icon: "⟠",
    explorerTx: "https://etherscan.io/tx/",
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
    rpc: "https://polygon.llamarpc.com",
    lifiId: "POL",
    usdcAddress: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    coingeckoId: "matic-network",
    icon: "⬡",
    explorerTx: "https://polygonscan.com/tx/",
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
    rpc: "https://base.llamarpc.com",
    lifiId: "BAS",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    coingeckoId: "ethereum",
    icon: "🔵",
    explorerTx: "https://basescan.org/tx/",
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
    rpc: "https://arbitrum.llamarpc.com",
    lifiId: "ARB",
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    coingeckoId: "ethereum",
    icon: "🔷",
    explorerTx: "https://arbiscan.io/tx/",
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
    rpc: "https://optimism.llamarpc.com",
    lifiId: "OPT",
    usdcAddress: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    coingeckoId: "ethereum",
    icon: "🔴",
    explorerTx: "https://optimistic.etherscan.io/tx/",
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
    rpc: "https://bsc.llamarpc.com",
    lifiId: "BSC",
    usdcAddress: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    coingeckoId: "binancecoin",
    icon: "💛",
    explorerTx: "https://bscscan.com/tx/",
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
    rpc: "https://avalanche.llamarpc.com",
    lifiId: "AVA",
    usdcAddress: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    coingeckoId: "avalanche-2",
    icon: "🔺",
    explorerTx: "https://snowtrace.io/tx/",
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
    rpc: "https://rpc.mantle.xyz",
    lifiId: "MNT",
    usdcAddress: "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9",
    coingeckoId: "mantle",
    icon: "🟢",
    explorerTx: "https://explorer.mantle.xyz/tx/",
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
