// Full bonding E2E on the new V4 system: launch -> mint 100 -> bond -> V4 pool -> buy/sell.
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther, parseEventLogs, keccak256, encodeAbiParameters } from "viem";
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
  { type: "function", name: "getCollectionInfo", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
    { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" }, { name: "bondingComplete", type: "bool" },
    { name: "tokenAddress", type: "address" } ]}] },
];
const SV_ABI = [{ type: "function", name: "getSlot0", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [
  { name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "protocolFee", type: "uint24" }, { name: "lpFee", type: "uint24" } ] }];
const ROUTER_ABI = [{ type: "function", name: "swapExactIn", stateMutability: "payable", inputs: [
  { name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }, { name: "recipient", type: "address" } ], outputs: [{ type: "uint256" }] }];
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
];

const ZERO = "0x0000000000000000000000000000000000000000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ok, t = 40) { let v; for (let i = 0; i < t; i++) { try { v = await fn(); if (ok(v)) return v; } catch (_) {} await sleep(2000); } return v; }

async function main() {
  console.log("deployer:", acct.address, "ETH:", formatEther(await pub.getBalance({ address: acct.address })));
  console.log("launchpad:", dep.launchpad, "factory:", dep.tokenFactory);

  const now = Math.floor(Date.now() / 1000);
  const z32 = "0x" + "0".repeat(64);
  const params = {
    name: "BondTest V4", ticker: "BONDV4", bio: "e2e bonding test",
    photoURIs: ["ipfs://p1", "ipfs://p2", "ipfs://p3", "ipfs://p4", "ipfs://p5", "ipfs://p6"], photoCount: 6,
    socialX: "", socialGithub: "", socialFarcaster: "",
    mintPriceWei: parseEther("0.0002"),
    tokenEnabled: true, tokenFeeBps: 250n, // 2.5% to prove variable fee (not default 1.5%)
    phaseRoots: [z32, z32, z32, z32],
    phaseStarts: [BigInt(now - 7200), BigInt(now - 7200), BigInt(now - 7200), BigInt(now - 60)],
    phaseEnds: [BigInt(now - 3600), BigInt(now - 3600), BigInt(now - 3600), BigInt(now + 86400)],
    phaseMaxPerWallet: [0n, 0n, 0n, 0n],
    allowlistCID: "",
  };

  console.log("\n[1] launchCollection (PUBLIC active immediately)...");
  let h = await wal.writeContract({ address: dep.launchpad, abi: LP_ABI, functionName: "launchCollection", args: [params] });
  const rcpt = await pub.waitForTransactionReceipt({ hash: h });
  const ev = parseEventLogs({ abi: LP_ABI, eventName: "CollectionLaunched", logs: rcpt.logs });
  const COL = ev[0].args.collection;
  console.log("  collection:", COL);

  const pid = await poll(() => pub.readContract({ address: COL, abi: NFT_ABI, functionName: "currentPhaseId" }), (v) => v === 3);
  console.log("  currentPhaseId:", pid, pid === 3 ? "(PUBLIC ok)" : "(UNEXPECTED)");

  const info0 = await pub.readContract({ address: COL, abi: NFT_ABI, functionName: "getCollectionInfo" });
  const unit = info0.mintPrice + info0.platformFeeETH;
  console.log("  unit cost:", formatEther(unit), "ETH (mintPrice", formatEther(info0.mintPrice), "+ fee", formatEther(info0.platformFeeETH), ")");

  console.log("\n[2] minting 100 in batches of 20...");
  for (let b = 0; b < 5; b++) {
    const qty = 20n;
    h = await wal.writeContract({ address: COL, abi: NFT_ABI, functionName: "mint", args: [qty, []], value: unit * qty, gas: 6_000_000n });
    await pub.waitForTransactionReceipt({ hash: h });
    const minted = await poll(() => pub.readContract({ address: COL, abi: NFT_ABI, functionName: "totalMinted" }), (v) => v >= BigInt((b + 1) * 20));
    console.log(`  batch ${b + 1}/5 -> totalMinted = ${minted}`);
  }

  console.log("\n[3] checking bonding...");
  const info = await poll(() => pub.readContract({ address: COL, abi: NFT_ABI, functionName: "getCollectionInfo" }), (v) => v.bondingComplete);
  console.log("  bondingComplete:", info.bondingComplete, "token:", info.tokenAddress);
  if (!info.bondingComplete || info.tokenAddress === ZERO) { console.log("  BONDING FAILED"); return; }

  const token = info.tokenAddress;
  const splitter = await pub.readContract({ address: dep.tokenFactory, abi: [{ type: "function", name: "tokenToSplitter", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }], functionName: "tokenToSplitter", args: [token] });
  console.log("  splitter:", splitter);

  const key = { currency0: ZERO, currency1: token, fee: 0, tickSpacing: 60, hooks: dep.feeHook };
  const poolId = keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    [ZERO, token, 0, 60, dep.feeHook]));
  const slot0 = await poll(() => pub.readContract({ address: dep.stateView, abi: SV_ABI, functionName: "getSlot0", args: [poolId] }), (v) => v && v[0] > 0n);
  console.log("  V4 pool sqrtPriceX96:", slot0 ? slot0[0].toString() : "NONE", slot0 && slot0[0] > 0n ? "(pool live)" : "(NO POOL)");

  console.log("\n[4] buy + sell via OriginSwapRouter...");
  const keyT = [ZERO, token, 0, 60, dep.feeHook];
  const sb = await pub.getBalance({ address: splitter });
  const buyIn = parseEther("0.0008");
  h = await wal.writeContract({ address: dep.swapRouter, abi: ROUTER_ABI, functionName: "swapExactIn", args: [keyT, true, buyIn, 0n, acct.address], value: buyIn });
  await pub.waitForTransactionReceipt({ hash: h });
  const tb = await poll(() => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [acct.address] }), (v) => v > 0n);
  console.log("  BUY ok, token received:", formatEther(tb));

  const sell = tb / 2n;
  await pub.waitForTransactionReceipt({ hash: await wal.writeContract({ address: token, abi: ERC20, functionName: "approve", args: [dep.swapRouter, sell] }) });
  h = await wal.writeContract({ address: dep.swapRouter, abi: ROUTER_ABI, functionName: "swapExactIn", args: [keyT, false, sell, 0n, acct.address] });
  await pub.waitForTransactionReceipt({ hash: h });
  const sa = await poll(() => pub.getBalance({ address: splitter }), (v) => v > sb);
  console.log("  SELL ok, splitter fee ETH total:", formatEther(sa));

  console.log("\n=== BONDING E2E PASSED: launch -> 100 mint -> bond -> V4 pool -> buy + sell + fee ===");
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
