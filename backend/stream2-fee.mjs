// Stream-2 diagnostic: compute how the 0.1% trade fee (ETH) would be distributed
// per collection.
//  - token collection  -> buyback ETH->token, fund distributor with token (merges with stream-1)
//  - NFT-only collection -> wrap ETH->WETH, fund distributor with WETH
// The oracle daemon does the real execution; this script is a read-only plan
// (it never sends transactions) for sanity-checking vault solvency.
//
// Env (.env in this dir): ROBINHOOD_RPC_URL, LAUNCHPAD_ADDRESS, VAULT_ADDRESS,
//   AIRDROP_DISTRIBUTOR, POOL_MANAGER, FEE_HOOK, SWAP_ROUTER, WETH,
//   LOOKBACK_BLOCKS, LOG_CHUNK.
//
// Usage:  node stream2-fee.mjs
import "dotenv/config";
import { createPublicClient, http, parseAbi, formatEther, keccak256, encodeAbiParameters } from "viem";
import { robinhood, RPC_URL, WETH as WETH_DEFAULT, POOL_MANAGER as PM_DEFAULT } from "./chain.mjs";

const LAUNCHPAD = process.env.LAUNCHPAD_ADDRESS;
const VAULT = process.env.VAULT_ADDRESS;
const DISTRIBUTOR = process.env.AIRDROP_DISTRIBUTOR;
const POOL_MANAGER = process.env.POOL_MANAGER || PM_DEFAULT;
const FEE_HOOK = process.env.FEE_HOOK || "";
const SWAP_ROUTER = process.env.SWAP_ROUTER || "";
const WETH = process.env.WETH || WETH_DEFAULT;
const ZERO = "0x0000000000000000000000000000000000000000";
const AIRDROP_FEE_BPS = 10n; // 0.1%, matches HoodseaNFT.AIRDROP_FEE_BPS
if (!LAUNCHPAD || !VAULT || !DISTRIBUTOR) { console.error("set LAUNCHPAD_ADDRESS, VAULT_ADDRESS, AIRDROP_DISTRIBUTOR in .env"); process.exit(1); }

// Robinhood Chain blocks are much faster than Base's 2s (sub-second possible), so
// the same wall-clock window needs a much larger block lookback. Env-tunable.
const LOOKBACK = BigInt(process.env.LOOKBACK_BLOCKS || "2000000");
const CHUNK = BigInt(process.env.LOG_CHUNK || "5000");

const pub = createPublicClient({ chain: robinhood, transport: http(RPC_URL) });

const LAUNCHPAD_ABI = parseAbi(["function getAllCollections() view returns (address[])"]);
const NFT_SOLD = { type: "event", name: "NFTSold", inputs: [
  { name: "tokenId", type: "uint256", indexed: true }, { name: "price", type: "uint256", indexed: false },
  { name: "from", type: "address", indexed: false }, { name: "to", type: "address", indexed: false }] };
const V4_SWAP = { type: "event", name: "Swap", inputs: [
  { name: "id", type: "bytes32", indexed: true }, { name: "sender", type: "address", indexed: true },
  { name: "amount0", type: "int128" }, { name: "amount1", type: "int128" }, { name: "sqrtPriceX96", type: "uint160" },
  { name: "liquidity", type: "uint128" }, { name: "tick", type: "int24" }, { name: "fee", type: "uint24" }] };
const NFT_INFO = [{ name: "getCollectionInfo", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
  { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
  { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
  { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
  { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" }, { name: "bondingComplete", type: "bool" },
  { name: "tokenAddress", type: "address" }] }] }];

const poolIdFor = (token) => keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [ZERO, token, 0, 60, FEE_HOOK]));

async function getLogsChunked(params) {
  const latest = await pub.getBlockNumber();
  let from = latest > LOOKBACK ? latest - LOOKBACK : 0n;
  const out = [];
  while (from <= latest) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    try { out.push(...await pub.getLogs({ ...params, fromBlock: from, toBlock: to })); } catch {}
    from = to + 1n;
  }
  return out;
}

// Total ETH volume that passed through a collection's trades (NFT sales + swap ETH legs).
async function collectionVolume(collection, tokenAddr) {
  let vol = 0n;
  const nftLogs = await getLogsChunked({ address: collection, event: NFT_SOLD });
  for (const l of nftLogs) vol += l.args.price;
  let swaps = 0;
  if (tokenAddr && tokenAddr !== ZERO && FEE_HOOK) {
    const swapLogs = await getLogsChunked({ address: POOL_MANAGER, event: V4_SWAP, args: { id: poolIdFor(tokenAddr) } });
    swaps = swapLogs.length;
    for (const l of swapLogs) { const e = l.args.amount0; vol += e < 0n ? -e : e; }
  }
  return { vol, nft: nftLogs.length, swaps };
}

async function main() {
  console.log("STREAM-2 FEE PLAN (read-only, no tx)");
  console.log("vault:", VAULT, "| distributor:", DISTRIBUTOR, "| router:", SWAP_ROUTER, "| WETH:", WETH);
  const vaultEth = await pub.getBalance({ address: VAULT });
  console.log("vault ETH (accrued 0.1% fee):", formatEther(vaultEth), "\n");

  const collections = await pub.readContract({ address: LAUNCHPAD, abi: LAUNCHPAD_ABI, functionName: "getAllCollections" });
  console.log(`scanning ${collections.length} collections...\n`);

  let planTokenFee = 0n, planWethFee = 0n, withToken = 0, nftOnly = 0;
  for (const col of collections) {
    let info; try { info = await pub.readContract({ address: col, abi: NFT_INFO, functionName: "getCollectionInfo" }); } catch { continue; }
    const token = info.tokenAddress;
    const hasToken = token && token !== ZERO;
    const { vol, nft, swaps } = await collectionVolume(col, hasToken ? token : null);
    if (vol === 0n) continue; // no trades, no fee
    const fee = (vol * AIRDROP_FEE_BPS) / 10000n;
    if (fee === 0n) continue;
    if (hasToken) { planTokenFee += fee; withToken++;
      console.log(`[TOKEN] ${info.ticker} ${col.slice(0, 10)} vol=${formatEther(vol)} (${nft} nft, ${swaps} swap) -> fee ${formatEther(fee)} ETH -> BUYBACK ${info.ticker} -> fund distributor[${token.slice(0, 8)}]`);
    } else { planWethFee += fee; nftOnly++;
      console.log(`[NFT-ONLY] ${info.ticker} ${col.slice(0, 10)} vol=${formatEther(vol)} (${nft} nft) -> fee ${formatEther(fee)} ETH -> WRAP WETH -> fund distributor[WETH]`);
    }
  }

  console.log(`\n=== PLAN ===`);
  console.log(`token collections: ${withToken}, total buyback fee: ${formatEther(planTokenFee)} ETH`);
  console.log(`NFT-only collections: ${nftOnly}, total WETH fee: ${formatEther(planWethFee)} ETH`);
  console.log(`grand total to distribute: ${formatEther(planTokenFee + planWethFee)} ETH`);
  console.log(`vault holds: ${formatEther(vaultEth)} ETH -> ${vaultEth >= planTokenFee + planWethFee ? "SOLVENT" : "SHORTFALL (vault < plan)"}`);
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
