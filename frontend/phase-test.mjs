// E2E phase test on Base Sepolia against the freshly deployed launchpad.
// Run from frontend/ so node_modules (viem, merkletreejs, keccak256) resolve.
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther, parseEventLogs } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
require("dotenv").config({ path: "/root/recomendasi/recomendasi/contracts/.env", quiet: true });

const RPC = fallback([http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]);
const LAUNCHPAD = "0x6f250B031988Cdce4735b1975D11b0f60f5bDE39";
const TOKEN_FACTORY = "0x52e2FcFa8c78f15ce196C6EC35f586679664b448";
const MINT_PRICE = parseEther("0.00001");
const PLATFORM_FEE = parseEther("0.0003");
const UNIT_COST = MINT_PRICE + PLATFORM_FEE;

const pub = createPublicClient({ chain: baseSepolia, transport: RPC });
const deployer = privateKeyToAccount(process.env.PRIVATE_KEY.startsWith("0x") ? process.env.PRIVATE_KEY : "0x" + process.env.PRIVATE_KEY);
const deployerWallet = createWalletClient({ account: deployer, chain: baseSepolia, transport: RPC });

const LP_ABI = [{
  type: "function", name: "launchCollection", stateMutability: "nonpayable",
  inputs: [{ name: "p", type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "mintPriceWei", type: "uint256" },
    { name: "phaseRoots", type: "bytes32[4]" }, { name: "phaseStarts", type: "uint256[4]" },
    { name: "phaseEnds", type: "uint256[4]" }, { name: "phaseMaxPerWallet", type: "uint256[4]" },
    { name: "allowlistCID", type: "string" },
  ]}],
  outputs: [{ type: "address" }],
}, { type: "event", name: "CollectionLaunched", inputs: [
  { name: "collection", type: "address", indexed: true }, { name: "creator", type: "address", indexed: true },
  { name: "name", type: "string" }, { name: "ticker", type: "string" },
  { name: "mintPrice", type: "uint256" }, { name: "mintStart", type: "uint256" } ] }];

