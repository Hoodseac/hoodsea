// Check whether a bonded token's vault can execute epoch (burn 9% + airdrop 1%) now.
import { createPublicClient, http, fallback, formatEther } from "viem";
import { baseSepolia } from "viem/chains";

const VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
// bonded test tokens (from memory): OINST + earlier ones. arg overrides.
const TOKEN = process.argv[2] || "0x7004395a113B085108c8926699733f240FD365F5";

const pub = createPublicClient({ chain: baseSepolia, transport: fallback([
  http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]) });

const VAULT_ABI = [{ type: "function", name: "getVaultStatus", stateMutability: "view",
  inputs: [{ type: "address" }], outputs: [
    { name: "balance", type: "uint256" }, { name: "executed", type: "uint256[5]" },
    { name: "epochTimes", type: "uint256[5]" }, { name: "ready", type: "bool[5]" }] },
  { type: "function", name: "getManagedTokens", stateMutability: "view", inputs: [], outputs: [{ type: "address[]" }] }];
const TOK_ABI = [
  { type: "function", name: "vaultLocked", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];
const LABELS = ["Day 1", "Day 7", "Day 14", "Day 28", "Day 56"];

const managed = await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "getManagedTokens" }).catch(() => []);
console.log("vault manages", managed.length, "token(s):", managed.join(", ") || "(none)");

const tokens = managed.length ? managed : [TOKEN];
for (const token of tokens) {
  let sym = "?"; try { sym = await pub.readContract({ address: token, abi: TOK_ABI, functionName: "symbol" }); } catch {}
  let locked = false; try { locked = await pub.readContract({ address: token, abi: TOK_ABI, functionName: "vaultLocked" }); } catch (e) { console.log(token, "no vaultLocked():", e.shortMessage || e.message); }
  let st; try { st = await pub.readContract({ address: VAULT, abi: VAULT_ABI, functionName: "getVaultStatus", args: [token] }); }
  catch (e) { console.log(`\n${sym} ${token}: getVaultStatus FAIL`, e.shortMessage || e.message); continue; }
  const [balance, executed, epochTimes, ready] = st;
  console.log(`\n=== ${sym} ${token} ===`);
  console.log("vaultLocked:", locked, "| vault token balance:", formatEther(balance));
  const now = Math.floor(Date.now() / 1000);
  epochTimes.forEach((t, i) => {
    const ts = Number(t);
    const when = ts > 0 ? new Date(ts * 1000).toISOString() : "UNSET (vault not locked)";
    const isDone = executed[i] && executed[i] !== 0n;
    const canNow = locked && ready[i] && !isDone;
    console.log(`  ${LABELS[i]}: time=${when} done=${!!isDone} ready=${ready[i]} ${canNow ? "<<< EXECUTABLE NOW" : ts > now && ts > 0 ? `(in ${Math.round((ts-now)/3600)}h)` : ""}`);
  });
}
