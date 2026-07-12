import { ethers } from "hardhat";
const SWAP_ROUTER = process.env.SWAP_ROUTER || ""; // set in .env after deploy
const HOOK = process.env.FEE_HOOK || "";
const TOKEN = process.env.TOKEN || "";
async function main() {
  const [s] = await ethers.getSigners();
  const erc = new ethers.Contract(TOKEN, ["function balanceOf(address) view returns (uint256)"], s);
  const router = new ethers.Contract(SWAP_ROUTER, ["function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint256 amountIn,uint256 minOut,address recipient) payable returns (uint256)"], s);
  const key = { currency0: ethers.ZeroAddress, currency1: TOKEN, fee: 0, tickSpacing: 60, hooks: HOOK };
  for (const amt of ["0.002", "0.002", "0.002", "0.002"]) {
    const before = await erc.balanceOf(s.address);
    try {
      const tx = await router.swapExactIn(key, true, ethers.parseEther(amt), 0n, s.address, { value: ethers.parseEther(amt), gasLimit: 3_000_000n });
      const rc = await tx.wait();
      const got = (await erc.balanceOf(s.address)) - before;
      console.log(`buy ${amt} ETH -> token ${ethers.formatUnits(got, 18)} (gasUsed ${rc.gasUsed})`);
    } catch (e: any) { console.log(`buy ${amt} ETH REVERT:`, e.shortMessage || e.message); }
  }
}
main().catch((e) => { console.error("FAIL:", e.shortMessage || e.message); process.exit(1); });