const NFT_ABI = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "bytes32[]" }], outputs: [] },
  { type: "function", name: "currentPhaseId", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getMintStatus", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "remainingForWallet", stateMutability: "view", inputs: [{ type: "uint8" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenOwner", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenListPrice", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getRarity", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "listNFT", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "buyNFT", stateMutability: "payable", inputs: [{ type: "uint256" }], outputs: [] },
];
const FACTORY_ABI = [
  { type: "function", name: "tokenToPool", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
];
const POOL_ABI = [
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
];
const INFO_ABI = [
  { type: "function", name: "info", stateMutability: "view", inputs: [], outputs: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" } ] },
];

// ── merkle identical to frontend/src/lib/allowlist.ts ──
const leafFor = (addr) => keccak256(Buffer.from(addr.slice(2), "hex"));
const buildRoot = (addrs) => addrs.length ? "0x" + new MerkleTree(addrs.map(leafFor), keccak256, { sortPairs: true }).getRoot().toString("hex") : "0x" + "0".repeat(64);
const getProof = (addrs, wallet) => addrs.length ? new MerkleTree(addrs.map(leafFor), keccak256, { sortPairs: true }).getHexProof(leafFor(wallet)) : [];

const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mintAs(w, collection, qty, proof, gas) {
  const wallet = createWalletClient({ account: w, chain: baseSepolia, transport: RPC });
  const hash = await wallet.writeContract({
    address: collection, abi: NFT_ABI, functionName: "mint",
    args: [BigInt(qty), proof], value: UNIT_COST * BigInt(qty),
    ...(gas ? { gas } : {}),
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (rcpt.status !== "success") throw new Error("tx reverted");
  return rcpt;
}
async function expectMintOk(label, w, collection, qty, proof, gas) {
  try { await mintAs(w, collection, qty, proof, gas); check(label, true); return true; }
  catch (e) { check(label, false, (e.shortMessage || e.message).slice(0, 120)); return false; }
}
async function expectMintFail(label, w, collection, qty, proof) {
  try { await mintAs(w, collection, qty, proof, BigInt(700_000)); check(label, false, "mint SUCCEEDED but should have been rejected"); }
  catch (e) { const m = (e.shortMessage || e.message).slice(0, 100); check(label, true, "rejected: " + m); }
}
async function waitUntil(unixTs, label) {
  const ms = unixTs * 1000 - Date.now();
  if (ms > 0) { console.log(`\n⏳ waiting ${Math.ceil(ms / 1000)}s for ${label}...`); await sleep(ms + 4000); } else await sleep(4000);
}
// public RPC nodes can lag a few blocks — retry reads instead of dying
async function readRetry(args, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await pub.readContract(args); }
    catch (e) { if (i === tries - 1) throw e; await sleep(3000); }
  }
}
async function waitForCode(address) {
  for (let i = 0; i < 20; i++) {
    const code = await pub.getCode({ address }).catch(() => null);
    if (code && code !== "0x") return;
    await sleep(3000);
  }
  throw new Error("contract code never appeared at " + address);
}

async function main() {
  console.log("deployer:", deployer.address, "balance:", formatEther(await pub.getBalance({ address: deployer.address })));
  console.log("gasPrice:", (await pub.getGasPrice()).toString(), "wei");

  // ── 1. load-or-generate + fund 50 wallets ──
  const WALLET_FILE = "/root/recomendasi/recomendasi/contracts/test-wallets.json";
  let pks;
  if (fs.existsSync(WALLET_FILE)) {
    pks = JSON.parse(fs.readFileSync(WALLET_FILE)).map((x) => x.pk);
    console.log("reusing", pks.length, "wallets from test-wallets.json");
  } else {
    pks = Array.from({ length: 50 }, () => generatePrivateKey());
  }
  const wallets = pks.map((pk) => privateKeyToAccount(pk));
  // keys kept locally (testnet only) so leftover funds are recoverable
  fs.writeFileSync(WALLET_FILE, JSON.stringify(wallets.map((w, i) => ({ i, address: w.address, pk: pks[i] })), null, 2));

  console.log("\n── funding wallets below 0.001 ETH (target 0.002) ──");
  let nonce = await pub.getTransactionCount({ address: deployer.address });
  let lastHash = null, fundedCount = 0;
  for (const w of wallets) {
    const bal = await pub.getBalance({ address: w.address });
    if (bal >= parseEther("0.001")) continue;
    lastHash = await deployerWallet.sendTransaction({ to: w.address, value: parseEther("0.002") - bal, nonce: nonce++ });
    fundedCount++;
    await sleep(120); // gentle on public RPC
  }
  if (lastHash) await pub.waitForTransactionReceipt({ hash: lastHash, timeout: 120_000 });
  console.log(`funded ${fundedCount} wallets`);

  // ── 2. allowlists ──
  const team = wallets.slice(0, 5).map((w) => w.address);
  const gtd = wallets.slice(5, 15).map((w) => w.address);
  const fcfs = wallets.slice(15, 30).map((w) => w.address);

  // ── 3. launch collection: team 0-150s, gtd 150-300s, fcfs 300-450s, public 450s+ ──
  const t0 = Math.floor(Date.now() / 1000);
  const starts = [t0 - 10, t0 + 150, t0 + 300, t0 + 450].map(BigInt);
  const ends = [t0 + 150, t0 + 300, t0 + 450, 9999999999].map(BigInt);
  console.log("\n── launching test collection (4 phases, 150s windows) ──");
  const launchHash = await deployerWallet.writeContract({
    address: LAUNCHPAD, abi: LP_ABI, functionName: "launchCollection",
    args: [{
      name: "Phase Test", ticker: "PHTEST", bio: "automated 4-phase e2e test",
      photoURIs: ["ipfs://ph1", "ipfs://ph2", "ipfs://ph3", "", "", ""], photoCount: 3,
      socialX: "", socialGithub: "", socialFarcaster: "",
      mintPriceWei: MINT_PRICE,
      phaseRoots: [buildRoot(team), buildRoot(gtd), buildRoot(fcfs), "0x" + "0".repeat(64)],
      phaseStarts: starts, phaseEnds: ends,
      phaseMaxPerWallet: [2n, 2n, 1n, 0n],
      allowlistCID: "",
    }],
    gas: 6_000_000n,
  });
  const launchRcpt = await pub.waitForTransactionReceipt({ hash: launchHash, timeout: 120_000 });
  check("launchCollection via new launchpad+deployer", launchRcpt.status === "success");
  const launched = parseEventLogs({ abi: LP_ABI, eventName: "CollectionLaunched", logs: launchRcpt.logs });
  const COL = launched[0].args.collection;
  console.log("collection:", COL);
  await waitForCode(COL);

  // ── 4. TEAM phase ──
  const pid0 = await readRetry({ address: COL, abi: NFT_ABI, functionName: "currentPhaseId" });
  check("TEAM phase active (currentPhaseId=0)", Number(pid0) === 0, "got " + pid0);
  await expectMintOk("TEAM: allowlisted wallet mints 2 (cap=2)", wallets[0], COL, 2, getProof(team, wallets[0].address));
  await expectMintFail("TEAM: same wallet 3rd mint rejected (cap)", wallets[0], COL, 1, getProof(team, wallets[0].address));
  await expectMintOk("TEAM: second allowlisted wallet mints 1", wallets[1], COL, 1, getProof(team, wallets[1].address));
  await expectMintFail("TEAM: non-team wallet rejected", wallets[7], COL, 1, getProof(team, wallets[7].address));
  await expectMintFail("TEAM: team wallet with EMPTY proof rejected", wallets[2], COL, 1, []);

  // ── 5. GTD phase ──
  await waitUntil(t0 + 150, "GTD phase");
  const pid1 = await readRetry({ address: COL, abi: NFT_ABI, functionName: "currentPhaseId" });
  check("GTD phase active (currentPhaseId=1)", Number(pid1) === 1, "got " + pid1);
  await expectMintOk("GTD: allowlisted wallet mints 2 (cap=2)", wallets[5], COL, 2, getProof(gtd, wallets[5].address));
  await expectMintFail("GTD: same wallet over cap rejected", wallets[5], COL, 1, getProof(gtd, wallets[5].address));
  await expectMintOk("GTD: second gtd wallet mints 1", wallets[6], COL, 1, getProof(gtd, wallets[6].address));
  await expectMintFail("GTD: team wallet (not on gtd) rejected", wallets[0], COL, 1, getProof(team, wallets[0].address));

  // ── 6. FCFS phase ──
  await waitUntil(t0 + 300, "FCFS phase");
  const pid2 = await readRetry({ address: COL, abi: NFT_ABI, functionName: "currentPhaseId" });
  check("FCFS phase active (currentPhaseId=2)", Number(pid2) === 2, "got " + pid2);
  await expectMintOk("FCFS: allowlisted wallet mints 1 (cap=1)", wallets[15], COL, 1, getProof(fcfs, wallets[15].address));
  await expectMintFail("FCFS: same wallet 2nd mint rejected (cap=1)", wallets[15], COL, 1, getProof(fcfs, wallets[15].address));
  await expectMintOk("FCFS: another fcfs wallet mints 1", wallets[16], COL, 1, getProof(fcfs, wallets[16].address));
  await expectMintFail("FCFS: outsider wallet rejected", wallets[40], COL, 1, []);

  // ── 7. PUBLIC phase: everyone mints, fill to 100 ──
  await waitUntil(t0 + 450, "PUBLIC phase");
  const pid3 = await readRetry({ address: COL, abi: NFT_ABI, functionName: "currentPhaseId" });
  check("PUBLIC phase active (currentPhaseId=3)", Number(pid3) === 3, "got " + pid3);
  await expectMintOk("PUBLIC: random wallet mints WITHOUT proof", wallets[44], COL, 1, []);
  await expectMintOk("PUBLIC: team wallet can mint again (no cap)", wallets[0], COL, 1, []);

  let minted = Number(await readRetry({ address: COL, abi: NFT_ABI, functionName: "totalMinted" }));
  console.log(`\n── filling to 100 (currently ${minted}) ──`);
  let wi = 0;
  while (minted < 100) {
    const left = 100 - minted;
    const qty = Math.min(3, left);
    const w = wallets[wi % 50]; wi++;
    const isLast = left <= 3;
    try {
      // last mint triggers bonding: token deploy + uniswap pool create needs lots of gas
      await mintAs(w, COL, qty, [], isLast ? 15_000_000n : BigInt(300_000 + 200_000 * qty));
      minted += qty;
      if (minted % 15 < 3 || isLast) console.log(`  minted ${minted}/100 (wallet #${(wi - 1) % 50})`);
    } catch (e) {
      console.log(`  wallet #${(wi - 1) % 50} mint failed: ${(e.shortMessage || e.message).slice(0, 90)} — continuing`);
      if (wi > 200) throw new Error("too many failures");
    }
  }
  check("Minted out: totalMinted == 100", minted === 100);

  // ── 8. bonding complete + token deployed ──
  await sleep(3000);
  const TOKEN_ABI = [{ type: "function", name: "getCollectionInfo", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
    { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" },
    { name: "bondingComplete", type: "bool" }, { name: "tokenAddress", type: "address" } ] }] }];
  let tokenAddr = null;
  try {
    const info = await readRetry({ address: COL, abi: TOKEN_ABI, functionName: "getCollectionInfo" });
    tokenAddr = info.tokenAddress;
    check("Bonding complete after 100th mint", info.bondingComplete === true);
    check("ERC-20 token auto-deployed", tokenAddr && tokenAddr !== "0x0000000000000000000000000000000000000000", "token: " + tokenAddr);
  } catch (e) { check("Bonding/token readback", false, (e.shortMessage || e.message).slice(0, 120)); }
  await expectMintFail("Mint after sellout rejected", wallets[3], COL, 1, []);

  // ── 9. rarity distribution after reveal: must be exactly 46/30/15/5/1/3 ──
  try {
    const counts = [0, 0, 0, 0, 0, 0];
    for (let start = 1; start <= 100; start += 20) {
      const batch = await Promise.all(Array.from({ length: 20 }, (_, k) =>
        readRetry({ address: COL, abi: NFT_ABI, functionName: "getRarity", args: [BigInt(start + k)] })));
      for (const r of batch) counts[Number(r)]++;
    }
    const expect = [46, 30, 15, 5, 1, 3];
    check("Rarity distribution = 46/30/15/5/1/3", JSON.stringify(counts) === JSON.stringify(expect), "got " + counts.join("/"));
  } catch (e) { check("Rarity distribution readback", false, (e.shortMessage || e.message).slice(0, 100)); }

  // ── 10. NFT marketplace: list + buy ──
  try {
    // find a token owned by wallets[0]
    let myToken = null;
    for (let id = 1; id <= 100 && !myToken; id++) {
      const owner = await readRetry({ address: COL, abi: NFT_ABI, functionName: "tokenOwner", args: [BigInt(id)] });
      if (owner.toLowerCase() === wallets[0].address.toLowerCase()) myToken = BigInt(id);
    }
    if (!myToken) throw new Error("no token owned by wallet[0]");
    const price = parseEther("0.0005");
    const seller = createWalletClient({ account: wallets[0], chain: baseSepolia, transport: RPC });
    let hash = await seller.writeContract({ address: COL, abi: NFT_ABI, functionName: "listNFT", args: [myToken, price, 0n], gas: 300_000n });
    let rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    check("Marketplace: listNFT works", rcpt.status === "success", `token #${myToken} @ 0.0005 ETH`);

    const sellerBalBefore = await pub.getBalance({ address: wallets[0].address });
    const buyer = createWalletClient({ account: wallets[31], chain: baseSepolia, transport: RPC });
    hash = await buyer.writeContract({ address: COL, abi: NFT_ABI, functionName: "buyNFT", args: [myToken], value: price, gas: 500_000n });
    rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const newOwner = await readRetry({ address: COL, abi: NFT_ABI, functionName: "tokenOwner", args: [myToken] });
    check("Marketplace: buyNFT transfers ownership", rcpt.status === "success" && newOwner.toLowerCase() === wallets[31].address.toLowerCase());
    const sellerBalAfter = await pub.getBalance({ address: wallets[0].address });
    check("Marketplace: seller received proceeds", sellerBalAfter > sellerBalBefore, `+${formatEther(sellerBalAfter - sellerBalBefore)} ETH`);
  } catch (e) { check("Marketplace list/buy", false, (e.shortMessage || e.message).slice(0, 120)); }

  // ── 11. Uniswap pool created + seeded ──
  try {
    const pool = await readRetry({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "tokenToPool", args: [tokenAddr] });
    const poolOk = pool && pool !== "0x0000000000000000000000000000000000000000";
    check("Uniswap V3 pool created at bonding", poolOk, "pool: " + pool);
    if (poolOk) {
      const liq = await readRetry({ address: pool, abi: POOL_ABI, functionName: "liquidity" });
      check("Pool has liquidity (token tradable)", liq > 0n, "liquidity: " + liq.toString());
    }
  } catch (e) { check("Pool check", false, (e.shortMessage || e.message).slice(0, 120)); }

  // ── summary ──
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n══════ RESULT: ${passed}/${results.length} PASS ══════`);
  console.log("collection:", COL);
  console.log("deployer balance after:", formatEther(await pub.getBalance({ address: deployer.address })));
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
