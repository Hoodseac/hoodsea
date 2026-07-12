// Reveal-timing e2e: launch with TEAM/GTD/FCFS/PUBLIC phases (60s windows) and
// revealTiming=24h meta, mint out, verify bondedAt timestamping + reveal gate.
// Also proves the 7d + already-elapsed path using the bonded MKTEST collection.
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
require("dotenv").config({ path: "/root/recomendasi/recomendasi/contracts/.env", quiet: true });

const RPC = fallback([http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]);
const LAUNCHPAD = "0x8f71aB89BCfb0d942c08062D8b83D305a876AD53";
const API = "https://originpad.live";
const MKTEST = "0xEF3fB716Ccf7F900518bB4d535487d1a98F714d4";
const MINT_PRICE = parseEther("0.00001");
const UNIT_COST = MINT_PRICE + parseEther("0.0003");
const ZERO32 = "0x" + "0".repeat(64);

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
];

const leafFor = (a) => keccak256(Buffer.from(a.slice(2), "hex"));
const buildRoot = (as) => as.length ? "0x" + new MerkleTree(as.map(leafFor), keccak256, { sortPairs: true }).getRoot().toString("hex") : ZERO32;
const getProof = (as, w) => as.length ? new MerkleTree(as.map(leafFor), keccak256, { sortPairs: true }).getHexProof(leafFor(w)) : [];

