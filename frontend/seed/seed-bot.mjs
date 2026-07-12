// OriginPad testnet seeding bot.
// Deploys varied NFT collections (mixed reveal timing, token on/off, fee, mint
// price, activity, art theme) so the public testnet looks alive instead of
// empty. TESTNET ONLY — this is demo/seed content, never run against mainnet.
//
// Usage:  node seed/seed-bot.mjs [count]   (default 3)
//   env COUNT, MINT (0/1 to enable light minting), MIN_BAL (stop threshold ETH)
import {
  createPublicClient, createWalletClient, http, fallback, parseEther,
  formatEther, parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";

const ROOT = "/root/recomendasi/recomendasi/contracts";
const FE = "/root/recomendasi/recomendasi/frontend";
const API = "http://localhost:3001";

const dep = JSON.parse(readFileSync(`${ROOT}/deployment.json`, "utf8"));
const env = readFileSync(`${ROOT}/.env`, "utf8");
const DEPLOYER_PK = (() => { const m = env.match(/PRIVATE_KEY=(.+)/)[1].trim(); return m.startsWith("0x") ? m : "0x" + m; })();
const JWT = (() => {
  const m = readFileSync(`${FE}/.env.local`, "utf8").match(/PINATA_JWT=([^\s]+)/);
  return m ? m[1].trim() : "";
})();
const wallets = JSON.parse(readFileSync(`${ROOT}/test-wallets.json`, "utf8"))
  .map((w) => ({ ...w, pk: w.pk.startsWith("0x") ? w.pk : "0x" + w.pk }));

const COUNT = Number(process.argv[2] || process.env.COUNT || 3);
const DO_MINT = process.env.MINT !== "0";
const MIN_BAL = parseEther(process.env.MIN_BAL || "0.01");
// Jittered gap between launches so the seed looks organic, not a 200-in-a-row
// bot dump. Defaults small for quick test runs; set big for the real 200 run
// (e.g. GAP_MIN=60 GAP_MAX=300 spreads 200 over ~6-16 hours).
const GAP_MIN = Number(process.env.GAP_MIN || 2);
const GAP_MAX = Number(process.env.GAP_MAX || 5);

const RPC = fallback([http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]);
const pub = createPublicClient({ chain: baseSepolia, transport: RPC });
const deployer = privateKeyToAccount(DEPLOYER_PK);
const deployerWal = createWalletClient({ account: deployer, chain: baseSepolia, transport: RPC });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rint = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const z32 = "0x" + "0".repeat(64);
const ZERO = "0x0000000000000000000000000000000000000000";

// ─── Theme catalogue for varied, non-flat collections ────────────────────────
const THEMES = [
  { word: "fox", style: "neon synthwave", adj: ["Cyber", "Neon", "Astro"] },
  { word: "koi", style: "japanese ink wash", adj: ["Sacred", "Drift", "Lotus"] },
  { word: "mecha", style: "chrome sci-fi", adj: ["Titan", "Forge", "Vault"] },
  { word: "crystal", style: "iridescent low-poly", adj: ["Prism", "Shard", "Echo"] },
  { word: "owl", style: "dark fantasy", adj: ["Moon", "Night", "Hollow"] },
  { word: "samurai", style: "ukiyo-e", adj: ["Ronin", "Blade", "Storm"] },
  { word: "jellyfish", style: "bioluminescent deep sea", adj: ["Abyss", "Glow", "Tide"] },
  { word: "dragon", style: "ember concept art", adj: ["Ash", "Pyre", "Wyrm"] },
  { word: "astronaut", style: "retro 80s poster", adj: ["Orbit", "Cosmo", "Lunar"] },
  { word: "tiger", style: "graffiti pop art", adj: ["Wild", "Royal", "Volt"] },
  { word: "phoenix", style: "molten gold", adj: ["Rise", "Solar", "Flux"] },
  { word: "wolf", style: "frost minimalism", adj: ["Pale", "Iron", "Tundra"] },
];

const LP_ABI = [{ type: "function", name: "launchCollection", stateMutability: "nonpayable",
  inputs: [{ name: "p", type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "mintPriceWei", type: "uint256" }, { name: "tokenEnabled", type: "bool" }, { name: "tokenFeeBps", type: "uint256" },
    { name: "phaseRoots", type: "bytes32[4]" }, { name: "phaseStarts", type: "uint256[4]" },
    { name: "phaseEnds", type: "uint256[4]" }, { name: "phaseMaxPerWallet", type: "uint256[4]" },
    { name: "allowlistCID", type: "string" } ]}], outputs: [{ type: "address" }] },
  { type: "event", name: "CollectionLaunched", inputs: [
    { name: "collection", type: "address", indexed: true }, { name: "creator", type: "address", indexed: true },
    { name: "name", type: "string" }, { name: "ticker", type: "string" },
    { name: "mintPrice", type: "uint256" }, { name: "mintStart", type: "uint256" } ] }];
