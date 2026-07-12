import { createPublicClient, createWalletClient, http, fallback, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
const ROOT = "/root/recomendasi/recomendasi/contracts";
const env = readFileSync(`${ROOT}/.env`, "utf8");
const PK = (() => { const m = env.match(/PRIVATE_KEY=(.+)/)[1].trim(); return m.startsWith("0x") ? m : "0x" + m; })();
const VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
const TOKEN = process.argv[2] || "0x7004395a113B085108c8926699733f240FD365F5";
const pub = createPublicClient({ chain: baseSepolia, transport: fallback([
  http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]) });
const acct = privateKeyToAccount(PK);
const wal = createWalletClient({ account: acct, chain: baseSepolia, transport: fallback([http("https://base-sepolia-rpc.publicnode.com")]) });
const ERC = [
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
];
const VABI = [{ name: "executeEpoch", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "token", type: "address" }, { name: "epochIndex", type: "uint256" }], outputs: [] }];
const DEAD = "0x000000000000000000000000000000000000dEaD";
const fmt = (x) => formatEther(x);

const sym = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "symbol" });
const supBefore = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "totalSupply" });
const vaultBefore = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "balanceOf", args: [VAULT] });
const deadBefore = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "balanceOf", args: [DEAD] });
console.log(`TOKEN ${sym} ${TOKEN}`);
console.log("BEFORE  totalSupply:", fmt(supBefore), "| vault:", fmt(vaultBefore), "| dead/burn:", fmt(deadBefore));

console.log("\nsending executeEpoch(token, 0) from", acct.address, "...");
const hash = await wal.writeContract({ address: VAULT, abi: VABI, functionName: "executeEpoch", args: [TOKEN, 0n], gas: 8_000_000n });
console.log("tx hash:", hash);
const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log("status:", rcpt.status, "| block:", rcpt.blockNumber, "| gasUsed:", rcpt.gasUsed.toString(), "| logs:", rcpt.logs.length);

const supAfter = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "totalSupply" });
const vaultAfter = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "balanceOf", args: [VAULT] });
const deadAfter = await pub.readContract({ address: TOKEN, abi: ERC, functionName: "balanceOf", args: [DEAD] });
console.log("\nAFTER   totalSupply:", fmt(supAfter), "| vault:", fmt(vaultAfter), "| dead/burn:", fmt(deadAfter));
console.log("\nDELTA  supply burned:", fmt(supBefore - supAfter), "| vault out:", fmt(vaultBefore - vaultAfter), "| to dead:", fmt(deadAfter - deadBefore));
console.log("explorer:", `https://sepolia.basescan.org/tx/${hash}`);
