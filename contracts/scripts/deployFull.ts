import { ethers, network } from "hardhat";
import * as fs from "fs";

// Full deploy: hook (mined) + vault + factory + NFT deployer + launchpad + airdrop
// distributor + swap router, wired together, on Robinhood Chain (chainId 4663).
// The 1% epoch airdrop routes into the AirdropDistributor (claim-based).
const POOL_MANAGERS: Record<string, string> = {
  // Uniswap V4 PoolManager on Robinhood Chain
  robinhood: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
};
// Uniswap V3 addresses per network for the ADDITIONAL plain (1% fee tier, no-hook)
// V3 pool seeded alongside the V4 pool. Verified on-chain against Robinhood Chain
// (chainId 4663): NPM.factory()/WETH9() and Router.factory()/WETH9() cross-link to
// the V3 factory 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA, and fee tier 10000 has
// tick spacing 200. Source: developers.uniswap.org Robinhood Chain V3 deployments +
// robinhoodchain.blockscout.com verified contracts. Env overrides win.
const V3_FACTORIES: Record<string, string> = {
  robinhood: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA", // UniswapV3Factory
};
const V3_POSITION_MANAGERS: Record<string, string> = {
  robinhood: "0x73991a25c818bf1f1128deaab1492d45638de0d3", // NonfungiblePositionManager
};
const WETHS: Record<string, string> = {
  robinhood: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", // WETH9
};
const ZERO = "0x0000000000000000000000000000000000000000";
const CHAIN_IDS: Record<string, number> = { robinhood: 4663 };
const FLAGS = 0xccn;
const MASK = 0x3fffn;

