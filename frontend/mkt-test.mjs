// Marketplace e2e on Base Sepolia: public-only launch, fill to 100,
// then list / cancel / buy / collection-offer / vault-fee checks.
import { createPublicClient, createWalletClient, http, fallback, parseEther, formatEther, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { createRequire } from "module";
import fs from "fs";

const require = createRequire(import.meta.url);
require("dotenv").config({ path: "/root/recomendasi/recomendasi/contracts/.env", quiet: true });

const RPC = fallback([http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]);
const LAUNCHPAD = "0x8f71aB89BCfb0d942c08062D8b83D305a876AD53";
const TOKEN_FACTORY = "0xc11f796179230756396EdcDd94D0bdb85c3C4F67";
const VAULT = "0x01EE6dFA10709564F733e468316bfb6BF6f5B9D1";
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
  { type: "function", name: "totalMinted", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tokenOwner", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "tokenListPrice", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "listNFT", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelListing", stateMutability: "nonpayable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "buyNFT", stateMutability: "payable", inputs: [{ type: "uint256" }], outputs: [] },
  { type: "function", name: "makeCollectionOffer", stateMutability: "payable", inputs: [], outputs: [] },
  { type: "function", name: "acceptCollectionOffer", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "address" }], outputs: [] },
  { type: "function", name: "collectionOffer", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getCollectionInfo", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
    { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" },
    { name: "bondingComplete", type: "bool" }, { name: "tokenAddress", type: "address" } ] }] },
];
const FACTORY_ABI = [{ type: "function", name: "tokenToPool", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] }];
const POOL_ABI = [{ type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] }];

const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${name}${extra ? "  (" + extra + ")" : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function readRetry(args, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await pub.readContract(args); }
    catch (e) { if (i === tries - 1) throw e; await sleep(3000); }
  }
}
async function writeAs(account, args) {
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: RPC });
  const hash = await wallet.writeContract(args);
  const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (rcpt.status !== "success") throw new Error("tx reverted");
  return rcpt;
}

