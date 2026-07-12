import { ethers } from "hardhat";
import * as fs from "fs";
const POOL_MANAGER = process.env.POOL_MANAGER || "0x8366a39cc670b4001a1121b8f6a443a643e40951"; // Uniswap V4 PoolManager on Robinhood Chain
async function main() {
  const R = await ethers.getContractFactory("HoodseaSwapRouter");
  const r = await R.deploy(POOL_MANAGER);
  await r.waitForDeployment();
  const addr = await r.getAddress();
  console.log("HoodseaSwapRouter:", addr);
  const d = JSON.parse(fs.readFileSync("deployment-robinhood.json","utf8"));
  d.swapRouter = addr;
  fs.writeFileSync("deployment-robinhood.json", JSON.stringify(d,null,2));
}
main().catch(e=>{console.error(e);process.exit(1);});
