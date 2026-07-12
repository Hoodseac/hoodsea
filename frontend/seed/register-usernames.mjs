// One-time: register a varied username for each of the 50 seed creator wallets
// so "Deployed by" in the feed shows names instead of raw addresses.
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";

const ROOT = "/root/recomendasi/recomendasi/contracts";
const API = "http://localhost:3001";
const wallets = JSON.parse(readFileSync(`${ROOT}/test-wallets.json`, "utf8"))
  .map((w) => ({ ...w, pk: w.pk.startsWith("0x") ? w.pk : "0x" + w.pk }));

const ADJ = ["neon", "cyber", "lunar", "solar", "frost", "ember", "void", "echo", "drift", "pixel",
  "astro", "iron", "vapor", "nova", "onyx", "jade", "crimson", "azure", "shadow", "golden",
  "mystic", "rogue", "zen", "wild", "cosmic", "hyper", "retro", "glitch", "prism", "storm"];
const NOUN = ["fox", "koi", "wolf", "raven", "tiger", "drake", "owl", "lynx", "phoenix", "orca",
  "panda", "viper", "falcon", "bear", "hawk", "ronin", "ghost", "samurai", "titan", "comet",
  "wizard", "ninja", "pilot", "nomad", "monk", "ace", "sage", "punk", "yeti", "golem"];
// Build 50 unique adj+noun handles with NO trailing number (e.g. "neonraven").
const used = new Set();
const handles = [];
for (let i = 0; i < wallets.length; i++) {
  let a = i % ADJ.length, n = (i * 7) % NOUN.length;
  let h = ADJ[a] + NOUN[n];
  while (used.has(h)) { n = (n + 1) % NOUN.length; h = ADJ[a] + NOUN[n]; } // bump noun until unique
  used.add(h); handles.push(h);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, fail = 0, skip = 0;

for (let i = 0; i < wallets.length; i++) {
  const w = wallets[i];
  const acct = privateKeyToAccount(w.pk);
  const wal = createWalletClient({ account: acct, chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });
  const username = handles[i];
  const timestamp = Date.now();
  const message = `Sign to set OriginPad profile\nUsername: ${username}\nTimestamp: ${timestamp}`;
  try {
    const signature = await wal.signMessage({ message });
    const r = await fetch(`${API}/api/profile/set`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: acct.address, username, signature, timestamp }),
    });
    if (r.ok) { ok++; console.log(`[${i + 1}/50] ${acct.address.slice(0, 8)} -> @${username}`); }
    else { const t = await r.text(); if (t.includes("taken") || t.includes("exists")) { skip++; console.log(`[${i + 1}/50] @${username} taken, skip`); } else { fail++; console.log(`[${i + 1}/50] FAIL ${r.status} ${t.slice(0, 80)}`); } }
  } catch (e) { fail++; console.log(`[${i + 1}/50] ERR ${e.shortMessage || e.message}`); }
  await sleep(120);
}
console.log(`\nDONE: ${ok} set, ${skip} skipped, ${fail} failed`);