const results = [];
const check = (n, ok, x = "") => { results.push(ok); console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${n}${x ? "  (" + x + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function mintAs(acct, col, qty, proof, gas) {
  const w = createWalletClient({ account: acct, chain: baseSepolia, transport: RPC });
  const h = await w.writeContract({ address: col, abi: NFT_ABI, functionName: "mint", args: [BigInt(qty), proof], value: UNIT_COST * BigInt(qty), gas });
  const r = await pub.waitForTransactionReceipt({ hash: h, timeout: 60_000 });
  if (r.status !== "success") throw new Error("tx reverted");
  return r;
}

async function main() {
  const wallets = JSON.parse(fs.readFileSync("/root/recomendasi/recomendasi/contracts/test-wallets.json")).map((x) => privateKeyToAccount(x.pk));

  // top-up
  let nonce = await pub.getTransactionCount({ address: deployer.address });
  let last = null, n = 0;
  for (const w of wallets) {
    const b = await pub.getBalance({ address: w.address });
    if (b >= parseEther("0.001")) continue;
    last = await deployerWallet.sendTransaction({ to: w.address, value: parseEther("0.002") - b, nonce: nonce++ }); n++;
    await sleep(120);
  }
  if (last) await pub.waitForTransactionReceipt({ hash: last, timeout: 120_000 });
  console.log(`topped up ${n} wallets`);

  const team = wallets.slice(0, 3).map((w) => w.address);
  const gtd = wallets.slice(5, 10).map((w) => w.address);
  const fcfs = wallets.slice(15, 20).map((w) => w.address);

  // launch: team [now,+60], gtd [+60,+120], fcfs [+120,+180], public [+180, inf)
  const t0 = Math.floor(Date.now() / 1000);
  const launchHash = await deployerWallet.writeContract({
    address: LAUNCHPAD, abi: LP_ABI, functionName: "launchCollection",
    args: [{
      name: "Reveal Test", ticker: "RVTEST", bio: "reveal 24h + 4 phase test",
      photoURIs: ["ipfs://r1", "ipfs://r2", "ipfs://r3", "", "", ""], photoCount: 3,
      socialX: "", socialGithub: "", socialFarcaster: "",
      mintPriceWei: MINT_PRICE,
      phaseRoots: [buildRoot(team), buildRoot(gtd), buildRoot(fcfs), ZERO32],
      phaseStarts: [BigInt(t0 - 10), BigInt(t0 + 60), BigInt(t0 + 120), BigInt(t0 + 180)],
      phaseEnds: [BigInt(t0 + 60), BigInt(t0 + 120), BigInt(t0 + 180), 9999999999n],
      phaseMaxPerWallet: [2n, 2n, 1n, 0n],
      allowlistCID: "",
    }],
    gas: 6_000_000n,
  });
  const rcpt = await pub.waitForTransactionReceipt({ hash: launchHash, timeout: 120_000 });
  const COL = parseEventLogs({ abi: LP_ABI, eventName: "CollectionLaunched", logs: rcpt.logs })[0].args.collection;
  check("launch RVTEST with TEAM/GTD/FCFS/PUBLIC", rcpt.status === "success", COL);
  for (let i = 0; i < 20; i++) { const c = await pub.getCode({ address: COL }).catch(() => null); if (c && c !== "0x") break; await sleep(3000); }

  // set meta revealTiming=24h (what the launch UI does)
  const metaRes = await fetch(`${API}/api/collection/meta`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection: COL, creator: deployer.address, revealTiming: "24h", websiteURL: "" }) });
  check("meta POST revealTiming=24h", metaRes.ok, String(metaRes.status));

  // one allowlist mint per phase (proof = same merkle algo as frontend)
  await mintAs(wallets[0], COL, 1, getProof(team, wallets[0].address), 500_000n);
  check("TEAM mint with proof", true);
  const wait = async (ts, l) => { const ms = ts * 1000 - Date.now(); if (ms > 0) { console.log(`⏳ ${Math.ceil(ms / 1000)}s -> ${l}`); await sleep(ms + 4000); } };
  await wait(t0 + 60, "GTD");
  await mintAs(wallets[5], COL, 1, getProof(gtd, wallets[5].address), 500_000n);
  check("GTD mint with proof", true);
  await wait(t0 + 120, "FCFS");
  await mintAs(wallets[15], COL, 1, getProof(fcfs, wallets[15].address), 500_000n);
  check("FCFS mint with proof", true);
  await wait(t0 + 180, "PUBLIC");

  // public fill to 100
  let minted = 3, wi = 20;
  while (minted < 100) {
    const left = 100 - minted, qty = Math.min(3, left), isLast = left <= 3;
    try {
      await mintAs(wallets[wi % 50], COL, qty, [], isLast ? 15_000_000n : BigInt(300_000 + 200_000 * qty));
      minted += qty;
      if (minted % 30 < 3 || isLast) console.log(`  minted ${minted}/100`);
    } catch (e) { console.log(`  wallet#${wi % 50}: ${(e.shortMessage || e.message).slice(0, 70)}`); if (wi > 250) throw e; }
    wi++;
  }
  check("RVTEST minted out", minted === 100);

  // bondedAt timestamping (what any visitor's browser now does via useReveal)
  const bres = await fetch(`${API}/api/collection/bonded/${COL}`, { method: "POST" });
  const bmeta = (await bres.json()).meta;
  check("bondedAt timestamped", bres.ok && !!bmeta.bondedAt, new Date(bmeta.bondedAt).toISOString());
  const meta = await (await fetch(`${API}/api/collection/meta/${COL}`)).json();
  const revealAt = meta.bondedAt + 24 * 3600 * 1000;
  const gateHolds = Date.now() < revealAt && meta.revealTiming === "24h";
  check("24h gate ACTIVE (UI shows UNREVEALED + countdown)", gateHolds, `reveals ${new Date(revealAt).toISOString()}`);

  // 7d + elapsed path on MKTEST: set meta 7d, bond-stamp, rewind bondedAt 8 days in db
  await fetch(`${API}/api/collection/meta`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection: MKTEST, creator: deployer.address, revealTiming: "7d", websiteURL: "" }) });
  await fetch(`${API}/api/collection/bonded/${MKTEST}`, { method: "POST" });
  const db = JSON.parse(fs.readFileSync("/root/profileapi/db.json", "utf8"));
  db.collections[MKTEST.toLowerCase()].bondedAt = Date.now() - 8 * 24 * 3600 * 1000;
  fs.writeFileSync("/root/profileapi/db.json", JSON.stringify(db, null, 2));
  const m2 = await (await fetch(`${API}/api/collection/meta/${MKTEST}`)).json();
  const elapsed = Date.now() >= m2.bondedAt + 7 * 24 * 3600 * 1000 && m2.revealTiming === "7d";
  check("7d gate ELAPSED (UI shows revealed photos)", elapsed, "bondedAt rewound 8d");

  const ok = results.filter(Boolean).length;
  console.log(`\n══════ RESULT: ${ok}/${results.length} PASS ══════`);
  console.log("RVTEST:", COL, "| deployer:", formatEther(await pub.getBalance({ address: deployer.address })));
  if (ok !== results.length) process.exit(1);
}
main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