async function waitCode(addr: string) {
  for (let i = 0; i < 40; i++) {
    if ((await ethers.provider.getCode(addr)) !== "0x") return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("no code at " + addr);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const POOL_MANAGER = POOL_MANAGERS[network.name];
  if (!POOL_MANAGER) throw new Error("no PoolManager for network " + network.name);
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log("deployer:", deployer.address, "network:", network.name, "balance:", ethers.formatEther(bal), "ETH");

  const PLATFORM_TREASURY = deployer.address;
  const KAS_WALLET = deployer.address;
  // Oracle is a separate fresh key (best practice: oracle != owner).
  const ORACLE_ADDRESS = process.env.MAINNET_ORACLE_ADDRESS || deployer.address;
  console.log("oracle role:", ORACLE_ADDRESS);

  // 1. Create2Factory + mine + deploy hook
  console.log("\n── Create2Factory + HoodseaFeeHook ──");
  const C2 = await ethers.getContractFactory("Create2Factory");
  const c2 = await C2.deploy(); await c2.waitForDeployment();
  const c2Addr = await c2.getAddress();
  const Hook = await ethers.getContractFactory("HoodseaFeeHook");
  const initCode = ethers.concat([Hook.bytecode, Hook.interface.encodeDeploy([POOL_MANAGER, deployer.address])]);
  const initCodeHash = ethers.keccak256(initCode);
  let salt = 0n, hookAddr = "";
  for (;;) {
    const addr = ethers.getCreate2Address(c2Addr, ethers.toBeHex(salt, 32), initCodeHash);
    if ((BigInt(addr) & MASK) === FLAGS) { hookAddr = addr; break; }
    salt++;
  }
  await (await c2.deploy(ethers.toBeHex(salt, 32), initCode)).wait();
  await waitCode(hookAddr);
  console.log("HoodseaFeeHook:", hookAddr, "salt:", salt.toString());

  // 2. Vault
  const Vault = await ethers.getContractFactory("HoodseaVault");
  const vault = await Vault.deploy(PLATFORM_TREASURY, ORACLE_ADDRESS); await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress(); console.log("HoodseaVault:", vaultAddr);

  // 3a. V3 locker deployer. Deploys a per-token HoodseaV3Locker at each V3 graduation;
  // each locker holds that token's V3 position NFT FOREVER (no principal withdraw / no
  // NFT transfer-out) and collect() splits the 1% fees creator/platform. The deployer
  // exists so the locker's creation code stays OUT of the factory (EIP-170). If V3 is
  // disabled (any of factory/NPM/WETH missing) it is skipped and the factory runs V4-only.
  const V3_FACTORY = process.env.V3_FACTORY || V3_FACTORIES[network.name] || ZERO;
  const V3_NPM = process.env.V3_POSITION_MANAGER || V3_POSITION_MANAGERS[network.name] || ZERO;
  const WETH = process.env.WETH9 || WETHS[network.name] || ZERO;
  const v3Enabled = V3_FACTORY !== ZERO && V3_NPM !== ZERO && WETH !== ZERO;
  let lockerDeployerAddr = ZERO;
  if (v3Enabled) {
    const LD = await ethers.getContractFactory("HoodseaV3LockerDeployer");
    const ld = await LD.deploy(); await ld.waitForDeployment();
    lockerDeployerAddr = await ld.getAddress();
    console.log("HoodseaV3LockerDeployer:", lockerDeployerAddr, "| V3 factory:", V3_FACTORY, "| NPM:", V3_NPM, "| WETH9:", WETH);
  } else {
    console.log("WARNING: V3 seeding DISABLED (missing V3 factory/NPM/WETH) — V4-only");
  }

  // 3b. Token factory. The optional USDC pair path is dropped on Robinhood Chain
  // (it was already skipped in production) — pass the zero address. The last four args
  // wire the ADDITIONAL plain 1% Uniswap V3 pool (v3Factory + NonfungiblePositionManager
  // + WETH + lockerDeployer). All-zero => V3 seeding disabled (V4-only, original behaviour).
  const Factory = await ethers.getContractFactory("HoodseaTokenFactory");
  const factory = await Factory.deploy(PLATFORM_TREASURY, vaultAddr, KAS_WALLET, POOL_MANAGER, hookAddr, ZERO, V3_FACTORY, V3_NPM, WETH, lockerDeployerAddr); await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress(); console.log("HoodseaTokenFactory:", factoryAddr);

  // 4. wire hook -> factory
  const hook = await ethers.getContractAt("HoodseaFeeHook", hookAddr);
  await (await hook.setFactory(factoryAddr)).wait(); console.log("hook.setFactory done");

  // 5. NFT deployer
  const NFTDep = await ethers.getContractFactory("HoodseaNFTDeployer");
  const nftDep = await NFTDep.deploy(); await nftDep.waitForDeployment();
  const nftDepAddr = await nftDep.getAddress(); console.log("HoodseaNFTDeployer:", nftDepAddr);

  // 6. Launchpad
  const Launchpad = await ethers.getContractFactory("HoodseaLaunchpad");
  const launchpad = await Launchpad.deploy(PLATFORM_TREASURY, vaultAddr, KAS_WALLET, factoryAddr, nftDepAddr); await launchpad.waitForDeployment();
  const launchpadAddr = await launchpad.getAddress(); console.log("HoodseaLaunchpad:", launchpadAddr);

  // S5: lock the deployer to this launchpad so no one can mint orphan collections.
  await (await nftDep.setLaunchpad(launchpadAddr)).wait();
  console.log("HoodseaNFTDeployer.setLaunchpad ->", launchpadAddr);

  // 7. AirdropDistributor + wire
  const Dist = await ethers.getContractFactory("AirdropDistributor");
  const dist = await Dist.deploy(deployer.address, ORACLE_ADDRESS); await dist.waitForDeployment();
  const distAddr = await dist.getAddress(); console.log("AirdropDistributor:", distAddr);
  await (await dist.setVault(vaultAddr)).wait();
  await (await vault.setAirdropDistributor(distAddr)).wait();
  console.log("distributor <-> vault wired");

  // 8. Swap router
  const Router = await ethers.getContractFactory("HoodseaSwapRouter");
  const router = await Router.deploy(POOL_MANAGER); await router.waitForDeployment();
  const routerAddr = await router.getAddress(); console.log("HoodseaSwapRouter:", routerAddr);
  // Splitters use the router to buy back tokens for creators who pick TOKEN/BOTH fee.
  await (await factory.setRouter(routerAddr)).wait();
  console.log("factory.setRouter ->", routerAddr);

  // 9. Wiring assertion — the NFT 0.1% fee sink (launchpad.airdropVault) MUST be the
  // same vault the airdrop system drains (vault <-> distributor), or stream-2 fees
  // get stranded. Fail the deploy loudly rather than discover the split later.
  const lpVault = (await launchpad.airdropVault()) as string;
  const vaultDist = (await vault.airdropDistributor()) as string;
  const distVault = (await dist.vault()) as string;
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!eq(lpVault, vaultAddr) || !eq(vaultDist, distAddr) || !eq(distVault, vaultAddr)) {
    throw new Error(`WIRING SPLIT: launchpad.airdropVault=${lpVault} vault=${vaultAddr} vault.distributor=${vaultDist} dist=${distAddr} dist.vault=${distVault}`);
  }
  console.log("wiring verified: launchpad.airdropVault == vault <-> distributor");

  const out = {
    network: network.name, chainId: CHAIN_IDS[network.name] || 4663,
    poolManager: POOL_MANAGER, feeHook: hookAddr, create2Factory: c2Addr, salt: salt.toString(),
    v3Factory: V3_FACTORY, v3PositionManager: V3_NPM, weth9: WETH, v3LockerDeployer: lockerDeployerAddr,
    v3SeedBps: (await factory.v3SeedBps()).toString(), creatorSplitBps: (await factory.creatorSplitBps()).toString(),
    vault: vaultAddr, airdropDistributor: distAddr, tokenFactory: factoryAddr,
    nftDeployer: nftDepAddr, launchpad: launchpadAddr, swapRouter: routerAddr, deployer: deployer.address,
  };
  fs.writeFileSync(`deployment-${network.name}.json`, JSON.stringify(out, null, 2));
  console.log("\n=== DONE ===\n" + JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
