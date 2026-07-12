// backend/oracle/index.ts
// Standalone Node.js oracle for the claim-based airdrop on Robinhood Chain.
// - Indexes NFT + token (Uniswap V4) trades, collecting the set of unique trading
//   wallets (participants) per token.
// - Daily 23:30 UTC snapshot: pick up to 100 RECIPIENTS uniformly at random from the
//   eligible participants (node:crypto randomness, never Math.random), split the
//   distributor's unallocated pool evenly among them as a CUMULATIVE merkle tree,
//   publish the root on-chain (AirdropDistributor.setRoot) and push the proofs to the
//   profile API for the claim UI.
// - Daily 00:00 UTC distribution: executeEpoch on the vault (burn 9%, fund the 1% pool).
// - Unclaimed allocations stay claimable forever (cumulative leaves), the unallocated
//   remainder rolls over to the next day's recipients.
// No emoji, no em dash.

import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEther, formatEther, keccak256, encodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { randomInt } from "crypto";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Config ──────────────────────────────────────────────────────────────────
// Robinhood Chain (Arbitrum Orbit L2, chainId 4663). Same definition as
// backend/chain.mjs; keep the two in sync. Public RPC is rate limited, so set
// ROBINHOOD_RPC_URL to a keyed RPC in production.
const RPC = process.env.ROBINHOOD_RPC_URL || process.env.RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const CHAIN = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const ORACLE_PK = process.env.ORACLE_PRIVATE_KEY as `0x${string}`;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS as `0x${string}`;
const DISTRIBUTOR_ADDRESS = process.env.AIRDROP_DISTRIBUTOR as `0x${string}`;
const LAUNCHPAD_ADDRESS = process.env.LAUNCHPAD_ADDRESS as `0x${string}`;

// Uniswap V4 PoolManager on Robinhood Chain
const POOL_MANAGER = (process.env.POOL_MANAGER || "0x8366a39cc670b4001a1121b8f6a443a643e40951") as `0x${string}`;
const FEE_HOOK = (process.env.FEE_HOOK || "0x0000000000000000000000000000000000000000") as `0x${string}`;

// Stream-2 (0.1% trade-fee distribution). The fee accrues as ETH in the vault.
// Each snapshot, the oracle drains it and routes per collection:
//   token collection  -> buyback ETH->token, fund distributor[token] (merges with stream-1)
//   NFT-only collection -> wrap ETH->WETH, fund distributor[WETH]
// Funds are sent DIRECTLY to the distributor (fund/notifyFunded are onlyVault), so the
// snapshot reads the pool balance-based: balanceOf(distributor) + totalClaimed.
const STREAM2_ENABLED = process.env.STREAM2_ENABLED !== "0";
const SWAP_ROUTER = (process.env.SWAP_ROUTER || "0x0000000000000000000000000000000000000000") as `0x${string}`; // HoodseaSwapRouter, set after deploy
// Canonical WETH on Robinhood Chain
const WETH = ((process.env.WETH || "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73").toLowerCase()) as `0x${string}`;
// Minimum vault ETH worth collecting in a run (skip dust to save gas).
const STREAM2_MIN_ETH = parseEther(process.env.STREAM2_MIN_ETH || "0.00002");
// Buyback slippage guard, basis points (500 = 5%).
const SLIPPAGE_BPS = BigInt(process.env.SLIPPAGE_BPS || "500");

const PROFILE_API = process.env.PROFILE_API || process.env.PROFILE_API_URL || "http://127.0.0.1:3001";
const AIRDROP_SECRET = process.env.AIRDROP_SECRET || "";

// getLogs chunking / lookback / throttle, all env-tunable.
// Robinhood Chain (Arbitrum Orbit) mines blocks MUCH faster than Base (sub-second
// possible vs Base's 2s), so the SAME wall-clock window needs a much larger block
// lookback. 2,000,000 blocks is roughly a few days at ~4-8 blocks/s; tune per real
// observed block time. LOG_CHUNK stays conservative for the rate-limited public RPC.
const LOG_CHUNK = BigInt(process.env.LOG_CHUNK || "5000");
const LOOKBACK_BLOCKS = BigInt(process.env.LOOKBACK_BLOCKS || process.env.INDEX_LOOKBACK_BLOCKS || "2000000");

const STATE_FILE = path.join(__dirname, "airdrop-state.json");

