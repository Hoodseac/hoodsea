import { ethers } from "hardhat";
const SWAP_ROUTER = process.env.SWAP_ROUTER || "";
const HOOK = process.env.FEE_HOOK || "";
const STATE_VIEW = process.env.STATE_VIEW || "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b"; // Robinhood Chain v4 StateView
const TOKEN = process.env.TOKEN || "";

async function main() {
  const [s] = await ethers.getSigners();
  const erc = new ethers.Contract(TOKEN, ["function balanceOf(address) view returns (uint256)"], s);
  const router = new ethers.Contract(SWAP_ROUTER, ["function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint256 amountIn,uint256 minOut,address recipient) payable returns (uint256)"], s);

  // pool state
  const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ["address","address","uint24","int24","address"],
    [ethers.ZeroAddress, TOKEN, 0, 60, HOOK]));
  const sv = new ethers.Contract(STATE_VIEW, [
    "function getSlot0(bytes32) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
    "function getLiquidity(bytes32) view returns (uint128)"], s);
  try {
    const slot0 = await sv.getSlot0(poolId);
    const liq = await sv.getLiquidity(poolId);
    console.log("sqrtPriceX96:", slot0[0].toString(), "tick:", slot0[1].toString(), "liquidity:", liq.toString());
  } catch (e: any) { console.log("stateview read err:", e.shortMessage || e.message); }

  const before = await erc.balanceOf(s.address);
  const key = { currency0: ethers.ZeroAddress, currency1: TOKEN, fee: 0, tickSpacing: 60, hooks: HOOK };
  console.log("buying with 0.002 ETH...");
  const tx = await router.swapExactIn(key, true, ethers.parseEther("0.002"), 0n, s.address, { value: ethers.parseEther("0.002"), gasLimit: 2_000_000n });
  await tx.wait();
  const got = (await erc.balanceOf(s.address)) - before;
  console.log("token received:", ethers.formatUnits(got, 18));
  console.log(got > 0n ? "=== POOL TRADEABLE (single-sided BUY OK) ===" : "=== SWAP 0 - NOT TRADEABLE ===");
}
main().catch((e) => { console.error("FAIL:", e.shortMessage || e.message); process.exit(1); });
