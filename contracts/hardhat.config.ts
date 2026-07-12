import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // hardhat default

// Robinhood Chain (Arbitrum Orbit L2). Public RPC is rate limited; prefer a keyed
// RPC via ROBINHOOD_RPC_URL in .env.
const ROBINHOOD_RPC_URL = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 1 },
      evmVersion: "cancun",
      viaIR: true,
      // HoodseaNFT sits at the EIP-170 24KB ceiling; stripping revert-reason strings
      // keeps it deployable without touching logic (requires still revert).
      debug: { revertStrings: "strip" },
    },
  },
  networks: {
    // In-process test network. Robinhood Chain (Arbitrum Orbit) has an
    // astronomically high block gas limit, so raise the local limit to match it
    // and let large-supply (up to 10000) mint-to-sellout + reveal tests run in
    // realistic batches. Does not affect the robinhood network below.
    hardhat: {
      blockGasLimit: 1_000_000_000,
      allowUnlimitedContractSize: false,
      // Pin the execution hardfork to cancun (matches solidity evmVersion). The
      // newer default hardfork enforces EIP-7825's 2^24 (~16.7M) per-tx gas cap,
      // which the real Robinhood Chain (Arbitrum Orbit, block gas limit ~1.1e15)
      // does NOT apply. cancun lets the large-supply mint/reveal tests run as they
      // would on-chain.
      hardfork: "cancun",
    },
    robinhood: {
      url: ROBINHOOD_RPC_URL,
      chainId: 4663,
      accounts: [PRIVATE_KEY],
    },
  },
  // Verification goes through the Robinhood Chain Blockscout instance. Blockscout
  // does not require a real API key — any non-empty string works.
  etherscan: {
    apiKey: {
      robinhood: process.env.BLOCKSCOUT_API_KEY || "blockscout",
    },
    customChains: [
      {
        network: "robinhood",
        chainId: 4663,
        urls: {
          apiURL: "https://robinhoodchain.blockscout.com/api",
          browserURL: "https://robinhoodchain.blockscout.com",
        },
      },
    ],
  },
  // Sourcify disabled — verification is done against Blockscout above.
  sourcify: {
    enabled: false,
  },
};

export default config;
