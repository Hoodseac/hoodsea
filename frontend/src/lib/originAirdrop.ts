import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, isAddress, formatUnits } from "viem";
import type { PublicClient } from "viem";
import { CONTRACTS, ORIGIN_AIRDROP_ABI, ERC20_ABI, IS_TESTNET } from "@/lib/contracts";

// Backend cache for merkle recipient lists (see profileapi /api/airdrop/campaign).
const PROFILE_API = process.env.NEXT_PUBLIC_PROFILE_API || "";

const ERC20_META_ABI = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// RecomNFT (ERC-1155) tracks the current owner of each of its 100 unique tokenIds.
const RECOM_NFT_ABI = [
  { name: "totalMinted", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "tokenOwner", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

export type AirdropMode = "MERKLE" | "FCFS";

// One recipient entry: [checksummed address, raw token amount as decimal string]
export type Entry = [string, string];

export interface Campaign {
  id: number;
  creator: `0x${string}`;
  token: `0x${string}`;
  mode: AirdropMode;
  merkleRoot: `0x${string}`;
  amountPerWallet: bigint; // FCFS only
  gateToken: `0x${string}`;
  gateMin: bigint;
  deposited: bigint;
  remaining: bigint;
  claimedCount: bigint;
  expiry: number; // unix seconds
  swept: boolean;
  // enriched
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimals?: number;
  liquidityUsd?: number;
}

// ── List parsing ──────────────────────────────────────────────────────────────
// Accepts one recipient per line. Two shapes:
//   0xabc...           -> uses the wizard's "amount per wallet" (equal split)
//   0xabc...,1000      -> explicit human amount for that wallet
// Commas, spaces, tabs or semicolons separate the address from the amount.
export interface ParseResult {
  rows: { address: string; amount?: string }[];
  errors: string[];
  hasPerRowAmounts: boolean;
}

export function parseRecipientList(text: string): ParseResult {
  const rows: { address: string; amount?: string }[] = [];
  const errors: string[] = [];
  let hasPerRowAmounts = false;
  const seen = new Set<string>();

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    const addr = parts[0];
    if (!isAddress(addr)) {
      errors.push(`Line ${i + 1}: invalid address "${addr}"`);
      return;
    }
    const checksummed = getAddress(addr);
    const lower = checksummed.toLowerCase();
    if (seen.has(lower)) {
      errors.push(`Line ${i + 1}: duplicate address ${checksummed}`);
      return;
    }
    seen.add(lower);
    let amount: string | undefined;
    if (parts[1]) {
      const a = parts[1].replace(/_/g, "");
      if (!/^\d+(\.\d+)?$/.test(a) || Number(a) <= 0) {
        errors.push(`Line ${i + 1}: invalid amount "${parts[1]}"`);
        return;
      }
      amount = a;
      hasPerRowAmounts = true;
    }
    rows.push({ address: checksummed, amount });
  });

  return { rows, errors, hasPerRowAmounts };
}

// Scale a human amount string to raw token units without floating point error.
export function toRawUnits(human: string, decimals: number): bigint {
  const [whole, frac = ""] = human.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * BigInt(10) ** BigInt(decimals) + BigInt(fracPadded || "0");
}

// ── Merkle tree ────────────────────────────────────────────────────────────────
// Must match the contract: leaf = keccak256(keccak256(abi.encode(address,uint256))),
// i.e. OpenZeppelin StandardMerkleTree with ["address","uint256"].
export function buildTree(entries: Entry[]): StandardMerkleTree<Entry> {
  return StandardMerkleTree.of(entries, ["address", "uint256"]) as StandardMerkleTree<Entry>;
}

export function proofFor(tree: StandardMerkleTree<Entry>, account: string): { amount: string; proof: `0x${string}`[] } | null {
  const target = account.toLowerCase();
  for (const [i, v] of tree.entries()) {
    if (String(v[0]).toLowerCase() === target) {
      return { amount: v[1], proof: tree.getProof(i) as `0x${string}`[] };
    }
  }
  return null;
}

// Rebuild a tree from a flat entries list (used by claimers from the cached list).
export function treeFromEntries(entries: Entry[]): StandardMerkleTree<Entry> {
  return buildTree(entries);
}