async function main() {
  console.log("deployer balance:", formatEther(await pub.getBalance({ address: deployer.address })));
  const wallets = JSON.parse(fs.readFileSync("/root/recomendasi/recomendasi/contracts/test-wallets.json")).map((x) => privateKeyToAccount(x.pk));

  // top-up wallets below 0.001
  let nonce = await pub.getTransactionCount({ address: deployer.address });
  let lastHash = null, funded = 0;
  for (const w of wallets) {
    const bal = await pub.getBalance({ address: w.address });
    if (bal >= parseEther("0.001")) continue;
    lastHash = await deployerWallet.sendTransaction({ to: w.address, value: parseEther("0.002") - bal, nonce: nonce++ });
    funded++;
    await sleep(120);
  }
  if (lastHash) await pub.waitForTransactionReceipt({ hash: lastHash, timeout: 120_000 });
  console.log(`topped up ${funded} wallets`);

  // launch public-only collection (active immediately, no expiry)
  const t0 = Math.floor(Date.now() / 1000);
  const launchHash = await deployerWallet.writeContract({
    address: LAUNCHPAD, abi: LP_ABI, functionName: "launchCollection",
    args: [{
      name: "Market Test", ticker: "MKTEST", bio: "marketplace e2e test",
      photoURIs: ["ipfs://m1", "ipfs://m2", "ipfs://m3", "", "", ""], photoCount: 3,
      socialX: "", socialGithub: "", socialFarcaster: "",
      mintPriceWei: MINT_PRICE,
      phaseRoots: [ZERO32, ZERO32, ZERO32, ZERO32],
      phaseStarts: [BigInt(t0 - 10), BigInt(t0 - 10), BigInt(t0 - 10), BigInt(t0 - 10)],
      phaseEnds: [BigInt(t0 - 10), BigInt(t0 - 10), BigInt(t0 - 10), 9999999999n],
      phaseMaxPerWallet: [0n, 0n, 0n, 0n],
      allowlistCID: "",
    }],
    gas: 6_000_000n,
  });
  const launchRcpt = await pub.waitForTransactionReceipt({ hash: launchHash, timeout: 120_000 });
  const COL = parseEventLogs({ abi: LP_ABI, eventName: "CollectionLaunched", logs: launchRcpt.logs })[0].args.collection;
  check("launchCollection (public-only)", launchRcpt.status === "success", COL);
  // wait for lagging RPC nodes
  for (let i = 0; i < 20; i++) { const c = await pub.getCode({ address: COL }).catch(() => null); if (c && c !== "0x") break; await sleep(3000); }

  // fill to 100
  let minted = 0, wi = 0;
  while (minted < 100) {
    const left = 100 - minted;
    const qty = Math.min(3, left);
    const w = wallets[wi % 50]; wi++;
    const isLast = left <= 3;
    try {
      await writeAs(w, { address: COL, abi: NFT_ABI, functionName: "mint", args: [BigInt(qty), []], value: UNIT_COST * BigInt(qty), gas: isLast ? 15_000_000n : BigInt(300_000 + 200_000 * qty) });
      minted += qty;
      if (minted % 30 < 3 || isLast) console.log(`  minted ${minted}/100`);
    } catch (e) {
      console.log(`  wallet #${(wi - 1) % 50} failed: ${(e.shortMessage || e.message).slice(0, 80)}`);
      if (wi > 200) throw new Error("too many failures");
    }
  }
  check("Minted out 100", minted === 100);
  await sleep(3000);

  const info = await readRetry({ address: COL, abi: NFT_ABI, functionName: "getCollectionInfo" });
  check("Bonded + token deployed", info.bondingComplete && info.tokenAddress !== "0x" + "0".repeat(40), "token: " + info.tokenAddress);
  const pool = await readRetry({ address: TOKEN_FACTORY, abi: FACTORY_ABI, functionName: "tokenToPool", args: [info.tokenAddress] });
  if (pool !== "0x" + "0".repeat(40)) {
    const liq = await readRetry({ address: pool, abi: POOL_ABI, functionName: "liquidity" });
    check("Uniswap pool + liquidity", liq > 0n, `pool ${pool} liq ${liq}`);
  } else check("Uniswap pool + liquidity", false, "no pool");

  // find tokens owned by wallets[0] and wallets[1]
  const ownerOf = async (id) => (await readRetry({ address: COL, abi: NFT_ABI, functionName: "tokenOwner", args: [BigInt(id)] })).toLowerCase();
  let tokA = null;
  for (let id = 1; id <= 100 && !tokA; id++) if (await ownerOf(id) === wallets[0].address.toLowerCase()) tokA = BigInt(id);
  if (!tokA) throw new Error("wallet0 owns nothing");
  console.log("wallet0 owns token #" + tokA);

  // list + cancel
  const price = parseEther("0.0005");
  await writeAs(wallets[0], { address: COL, abi: NFT_ABI, functionName: "listNFT", args: [tokA, price, 0n], gas: 300_000n });
  check("listNFT", (await readRetry({ address: COL, abi: NFT_ABI, functionName: "tokenListPrice", args: [tokA] })) === price);
  await writeAs(wallets[0], { address: COL, abi: NFT_ABI, functionName: "cancelListing", args: [tokA], gas: 300_000n });
  check("cancelListing", (await readRetry({ address: COL, abi: NFT_ABI, functionName: "tokenListPrice", args: [tokA] })) === 0n);

  // relist + buy by wallet31; vault must receive 0.1% fee
  await writeAs(wallets[0], { address: COL, abi: NFT_ABI, functionName: "listNFT", args: [tokA, price, 0n], gas: 300_000n });
  const sellerBefore = await pub.getBalance({ address: wallets[0].address });
  const vaultBefore = await pub.getBalance({ address: VAULT });
  await writeAs(wallets[31], { address: COL, abi: NFT_ABI, functionName: "buyNFT", args: [tokA], value: price, gas: 500_000n });
  check("buyNFT: ownership transferred", await ownerOf(Number(tokA)) === wallets[31].address.toLowerCase());
  const sellerAfter = await pub.getBalance({ address: wallets[0].address });
  check("buyNFT: seller paid", sellerAfter > sellerBefore, `+${formatEther(sellerAfter - sellerBefore)} ETH`);
  const vaultAfter = await pub.getBalance({ address: VAULT });
  check("buyNFT: vault received airdrop fee", vaultAfter > vaultBefore, `+${formatEther(vaultAfter - vaultBefore)} ETH`);

  // collection offer: wallet32 offers, wallet31 accepts with tokA
  const offerAmt = parseEther("0.0004");
  await writeAs(wallets[32], { address: COL, abi: NFT_ABI, functionName: "makeCollectionOffer", args: [], value: offerAmt, gas: 300_000n });
  check("makeCollectionOffer", (await readRetry({ address: COL, abi: NFT_ABI, functionName: "collectionOffer", args: [wallets[32].address] })) === offerAmt);
  await writeAs(wallets[31], { address: COL, abi: NFT_ABI, functionName: "acceptCollectionOffer", args: [tokA, wallets[32].address], gas: 500_000n });
  check("acceptCollectionOffer: ownership to offerer", await ownerOf(Number(tokA)) === wallets[32].address.toLowerCase());

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n══════ RESULT: ${passed}/${results.length} PASS ══════`);
  console.log("collection:", COL, "| token:", info.tokenAddress);
  console.log("deployer balance after:", formatEther(await pub.getBalance({ address: deployer.address })));
  if (passed !== results.length) process.exit(1);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
