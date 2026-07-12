import { createPublicClient, http, fallback } from "viem";
import { baseSepolia } from "viem/chains";
const VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
const TOKEN = process.argv[2] || "0x7004395a113B085108c8926699733f240FD365F5";
const CALLER = "0x068CD16Ee1C4ED5300b54d5C2fef5fA5353aE0E7"; // deployer/oracle
const pub = createPublicClient({ chain: baseSepolia, transport: fallback([
  http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]) });
const ABI = [{ name: "executeEpoch", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "token", type: "address" }, { name: "epochIndex", type: "uint256" }], outputs: [] }];
try {
  await pub.simulateContract({ address: VAULT, abi: ABI, functionName: "executeEpoch", args: [TOKEN, 0n], account: CALLER });
  console.log("Day 1 executeEpoch -> WOULD SUCCEED (sim ok)");
} catch (e) { console.log("Day 1 executeEpoch -> WOULD REVERT:", (e.shortMessage || e.message).split("\n")[0]); }
