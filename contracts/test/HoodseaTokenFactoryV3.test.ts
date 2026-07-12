import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// The factory seeds BOTH a Uniswap V4 pool (with the HoodseaFeeHook) and, in
// addition, a plain Uniswap V3 pool on the canonical 1% fee tier (no hooks) so the
// token is universally indexable/tradeable. The V3 position NFT is locked in a
// per-token HoodseaV3Locker (ported from Primehod): liquidity is permanently locked
// while collect() splits the 1% fees creator/platform by creatorSplitBps. These
// tests drive the real HoodseaTokenFactory + HoodseaV3LockerDeployer + HoodseaV3Locker
// against permissive mocks of the V4 PoolManager, the fee hook, and the V3
// factory / NonfungiblePositionManager.
//
// NOTE: revert strings are stripped by the compiler (hardhat.config.ts), so
// require-failures are asserted with .reverted, not .revertedWith("...").
const TOTAL = 1_000_000_000n * 10n ** 18n; // HoodseaToken.TOTAL_SUPPLY
const HALF = TOTAL / 2n; // liquidity half held by the factory
const MAX_TICK = 887272n;
const V3_TICK_SPACING = 200n;
const MAX_ALIGNED = MAX_TICK - (MAX_TICK % V3_TICK_SPACING); // 887200

