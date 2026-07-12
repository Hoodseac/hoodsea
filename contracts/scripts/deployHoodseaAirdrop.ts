import { ethers, network } from "hardhat";

/**
 * Deploy HoodseaAirdrop — permissionless multi-campaign airdrop (merkle + FCFS).
 * No constructor args, no owner/admin (no rug). Same contract on testnet & mainnet.
 *
 *   npx hardhat run scripts/deployHoodseaAirdrop.ts --network robinhood
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Network:", network.name);

  const Airdrop = await ethers.getContractFactory("HoodseaAirdrop");
  const airdrop = await Airdrop.deploy();
  await airdrop.waitForDeployment();
  const addr = await airdrop.getAddress();

  console.log("\n═══════════════════════════════════════════════════");
  console.log("HoodseaAirdrop:", addr);
  console.log("═══════════════════════════════════════════════════");
  console.log("\nFrontend env:");
  console.log(`NEXT_PUBLIC_AIRDROP_ADDRESS=${addr}`);
  console.log(`\nVerify:`);
  console.log(`npx hardhat verify --network ${network.name} ${addr}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
