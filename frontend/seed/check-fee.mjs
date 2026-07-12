import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });
const VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
const bal = await pub.getBalance({ address: VAULT });
console.log("old vault ETH balance (akumulasi 0.1% fee):", formatEther(bal), "ETH");
// withdrawETH exists? check
const ABI = [{ name: "withdrawETH", type: "function", stateMutability: "nonpayable", inputs: [{type:"address"}], outputs: [] }];
