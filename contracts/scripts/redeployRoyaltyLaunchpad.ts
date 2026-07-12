import { ethers, network, run } from "hardhat";
import * as fs from "fs";

// PARTIAL redeploy for the EIP-2981 royalty + contractURI change.
// deployNFT's signature changed (added _royaltyReceiver), and HoodseaNFTDeployer is
// one-time locked to a launchpad, so BOTH the NFT deployer and the launchpad must be
// redeployed together. Everything else (vault, token factory, swapRouter, feeHook,
// poolManager, create2Factory, airdropDistributor, oracle) is REUSED. The token
// factory reads each collection's launchpad dynamically, so existing infra keeps
// working; new collections launched here get royalties + contractURI.
//
// Addresses are HARDCODED to the audited values (NOT read from .env) so a stale env
// default can never point this at the wrong factory/vault. Real mainnet spend.

const EXPECTED_DEPLOYER = "0xF7B7b5c705cCe54b9Ea379e8612AC0704382A3d7";
const VAULT   = "0x715311f008A1546Ad32E3Eb84942855c8a709e4e";
const FACTORY = "0x6c0d5D2324a12CA5150f99d0afCCF018a4551322"; // CURRENT V3 token factory
const eq = (a: string, b: string) => ethers.getAddress(a) === ethers.getAddress(b);

async function verify(address: string, args: any[]) {
  for (let i = 0; i < 5; i++) {
    try {
      await run("verify:verify", { address, constructorArguments: args });
      return "OK";
    } catch (e: any) {
      const m = String(e?.message || e);
      if (/already verified/i.test(m)) return "AlreadyVerified";
      if (i === 4) return "FAILED: " + m.split("\n")[0];
      await new Promise((r) => setTimeout(r, 8000));
    }
  }
  return "FAILED";
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = deployer.address; // platformTreasury == kasWallet == deployer
  const kas = deployer.address;

  console.log("network:", network.name);
  console.log("deployer:", deployer.address);
  if (!eq(deployer.address, EXPECTED_DEPLOYER)) {
    throw new Error(`WRONG DEPLOYER: got ${deployer.address}, expected ${EXPECTED_DEPLOYER}`);
  }
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("balance:", ethers.formatEther(bal), "ETH");
  console.log("reusing vault:", VAULT, "factory:", FACTORY);

  const startBal = bal;

  // 1. New HoodseaNFTDeployer (embeds the updated HoodseaNFT creation bytecode).
  const NFTDep = await ethers.getContractFactory("HoodseaNFTDeployer");
  const nftDep = await NFTDep.deploy();
  await nftDep.waitForDeployment();
  const nftDepAddr = await nftDep.getAddress();
  console.log("HoodseaNFTDeployer:", nftDepAddr);

  // 2. New HoodseaLaunchpad — constructor order:
  //    (_platformTreasury, _airdropVault, _kasWallet, _tokenFactory, _nftDeployer)
  const Launchpad = await ethers.getContractFactory("HoodseaLaunchpad");
  const launchpad = await Launchpad.deploy(treasury, VAULT, kas, FACTORY, nftDepAddr);
  await launchpad.waitForDeployment();
  const launchpadAddr = await launchpad.getAddress();
  console.log("HoodseaLaunchpad:", launchpadAddr);

  // 3. Lock the deployer to this launchpad (S5: no orphan collections).
  await (await nftDep.setLaunchpad(launchpadAddr)).wait();
  console.log("nftDeployer.setLaunchpad ->", launchpadAddr);

  // 4. Wiring assertions — revert on any mismatch BEFORE we report success.
  const lpFactory = await launchpad.tokenFactory();
  const lpVault = await launchpad.airdropVault();
  const lpTreasury = await launchpad.platformTreasury();
  const lpKas = await launchpad.kasWallet();
  const depLaunchpad = await nftDep.launchpad();
  const fee = await launchpad.getPlatformFeeETH();

  console.log("\n── wiring assertion ──");
  console.log("launchpad.tokenFactory   :", lpFactory, eq(lpFactory, FACTORY) ? "OK" : "MISMATCH");
  console.log("launchpad.airdropVault   :", lpVault, eq(lpVault, VAULT) ? "OK" : "MISMATCH");
  console.log("launchpad.platformTreasury:", lpTreasury, eq(lpTreasury, treasury) ? "OK" : "MISMATCH");
  console.log("launchpad.kasWallet      :", lpKas, eq(lpKas, kas) ? "OK" : "MISMATCH");
  console.log("nftDeployer.launchpad    :", depLaunchpad, eq(depLaunchpad, launchpadAddr) ? "OK (locked)" : "MISMATCH");
  console.log("launchpad.platformFeeETH :", fee.toString());

  if (!eq(lpFactory, FACTORY)) throw new Error("ASSERT FAIL: tokenFactory mismatch");
  if (!eq(lpVault, VAULT)) throw new Error("ASSERT FAIL: airdropVault mismatch");
  if (!eq(lpTreasury, treasury)) throw new Error("ASSERT FAIL: platformTreasury mismatch");
  if (!eq(lpKas, kas)) throw new Error("ASSERT FAIL: kasWallet mismatch");
  if (!eq(depLaunchpad, launchpadAddr)) throw new Error("ASSERT FAIL: nftDeployer not locked to new launchpad");
  console.log("ALL ASSERTIONS PASSED");

  const endBal = await ethers.provider.getBalance(deployer.address);
  const gasSpent = startBal - endBal;

  const out = {
    network: network.name,
    chainId: 4663,
    change: "EIP-2981 royalties + contractURI (partial redeploy)",
    nftDeployer: nftDepAddr,
    launchpad: launchpadAddr,
    reused: {
      vault: VAULT,
      tokenFactory: FACTORY,
    },
    orphaned: {
      oldLaunchpad: "0x00bF94d829D1a510E1C16c75D550C2034Bf1BB91",
    },
    deployer: deployer.address,
    gasSpentEth: ethers.formatEther(gasSpent),
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync("redeployment-royalty.json", JSON.stringify(out, null, 2));
  console.log("\n=== DEPLOYED (gas spent " + ethers.formatEther(gasSpent) + " ETH) ===");
  console.log(JSON.stringify(out, null, 2));

  // 5. Verify on Blockscout.
  console.log("\n── Blockscout verification ──");
  const vDep = await verify(nftDepAddr, []);
  console.log("HoodseaNFTDeployer verify:", vDep);
  const vLp = await verify(launchpadAddr, [treasury, VAULT, kas, FACTORY, nftDepAddr]);
  console.log("HoodseaLaunchpad verify:", vLp);

  (out as any).verify = { nftDeployer: vDep, launchpad: vLp };
  fs.writeFileSync("redeployment-royalty.json", JSON.stringify(out, null, 2));
  console.log("\n=== FINAL ===\n" + JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
