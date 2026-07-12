// Estimate gas cost of one launchCollection on Base Sepolia.
import { createPublicClient, http, fallback, formatEther, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";

const ROOT = "/root/recomendasi/recomendasi/contracts";
const dep = JSON.parse(readFileSync(`${ROOT}/deployment.json`, "utf8"));
const env = readFileSync(`${ROOT}/.env`, "utf8");
const PK = (() => { const m = env.match(/PRIVATE_KEY=(.+)/)[1].trim(); return m.startsWith("0x") ? m : "0x" + m; })();

const pub = createPublicClient({ chain: baseSepolia, transport: fallback([
  http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]) });
const acct = privateKeyToAccount(PK);

const LP_ABI = [{ type: "function", name: "launchCollection", stateMutability: "nonpayable",
  inputs: [{ name: "p", type: "tuple", components: [
    { name: "name", type: "string" }, { name: "ticker", type: "string" }, { name: "bio", type: "string" },
    { name: "photoURIs", type: "string[6]" }, { name: "photoCount", type: "uint8" },
    { name: "socialX", type: "string" }, { name: "socialGithub", type: "string" }, { name: "socialFarcaster", type: "string" },
    { name: "mintPriceWei", type: "uint256" }, { name: "tokenEnabled", type: "bool" }, { name: "tokenFeeBps", type: "uint256" },
    { name: "phaseRoots", type: "bytes32[4]" }, { name: "phaseStarts", type: "uint256[4]" },
    { name: "phaseEnds", type: "uint256[4]" }, { name: "phaseMaxPerWallet", type: "uint256[4]" },
    { name: "allowlistCID", type: "string" } ]}], outputs: [{ type: "address" }] }];

const now = Math.floor(Date.now() / 1000);
const z32 = "0x" + "0".repeat(64);
const params = {
  name: "GasProbe", ticker: "GAS", bio: "estimate",
  photoURIs: Array(6).fill("ipfs://QmPlaceholderCidForGasEstimateXXXXXXXXXXXX"), photoCount: 6,
  socialX: "", socialGithub: "", socialFarcaster: "",
  mintPriceWei: parseEther("0.0001"), tokenEnabled: true, tokenFeeBps: 250n,
  phaseRoots: [z32, z32, z32, z32],
  phaseStarts: [BigInt(now - 7200), BigInt(now - 7200), BigInt(now - 7200), BigInt(now - 60)],
  phaseEnds: [BigInt(now - 3600), BigInt(now - 3600), BigInt(now - 3600), BigInt(now + 86400)],
  phaseMaxPerWallet: [0n, 0n, 0n, 0n], allowlistCID: "",
};

const gas = await pub.estimateContractGas({ address: dep.launchpad, abi: LP_ABI,
  functionName: "launchCollection", args: [params], account: acct });
const gp = await pub.getGasPrice();
const cost = gas * gp;
console.log("launch gas estimate:", gas.toString());
console.log("gas price (gwei):", Number(gp) / 1e9);
console.log("launch cost:", formatEther(cost), "ETH");
console.log("platform fee per mint:", "0.0003 ETH");
console.log("--- projections (launch only, no mints) ---");
console.log("200 launches:", formatEther(cost * 200n), "ETH");
console.log("with avg 5 mints each (+fee):", formatEther(cost * 200n + parseEther("0.0003") * 5n * 200n), "ETH");