describe("HoodseaTokenFactory V3 dual-seed (Primehod-style 1% locked pool)", () => {
  let owner: SignerWithAddress, treasury: SignerWithAddress, kas: SignerWithAddress,
    vault: SignerWithAddress, creator: SignerWithAddress;

  // roles: platform=treasury, kas=kas, airdrop=vault (V4 recipients); V3 fee split is
  // creator/platform only.
  async function deploy(opts: { disable?: "factory" | "npm" | "weth" | "deployer" } = {}) {
    [owner, treasury, kas, vault, creator] = await ethers.getSigners();
    const pm = await ethers.deployContract("MockV4PoolManager");
    const hook = await ethers.deployContract("MockFeeHook");
    const v3f = await ethers.deployContract("MockUniswapV3Factory");
    const npm = await ethers.deployContract("MockNonfungiblePositionManager");
    const weth = await ethers.deployContract("MockERC20", [ethers.parseEther("1000000")]); // owner holds WETH
    const deployer = await ethers.deployContract("HoodseaV3LockerDeployer");

    const A = (real: any, d: string) => (opts.disable === d ? ethers.ZeroAddress : real);
    const v3fAddr = A(await v3f.getAddress(), "factory");
    const npmAddr = A(await npm.getAddress(), "npm");
    const wethAddr = A(await weth.getAddress(), "weth");
    const depAddr = A(await deployer.getAddress(), "deployer");

    const factory = await ethers.deployContract("HoodseaTokenFactory", [
      treasury.address, vault.address, kas.address,
      await pm.getAddress(), await hook.getAddress(), ethers.ZeroAddress,
      v3fAddr, npmAddr, wethAddr, depAddr,
    ]);
    const coll = await ethers.deployContract("MockBondingCollection");
    return { pm, hook, v3f, npm, weth, wethAddr, deployer, factory, coll };
  }

  async function bond(factory: any, coll: any) {
    const tx = await coll.bond(await factory.getAddress(), creator.address, "TokTest", "TT", 150n);
    const rc = await tx.wait();
    const token = (await factory.collectionToToken(await coll.getAddress())) as string;
    const evs = rc!.logs.map((l: any) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .filter((e: any) => e) as any[];
    const ev = (name: string) => evs.find((e) => e.name === name);
    return { token, ev };
  }

  async function lockerOf(factory: any, token: string) {
    return ethers.getContractAt("HoodseaV3Locker", await factory.tokenToV3Locker(token));
  }

  describe("dual-seed happy path (default 50/50 seed, 55/45 fee split)", () => {
    it("seeds a 1% single-sided V3 pool, locks the NFT, keeps V4, no stranded supply", async () => {
      const { pm, hook, npm, wethAddr, factory, coll } = await deploy();
      expect(await factory.v3SeedBps()).to.equal(5000n);
      expect(await factory.creatorSplitBps()).to.equal(5500n);
      expect(await factory.V3_FEE()).to.equal(10000n); // 1% tier
      expect(await factory.V3_TICK_SPACING()).to.equal(200n);

      const { token, ev } = await bond(factory, coll);
      expect(token).to.not.equal(ethers.ZeroAddress);

      // ── V3 pool created + position minted single-sided ────────────────────
      expect(await npm.minted()).to.equal(true);
      const v3Amount = (HALF * 5000n) / 10000n; // 250M
      const tokenIs0 = BigInt(token) < BigInt(wethAddr);
      const a0 = await npm.mintAmount0();
      const a1 = await npm.mintAmount1();
      if (tokenIs0) {
        expect((await npm.mintToken0()).toLowerCase()).to.equal(token.toLowerCase());
        expect(a0).to.equal(v3Amount);
        expect(a1).to.equal(0n); // single-sided: no WETH required
        expect(await npm.mintTickUpper()).to.equal(MAX_ALIGNED); // full range above
      } else {
        expect((await npm.mintToken1()).toLowerCase()).to.equal(token.toLowerCase());
        expect(a1).to.equal(v3Amount);
        expect(a0).to.equal(0n);
        expect(await npm.mintTickLower()).to.equal(-MAX_ALIGNED); // full range below
      }
      expect((await npm.mintTickLower()) % 200n).to.equal(0n);
      expect((await npm.mintTickUpper()) % 200n).to.equal(0n);
      const erc = await ethers.getContractAt("MockERC20", token);
      expect(await erc.balanceOf(await npm.getAddress())).to.equal(v3Amount); // token pulled in

      // ── NFT locked in a per-token locker (not DEAD) ───────────────────────
      const lockerAddr = await factory.tokenToV3Locker(token);
      expect(lockerAddr).to.not.equal(ethers.ZeroAddress);
      expect((await npm.mintRecipient()).toLowerCase()).to.equal(lockerAddr.toLowerCase());
      const locker = await lockerOf(factory, token);
      expect(await locker.tokenId()).to.equal(await npm.lastTokenId());
      expect(await locker.creator()).to.equal(creator.address);
      expect(await locker.platform()).to.equal(treasury.address);
      expect(await locker.creatorSplitBps()).to.equal(5500n);
      expect(await locker.factory()).to.equal(await factory.getAddress());

      // ── split math / no stranded supply: V3 + V4 == full half, exactly ────
      expect(ev("V3PoolSeeded").args.tokenAmount).to.equal(v3Amount);
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF - v3Amount);

      // ── V4 path still works, unchanged ────────────────────────────────────
      expect(await pm.initialized()).to.equal(true);
      expect(await pm.modifyCalled()).to.equal(true);
      expect(await pm.lastFee()).to.equal(0n); // LP_FEE = 0 (fee via hook)
      expect(await pm.lastTickSpacing()).to.equal(60n);
      expect(await pm.lastCurrency0()).to.equal(ethers.ZeroAddress); // native ETH
      expect((await pm.lastHooks()).toLowerCase()).to.equal((await hook.getAddress()).toLowerCase());
      expect(await hook.registered()).to.equal(true);
      expect(await hook.lastFeeBps()).to.equal(150n);
    });
  });

  describe("HoodseaV3Locker (permanent lock, fee-only)", () => {
    it("collect() splits BOTH assets creator/platform by creatorSplitBps (55/45)", async () => {
      const { npm, weth, wethAddr, factory, coll } = await deploy();
      const { token } = await bond(factory, coll);
      const locker = await lockerOf(factory, token);
      const erc = await ethers.getContractAt("MockERC20", token);
      const tokenIs0 = BigInt(token) < BigInt(wethAddr);

      // Pre-load fees the mock pays on collect. Project-token side comes from the NPM's
      // balance (it holds the seeded tokens); fund the WETH side explicitly.
      const tokenFee = 10000n; // creator 5500 / platform 4500
      const wethFee = 20000n; //  creator 11000 / platform 9000
      await weth.transfer(await npm.getAddress(), wethFee);
      if (tokenIs0) await npm.setFees(tokenFee, wethFee);
      else await npm.setFees(wethFee, tokenFee);

      const t0 = tokenIs0 ? token : wethAddr;
      const t1 = tokenIs0 ? wethAddr : token;
      await locker.collect(t0, t1);
      expect(await npm.collectCount()).to.equal(1n);

      expect(await erc.balanceOf(creator.address)).to.equal((tokenFee * 5500n) / 10000n);
      expect(await erc.balanceOf(treasury.address)).to.equal(tokenFee - (tokenFee * 5500n) / 10000n);
      expect(await weth.balanceOf(creator.address)).to.equal((wethFee * 5500n) / 10000n);
      expect(await weth.balanceOf(treasury.address)).to.equal(wethFee - (wethFee * 5500n) / 10000n);
    });

    it("collect() is permissionless (any caller)", async () => {
      const { npm, weth, wethAddr, factory, coll } = await deploy();
      const { token } = await bond(factory, coll);
      const locker = await lockerOf(factory, token);
      const tokenIs0 = BigInt(token) < BigInt(wethAddr);
      await weth.transfer(await npm.getAddress(), 150n);
      await npm.setFees(tokenIs0 ? 0n : 150n, tokenIs0 ? 150n : 0n);
      await expect(locker.connect(kas).collect(tokenIs0 ? token : wethAddr, tokenIs0 ? wethAddr : token))
        .to.not.be.reverted;
    });

    it("has NO principal-withdraw / NFT transfer-out path (liquidity locked forever)", async () => {
      const { factory, coll } = await deploy();
      const { token } = await bond(factory, coll);
      const locker = await lockerOf(factory, token);
      const fns = locker.interface.fragments.filter((f: any) => f.type === "function").map((f: any) => f.name);
      for (const forbidden of ["decreaseLiquidity", "withdraw", "transferFrom", "safeTransferFrom", "transfer", "burn", "unlock", "setFactory"]) {
        expect(fns, `locker must not expose ${forbidden}`).to.not.include(forbidden);
      }
      expect(fns).to.include("collect"); // only fees flow
      expect(fns).to.include("lock");
    });

    it("lock() is factory-only and one-shot", async () => {
      const { factory, coll } = await deploy();
      const { token } = await bond(factory, coll);
      const locker = await lockerOf(factory, token);
      // already locked during bond -> re-lock reverts, and a non-factory caller reverts
      await expect(locker.connect(owner).lock(123n)).to.be.reverted;
    });
  });

  describe("front-run pre-init guard (MEDIUM): createPool reverts on pre-existence", () => {
    it("skips the V3 seed cleanly when the pool already exists; supply folds into V4", async () => {
      const { pm, v3f, npm, factory, coll } = await deploy();
      await v3f.setRevertOnCreate(true); // simulate attacker's pool already existing
      const { token, ev } = await bond(factory, coll);
      expect(token).to.not.equal(ethers.ZeroAddress); // bonding not bricked
      expect(await npm.minted()).to.equal(false); // never minted into someone else's pool
      expect(await factory.tokenToV3Locker(token)).to.equal(ethers.ZeroAddress);
      expect(await pm.initialized()).to.equal(true); // V4 seeded
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF); // full half, no stranded supply
    });
  });

  describe("rounding dust joins the locked fee stream", () => {
    it("leftover the position couldn't take is transferred to the locker", async () => {
      const { npm, wethAddr, factory, coll } = await deploy();
      await npm.setUseFraction(9000n); // position takes 90%, leaves 10% dust
      const { token, ev } = await bond(factory, coll);
      const v3Amount = (HALF * 5000n) / 10000n;
      const used = (v3Amount * 9000n) / 10000n;
      const dust = v3Amount - used;
      const erc = await ethers.getContractAt("MockERC20", token);
      const lockerAddr = await factory.tokenToV3Locker(token);
      expect(await erc.balanceOf(lockerAddr)).to.equal(dust); // dust parked in the locker
      // full v3Amount still left the factory, so V4 gets exactly HALF - v3Amount
      expect(ev("V3PoolSeeded").args.tokenAmount).to.equal(v3Amount);
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF - v3Amount);
    });
  });

  describe("v3SeedBps split knob", () => {
    it("0 = V4-only (V3 skipped, V4 gets full half)", async () => {
      const { pm, npm, factory, coll } = await deploy();
      await factory.connect(owner).setV3SeedBps(0);
      const { token, ev } = await bond(factory, coll);
      expect(await npm.minted()).to.equal(false);
      expect(await pm.initialized()).to.equal(true);
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF);
    });

    it("10000 = V3-only (whole liquidity half to V3, V4 gets 0)", async () => {
      const { npm, wethAddr, factory, coll } = await deploy();
      await factory.connect(owner).setV3SeedBps(10000);
      const { token, ev } = await bond(factory, coll);
      const side = BigInt(token) < BigInt(wethAddr) ? await npm.mintAmount0() : await npm.mintAmount1();
      expect(side).to.equal(HALF); // 500M
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(0n);
    });

    it("custom bps routes the exact carve to V3 and the remainder to V4", async () => {
      const { npm, wethAddr, factory, coll } = await deploy();
      await factory.connect(owner).setV3SeedBps(4000);
      const { token, ev } = await bond(factory, coll);
      const expected = (HALF * 4000n) / 10000n; // 200M
      const side = BigInt(token) < BigInt(wethAddr) ? await npm.mintAmount0() : await npm.mintAmount1();
      expect(side).to.equal(expected);
      expect(ev("V3PoolSeeded").args.tokenAmount).to.equal(expected);
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF - expected);
    });

    it("owner-settable knobs reject > 10000 and non-owner callers", async () => {
      const { factory } = await deploy();
      await expect(factory.connect(owner).setV3SeedBps(10001)).to.be.reverted;
      await expect(factory.connect(owner).setCreatorSplitBps(10001)).to.be.reverted;
      await expect(factory.connect(creator).setV3SeedBps(1)).to.be.reverted;
      await expect(factory.connect(creator).setCreatorSplitBps(1)).to.be.reverted;
    });

    it("setCreatorSplitBps changes the split baked into new lockers", async () => {
      const { factory, coll } = await deploy();
      await factory.connect(owner).setCreatorSplitBps(7000);
      const { token } = await bond(factory, coll);
      const locker = await lockerOf(factory, token);
      expect(await locker.creatorSplitBps()).to.equal(7000n);
    });

    for (const piece of ["factory", "npm", "weth", "deployer"] as const) {
      it(`missing V3 ${piece} => V3 disabled, V4 gets full half`, async () => {
        const { pm, npm, factory, coll } = await deploy({ disable: piece });
        const { token, ev } = await bond(factory, coll);
        expect(token).to.not.equal(ethers.ZeroAddress);
        expect(await npm.minted()).to.equal(false);
        expect(await pm.initialized()).to.equal(true);
        expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF);
      });
    }
  });

  describe("best-effort isolation (a seed failure never bricks bonding, no stranded supply)", () => {
    it("V3 mint revert -> token still deploys, V4 gets the FULL half", async () => {
      const { pm, npm, factory, coll } = await deploy();
      await npm.setRevertOnMint(true);
      const { token, ev } = await bond(factory, coll);
      expect(token).to.not.equal(ethers.ZeroAddress);
      expect(await npm.minted()).to.equal(false);
      expect(await pm.initialized()).to.equal(true);
      expect(ev("V4PoolSeeded").args.tokenAmount).to.equal(HALF);
    });

    it("V4 init revert -> V3 still seeded and locked, token still deploys", async () => {
      const { pm, npm, factory, coll } = await deploy();
      await pm.setRevertOnInit(true);
      const { token } = await bond(factory, coll);
      expect(token).to.not.equal(ethers.ZeroAddress);
      expect(await pm.initialized()).to.equal(false);
      expect(await npm.minted()).to.equal(true);
      const lockerAddr = await factory.tokenToV3Locker(token);
      expect((await npm.mintRecipient()).toLowerCase()).to.equal(lockerAddr.toLowerCase());
    });
  });

  describe("full mint -> bond -> both pools seeded (real launchpad + NFT)", () => {
    it("selling out a token-enabled collection seeds V4 and a locked 1% V3 pool", async function () {
      this.timeout(120000);
      [owner, treasury, kas, vault, creator] = await ethers.getSigners();

      const vaultC = await ethers.deployContract("HoodseaVault", [treasury.address, owner.address]);
      const pm = await ethers.deployContract("MockV4PoolManager");
      const hook = await ethers.deployContract("MockFeeHook");
      const v3f = await ethers.deployContract("MockUniswapV3Factory");
      const npm = await ethers.deployContract("MockNonfungiblePositionManager");
      const weth = await ethers.deployContract("MockERC20", [0n]);
      const deployer = await ethers.deployContract("HoodseaV3LockerDeployer");
      const factory = await ethers.deployContract("HoodseaTokenFactory", [
        treasury.address, await vaultC.getAddress(), kas.address,
        await pm.getAddress(), await hook.getAddress(), ethers.ZeroAddress,
        await v3f.getAddress(), await npm.getAddress(), await weth.getAddress(), await deployer.getAddress(),
      ]);
      const nftDeployer = await ethers.deployContract("HoodseaNFTDeployer", []);
      const launchpad = await ethers.deployContract("HoodseaLaunchpad", [
        treasury.address, await vaultC.getAddress(), kas.address,
        await factory.getAddress(), await nftDeployer.getAddress(),
      ]);
      await nftDeployer.setLaunchpad(await launchpad.getAddress());

      const now = Math.floor(Date.now() / 1000);
      const FAR = now + 60 * 86400;
      const params = {
        name: "Creator", ticker: "TOKN", bio: "bio",
        photoURIs: ["ipfs://a", "ipfs://b", "ipfs://c", "", "", ""], photoCount: 3,
        socialX: "", socialGithub: "", socialFarcaster: "",
        mintPriceWei: 0n, tokenEnabled: true, tokenFeeBps: 150n,
        decaySeconds: 0n, feeReceiveType: 0,
        startMcPairWei: ethers.parseEther("3"), pairIsUSDC: false,
        phaseRoots: [ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash] as [string, string, string, string],
        phaseStarts: [now, FAR, FAR + 100, FAR + 200] as [number, number, number, number],
        phaseEnds: [FAR, FAR + 100, FAR + 200, FAR + 300] as [number, number, number, number],
        phaseMaxPerWallet: [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint],
        allowlistCID: "", maxSupply: 10n,
      };
      const tx = await launchpad.connect(creator).launchCollection(params);
      const rc = await tx.wait();
      const evc = rc!.logs.map((l) => { try { return launchpad.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "CollectionLaunched");
      const collection = (evc as any).args.collection as string;
      const nft = await ethers.getContractAt("HoodseaNFT", collection);

      await nft.connect(creator).mint(10n, [], { value: 0, gasLimit: 20_000_000 });

      const info = await nft.getCollectionInfo();
      expect(info.bondingComplete).to.equal(true);
      expect(info.tokenAddress).to.not.equal(ethers.ZeroAddress);

      // both pools seeded; V3 NFT locked in a per-token locker with creator == launcher
      expect(await pm.initialized()).to.equal(true);
      expect(await npm.minted()).to.equal(true);
      const lockerAddr = await factory.tokenToV3Locker(info.tokenAddress);
      expect(lockerAddr).to.not.equal(ethers.ZeroAddress);
      expect((await npm.mintRecipient()).toLowerCase()).to.equal(lockerAddr.toLowerCase());
      const locker = await ethers.getContractAt("HoodseaV3Locker", lockerAddr);
      expect(await locker.creator()).to.equal(creator.address);
      expect(await locker.tokenId()).to.equal(await npm.lastTokenId());

      const v3Amount = (HALF * 5000n) / 10000n;
      const erc = await ethers.getContractAt("MockERC20", info.tokenAddress);
      expect(await erc.balanceOf(await npm.getAddress())).to.equal(v3Amount);
    });
  });
});
