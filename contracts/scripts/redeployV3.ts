import { ethers, network } from "hardhat";
import * as fs from "fs";

// PARTIAL redeploy on Robinhood Chain (chainId 4663): deploy a NEW HoodseaFeeHook,
// HoodseaV3LockerDeployer and (round-2 V3 dual-seed) HoodseaTokenFactory, then
// repoint the existing launchpad at the new factory. Everything else is REUSED.
// Does NOT run deployFull.ts. Real mainnet spend — asserts wiring, stops on any fail.

// ── Reused (already-deployed) addresses ──────────────────────────────────────
const DEPLOYER = "0xF7B7b5c705cCe54b9Ea379e8612AC0704382A3d7"; // owner/treasury/kas
const VAULT = "0x715311f008A1546Ad32E3Eb84942855c8a709e4e";
const SWAP_ROUTER = "0x2736840beB3295dAB14BaCD78f71FC934108eB4B";
const LAUNCHPAD = "0x00bF94d829D1a510E1C16c75D550C2034Bf1BB91";
const CREATE2_FACTORY = "0xAFDCb9b791D4eB6257DDBe356d63b8a5335a9861"; // reuse for hook mining
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const AIRDROP_DISTRIBUTOR = "0x47Bb7C36FFF1170C8BcC238E3089282377552feF";
const V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA";
const V3_NPM = "0x73991a25c818bf1f1128deaab1492d45638de0d3";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const USDC = "0x0000000000000000000000000000000000000000"; // ETH-only

const FLAGS = 0xccn; // hook permission bits (beforeSwap+afterSwap+returnDeltas)
const MASK = 0x3fffn; // low 14 bits

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