const NFT_ABI = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "bytes32[]" }], outputs: [] },
  { type: "function", name: "getCollectionInfo", stateMutability: "view", inputs: [], outputs: [{ type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" }, { name: "creator", type: "address" },
    { name: "mintPrice", type: "uint256" }, { name: "platformFeeETH", type: "uint256" }, { name: "bondingComplete", type: "bool" },
    { name: "tokenAddress", type: "address" } ]}] },
];

// ─── Image sources ───────────────────────────────────────────────────────────
// AI gens (Pollinations / Lexica) are now gated/down (402/500), so the reliable
// base is DiceBear generative avatars (one cohesive style per collection, like
// a real PFP drop). Pollinations is still probed opportunistically for bonus AI
// art when its free tier responds; Picsum is the last-resort fallback.
const DICEBEAR_STYLES = ["bottts", "fun-emoji", "shapes", "thumbs", "pixel-art", "lorelei",
  "notionists", "adventurer", "big-smile", "croodles", "open-peeps", "micah", "personas", "icons", "rings"];

async function fetchTimeout(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error("http " + r.status);
    const b = Buffer.from(await r.arrayBuffer()); if (b.length < 800) throw new Error("tiny img"); return b;
  } finally { clearTimeout(t); }
}
const aiUrl = (prompt, seed) => `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&seed=${seed}&nologo=true&model=flux`;
const dbUrl = (style, seed) => `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}&size=512`;
// Try AI first (short timeout so frequent 402s do not stall), then the
// collection's DiceBear style, then Picsum. `ai` is disabled per-collection
// once it has failed, so we do not re-probe a gated endpoint 6x.
async function genImage(prompt, style, seed, tryAi) {
  if (tryAi) { try { return { bytes: await fetchTimeout(aiUrl(prompt, seed), 14000), src: "pollinations" }; } catch {} }
  try { return { bytes: await fetchTimeout(dbUrl(style, seed), 10000), src: "dicebear" }; } catch {}
  return { bytes: await fetchTimeout(`https://picsum.photos/seed/${seed}/512`, 12000), src: "picsum" };
}
async function pinToIPFS(bytes, filename) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), filename);
  form.append("pinataMetadata", JSON.stringify({ name: filename }));
  const r = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST", headers: { Authorization: `Bearer ${JWT}` }, body: form });
  if (!r.ok) throw new Error("pinata " + r.status + " " + (await r.text()).slice(0, 120));
  return `ipfs://${(await r.json()).IpfsHash}`;
}

