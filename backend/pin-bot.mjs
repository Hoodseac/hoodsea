// Auto-pin every collection's art (photoURIs ipfs://CID) to the local IPFS node,
// so the content survives even if the pinning service is dropped. Idempotent: pin
// add on an already-pinned CID is a no-op. Reads collections straight from the
// Hoodsea launchpad on Robinhood Chain.
//
// Env: ROBINHOOD_RPC_URL (or RPC_URL), LAUNCHPAD_ADDRESS, IPFS_API,
//   PIN_TIMEOUT_MS, PIN_INTERVAL_MS.
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { robinhood, RPC_URL } from "./chain.mjs";

const LAUNCHPAD = process.env.LAUNCHPAD_ADDRESS || "";
const IPFS_API = process.env.IPFS_API || "http://127.0.0.1:5001";
if (!LAUNCHPAD) { console.error("set LAUNCHPAD_ADDRESS in .env"); process.exit(1); }
const c = createPublicClient({ chain: robinhood, transport: http(RPC_URL) });

const LP_ABI = [{ type: "function", name: "getAllCollections", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }];
const INFO_ABI = [{ type: "function", name: "getCollectionInfo", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
  { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
  { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
  { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
  { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" }, { name: "bondingComplete", type: "bool" },
  { name: "tokenAddress", type: "address" },
]}] }];

const cidOf = (uri) => (uri || "").startsWith("ipfs://") ? uri.slice(7).split("/")[0].split("?")[0] : null;
// basic CID sanity: v0 (Qm... 46 base58) or v1 (bafy/bafk... >= 50). Skips seed junk like "p1".
const validCid = (cid) => /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(cid) || /^baf[a-z0-9]{50,}$/.test(cid);
const PIN_TIMEOUT_MS = Number(process.env.PIN_TIMEOUT_MS || 25000);
const pinned = new Set(); // in-memory cache to skip re-pin within a run
const log = (...a) => console.log(`[pinbot ${new Date().toISOString()}]`, ...a);

async function isPinned(cid) {
  try { const r = await fetch(`${IPFS_API}/api/v0/pin/ls?arg=${cid}&type=recursive`, { method: "POST" }); return r.ok; }
  catch { return false; }
}
async function pin(cid) {
  if (pinned.has(cid)) return "cached";
  if (!validCid(cid)) return "invalid";
  if (await isPinned(cid)) { pinned.add(cid); return "already"; }
  // pin/add blocks until content is fetched; cap it so an unreachable CID can't hang the cycle.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PIN_TIMEOUT_MS);
  try {
    const r = await fetch(`${IPFS_API}/api/v0/pin/add?arg=${cid}&recursive=true`, { method: "POST", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    pinned.add(cid);
    return "PINNED";
  } finally { clearTimeout(t); }
}

async function cycle() {
  const cols = await c.readContract({ address: LAUNCHPAD, abi: LP_ABI, functionName: "getAllCollections" });
  let cids = 0, newPins = 0, fails = 0;
  for (const col of cols) {
    try {
      const info = await c.readContract({ address: col, abi: INFO_ABI, functionName: "getCollectionInfo" });
      const uris = info.photoURIs.slice(0, Number(info.photoCount) || info.photoURIs.length);
      for (const u of uris) {
        const cid = cidOf(u);
        if (!cid) continue;
        cids++;
        try { const res = await pin(cid); if (res === "PINNED") { newPins++; log(`+ ${col.slice(0,10)} ${cid.slice(0,12)}...`); } }
        catch (e) { fails++; }
      }
    } catch { /* collection not readable yet */ }
  }
  log(`cycle done: ${cols.length} collections, ${cids} art CIDs, ${newPins} newly pinned, ${fails} fails, ${pinned.size} total tracked`);
}

const INTERVAL = Number(process.env.PIN_INTERVAL_MS || 15 * 60 * 1000);
log(`start. launchpad=${LAUNCHPAD} ipfs=${IPFS_API} interval=${INTERVAL}ms`);
await cycle();
setInterval(() => cycle().catch((e) => log("cycle error:", e.message)), INTERVAL);
