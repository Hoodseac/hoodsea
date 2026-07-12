// Robinhood Chain, defined once for the whole app. Every wagmi/viem consumer
// imports this instead of a chain from wagmi/chains or viem/chains.
import { defineChain } from "viem";

export const ROBINHOOD_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [ROBINHOOD_RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

// Explorer link helpers. Blockscout uses the same tx/ address/ token/ paths.
export const EXPLORER_URL = robinhoodChain.blockExplorers.default.url;
export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
export const explorerToken = (addr: string) => `${EXPLORER_URL}/token/${addr}`;
