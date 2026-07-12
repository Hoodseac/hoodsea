// Burn bot: execute a vault epoch (burn 9% + fund the 1% airdrop pool) for every
// managed token that is ready. Permissionless executeEpoch; reverts are caught
// ("Epoch not ready yet" / "Already executed"). Idempotent: writes burn-exec.done
// next to this script when every token has executed the target epoch.
//
// Env (.env in this dir): ROBINHOOD_RPC_URL, ORACLE_PRIVATE_KEY, VAULT_ADDRESS,
//   AIRDROP_DISTRIBUTOR, optional EPOCH (default 0), optional TOKENS (comma list;
//   default = vault.getManagedTokens()).
import "dotenv/config";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, RPC_URL } from "./chain.mjs";
import { writeFileSync, existsSync, appendFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = process.env.VAULT_ADDRESS;
const DIST = process.env.AIRDROP_DISTRIBUTOR;
const EPOCH = BigInt(process.env.EPOCH || "0");
const DEAD = "0x000000000000000000000000000000000000dEaD";
if (!VAULT || !DIST || !process.env.ORACLE_PRIVATE_KEY) {
  console.error("set VAULT_ADDRESS, AIRDROP_DISTRIBUTOR, ORACLE_PRIVATE_KEY in .env");
  process.exit(1);
}
const DONE = join(HERE, "burn-exec.done");
const LOG = join(HERE, "burn-exec.log");
const log = (...a) => { const s = `[${new Date().toISOString()}] ${a.join(" ")}`; console.log(s); appendFileSync(LOG, s + "\n"); };

if (existsSync(DONE)) { console.log("already done, exiting"); process.exit(0); }

const pub = createPublicClient({ chain: robinhood, transport: http(RPC_URL) });
const acct = privateKeyToAccount(process.env.ORACLE_PRIVATE_KEY.startsWith("0x") ? process.env.ORACLE_PRIVATE_KEY : "0x" + process.env.ORACLE_PRIVATE_KEY);
const wc = createWalletClient({ account: acct, chain: robinhood, transport: http(RPC_URL) });

const vaultAbi = [
  { type: "function", name: "executeEpoch", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "getManagedTokens", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] },
];
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const TOKENS = process.env.TOKENS
  ? process.env.TOKENS.split(",").map((t) => t.trim()).filter(Boolean)
  : await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getManagedTokens" });

let allDone = TOKENS.length > 0;
for (const t of TOKENS) {
  try {
    const supply = await pub.readContract({ address: t, abi: erc20, functionName: "totalSupply" });
    const deadBefore = await pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [DEAD] });
    const distBefore = await pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [DIST] });
    const { request } = await pub.simulateContract({ account: acct, address: VAULT, abi: vaultAbi, functionName: "executeEpoch", args: [t, EPOCH] });
    const h = await wc.writeContract(request);
    const r = await pub.waitForTransactionReceipt({ hash: h });
    const deadAfter = await pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [DEAD] });
    const distAfter = await pub.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [DIST] });
    const burned = deadAfter - deadBefore, aird = distAfter - distBefore;
    log(`OK ${t} tx=${h} ${r.status} burned=${formatEther(burned)} (~9% of ${formatEther(supply)}) airdrop=${formatEther(aird)} (~1%)`);
  } catch (e) {
    const m = e.shortMessage || e.message || String(e);
    if (/Already executed/.test(m)) { log(`SKIP ${t} already executed`); }
    else if (/not ready/i.test(m)) { log(`WAIT ${t} epoch not ready yet`); allDone = false; }
    else { log(`ERR ${t} ${m.slice(0, 140)}`); allDone = false; }
  }
}

if (allDone) {
  writeFileSync(DONE, new Date().toISOString() + "\n");
  log("ALL DONE");
}
