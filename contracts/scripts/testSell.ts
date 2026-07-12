import { ethers } from "hardhat";
const SWAP_ROUTER = process.env.SWAP_ROUTER || ""; // set in .env after deploy
const HOOK = process.env.FEE_HOOK || "";
const TOKEN = process.env.TOKEN || "";
async function main() {
  const [s] = await ethers.getSigners();
  const erc = new ethers.Contract(TOKEN, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ], s);
  const router = new ethers.Contract(SWAP_ROUTER, ["function swapExactIn((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,uint256 amountIn,uint256 minOut,address recipient) payable returns (uint256)"], s);
  const key = { currency0: ethers.ZeroAddress, currency1: TOKEN, fee: 0, tickSpacing: 60, hooks: HOOK };

  const allow = await erc.allowance(s.address, SWAP_ROUTER);
  if (allow < ethers.parseUnits("1000000", 18)) {
    console.log("approving router...");
    await (await erc.approve(SWAP_ROUTER, ethers.MaxUint256)).wait();
  }

  const tokBefore = await erc.balanceOf(s.address);
  const ethBefore = await ethers.provider.getBalance(s.address);
  const sellAmt = ethers.parseUnits("1000000", 18); // sell 1,000,000 tokens
  console.log("selling 1,000,000 token -> ETH...");
  const tx = await router.swapExactIn(key, false, sellAmt, 0n, s.address, { value: 0n, gasLimit: 3_000_000n });
  const rc = await tx.wait();
  // poll token balance to drop (avoid RPC lag)
  let tokAfter = tokBefore;
  for (let i = 0; i < 15; i++) { tokAfter = await erc.balanceOf(s.address); if (tokAfter < tokBefore) break; await new Promise((r) => setTimeout(r, 2000)); }
  const ethAfter = await ethers.provider.getBalance(s.address);
  const gasCost = rc.gasUsed * (rc.gasPrice ?? 0n);
  const tokSpent = tokBefore - tokAfter;
  const ethDelta = ethAfter - ethBefore + gasCost; // add back gas to see swap ETH gain
  console.log("token spent:", ethers.formatUnits(tokSpent, 18));
  console.log("ETH received (gross of gas):", ethers.formatEther(ethDelta));
  console.log(tokSpent > 0n && ethDelta > 0n ? "=== SELL OK (token->ETH) ===" : "=== SELL FAILED ===");
}
main().catch((e) => { console.error("FAIL:", e.shortMessage || e.message); process.exit(1); });