function poolIdFor(token: `0x${string}`): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
    ["0x0000000000000000000000000000000000000000", token, 0, 60, FEE_HOOK]
  ));
}

const account = privateKeyToAccount(ORACLE_PK);
const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const walletClient = createWalletClient({ account, chain: CHAIN, transport: http(RPC) });

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const NFT_SOLD_ABI = parseAbi([
  "event NFTSold(uint256 indexed tokenId, uint256 price, address from, address to)",
]);

const VAULT_ABI = parseAbi([
  "function executeEpoch(address token, uint256 epochIndex) external",
  "function getVaultStatus(address token) external view returns (uint256 balance, uint256[5] executed, uint256[5] epochTimes, bool[5] ready)",
  "function getManagedTokens() external view returns (address[])",
  "function withdrawETH(address to, uint256 amount) external",
  "function airdropVault() external view returns (address)",
]);

const DISTRIBUTOR_ABI = parseAbi([
  "function setRoot(address token, bytes32 root) external",
  "function totalFunded(address token) external view returns (uint256)",
  "function totalClaimed(address token) external view returns (uint256)",
  "function round(address token) external view returns (uint256)",
]);

const ERC20_BAL_ABI = parseAbi(["function balanceOf(address) external view returns (uint256)"]);

// HoodseaSwapRouter exact-input swap (ETH<->token through the V4 pool + fee hook).
const SWAP_ROUTER_ABI = [{
  name: "swapExactIn", type: "function", stateMutability: "payable",
  inputs: [
    { name: "key", type: "tuple", components: [
      { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
    { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint256" },
    { name: "minOut", type: "uint256" }, { name: "recipient", type: "address" }],
  outputs: [{ type: "uint256" }],
}] as const;

// Canonical WrappedETH (deposit / transfer).
const WETH_ABI = parseAbi([
  "function deposit() external payable",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function balanceOf(address) external view returns (uint256)",
]);

function poolKeyFor(token: `0x${string}`) {
  return { currency0: ZERO_ADDR as `0x${string}`, currency1: token, fee: 0, tickSpacing: 60, hooks: FEE_HOOK };
}

const TOKEN_ABI = parseAbi([
  "function totalSupply() external view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const V4_SWAP_EVENT = {
  type: "event", name: "Swap", inputs: [
    { name: "id", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "amount0", type: "int128", indexed: false },
    { name: "amount1", type: "int128", indexed: false },
    { name: "sqrtPriceX96", type: "uint160", indexed: false },
    { name: "liquidity", type: "uint128", indexed: false },
    { name: "tick", type: "int24", indexed: false },
    { name: "fee", type: "uint24", indexed: false },
  ],
} as const;

const LAUNCHPAD_ABI = parseAbi([
  "function getAllCollections() external view returns (address[])",
  "event CollectionLaunched(address indexed collection, address indexed creator, string name, string ticker, uint256 mintPrice, uint256 mintStart)",
]);

const NFT_ABI_FULL = [{
  name: "getCollectionInfo", type: "function", stateMutability: "view", inputs: [],
  outputs: [{ name: "", type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" },
    { name: "bio", type: "string" }, { name: "socialX", type: "string" },
    { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" },
    { name: "creator", type: "address" }, { name: "mintPrice", type: "uint256" },
    { name: "platformFeeETH", type: "uint256" }, { name: "bondingComplete", type: "bool" },
    { name: "tokenAddress", type: "address" },
  ]}],
}] as const;

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const DEAD = "0x000000000000000000000000000000000000dead";

// ─── Persistent cumulative allocation state ─────────────────────────────────────
// token => { allocated: total tokens promised so far, cumulative: addr => cumulative amount }
type TokenState = { allocated: string; cumulative: Record<string, string> };
let allocState: Record<string, TokenState> = {};

function loadState() {
  try { allocState = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { allocState = {}; }
}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(allocState, null, 1)); }
  catch (e) { console.error("[oracle] saveState failed:", e); }
}

// ─── In-memory trade state ──────────────────────────────────────────────────────
// key = token address (token collections) OR WETH (all NFT-only collections, pooled).
// spent/received are kept for participation tracking (a wallet with any activity is
// an eligible airdrop participant).
const tradeState: Record<string, Record<string, { spent: bigint; received: bigint }>> = {};
// Per-collection trade volume is accumulated in volAccum (declared below) and used to
// attribute the vault's accrued 0.1% fee across collections (stream-2).
// Distinct token-collection token addresses seen this pass (diagnostic only).
let seenTokens = new Set<string>();

function touchState(key: string, addr: string) {
  if (!tradeState[key]) tradeState[key] = {};
  if (!tradeState[key][addr]) tradeState[key][addr] = { spent: BigInt(0), received: BigInt(0) };
}

// ─── Incremental index checkpoint (persisted) ───────────────────────────────────
// Instead of re-scanning LOOKBACK_BLOCKS every cycle (≈14k getLogs over ~100
// collections — overwhelms any free RPC), we persist tradeState + a block checkpoint
// and only scan NEW blocks each cycle. First run bootstraps from latest-LOOKBACK.
const INDEX_STATE_FILE = path.join(__dirname, "index-state.json");
// Delay between getLogs chunks. The public Robinhood RPC is rate limited, so
// default is gentler than the old Base setting; drop it with a keyed RPC.
const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || "150");
let lastIndexedBlock: bigint = BigInt(0);
// per-collection volume accumulated since the last successful stream-2 collection
let volAccum: Record<string, { tokenAddr: `0x${string}` | null; vol: bigint }> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadIndexState() {
  try {
    const d = JSON.parse(fs.readFileSync(INDEX_STATE_FILE, "utf8"));
    lastIndexedBlock = BigInt(d.lastBlock || "0");
    for (const [k, traders] of Object.entries<any>(d.trades || {})) {
      tradeState[k] = {};
      for (const [a, v] of Object.entries<any>(traders)) tradeState[k][a] = { spent: BigInt(v.spent), received: BigInt(v.received) };
    }
    for (const [c, v] of Object.entries<any>(d.volAccum || {})) volAccum[c] = { tokenAddr: v.tokenAddr, vol: BigInt(v.vol) };
    console.log(`[oracle] index-state loaded: block ${lastIndexedBlock}, ${Object.keys(tradeState).length} keys`);
  } catch { lastIndexedBlock = BigInt(0); }
}
function saveIndexState() {
  try {
    const trades: any = {};
    for (const [k, traders] of Object.entries(tradeState)) {
      trades[k] = {};
      for (const [a, v] of Object.entries(traders)) trades[k][a] = { spent: v.spent.toString(), received: v.received.toString() };
    }
    const vol: any = {};
    for (const [c, v] of Object.entries(volAccum)) vol[c] = { tokenAddr: v.tokenAddr, vol: v.vol.toString() };
    fs.writeFileSync(INDEX_STATE_FILE, JSON.stringify({ lastBlock: lastIndexedBlock.toString(), trades, volAccum: vol }, null, 1));
  } catch (e) { console.error("[oracle] saveIndexState failed:", e); }
}

// chunked getLogs over an EXPLICIT range, with retry + throttle (never silently skip —
// a swallowed getLogs error is exactly what hid the indexing failure before).
async function getLogsChunked(params: any, fromBlock: bigint, toBlock: bigint) {
  const out: any[] = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + LOG_CHUNK - BigInt(1) > toBlock ? toBlock : from + LOG_CHUNK - BigInt(1);
    let ok = false;
    for (let attempt = 0; attempt < 5 && !ok; attempt++) {
      try { out.push(...await publicClient.getLogs({ ...params, fromBlock: from, toBlock: to })); ok = true; }
      catch (e) { await sleep(300 * (attempt + 1)); }
    }
    if (!ok) throw new Error(`getLogs ${from}-${to} failed after retries`);
    from = to + BigInt(1);
    if (RPC_DELAY_MS > 0) await sleep(RPC_DELAY_MS);
  }
  return out;
}

// ─── Index trades for one collection ────────────────────────────────────────────
// Token collections accumulate trade activity per trader keyed by their token
// (recipients get that token). NFT-only collections pool into the shared WETH key
// (recipients get WETH).
async function indexCollectionTrades(collectionAddress: `0x${string}`, fromBlock: bigint, toBlock: bigint) {
  const info = await publicClient.readContract({
    address: collectionAddress, abi: NFT_ABI_FULL, functionName: "getCollectionInfo",
  }) as any;
  const tokenAddrRaw = info.tokenAddress as `0x${string}`;
  const hasToken = tokenAddrRaw && tokenAddrRaw !== ZERO_ADDR;
  const key = (hasToken ? tokenAddrRaw : WETH).toLowerCase();
  if (hasToken) seenTokens.add(tokenAddrRaw.toLowerCase());

  let vol = BigInt(0);

  // NFT marketplace trades (every collection): buyer net-spends, seller net-receives.
  const nftLogs = await getLogsChunked({ address: collectionAddress, event: NFT_SOLD_ABI[0] }, fromBlock, toBlock);
  for (const log of nftLogs) {
    const { price, from, to } = log.args as any;
    touchState(key, from); touchState(key, to);
    tradeState[key][from].received += price;
    tradeState[key][to].spent += price;
    vol += price;
  }

  // Uniswap V4 swaps (token collections only): ETH leg in/out per trader.
  let swapCount = 0;
  if (hasToken) {
    const swapLogs = await getLogsChunked({ address: POOL_MANAGER, event: V4_SWAP_EVENT, args: { id: poolIdFor(tokenAddrRaw) } }, fromBlock, toBlock);
    swapCount = swapLogs.length;
    const txFrom: Record<string, `0x${string}`> = {};
    for (const log of swapLogs) {
      const eth: bigint = (log as any).args.amount0;
      if (eth === BigInt(0)) continue;
      const txHash = (log as any).transactionHash as string;
      let trader = txFrom[txHash];
      if (!trader) { trader = (await publicClient.getTransaction({ hash: txHash as `0x${string}` })).from; txFrom[txHash] = trader; }
      touchState(key, trader);
      if (eth < BigInt(0)) tradeState[key][trader].spent += -eth; else tradeState[key][trader].received += eth;
      vol += eth < BigInt(0) ? -eth : eth;
    }
  }

  if (vol > BigInt(0)) {
    const ck = collectionAddress.toLowerCase();
    const cur = volAccum[ck] || { tokenAddr: hasToken ? tokenAddrRaw : null, vol: BigInt(0) };
    cur.vol += vol;
    volAccum[ck] = cur;
    console.log(`[oracle] ${hasToken ? tokenAddrRaw : "NFT-only " + collectionAddress.slice(0, 10)}: ${nftLogs.length} NFT trades, ${swapCount} swaps, +${formatEther(vol)} ETH (accum ${formatEther(cur.vol)})`);
  }
}

async function indexAllCollections() {
  tradeState[WETH] = tradeState[WETH] || {}; // ensure the WETH pool key exists
  seenTokens = new Set<string>();
  const latest = await publicClient.getBlockNumber();
  // incremental: only scan blocks after the checkpoint. First run bootstraps from
  // latest-LOOKBACK so we capture history once, then advance the checkpoint.
  const from = lastIndexedBlock > BigInt(0)
    ? lastIndexedBlock + BigInt(1)
    : (latest > LOOKBACK_BLOCKS ? latest - LOOKBACK_BLOCKS : BigInt(0));
  if (from > latest) { return; } // no new blocks
  const collections = await publicClient.readContract({
    address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "getAllCollections",
  }) as `0x${string}`[];
  let failed = 0;
  for (const col of collections) {
    try { await indexCollectionTrades(col, from, latest); }
    catch (e: any) { failed++; console.error(`[oracle] index ${col.slice(0, 10)} failed:`, e?.shortMessage || e?.message); }
  }
  // Advance the checkpoint even if a few collections failed (retries make that rare,
  // and failures are logged loudly, not swallowed). Avoids double-counting on re-scan.
  lastIndexedBlock = latest;
  saveIndexState();
  console.log(`[oracle] indexed ${from}..${latest} over ${collections.length} collections (${failed} failed)`);
}

// ─── Stream-2 step 0: push each token pool's accrued V4 swap fee into the vault ───
// Token-collection swap fees pile up in the per-pool fee SPLITTER until distribute()
// is called (permissionless). distribute() sends the airdrop 0.1% portion to the
// vault. NFT marketplace fees already go straight to the vault on buyNFT, so NFT-only
// collections need nothing here. Without this, the vault stays empty and stream-2
// has nothing to distribute.
const HOOK_RECIP_ABI = parseAbi(["function feeRecipient(bytes32) view returns (address)"]);
const SPLITTER_ABI = parseAbi(["function distribute() external"]);
const DISTRIBUTE_MIN = parseEther(process.env.DISTRIBUTE_MIN_ETH || "0.000005");

async function distributeSplitters() {
  const collections = await publicClient.readContract({
    address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, functionName: "getAllCollections",
  }) as `0x${string}`[];
  let done = 0;
  for (const col of collections) {
    try {
      const info = await publicClient.readContract({ address: col, abi: NFT_ABI_FULL, functionName: "getCollectionInfo" }) as any;
      const token = info.tokenAddress as `0x${string}`;
      if (!token || token === ZERO_ADDR) continue;               // NFT-only: fee already direct to vault
      const splitter = await publicClient.readContract({ address: FEE_HOOK, abi: HOOK_RECIP_ABI, functionName: "feeRecipient", args: [poolIdFor(token)] }) as `0x${string}`;
      if (!splitter || splitter === ZERO_ADDR) continue;
      const bal = await publicClient.getBalance({ address: splitter });
      if (bal < DISTRIBUTE_MIN) continue;
      const hash = await walletClient.writeContract({ address: splitter, abi: SPLITTER_ABI, functionName: "distribute" });
      await publicClient.waitForTransactionReceipt({ hash });
      done++;
      console.log(`[oracle] stream-2 distribute() ${splitter.slice(0, 10)} (${formatEther(bal)} ETH) for ${token.slice(0, 10)}`);
    } catch (e: any) { /* nothing-to-distribute / edge: skip */ }
  }
  if (done) console.log(`[oracle] stream-2: distributed ${done} splitter(s) -> vault`);
}

// ─── Stream-2: drain the vault's accrued 0.1% fee and fund the distributor ────────
// Must run AFTER indexAllCollections (uses collectionVols) and BEFORE the snapshot.
async function collectStream2Fees() {
  if (!STREAM2_ENABLED) return;
  await distributeSplitters();                                   // push token-pool swap fees into the vault first
  const vaultEth = await publicClient.getBalance({ address: VAULT_ADDRESS });
  if (vaultEth < STREAM2_MIN_ETH) { console.log(`[oracle] stream-2: vault ${formatEther(vaultEth)} ETH < min, skip`); return; }

  // volume accrued since the last collection (incremental) attributes the vault's
  // accrued 0.1% fee across collections. Reset after a successful pass.
  const cols = Object.entries(volAccum).map(([collection, v]) => ({ collection: collection as `0x${string}`, tokenAddr: v.tokenAddr, vol: v.vol }));
  const totalVol = cols.reduce((s, c) => s + c.vol, BigInt(0));
  if (totalVol === BigInt(0)) { console.log("[oracle] stream-2: no trade volume, skip"); return; }
  console.log(`[oracle] stream-2: vault ${formatEther(vaultEth)} ETH over ${cols.length} collections (vol ${formatEther(totalVol)} ETH)`);

  let wethEth = BigInt(0); // accumulated NFT-only share -> wrapped once
  for (const c of cols) {
    const share = (vaultEth * c.vol) / totalVol;
    if (share === BigInt(0)) continue;
    if (!c.tokenAddr) { wethEth += share; continue; }
    // token collection: withdraw share -> buyback -> distributor[token]
    try {
      await withdrawFromVault(share);
      const bought = await buybackToDistributor(c.tokenAddr, share);
      console.log(`[oracle] stream-2 buyback ${c.tokenAddr.slice(0, 10)}: ${formatEther(share)} ETH -> ${formatEther(bought)} token`);
    } catch (e: any) {
      console.error(`[oracle] stream-2 buyback ${c.tokenAddr.slice(0, 10)} failed, refunding vault:`, e?.shortMessage || e?.message);
      try { await refundVault(share); } catch {}
    }
  }

  if (wethEth > BigInt(0)) {
    try {
      await withdrawFromVault(wethEth);
      await wrapAndFund(wethEth);
      console.log(`[oracle] stream-2 WETH: wrapped ${formatEther(wethEth)} ETH -> distributor[WETH]`);
    } catch (e: any) {
      console.error("[oracle] stream-2 WETH wrap failed, refunding vault:", e?.shortMessage || e?.message);
      try { await refundVault(wethEth); } catch {}
    }
  }

  // fees for this volume window are now attributed; reset the accumulator
  volAccum = {};
  saveIndexState();
}

async function withdrawFromVault(amount: bigint) {
  const hash = await walletClient.writeContract({
    address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "withdrawETH", args: [account.address, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function refundVault(amount: bigint) {
  const hash = await walletClient.sendTransaction({ to: VAULT_ADDRESS, value: amount });
  await publicClient.waitForTransactionReceipt({ hash });
}

// Buyback ETH->token via the V4 router, recipient = distributor (direct funding).
async function buybackToDistributor(token: `0x${string}`, ethIn: bigint): Promise<bigint> {
  const key = poolKeyFor(token);
  // quote for a slippage floor
  let minOut = BigInt(0);
  try {
    const { result } = await publicClient.simulateContract({
      address: SWAP_ROUTER, abi: SWAP_ROUTER_ABI, functionName: "swapExactIn",
      args: [key, true, ethIn, BigInt(0), DISTRIBUTOR_ADDRESS], value: ethIn, account,
    });
    minOut = ((result as bigint) * (BigInt(10000) - SLIPPAGE_BPS)) / BigInt(10000);
  } catch { minOut = BigInt(0); }
  const before = await publicClient.readContract({ address: token, abi: ERC20_BAL_ABI, functionName: "balanceOf", args: [DISTRIBUTOR_ADDRESS] }) as bigint;
  const hash = await walletClient.writeContract({
    address: SWAP_ROUTER, abi: SWAP_ROUTER_ABI, functionName: "swapExactIn",
    args: [key, true, ethIn, minOut, DISTRIBUTOR_ADDRESS], value: ethIn,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.readContract({ address: token, abi: ERC20_BAL_ABI, functionName: "balanceOf", args: [DISTRIBUTOR_ADDRESS] }) as bigint;
  return after - before;
}

// Wrap ETH->WETH and transfer to the distributor (NFT-only payout currency).
async function wrapAndFund(ethIn: bigint) {
  const d = await walletClient.writeContract({ address: WETH, abi: WETH_ABI, functionName: "deposit", args: [], value: ethIn });
  await publicClient.waitForTransactionReceipt({ hash: d });
  const t = await walletClient.writeContract({ address: WETH, abi: WETH_ABI, functionName: "transfer", args: [DISTRIBUTOR_ADDRESS, ethIn] });
  await publicClient.waitForTransactionReceipt({ hash: t });
}

// ─── Recipient selection (uniform random over participants) ─────────────────────
let excludedSet = new Set<string>();
async function refreshExcluded() {
  try {
    const r = await fetch(`${PROFILE_API}/api/moderation`);
    if (r.ok) { const d: any = await r.json(); excludedSet = new Set((d.excluded || []).map((a: string) => String(a).toLowerCase())); }
  } catch {}
}

// Eligible participants = every unique wallet that traded this key (NFT sale or
// V4 swap), minus the zero/dead addresses and the moderation exclusion list.
function eligibleParticipants(tokenAddr: string): `0x${string}`[] {
  const state = tradeState[tokenAddr.toLowerCase()];
  if (!state) return [];
  return Object.entries(state)
    .filter(([, { spent, received }]) => spent > BigInt(0) || received > BigInt(0))
    .map(([address]) => address as `0x${string}`)
    .filter((a) => ![ZERO_ADDR, DEAD].includes(a.toLowerCase()))
    .filter((a) => !excludedSet.has(a.toLowerCase()));
}

// Pick up to topN recipients UNIFORMLY AT RANDOM from the eligible participants,
// using node:crypto randomness (crypto.randomInt), never Math.random. Fewer than
// topN participants means everyone is selected. Partial Fisher-Yates shuffle.
function pickRandomRecipients(tokenAddr: string, topN = 100): `0x${string}`[] {
  const pool = eligibleParticipants(tokenAddr);
  if (pool.length <= topN) return pool;
  for (let i = 0; i < topN; i++) {
    const j = i + randomInt(pool.length - i); // uniform in [i, pool.length)
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, topN);
}

// ─── Cumulative merkle snapshot per token ───────────────────────────────────────
async function snapshotAirdrop(tokenAddr: `0x${string}`) {
  const key = tokenAddr.toLowerCase();
  // Balance-based pool: everything ever made available = current distributor balance
  // (unclaimed) + already claimed. Captures stream-1 (vault-funded) and stream-2
  // (oracle direct-funded buyback/WETH) uniformly, since claim() pays from balance.
  const [bal, claimedTotal] = await Promise.all([
    publicClient.readContract({ address: tokenAddr, abi: ERC20_BAL_ABI, functionName: "balanceOf", args: [DISTRIBUTOR_ADDRESS] }) as Promise<bigint>,
    publicClient.readContract({ address: DISTRIBUTOR_ADDRESS, abi: DISTRIBUTOR_ABI, functionName: "totalClaimed", args: [tokenAddr] }) as Promise<bigint>,
  ]);
  const funded = bal + claimedTotal;
  if (funded === BigInt(0)) return; // pool not funded yet

  const ts = allocState[key] || { allocated: "0", cumulative: {} };
  const cumulative: Record<string, bigint> = {};
  for (const [a, v] of Object.entries(ts.cumulative)) cumulative[a.toLowerCase()] = BigInt(v);
  let allocated = BigInt(ts.allocated);

  // Distribute the still-unallocated pool EVENLY across up to 100 randomly picked
  // recipients (rollover of the remainder to the next snapshot).
  const available = funded > allocated ? funded - allocated : BigInt(0);
  const winners = pickRandomRecipients(key, 100);

  if (available > BigInt(0) && winners.length > 0) {
    const share = available / BigInt(winners.length);
    let handed = BigInt(0);
    if (share > BigInt(0)) {
      for (const w of winners) {
        const a = w.toLowerCase();
        cumulative[a] = (cumulative[a] || BigInt(0)) + share;
        handed += share;
      }
    }
    allocated += handed; // rounding dust stays unallocated, rolls to next day
    console.log(`[oracle] ${tokenAddr}: selected ${winners.length} random recipients, ${formatEther(handed)} allocated`);
  }

  // Persist
  allocState[key] = {
    allocated: allocated.toString(),
    cumulative: Object.fromEntries(Object.entries(cumulative).map(([a, v]) => [a, v.toString()])),
  };
  saveState();

  const entries = Object.entries(cumulative).filter(([, v]) => v > BigInt(0));
  if (entries.length === 0) { console.log(`[oracle] ${tokenAddr}: no allocations yet`); return; }

  const tree = StandardMerkleTree.of(entries.map(([a, v]) => [a, v.toString()]), ["address", "uint256"]);

  // Publish the root on-chain. AWAIT the receipt so back-to-back snapshots don't
  // submit two setRoot txs on the same nonce ("replacement transaction underpriced").
  try {
    const hash = await walletClient.writeContract({
      address: DISTRIBUTOR_ADDRESS, abi: DISTRIBUTOR_ABI, functionName: "setRoot", args: [tokenAddr, tree.root as `0x${string}`],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`[oracle] setRoot ${tokenAddr} -> ${tree.root} tx ${hash}`);
  } catch (e: any) { console.error(`[oracle] setRoot failed ${tokenAddr}:`, e?.shortMessage || e?.message || e); }

  // Push proofs to the profile API for the claim UI
  const claims: Record<string, { amount: string; proof: string[] }> = {};
  for (const [i, v] of tree.entries()) {
    claims[(v[0] as string).toLowerCase()] = { amount: v[1] as string, proof: tree.getProof(i) };
  }
  try {
    const res = await fetch(`${PROFILE_API}/api/airdrop/claims`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-oracle-secret": AIRDROP_SECRET },
      body: JSON.stringify({ token: tokenAddr, root: tree.root, funded: funded.toString(), allocated: allocated.toString(), claims }),
    });
    if (!res.ok) console.error(`[oracle] publish claims ${tokenAddr} HTTP ${res.status}`);
  } catch (e) { console.error(`[oracle] publish claims ${tokenAddr} failed:`, e); }
}

// ─── Daily jobs ─────────────────────────────────────────────────────────────────
async function snapshotEpochs() {
  console.log("[oracle] === SNAPSHOT 23:30 UTC ===");
  await refreshExcluded();
  await indexAllCollections();

  // Stream-2: turn the vault's accrued 0.1% fee into per-collection token buybacks /
  // WETH BEFORE snapshotting, so the new funds are in the distributor balance.
  try { await collectStream2Fees(); } catch (e) { console.error("[oracle] stream-2 collect failed:", e); }

  // Snapshot key set: stream-1 managed tokens + every token collection that traded
  // (stream-2) + the shared WETH pool for NFT-only collections.
  const managed = await publicClient.readContract({
    address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "getManagedTokens",
  }) as `0x${string}`[];
  const keys = new Set<string>();
  for (const t of managed) keys.add(t.toLowerCase());
  // every token that has EVER traded (cumulative tradeState), not just this pass
  for (const k of Object.keys(tradeState)) keys.add(k);
  keys.add(WETH);
  for (const k of keys) {
    try { await snapshotAirdrop(k as `0x${string}`); } catch (e) { console.error(`[oracle] snapshot ${k} failed:`, e); }
  }
}

async function distributeEpochs() {
  console.log("[oracle] === DISTRIBUTION 00:00 UTC ===");
  const managed = await publicClient.readContract({
    address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "getManagedTokens",
  }) as `0x${string}`[];
  for (const t of managed) {
    const [, executed, , ready] = await publicClient.readContract({
      address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "getVaultStatus", args: [t],
    }) as unknown as any[];
    for (let i = 0; i < 5; i++) {
      if (ready[i] && executed[i] === BigInt(0)) {
        try {
          const hash = await walletClient.writeContract({
            address: VAULT_ADDRESS, abi: VAULT_ABI, functionName: "executeEpoch", args: [t, BigInt(i)],
          });
          console.log(`[oracle] executeEpoch ${t} #${i} tx ${hash}`);
        } catch (e) { console.error(`[oracle] executeEpoch ${t} #${i} failed:`, e); }
      }
    }
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────────
function msUntilUTC(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}
function scheduleDaily(hour: number, minute: number, label: string, job: () => Promise<void>) {
  const delay = msUntilUTC(hour, minute);
  console.log(`[oracle] Next ${label} at ${String(hour).padStart(2,"0")}:${String(minute).padStart(2,"0")} UTC in ${Math.round(delay/60000)} min`);
  setTimeout(async () => {
    try { await job(); } catch (e) { console.error(`[oracle] ${label} failed:`, e); }
    scheduleDaily(hour, minute, label, job);
  }, delay);
}

// The 0.1% NFT fee is routed to whatever the launchpad has as airdropVault. Stream-2
// drains VAULT_ADDRESS, so the two MUST match or NFT fees never reach the distributor.
async function checkVaultWiring() {
  try {
    const lpVault = await publicClient.readContract({
      address: LAUNCHPAD_ADDRESS, abi: parseAbi(["function airdropVault() view returns (address)"]), functionName: "airdropVault",
    }) as `0x${string}`;
    if (lpVault.toLowerCase() !== VAULT_ADDRESS.toLowerCase()) {
      console.warn(`[oracle] WARNING vault wiring split: launchpad.airdropVault=${lpVault} but VAULT_ADDRESS=${VAULT_ADDRESS}. NFT 0.1% fees land in the launchpad vault; set VAULT_ADDRESS to it (or unify on mainnet) or NFT-only stream-2 will be stranded.`);
    } else {
      console.log(`[oracle] vault wiring OK: launchpad.airdropVault == VAULT_ADDRESS`);
    }
  } catch { /* launchpad has no airdropVault getter; skip */ }
}

async function main() {
  const manual = process.argv[2]; // "snapshot" | "distribute" | "stream2" | "both"
  loadState();
  loadIndexState();
  console.log(`[oracle] start. chain=${CHAIN.name} vault=${VAULT_ADDRESS} distributor=${DISTRIBUTOR_ADDRESS} oracle=${account.address}`);
  console.log(`[oracle] stream-2 ${STREAM2_ENABLED ? "ON" : "OFF"} router=${SWAP_ROUTER} weth=${WETH} slippage=${SLIPPAGE_BPS}bps`);
  await checkVaultWiring();

  if (manual === "snapshot") { await snapshotEpochs(); process.exit(0); }
  if (manual === "distribute") { await distributeEpochs(); process.exit(0); }
  if (manual === "stream2") { await indexAllCollections(); await collectStream2Fees(); process.exit(0); }
  if (manual === "both") { await distributeEpochs(); await snapshotEpochs(); process.exit(0); }

  await indexAllCollections();

  setInterval(async () => { try { await indexAllCollections(); } catch (e) { console.error("[oracle] index loop failed:", e); } }, 10 * 60 * 1000);

  scheduleDaily(23, 30, "snapshot", snapshotEpochs);
  scheduleDaily(0, 0, "distribution", distributeEpochs);

  publicClient.watchContractEvent({
    address: LAUNCHPAD_ADDRESS, abi: LAUNCHPAD_ABI, eventName: "CollectionLaunched",
    onLogs: (logs) => { for (const l of logs) console.log(`[oracle] new collection ${(l as any).args.collection}`); },
  });
  console.log("[oracle] running. snapshot 23:30 UTC, distribution 00:00 UTC daily.");
}

main().catch(console.error);
