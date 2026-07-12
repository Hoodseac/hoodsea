// Shared Robinhood Chain definition for every backend script (viem).
// Robinhood Chain is an Arbitrum Orbit L2 (chainId 4663). Blocks are FAST
// (sub-second possible) — much faster than Base's 2s — so any block-count
// lookback must be much larger than on Base to cover the same wall-clock window.
// The public RPC is rate limited; set ROBINHOOD_RPC_URL to a keyed RPC for
// anything heavier than a one-off read.
import { defineChain } from "viem";

export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const RPC_URL = process.env.ROBINHOOD_RPC_URL || process.env.RPC_URL || PUBLIC_RPC;

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

// Canonical WETH on Robinhood Chain
export const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
// Uniswap V4 core on Robinhood Chain
export const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
export const STATE_VIEW = "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b";