async function waitCode(addr: string) {
  for (let i = 0; i < 40; i++) {
    if ((await ethers.provider.getCode(addr)) !== "0x") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("no code at " + addr);
}

async function main() {
  if (network.name !== "robinhood") throw new Error("run with --network robinhood");
  const [deployer] = await ethers.getSigners();
  if (!eq(deployer.address, DEPLOYER)) throw new Error("wrong deployer key: " + deployer.address + " != " + DEPLOYER);
  const bal0 = await ethers.provider.getBalance(deployer.address);
  console.log("deployer:", deployer.address, "| balance:", ethers.formatEther(bal0), "ETH | network:", network.name);

  // 1. NEW HoodseaFeeHook, mined to 0xCC low-14-bits, deployed via the EXISTING
  //    Create2Factory. Skip any mined address that already has code (the old hook
  //    lives at the first 0xCC match since the initcode is unchanged).
  const Hook = await ethers.getContractFactory("HoodseaFeeHook");
  const initCode = ethers.concat([Hook.bytecode, Hook.interface.encodeDeploy([POOL_MANAGER, deployer.address])]);
  const initCodeHash = ethers.keccak256(initCode);
  let salt = 0n, hookAddr = "";
  for (;;) {
    const addr = ethers.getCreate2Address(CREATE2_FACTORY, ethers.toBeHex(salt, 32), initCodeHash);
    if ((BigInt(addr) & MASK) === FLAGS) {
      if ((await ethers.provider.getCode(addr)) === "0x") { hookAddr = addr; break; }
      console.log("  salt", salt.toString(), "-> 0xCC match", addr, "already deployed, skipping");
    }
    salt++;
  }
  const c2 = await ethers.getContractAt("Create2Factory", CREATE2_FACTORY);
  console.log("\n── HoodseaFeeHook ──\nmined:", hookAddr, "salt:", salt.toString(), "via Create2Factory", CREATE2_FACTORY);
  await (await c2.deploy(ethers.toBeHex(salt, 32), initCode)).wait();
  await waitCode(hookAddr);
  console.log("HoodseaFeeHook deployed:", hookAddr);

  // 2. HoodseaV3LockerDeployer (deploys per-token lockers at bonding).
  const LD = await ethers.getContractFactory("HoodseaV3LockerDeployer");
  const ld = await LD.deploy(); await ld.waitForDeployment();
  const ldAddr = await ld.getAddress(); console.log("HoodseaV3LockerDeployer:", ldAddr);

  // 3. HoodseaTokenFactory (round-2 V3 dual-seed constructor).
  const Factory = await ethers.getContractFactory("HoodseaTokenFactory");
  const factory = await Factory.deploy(
    DEPLOYER, VAULT, DEPLOYER, POOL_MANAGER, hookAddr, USDC, V3_FACTORY, V3_NPM, WETH, ldAddr
  );
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress(); console.log("HoodseaTokenFactory:", factoryAddr);

  // 4. Rewire.
  const hook = await ethers.getContractAt("HoodseaFeeHook", hookAddr);
  await (await hook.setFactory(factoryAddr)).wait(); console.log("\nhook.setFactory ->", factoryAddr);
  await (await factory.setRouter(SWAP_ROUTER)).wait(); console.log("factory.setRouter ->", SWAP_ROUTER);
  const launchpad = await ethers.getContractAt("HoodseaLaunchpad", LAUNCHPAD);
  await (await launchpad.updateAddresses(DEPLOYER, VAULT, DEPLOYER, factoryAddr)).wait();
  console.log("launchpad.updateAddresses -> treasury/kas=deployer, vault=vault, factory=", factoryAddr);

  // 5. Assert wiring (revert loudly on any mismatch).
  const vault = await ethers.getContractAt("HoodseaVault", VAULT);
  const checks: [string, boolean][] = [
    ["launchpad.tokenFactory == newFactory", eq(await launchpad.tokenFactory(), factoryAddr)],
    ["hook.factory == newFactory", eq(await hook.factory(), factoryAddr)],
    ["factory.router == swapRouter", eq(await factory.router(), SWAP_ROUTER)],
    ["launchpad.airdropVault == vault", eq(await launchpad.airdropVault(), VAULT)],
    ["vault.airdropDistributor == distributor", eq(await vault.airdropDistributor(), AIRDROP_DISTRIBUTOR)],
  ];
  console.log("\n=== WIRING ASSERTIONS ===");
  for (const [name, ok] of checks) console.log((ok ? "OK   " : "FAIL ") + name);
  if (checks.some(([, ok]) => !ok)) throw new Error("WIRING ASSERTION FAILED — see above");

  // V3 defaults sanity (informational).
  console.log("\n=== FACTORY V3 CONFIG ===");
  console.log("v3Factory       :", await factory.v3Factory());
  console.log("v3Npm           :", await factory.v3Npm());
  console.log("weth            :", await factory.weth());
  console.log("v3LockerDeployer:", await factory.v3LockerDeployer());
  console.log("v3SeedBps       :", (await factory.v3SeedBps()).toString());
  console.log("creatorSplitBps :", (await factory.creatorSplitBps()).toString());

  const bal1 = await ethers.provider.getBalance(deployer.address);
  const out = {
    network: network.name, chainId: 4663,
    reused: {
      poolManager: POOL_MANAGER, create2Factory: CREATE2_FACTORY, vault: VAULT, swapRouter: SWAP_ROUTER,
      launchpad: LAUNCHPAD, airdropDistributor: AIRDROP_DISTRIBUTOR, v3Factory: V3_FACTORY, v3Npm: V3_NPM, weth: WETH,
    },
    deployed: { feeHook: hookAddr, hookSalt: salt.toString(), v3LockerDeployer: ldAddr, tokenFactory: factoryAddr },
    deployer: deployer.address,
    gasSpentEth: ethers.formatEther(bal0 - bal1),
    verifyArgs: {
      HoodseaFeeHook: [POOL_MANAGER, deployer.address],
      HoodseaV3LockerDeployer: [],
      HoodseaTokenFactory: [DEPLOYER, VAULT, DEPLOYER, POOL_MANAGER, hookAddr, USDC, V3_FACTORY, V3_NPM, WETH, ldAddr],
    },
  };
  fs.writeFileSync("redeployment-v3.json", JSON.stringify(out, null, 2));
  console.log("\n=== DONE ===\n" + JSON.stringify(out, null, 2));
  console.log("\ngas spent:", ethers.formatEther(bal0 - bal1), "ETH");
}

main().catch((e) => { console.error(e); process.exit(1); });
