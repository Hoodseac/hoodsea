import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
const VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
const DEAD = "0x000000000000000000000000000000000000dEaD".toLowerCase();
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });
const ABI = [{ name: "airdropDistributor", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }];
let dist;
try { dist = await pub.readContract({ address: VAULT, abi: ABI, functionName: "airdropDistributor" }); }
catch (e) { console.log("read failed:", e.shortMessage || e.message); process.exit(1); }
console.log("vault.airdropDistributor =", dist);
console.log("is it the dead address?", dist.toLowerCase() === DEAD ? "YES — airdrop 1% is being burned to dead!" : "no");
const code = await pub.getBytecode({ address: dist }).catch(() => "0x");
console.log("code at that address:", code && code !== "0x" ? "contract present" : "none (EOA/dead)");