// ── Backend cache (recipient lists) ─────────────────────────────────────────────
export async function storeCampaignList(id: number, root: string, entries: Entry[]): Promise<boolean> {
  try {
    const res = await fetch(`${PROFILE_API}/api/airdrop/campaign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract: CONTRACTS.originAirdrop, id, root, entries }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchCampaignList(id: number): Promise<{ root: string; entries: Entry[] } | null> {
  try {
    const res = await fetch(`${PROFILE_API}/api/airdrop/campaign/${CONTRACTS.originAirdrop}/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { root: data.root, entries: data.entries };
  } catch {
    return null;
  }
}

// ── On-chain reads ───────────────────────────────────────────────────────────────
function decodeCampaign(id: number, raw: readonly unknown[]): Campaign {
  return {
    id,
    creator: raw[0] as `0x${string}`,
    token: raw[1] as `0x${string}`,
    mode: (raw[2] as number) === 0 ? "MERKLE" : "FCFS",
    merkleRoot: raw[3] as `0x${string}`,
    amountPerWallet: raw[4] as bigint,
    gateToken: raw[5] as `0x${string}`,
    gateMin: raw[6] as bigint,
    deposited: raw[7] as bigint,
    remaining: raw[8] as bigint,
    claimedCount: raw[9] as bigint,
    expiry: Number(raw[10] as bigint),
    swept: raw[11] as boolean,
  };
}

export async function fetchCampaign(client: PublicClient, id: number): Promise<Campaign> {
  const raw = (await client.readContract({
    address: CONTRACTS.originAirdrop,
    abi: ORIGIN_AIRDROP_ABI,
    functionName: "campaigns",
    args: [BigInt(id)],
  })) as readonly unknown[];
  const c = decodeCampaign(id, raw);
  const [symbol, name, decimals] = await Promise.all([
    client.readContract({ address: c.token, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "TKN"),
    client.readContract({ address: c.token, abi: ERC20_META_ABI, functionName: "name" }).catch(() => ""),
    client.readContract({ address: c.token, abi: ERC20_ABI, functionName: "decimals" }).catch(() => 18),
  ]);
  c.tokenSymbol = symbol as string;
  c.tokenName = name as string;
  c.tokenDecimals = Number(decimals);
  return c;
}

// Test/junk campaigns to hide from the public list (testnet only; the contract is
// permissionless so they cannot be deleted on-chain). id 0 = the e2e MockERC20 test.
const HIDDEN_CAMPAIGN_IDS = new Set<number>([0]);

export async function fetchAllCampaigns(client: PublicClient): Promise<Campaign[]> {
  const count = (await client.readContract({
    address: CONTRACTS.originAirdrop,
    abi: ORIGIN_AIRDROP_ABI,
    functionName: "campaignsCount",
  })) as bigint;
  const n = Number(count);
  const ids = Array.from({ length: n }, (_, i) => i).filter((i) => !HIDDEN_CAMPAIGN_IDS.has(i));
  let out = await Promise.all(ids.map((i) => fetchCampaign(client, i)));

  // Anti-dust: drop campaigns whose token name/symbol is a phishing/dust token.
  out = out.filter((c) => !looksLikeScamToken(c.tokenName || "", c.tokenSymbol || ""));

  // On mainnet, also require a live DEX market so scam/dust tokens stay out of the list.
  if (!IS_TESTNET && out.length) {
    const markets = await fetchTokenMarkets(out.map((c) => c.token));
    out = out.filter((c) => {
      const m = markets[c.token.toLowerCase()];
      c.liquidityUsd = m?.liquidityUsd || 0;
      return m && m.hasPair && m.liquidityUsd >= MIN_LIQUIDITY_USD;
    });
  }

  // newest first
  return out.reverse();
}

export async function hasClaimed(client: PublicClient, id: number, account: string): Promise<boolean> {
  return (await client.readContract({
    address: CONTRACTS.originAirdrop,
    abi: ORIGIN_AIRDROP_ABI,
    functionName: "claimed",
    args: [BigInt(id), account as `0x${string}`],
  })) as boolean;
}

// ── Display helpers ──────────────────────────────────────────────────────────────
export function fmtAmount(raw: bigint, decimals = 18): string {
  const n = Number(formatUnits(raw, decimals));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (n === 0) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function expiryLabel(expiry: number): { text: string; expired: boolean } {
  const now = Math.floor(Date.now() / 1000);
  const expired = now > expiry;
  if (expired) return { text: "Ended", expired: true };
  const secs = expiry - now;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return { text: `${d}d ${h}h left`, expired: false };
  if (h > 0) return { text: `${h}h ${m}m left`, expired: false };
  return { text: `${m}m left`, expired: false };
}

export const MODE_LABEL: Record<AirdropMode, string> = { MERKLE: "Allowlist", FCFS: "First come first serve" };

// ── NFT holder snapshot (Hoodsea RecomNFT collections) ─────────────────────────
export interface Holder { address: string; count: number }
export interface SnapshotResult { holders: Holder[]; totalNfts: number; minted: number }

// Reads tokenOwner(1..totalMinted) and aggregates per-holder counts. Reads batch into
// one Multicall3 call (wagmi transport has batch.multicall on), so even a full
// 100-supply collection is a couple of round-trips. The zero address is skipped.
export async function snapshotNftHolders(client: PublicClient, collection: string): Promise<SnapshotResult> {
  if (!isAddress(collection)) throw new Error("Not a valid collection address");
  const addr = getAddress(collection) as `0x${string}`;

  const code = await client.getBytecode({ address: addr }).catch(() => undefined);
  if (!code || code === "0x") throw new Error("No contract at this address");

  let minted: number;
  try {
    minted = Number((await client.readContract({ address: addr, abi: RECOM_NFT_ABI, functionName: "totalMinted" })) as bigint);
  } catch {
    throw new Error("Not an Hoodsea NFT collection (no totalMinted)");
  }
  if (minted === 0) throw new Error("This collection has no minted NFTs yet");

  // Explicit multicall (chunks reliably). The transport's auto-batch is intentionally
  // off because the free RPC rejects large auto-batches; client.multicall is robust.
  const ids = Array.from({ length: minted }, (_, i) => i + 1);
  const results = await client.multicall({
    contracts: ids.map((id) => ({ address: addr, abi: RECOM_NFT_ABI, functionName: "tokenOwner", args: [BigInt(id)] as const })),
    allowFailure: true,
    batchSize: 1024,
  });

  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.status !== "success") continue;
    const lo = String(r.result).toLowerCase();
    if (lo === "0x0000000000000000000000000000000000000000") continue;
    counts.set(lo, (counts.get(lo) || 0) + 1);
  }
  const holders: Holder[] = [...counts.entries()]
    .map(([address, count]) => ({ address: getAddress(address), count }))
    .sort((a, b) => b.count - a.count);
  const totalNfts = holders.reduce((s, h) => s + h.count, 0);
  return { holders, totalNfts, minted };
}

// Turn a snapshot into merkle entries: equal amount each, or weighted by NFTs held.
export function holdersToEntries(holders: Holder[], decimals: number, mode: "equal" | "weighted", perUnit: string): Entry[] {
  const unit = toRawUnits(perUnit, decimals);
  return holders.map((h) => [h.address, (mode === "weighted" ? unit * BigInt(h.count) : unit).toString()] as Entry);
}

// ── Anti-dust / scam token filter ────────────────────────────────────────────────
// Dust-attack tokens smuggle a phishing call-to-action into their name/symbol
// ("claim at evil.site", "t.me/...", a bare domain). We reject those outright, on
// both networks. On mainnet we additionally require a live DEX market, since real
// projects have liquidity and pure scam/dust tokens almost never do. (DexScreener
// does not index Robinhood Chain, so that check is mainnet-only.)
const URL_RE = /(https?:\/\/|www\.|t\.me\/|telegram|discord\.gg|\b[a-z0-9-]{2,}\.(com|io|xyz|net|org|app|fi|finance|me|cc|vip|top|live|gift|claim|site|online|link|pro|win|gg|to|ru|info)\b)/i;
const LURE_RE = /(visit|claim\s+(your|now|at|here|reward)|reward[s]?\s+(at|here|now)|free\s+(mint|claim|token)|voucher|giveaway|airdrop\s+(at|here|claim|now)|\$\s*\d)/i;

export function looksLikeScamToken(name: string, symbol: string): boolean {
  const s = `${name || ""} ${symbol || ""}`;
  if (URL_RE.test(s)) return true;
  if (LURE_RE.test(s)) return true;
  if ((symbol || "").length > 16) return true; // legit tickers are short
  if ((name || "").length > 60) return true;
  // control chars / zero-width / excessive emoji often used to spoof
  if (/[ -​-‏‪-‮]/.test(s)) return true;
  return false;
}

export interface MarketInfo { liquidityUsd: number; priceUsd: number; hasPair: boolean }

export async function fetchTokenMarkets(addresses: string[]): Promise<Record<string, MarketInfo>> {
  const out: Record<string, MarketInfo> = {};
  if (IS_TESTNET || addresses.length === 0) return out; // no market data on testnet
  try {
    // DexScreener accepts up to 30 comma-separated token addresses
    const uniq = Array.from(new Set(addresses.map((a) => a.toLowerCase()))).slice(0, 30);
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${uniq.join(",")}`);
    if (!res.ok) return out;
    const data = await res.json();
    for (const pair of data.pairs || []) {
      if (pair.chainId !== "base") continue;
      const addr = (pair.baseToken?.address || "").toLowerCase();
      if (!addr) continue;
      const liq = Number(pair.liquidity?.usd || 0);
      const prev = out[addr];
      if (!prev || liq > prev.liquidityUsd) {
        out[addr] = { liquidityUsd: liq, priceUsd: Number(pair.priceUsd || 0), hasPair: true };
      }
    }
  } catch { /* network issue: treat as no data, callers decide */ }
  return out;
}

const MIN_LIQUIDITY_USD = 250; // mainnet floor for a token to count as "real"

export interface TokenCheck {
  ok: boolean;
  reason?: string;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: bigint;
  balance: bigint;
  liquidityUsd?: number;
}

// Full pre-flight used by the create wizard before letting a token be airdropped.
export async function validateTokenForAirdrop(client: PublicClient, account: `0x${string}` | undefined, rawAddr: string): Promise<TokenCheck> {
  const base: TokenCheck = { ok: false, symbol: "", name: "", decimals: 18, totalSupply: BigInt(0), balance: BigInt(0) };
  if (!isAddress(rawAddr)) return { ...base, reason: "Not a valid address" };
  const addr = getAddress(rawAddr) as `0x${string}`;

  const code = await client.getBytecode({ address: addr }).catch(() => undefined);
  if (!code || code === "0x") return { ...base, reason: "No contract at this address" };

  let symbol = "", name = "", decimals = 18, totalSupply = BigInt(0), balance = BigInt(0);
  try {
    [symbol, name, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
      client.readContract({ address: addr, abi: ERC20_META_ABI, functionName: "name" }) as Promise<string>,
      client.readContract({ address: addr, abi: ERC20_ABI, functionName: "decimals" }).then(Number),
      client.readContract({ address: addr, abi: ERC20_META_ABI, functionName: "totalSupply" }) as Promise<bigint>,
    ]);
    if (account) balance = (await client.readContract({ address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [account] })) as bigint;
  } catch {
    return { ...base, reason: "Not a standard ERC-20 token" };
  }

  const meta: TokenCheck = { ...base, symbol, name, decimals, totalSupply, balance, ok: true, reason: undefined };

  if (!symbol || !name) return { ...meta, ok: false, reason: "Token is missing a name or symbol" };
  if (decimals > 18) return { ...meta, ok: false, reason: "Unsupported decimals (must be 0-18)" };
  if (totalSupply === BigInt(0)) return { ...meta, ok: false, reason: "Token has zero supply" };
  if (looksLikeScamToken(name, symbol)) return { ...meta, ok: false, reason: "Name or symbol looks like a phishing/dust token and is blocked" };

  if (!IS_TESTNET) {
    const markets = await fetchTokenMarkets([addr]);
    const m = markets[addr.toLowerCase()];
    meta.liquidityUsd = m?.liquidityUsd || 0;
    if (!m || !m.hasPair || m.liquidityUsd < MIN_LIQUIDITY_USD) {
      return { ...meta, ok: false, reason: `No real DEX liquidity on Base (needs >= $${MIN_LIQUIDITY_USD}). Possible dust/scam token.` };
    }
  }

  return meta;
}
