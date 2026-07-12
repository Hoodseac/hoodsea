import { createPublicClient, http, fallback } from "viem";
import { baseSepolia } from "viem/chains";
const VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
const pub = createPublicClient({ chain: baseSepolia, transport: fallback([http("https://base-sepolia-rpc.publicnode.com")]) });
const ABI = [{ name: "airdropDistributor", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }];
const dist = await pub.readContract({ address: VAULT, abi: ABI, functionName: "airdropDistributor" });
console.log("vault.airdropDistributor =", dist);
const code = await pub.getBytecode({ address: dist }).catch(() => null);
console.log("has contract code:", code && code !== "0x" ? `yes (${code.length} chars)` : "NO (EOA/dead)");
