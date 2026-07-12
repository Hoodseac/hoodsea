import { ethers } from "hardhat";
const SWAP_ROUTER = process.env.SWAP_ROUTER || ""; // set in .env after deploy
const HOOK = process.env.FEE_HOOK || "";
const TOKEN = process.env.TOKEN || "";
async function main() {
  const [s] = await ethers.getSigners();
  const erc = new ethers.Contract(TOKEN, ["function balanceOf(address) view returns (uint256)"], s);
  const router = new ethers.Contract(SWAP_ROUTER, ["function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint256 amountIn,uint256 minOut,address recipient) payable returns (uint256)"], s);
  const key = { currency0: ethers.ZeroAddress, currency1: TOKEN, fee: 0, tickSpacing: 60, hooks: HOOK };
  const before = await erc.balanceOf(s.address);
  console.log("before:", ethers.formatUnits(before, 18));
  console.log("buying 0.001 ETH (small)...");
  const tx = await router.swapExactIn(key, true, ethers.parseEther("0.001"), 0n, s.address, { value: ethers.parseEther("0.001"), gasLimit: 3_000_000n });
  await tx.wait();
  // Poll until the balance change propagates (avoid RPC read lag false-zero).
  let got = 0n;
  for (let i = 0; i < 15; i++) {
    got = (await erc.balanceOf(s.address)) - before;
    if (got > 0n) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("token received from 0.001 ETH:", ethers.formatUnits(got, 18));
  console.log(got > 0n ? "=== SMALL BUY OK -> single-sided pool consistent ===" : "=== STILL 0 after polling ===");
}
main().catch((e) => { console.error("FAIL:", e.shortMessage || e.message); process.exit(1); });
