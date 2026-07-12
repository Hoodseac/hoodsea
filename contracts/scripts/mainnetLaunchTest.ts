import { ethers } from "hardhat";
import * as fs from "fs";
// REAL launch + bond on Robinhood Chain to confirm the single-sided token is tradeable.
// Reads the live deployment from deployment-robinhood.json (written by deployFull.ts);
// env vars override.
const dep = (() => { try { return JSON.parse(fs.readFileSync("deployment-robinhood.json", "utf8")); } catch { return {}; } })();
const LAUNCHPAD = process.env.LAUNCHPAD_ADDRESS || dep.launchpad || "";
const SWAP_ROUTER = process.env.SWAP_ROUTER || dep.swapRouter || "";
const HOOK = process.env.FEE_HOOK || dep.feeHook || "";
const Z = "0x" + "0".repeat(64); const D = "0x" + "0".repeat(63) + "1";
const LP_ABI = ["function launchCollection((string name,string ticker,string bio,string[6] photoURIs,uint8 photoCount,string socialX,string socialGithub,string socialFarcaster,uint256 mintPriceWei,bool tokenEnabled,uint256 tokenFeeBps,uint256 decaySeconds,uint8 feeReceiveType,uint256 startMcPairWei,bool pairIsUSDC,bytes32[4] phaseRoots,uint256[4] phaseStarts,uint256[4] phaseEnds,uint256[4] phaseMaxPerWallet,string allowlistCID,uint256 maxSupply)) returns (address)", "event CollectionLaunched(address indexed collection,address indexed creator,string name,string ticker,uint256 mintPrice,uint256 mintStart)"];
const NFT_ABI = ["function mint(uint256 quantity, bytes32[] proof) payable", "function getCollectionInfo() view returns (tuple(string,string,string,string,string,string,string[6],uint8,address,uint256,uint256,bool,address,bool,uint256))"];
async function main() {
  const [s] = await ethers.getSigners();
  console.log("creator:", s.address, "bal:", ethers.formatEther(await ethers.provider.getBalance(s.address)));
  const now = Math.floor(Date.now() / 1000); const FAR = 9999999999n;
  const lp = new ethers.Contract(LAUNCHPAD, LP_ABI, s);
  const p = { name: "Hoodsea Demo", ticker: "DEMO", bio: "single-sided launch demo", photoURIs: ["ipfs://Qmdemo1", "ipfs://Qmdemo2", "ipfs://Qmdemo3", "", "", ""], photoCount: 3, socialX: "", socialGithub: "", socialFarcaster: "", mintPriceWei: 0n, tokenEnabled: true, tokenFeeBps: 150n, decaySeconds: 30n, feeReceiveType: 0, startMcPairWei: ethers.parseEther("3"), pairIsUSDC: false, phaseRoots: [D, D, D, Z], phaseStarts: [BigInt(now - 3), BigInt(now - 2), BigInt(now - 1), BigInt(now)], phaseEnds: [BigInt(now - 2), BigInt(now - 1), BigInt(now), FAR], phaseMaxPerWallet: [0n, 0n, 0n, 0n], allowlistCID: "", maxSupply: 100n };
  console.log("launching on Robinhood Chain...");
  const rc = await (await lp.launchCollection(p, { gasLimit: 7_000_000n })).wait();
  const col = rc.logs.map((l: any) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "CollectionLaunched").args.collection;
  console.log("collection:", col);
  const nft = new ethers.Contract(col, NFT_ABI, s);
  for (let d = 0; d < 100; ) { const q = Math.min(20, 100 - d); const last = d + q >= 100; await (await nft.mint(q, [], { value: 0, gasLimit: last ? 14_000_000n : 6_000_000n })).wait(); d += q; console.log("minted", d, last ? "(bonding)" : ""); }
  let token = ethers.ZeroAddress;
  for (let i = 0; i < 15; i++) { const info = await nft.getCollectionInfo(); if (info[11] && info[12] !== ethers.ZeroAddress) { token = info[12]; break; } await new Promise((r) => setTimeout(r, 3000)); }
  console.log("TOKEN DEPLOYED:", token);
  if (token === ethers.ZeroAddress) throw new Error("no token");
  // tiny buy to confirm tradeable
  const erc = new ethers.Contract(token, ["function balanceOf(address) view returns (uint256)"], s);
  const router = new ethers.Contract(SWAP_ROUTER, ["function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint256 amountIn,uint256 minOut,address recipient) payable returns (uint256)"], s);
  const before = await erc.balanceOf(s.address);
  await (await router.swapExactIn({ currency0: ethers.ZeroAddress, currency1: token, fee: 0, tickSpacing: 60, hooks: HOOK }, true, ethers.parseEther("0.0003"), 0n, s.address, { value: ethers.parseEther("0.0003"), gasLimit: 2_000_000n })).wait();
  let got = 0n; for (let i = 0; i < 15; i++) { got = (await erc.balanceOf(s.address)) - before; if (got > 0n) break; await new Promise((r) => setTimeout(r, 2000)); }
  console.log("bought with 0.0003 ETH ->", ethers.formatUnits(got, 18), "DEMO");
  console.log(got > 0n ? "=== MAINNET TOKEN LIVE + TRADEABLE ===" : "=== buy 0 ===");
  console.log("explorer token:", "https://robinhoodchain.blockscout.com/token/" + token);
  console.log("hoodsea token page: /token/" + token);
}
main().catch((e) => { console.error("FAIL:", e.shortMessage || e.message); process.exit(1); });
