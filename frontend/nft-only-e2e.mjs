// NFT-only E2E: launch with tokenEnabled=false -> mint 100 -> bond with NO token,
// marketplace unlocks, creator withdraws the pool ETH via withdrawEmergency.
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";

const dep = JSON.parse(readFileSync("/root/recomendasi/recomendasi/contracts/deployment.json", "utf8"));
const env = readFileSync("/root/recomendasi/recomendasi/contracts/.env", "utf8");
const PK = (() => { const m = env.match(/PRIVATE_KEY=(.+)/)[1].trim(); return m.startsWith("0x") ? m : "0x" + m; })();

const RPC = fallback([http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]);
const pub = createPublicClient({ chain: baseSepolia, transport: RPC });
const acct = privateKeyToAccount(PK);
const wal = createWalletClient({ account: acct, chain: baseSepolia, transport: RPC });

const LP_ABI = [{
  type: "function", name: "launchCollection", stateMutability: "nonpayable",
  inputs: [{ name: "p", type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "mintPriceWei", type: "uint256" },
    { name: "tokenEnabled", type: "bool" }, { name: "tokenFeeBps", type: "uint256" },
    { name: "phaseRoots", type: "bytes32[4]" }, { name: "phaseStarts", type: "uint256[4]" },
    { name: "phaseEnds", type: "uint256[4]" }, { name: "phaseMaxPerWallet", type: "uint256[4]" },
    { name: "allowlistCID", type: "string" } ]}],
  outputs: [{ type: "address" }],
}, { type: "event", name: "CollectionLaunched", inputs: [
  { name: "collection", type: "address", indexed: true }, { name: "creator", type: "address", indexed: true },
  { name: "name", type: "string" }, { name: "ticker", type: "string" },
  { name: "mintPrice", type: "uint256" }, { name: "mintStart", type: "uint256" } ] }];

const NFT_ABI = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "bytes32[]" }], outputs: [] },
  { type: "function", name: "currentPhaseId", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "poolBalance", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdrawEmergency", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "getCollectionInfo", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
    { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" }, { name: "bondingComplete", type: "bool" },
    { name: "tokenAddress", type: "address" }, { name: "tokenEnabled", type: "bool" }, { name: "tokenFeeBps", type: "uint256" } ]}] },
];

const ZERO = "0x0000000000000000000000000000000000000000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ok, t = 40) { let v; for (let i = 0; i < t; i++) { try { v = await fn(); if (ok(v)) return v; } catch (_) {} await sleep(2000); } return v; }

async function main() {
  console.log("deployer:", acct.address, "ETH:", formatEther(await pub.getBalance({ address: acct.address })));

  const now = Math.floor(Date.now() / 1000);
  const z32 = "0x" + "0".repeat(64);
  const params = {
    name: "NFT Only Test", ticker: "NFTONLY", bio: "nft-only e2e (no token)",
    photoURIs: ["ipfs://p1", "ipfs://p2", "ipfs://p3", "ipfs://p4", "ipfs://p5", "ipfs://p6"], photoCount: 6,
    socialX: "", socialGithub: "", socialFarcaster: "",
    mintPriceWei: parseEther("0.0002"),
    tokenEnabled: false, tokenFeeBps: 0n, // NFT-only: no token, no pool
    phaseRoots: [z32, z32, z32, z32],
    phaseStarts: [BigInt(now - 7200), BigInt(now - 7200), BigInt(now - 7200), BigInt(now - 60)],
    phaseEnds: [BigInt(now - 3600), BigInt(now - 3600), BigInt(now - 3600), BigInt(now + 86400)],
    phaseMaxPerWallet: [0n, 0n, 0n, 0n],
    allowlistCID: "",
  };

  console.log("\n[1] launchCollection (tokenEnabled=false)...");
  let h = await wal.writeContract({ address: dep.launchpad, abi: LP_ABI, functionName: "launchCollection", args: [params] });
  const rcpt = await pub.waitForTransactionReceipt({ hash: h });
  const ev = parseEventLogs({ abi: LP_ABI, eventName: "CollectionLaunched", logs: rcpt.logs });
  const COL = ev[0].args.collection;
  console.log("  collection:", COL);

  const info0 = await poll(() => pub.readContract({ address: COL, abi: NFT_ABI, functionName: "getCollectionInfo" }), (v) => !!v);
  console.log("  tokenEnabled:", info0.tokenEnabled, "(expect false)  tokenFeeBps:", info0.tokenFeeBps.toString());
  const unit = info0.mintPrice + info0.platformFeeETH;

  console.log("\n[2] minting 100 in batches of 20...");
  for (let b = 0; b < 5; b++) {
    const qty = 20n;
    h = await wal.writeContract({ address: COL, abi: NFT_ABI, functionName: "mint", args: [qty, []], value: unit * qty, gas: 6_000_000n });
    await pub.waitForTransactionReceipt({ hash: h });
    const minted = await poll(() => pub.readContract({ address: COL, abi: NFT_ABI, functionName: "totalMinted" }), (v) => v >= BigInt((b + 1) * 20));
    console.log(`  batch ${b + 1}/5 -> totalMinted = ${minted}`);
  }

  console.log("\n[3] checking bonding (NFT-only)...");
  const info = await poll(() => pub.readContract({ address: COL, abi: NFT_ABI, functionName: "getCollectionInfo" }), (v) => v.bondingComplete);
  console.log("  bondingComplete:", info.bondingComplete, "(expect true)");
  console.log("  tokenAddress   :", info.tokenAddress, info.tokenAddress === ZERO ? "(NO TOKEN - correct)" : "(UNEXPECTED TOKEN)");
  if (!info.bondingComplete) { console.log("  FAIL: bonding did not complete"); return; }
  if (info.tokenAddress !== ZERO) { console.log("  FAIL: a token was deployed for an NFT-only collection"); return; }

  console.log("\n[4] creator withdraws pool ETH (withdrawEmergency)...");
  const poolBal = await pub.readContract({ address: COL, abi: NFT_ABI, functionName: "poolBalance" });
  const contractBal = await pub.getBalance({ address: COL });
  console.log("  poolBalance:", formatEther(poolBal), "ETH  contract ETH:", formatEther(contractBal));
  const before = await pub.getBalance({ address: acct.address });
  h = await wal.writeContract({ address: COL, abi: NFT_ABI, functionName: "withdrawEmergency", args: [] });
  const wr = await pub.waitForTransactionReceipt({ hash: h });
  const after = await pub.getBalance({ address: acct.address });
  const colAfter = await pub.getBalance({ address: COL });
  const gas = wr.gasUsed * wr.effectiveGasPrice;
  console.log("  creator delta (net of gas):", formatEther(after - before + gas), "ETH  | contract ETH after:", formatEther(colAfter));

  const ok = colAfter === 0n && (after - before + gas) > 0n;
  console.log("\n=== NFT-ONLY E2E", ok ? "PASSED" : "CHECK",
    ": launch(token off) -> 100 mint -> bond NO token -> creator withdrew pool ETH ===");
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
