import { ethers, network } from "hardhat";

// Redeploy ONLY the launchpad + its NFT deployer (the deployer is one-time
// locked to a launchpad, so both must be fresh). Reuses the existing vault /
// factory / treasury. New launchpad has a SETTABLE platform fee (default 0).
// The token factory reads each collection's launchpad dynamically, so existing
// factory/vault/router/hook keep working with collections from the new launchpad.
// Existing addresses come from .env (VAULT_ADDRESS / TOKEN_FACTORY_ADDRESS) so this
// script works against whatever Robinhood Chain deployment is live.
const EXISTING: Record<string, { vault: string; factory: string }> = {
  robinhood: {
    vault: process.env.VAULT_ADDRESS || "",
    factory: process.env.TOKEN_FACTORY_ADDRESS || "",
  },
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const ex = (EXISTING as any)[network.name];
  if (!ex || !ex.vault || !ex.factory) throw new Error("set VAULT_ADDRESS and TOKEN_FACTORY_ADDRESS in .env for network " + network.name);
  const treasury = deployer.address; // platformTreasury == kasWallet == deployer
  console.log("deployer:", deployer.address, "network:", network.name);
  console.log("reusing vault:", ex.vault, "factory:", ex.factory);

  const NFTDep = await ethers.getContractFactory("HoodseaNFTDeployer");
  const nftDep = await NFTDep.deploy();
  await nftDep.waitForDeployment();
  const nftDepAddr = await nftDep.getAddress();
  console.log("HoodseaNFTDeployer:", nftDepAddr);

  const Launchpad = await ethers.getContractFactory("HoodseaLaunchpad");
  const launchpad = await Launchpad.deploy(treasury, ex.vault, treasury, ex.factory, nftDepAddr);
  await launchpad.waitForDeployment();
  const launchpadAddr = await launchpad.getAddress();
  console.log("HoodseaLaunchpad:", launchpadAddr);

  await (await nftDep.setLaunchpad(launchpadAddr)).wait();
  console.log("nftDeployer.setLaunchpad ->", launchpadAddr);

  const fee = await launchpad.getPlatformFeeETH();
  console.log("platformFeeETH (should be 0):", fee.toString());

  console.log("\n=== NEW ADDRESSES ===");
  console.log(JSON.stringify({ launchpad: launchpadAddr, nftDeployer: nftDepAddr }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
