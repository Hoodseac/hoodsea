import { ethers } from "hardhat";

// Deploys the new AirdropDistributor + a new HoodseaVault (claim-based 1% airdrop),
// wires them together, and points the existing factory at the new vault so future
// launches lock into it. Existing collections stay on the old vault.
//
// All roles (owner/platform/oracle/treasury/kas) match the current deployment owner.
async function main() {
  const [deployer] = await ethers.getSigners();
  const me = await deployer.getAddress();
  console.log("deployer:", me);

  const FACTORY = process.env.TOKEN_FACTORY_ADDRESS || ""; // existing HoodseaTokenFactory
  if (!FACTORY) throw new Error("set TOKEN_FACTORY_ADDRESS in .env");
  const TREASURY = me;
  const KAS = me;
  const ORACLE = me;

  // 1) AirdropDistributor(owner, oracle)
  const Dist = await ethers.getContractFactory("AirdropDistributor");
  const dist = await Dist.deploy(me, ORACLE);
  await dist.waitForDeployment();
  const distAddr = await dist.getAddress();
  console.log("AirdropDistributor:", distAddr);

  // 2) HoodseaVault(platform, airdropOracle)
  const Vault = await ethers.getContractFactory("HoodseaVault");
  const vault = await Vault.deploy(me, ORACLE);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log("HoodseaVault (new):", vaultAddr);

  // 3) wire
  let tx = await dist.setVault(vaultAddr);
  await tx.wait();
  console.log("dist.setVault ->", vaultAddr);

  tx = await vault.setAirdropDistributor(distAddr);
  await tx.wait();
  console.log("vault.setAirdropDistributor ->", distAddr);

  // 4) point factory at the new vault for future launches
  const factory = await ethers.getContractAt("HoodseaTokenFactory", FACTORY);
  tx = await factory.updateAddresses(TREASURY, vaultAddr, KAS);
  await tx.wait();
  console.log("factory.updateAddresses(vault) ->", vaultAddr);

  console.log("\n=== SET THESE ===");
  console.log("NEXT_PUBLIC_VAULT_ADDRESS=", vaultAddr);
  console.log("NEXT_PUBLIC_AIRDROP_DISTRIBUTOR=", distAddr);
  console.log("backend VAULT_ADDRESS=", vaultAddr);
  console.log("backend AIRDROP_DISTRIBUTOR=", distAddr);
}

main().catch((e) => { console.error(e); process.exit(1); });