async function postMeta(creatorPk, collection, revealTiming, unrevealedURI) {
  const acct = privateKeyToAccount(creatorPk);
  const wal = createWalletClient({ account: acct, chain: baseSepolia, transport: RPC });
  const timestamp = Date.now();
  const key = collection.toLowerCase();
  const signature = await wal.signMessage({ message: `Set OriginPad collection meta\nCollection: ${key}\nTimestamp: ${timestamp}` });
  const body = JSON.stringify({ collection: key, revealTiming, websiteURL: "", unrevealedURI, signature, timestamp });
  const r = await fetch(`${API}/api/collection/meta`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  if (!r.ok) throw new Error("meta " + r.status + " " + (await r.text()).slice(0, 120));
}

async function buildCollection(i) {
  const theme = pick(THEMES);
  const seedBase = Date.now() + i * 1000;
  const name = `${pick(theme.adj)} ${theme.word[0].toUpperCase()}${theme.word.slice(1)}s`;
  const ticker = (theme.adj[0].slice(0, 2) + theme.word.slice(0, 3)).toUpperCase();
  const bio = `A ${theme.style} ${theme.word} collection on OriginPad.`;
  const revealTiming = (() => { const r = Math.random(); return r < 0.6 ? "instant" : r < 0.82 ? "24h" : "7d"; })();
  const tokenEnabled = chance(0.7);
  const tokenFeeBps = tokenEnabled ? BigInt(rint(15, 35) * 10) : 250n;
  const mintPriceWei = pick([0n, 0n, parseEther("0.0001"), parseEther("0.0002")]);
  // most collections live now; ~15% are UPCOMING (future public start) for variety
  const upcoming = chance(0.15);
  const style = pick(DICEBEAR_STYLES); // cohesive generative art style for this drop
  return { theme, seedBase, name, ticker, bio, revealTiming, tokenEnabled, tokenFeeBps, mintPriceWei, upcoming, style };
}

async function main() {
  console.log(`SEED BOT  count=${COUNT}  mint=${DO_MINT}  deployer=${deployer.address}`);
  console.log("deployer balance:", formatEther(await pub.getBalance({ address: deployer.address })), "ETH\n");
  if (!JWT) throw new Error("no PINATA_JWT");

  const results = [];
  for (let i = 0; i < COUNT; i++) {
    const bal = await pub.getBalance({ address: deployer.address });
    if (bal < MIN_BAL) { console.log(`! stopping: deployer balance ${formatEther(bal)} < ${formatEther(MIN_BAL)}`); break; }

    const c = await buildCollection(i);
    const creator = wallets[i % wallets.length];
    process.stdout.write(`[${i + 1}/${COUNT}] ${c.name} (${c.ticker}) reveal=${c.revealTiming} token=${c.tokenEnabled} fee=${c.tokenFeeBps} price=${formatEther(c.mintPriceWei)} ${c.upcoming ? "UPCOMING" : "LIVE"}\n  art: `);

    // 6 photos (cohesive style per collection; A=ai D=dicebear S=stock/picsum)
    const photoURIs = [];
    let srcTally = "";
    let tryAi = true;
    for (let p = 0; p < 6; p++) {
      const prompt = `${c.theme.style} ${c.theme.word}, variant ${p + 1}, nft art, centered, vivid`;
      const seed = `${c.ticker}-${c.seedBase}-${p}`;
      const img = await genImage(prompt, c.style, seed, tryAi);
      if (img.src !== "pollinations") tryAi = false; // stop re-probing a gated AI endpoint
      photoURIs.push(await pinToIPFS(img.bytes, `${c.ticker}_${p + 1}.png`));
      srcTally += { pollinations: "A", dicebear: "D", picsum: "S" }[img.src];
    }
    process.stdout.write(`[${c.style}:${srcTally}] `);

    // mystery image for delayed reveal
    let unrevealedURI = "";
    if (c.revealTiming !== "instant") {
      const m = await genImage(`mysterious glowing question mark, ${c.theme.style}, dark`, c.style, `${c.ticker}-mystery`, false);
      unrevealedURI = await pinToIPFS(m.bytes, `${c.ticker}_mystery.png`);
      process.stdout.write("mystery ");
    }

    // phases: public only. live now, or upcoming (future start)
    const now = Math.floor(Date.now() / 1000);
    const start = c.upcoming ? now + rint(3600, 172800) : now - 120;
    const end = start + 30 * 86400;
    const params = {
      name: c.name, ticker: c.ticker, bio: c.bio,
      photoURIs, photoCount: 6, socialX: "", socialGithub: "", socialFarcaster: "",
      mintPriceWei: c.mintPriceWei, tokenEnabled: c.tokenEnabled, tokenFeeBps: c.tokenFeeBps,
      phaseRoots: [z32, z32, z32, z32],
      phaseStarts: [BigInt(start), BigInt(start), BigInt(start), BigInt(start)],
      phaseEnds: [BigInt(end), BigInt(end), BigInt(end), BigInt(end)],
      phaseMaxPerWallet: [0n, 0n, 0n, 0n], allowlistCID: "",
    };

    // launch from the creator wallet (so creators vary across the explore page)
    const creatorAcct = privateKeyToAccount(creator.pk);
    const creatorWal = createWalletClient({ account: creatorAcct, chain: baseSepolia, transport: RPC });
    let collection;
    try {
      const h = await creatorWal.writeContract({ address: dep.launchpad, abi: LP_ABI, functionName: "launchCollection", args: [params], gas: 6_500_000n });
      const rcpt = await pub.waitForTransactionReceipt({ hash: h });
      collection = parseEventLogs({ abi: LP_ABI, eventName: "CollectionLaunched", logs: rcpt.logs })[0].args.collection;
    } catch (e) { console.log(`\n  LAUNCH FAIL: ${e.shortMessage || e.message}`); continue; }
    process.stdout.write(`-> ${collection} `);

    // off-chain reveal meta (signed by creator)
    if (c.revealTiming !== "instant") {
      try { await postMeta(creator.pk, collection, c.revealTiming, unrevealedURI); process.stdout.write("meta✓ "); }
      catch (e) { process.stdout.write(`meta-fail(${e.message}) `); }
    }

    // light minting for liveliness (from deployer; fee recycles to treasury)
    let minted = 0;
    if (DO_MINT && !c.upcoming) {
      const target = chance(0.4) ? 0 : rint(1, 25);
      if (target > 0) {
        const info = await pub.readContract({ address: collection, abi: NFT_ABI, functionName: "getCollectionInfo" });
        const unit = info.mintPrice + info.platformFeeETH;
        try {
          const h = await deployerWal.writeContract({ address: collection, abi: NFT_ABI, functionName: "mint", args: [BigInt(target), []], value: unit * BigInt(target), gas: 6_000_000n });
          await pub.waitForTransactionReceipt({ hash: h });
          minted = target;
        } catch (e) { process.stdout.write(`mint-fail(${(e.shortMessage || e.message).slice(0, 40)}) `); }
      }
    }
    console.log(`minted=${minted}`);
    results.push({ collection, ...c, minted });
    if (i < COUNT - 1) {
      const gap = rint(GAP_MIN, GAP_MAX);
      console.log(`  ...jeda ${gap}s sebelum berikutnya`);
      await sleep(gap * 1000);
    }
  }

  console.log(`\n=== DONE: ${results.length}/${COUNT} launched ===`);
  console.log("deployer balance left:", formatEther(await pub.getBalance({ address: deployer.address })), "ETH");
  const counts = results.reduce((a, r) => { a[r.revealTiming] = (a[r.revealTiming] || 0) + 1; return a; }, {});
  console.log("reveal mix:", JSON.stringify(counts), "| token-enabled:", results.filter((r) => r.tokenEnabled).length, "| upcoming:", results.filter((r) => r.upcoming).length, "| with mints:", results.filter((r) => r.minted > 0).length);
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
