import { ethers } from "hardhat";

// End-to-end test on Robinhood Chain: launch a FREE-MINT token-enabled collection,
// mint 100 to bond, then confirm the single-sided pool is live by buying token
// with ETH via the swap router.
const LAUNCHPAD = process.env.LAUNCHPAD_ADDRESS || "";
const SWAP_ROUTER = process.env.SWAP_ROUTER || "";
const HOOK = process.env.FEE_HOOK || "";
const Z = "0x" + "0".repeat(64);
const D = "0x" + "0".repeat(63) + "1";

const LP_ABI = [
  "function launchCollection((string name,string ticker,string bio,string[6] photoURIs,uint8 photoCount,string socialX,string socialGithub,string socialFarcaster,uint256 mintPriceWei,bool tokenEnabled,uint256 tokenFeeBps,uint256 decaySeconds,uint8 feeReceiveType,uint256 startMcPairWei,bool pairIsUSDC,bytes32[4] phaseRoots,uint256[4] phaseStarts,uint256[4] phaseEnds,uint256[4] phaseMaxPerWallet,string allowlistCID,uint256 maxSupply)) returns (address)",
  "event CollectionLaunched(address indexed collection,address indexed creator,string name,string ticker,uint256 mintPrice,uint256 mintStart)",
];
const NFT_ABI = [
  "function mint(uint256 quantity, bytes32[] proof) payable",
  "function getCollectionInfo() view returns (tuple(string name,string ticker,string bio,string socialX,string socialGithub,string socialFarcaster,string[6] photoURIs,uint8 photoCount,address creator,uint256 mintPrice,uint256 platformFeeETH,bool bondingComplete,address tokenAddress,bool tokenEnabled,uint256 tokenFeeBps))",
  "function totalMinted() view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];
const ROUTER_ABI = ["function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key, bool zeroForOne, uint256 amountIn, uint256 minOut, address recipient) payable returns (uint256)"];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("tester:", signer.address);
  const now = Math.floor(Date.now() / 1000);
  const FAR = 9999999999n;

  const lp = new ethers.Contract(LAUNCHPAD, LP_ABI, signer);
  const params = {
    name: "SingleSided Test", ticker: "SSTEST", bio: "test",
    photoURIs: ["ipfs://a", "ipfs://b", "ipfs://c", "", "", ""], photoCount: 3,
    socialX: "", socialGithub: "", socialFarcaster: "",
    mintPriceWei: 0n, tokenEnabled: true, tokenFeeBps: 150n,
    decaySeconds: 0n, feeReceiveType: 0,
    startMcPairWei: ethers.parseEther("3"), pairIsUSDC: false, // ~3 ETH FDV, ETH pair
    phaseRoots: [D, D, D, Z],
    phaseStarts: [BigInt(now - 3), BigInt(now - 2), BigInt(now - 1), BigInt(now)],
    phaseEnds: [BigInt(now - 2), BigInt(now - 1), BigInt(now), FAR],
    phaseMaxPerWallet: [0n, 0n, 0n, 0n], allowlistCID: "", maxSupply: 100n,
  };
  console.log("launching free-mint collection...");
  const tx = await lp.launchCollection(params, { gasLimit: 7_000_000n });
  const rc = await tx.wait();
  const ev = rc.logs.map((l: any) => { try { return lp.interface.parseLog(l); } catch { return null; } }).find((e: any) => e && e.name === "CollectionLaunched");
  const collection = ev.args.collection;
  console.log("collection:", collection);

  const nft = new ethers.Contract(collection, NFT_ABI, signer);
  // Mint 100 (free): batches of 20, last mint carries heavy bonding gas.
  for (let done = 0; done < 100; ) {
    const qty = Math.min(20, 100 - done);
    const isLast = done + qty >= 100;
    const mtx = await nft.mint(qty, [], { value: 0, gasLimit: isLast ? 14_000_000n : 6_000_000n });
    await mtx.wait();
    done += qty;
    console.log("minted", done, "/100", isLast ? "(bonding tx)" : "");
  }

  // Poll for the token (RPC state can lag behind the bonding tx).
  let token = ethers.ZeroAddress;
  for (let i = 0; i < 12; i++) {
    const info = await nft.getCollectionInfo();
    if (info.bondingComplete && info.tokenAddress !== ethers.ZeroAddress) { token = info.tokenAddress; break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("token:", token);
  if (token === ethers.ZeroAddress) throw new Error("no token deployed");

  // Try to BUY token with 0.002 ETH via the single-sided pool.
  const router = new ethers.Contract(SWAP_ROUTER, ROUTER_ABI, signer);
  const erc = new ethers.Contract(token, ERC20_ABI, signer);
  const before = await erc.balanceOf(signer.address);
  const key = { currency0: ethers.ZeroAddress, currency1: token, fee: 0, tickSpacing: 60, hooks: HOOK };
  console.log("swapping 0.002 ETH -> token...");
  const stx = await router.swapExactIn(key, true, ethers.parseEther("0.002"), 0n, signer.address, { value: ethers.parseEther("0.002"), gasLimit: 2_000_000n });
  await stx.wait();
  let after = before;
  for (let i = 0; i < 15; i++) { after = await erc.balanceOf(signer.address); if (after > before) break; await new Promise((r) => setTimeout(r, 2000)); }
  const got = after - before;
  console.log("token received:", ethers.formatUnits(got, 18));
  console.log(got > 0n ? "=== SINGLE-SIDED POOL TRADEABLE (BUY OK) ===" : "=== SWAP RETURNED 0 — NOT TRADEABLE ===");
}
main().catch((e) => { console.error("TEST FAIL:", e.shortMessage || e.message || e); process.exit(1); });
