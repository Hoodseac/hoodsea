import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HoodseaLaunchpad, HoodseaNFTDeployer, MockTokenFactory, HoodseaVault } from "../typechain-types";

// NOTE: the compiler strips revert-reason strings (debug.revertStrings: "strip" in
// hardhat.config.ts, needed to keep HoodseaNFT under the EIP-170 size cap), so
// require-failures are asserted with .reverted, not .revertedWith("...").
describe("HoodseaLaunchpad", () => {
  let launchpad: HoodseaLaunchpad;
  let vault: HoodseaVault;
  let nftDeployer: HoodseaNFTDeployer;
  let mockFactory: MockTokenFactory;
  let owner: SignerWithAddress;
  let treasury: SignerWithAddress;
  let creator: SignerWithAddress;
  let user: SignerWithAddress;

  const defaultPhotos: [string, string, string, string, string, string] = [
    "ipfs://photo1", "ipfs://photo2", "ipfs://photo3", "", "", ""
  ];
  const zeroRoot = ethers.ZeroHash;

  function makeParams(overrides: Partial<{
    name: string; ticker: string; photoCount: number; mintPriceWei: bigint;
    maxSupply: bigint; wideWindow: boolean;
  }> = {}) {
    const now = Math.floor(Date.now() / 1000);
    // wideWindow keeps phase 0 open for 60 days so a long mint-to-sellout run
    // (many batched txs, advancing block timestamps) never expires mid-test.
    const p0end = overrides.wideWindow ? now + 60 * 86400 : now + 100;
    return {
      name: overrides.name ?? "Test Creator",
      ticker: overrides.ticker ?? "TEST",
      bio: "A test bio",
      photoURIs: defaultPhotos,
      photoCount: overrides.photoCount ?? 3,
      socialX: "@test",
      socialGithub: "testgithub",
      socialFarcaster: "testfarc",
      mintPriceWei: overrides.mintPriceWei ?? 0n,
      tokenEnabled: false,
      tokenFeeBps: 0n,
      decaySeconds: 0n,
      feeReceiveType: 0,
      startMcPairWei: 0n,
      pairIsUSDC: false,
      phaseRoots: [zeroRoot, zeroRoot, zeroRoot, zeroRoot] as [string, string, string, string],
      // Phases must be sequential and non-overlapping (setupPhases enforces
      // start[i] < end[i] and start[i] >= end[i-1]).
      phaseStarts: [now, p0end, p0end + 100, p0end + 200] as [number, number, number, number],
      phaseEnds: [p0end, p0end + 100, p0end + 200, p0end + 300] as [number, number, number, number],
      phaseMaxPerWallet: [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint],
      allowlistCID: "",
      maxSupply: overrides.maxSupply ?? 100n,
    };
  }

  beforeEach(async () => {
    [owner, treasury, creator, user] = await ethers.getSigners();

    vault = await ethers.deployContract("HoodseaVault", [treasury.address, owner.address]);
    mockFactory = await ethers.deployContract("MockTokenFactory", [
      treasury.address, await vault.getAddress(), treasury.address
    ]);
    nftDeployer = await ethers.deployContract("HoodseaNFTDeployer", []);
    launchpad = await ethers.deployContract("HoodseaLaunchpad", [
      treasury.address,
      await vault.getAddress(),
      treasury.address, // kasWallet
      await mockFactory.getAddress(),
      await nftDeployer.getAddress(),
    ]);
    await nftDeployer.setLaunchpad(await launchpad.getAddress());
  });

  describe("launchCollection", () => {
    it("deploys NFT and registers collection", async () => {
      await launchpad.connect(creator).launchCollection(makeParams());

      const collections = await launchpad.getAllCollections();
      expect(collections.length).to.equal(1);
      expect(await launchpad.isCollection(collections[0])).to.be.true;
    });

    it("emits CollectionLaunched event", async () => {
      const params = makeParams({ name: "MyCreator", ticker: "MYC" });
      await expect(launchpad.connect(creator).launchCollection(params))
        .to.emit(launchpad, "CollectionLaunched")
        .withArgs(
          (v: string) => v !== ethers.ZeroAddress,
          creator.address,
          "MyCreator",
          "MYC",
          0n,
          (v: bigint) => v > 0n
        );
    });

    it("registers collection under creator", async () => {
      await launchpad.connect(creator).launchCollection(makeParams());
      const creatorColls = await launchpad.getCreatorCollections(creator.address);
      expect(creatorColls.length).to.equal(1);
    });

    it("reverts with < 3 photos", async () => {
      await expect(
        launchpad.connect(creator).launchCollection(makeParams({ photoCount: 2 }))
      ).to.be.reverted;
    });

    it("reverts with > 6 photos", async () => {
      await expect(
        launchpad.connect(creator).launchCollection(makeParams({ photoCount: 7 }))
      ).to.be.reverted;
    });

    it("reverts with empty name", async () => {
      await expect(
        launchpad.connect(creator).launchCollection(makeParams({ name: "" }))
      ).to.be.reverted;
    });

    it("reverts with empty ticker", async () => {
      await expect(
        launchpad.connect(creator).launchCollection(makeParams({ ticker: "" }))
      ).to.be.reverted;
    });

    it("multiple creators each have own collections", async () => {
      await launchpad.connect(creator).launchCollection(makeParams({ name: "A", ticker: "AAA" }));
      await launchpad.connect(user).launchCollection(makeParams({ name: "B", ticker: "BBB" }));

      expect(await launchpad.getCreatorCollections(creator.address)).to.have.length(1);
      expect(await launchpad.getCreatorCollections(user.address)).to.have.length(1);
      expect(await launchpad.getAllCollections()).to.have.length(2);
      expect(await launchpad.getCollectionCount()).to.equal(2n);
    });
  });

  describe("getPlatformFeeETH", () => {
    it("defaults to 0 and is owner-settable", async () => {
      expect(await launchpad.getPlatformFeeETH()).to.equal(0n);
      await launchpad.connect(owner).setPlatformFee(ethers.parseEther("0.0003"));
      expect(await launchpad.getPlatformFeeETH()).to.equal(ethers.parseEther("0.0003"));
      await expect(launchpad.connect(creator).setPlatformFee(1n)).to.be.reverted;
    });
  });

  describe("updateAddresses", () => {
    it("owner can update platform addresses", async () => {
      await launchpad.connect(owner).updateAddresses(
        user.address, user.address, user.address, await mockFactory.getAddress()
      );
      expect(await launchpad.platformTreasury()).to.equal(user.address);
    });

    it("non-owner cannot update", async () => {
      await expect(
        launchpad.connect(creator).updateAddresses(
          user.address, user.address, user.address, await mockFactory.getAddress()
        )
      ).to.be.reverted;
    });
  });

  // ─── Creator-settable supply (10..10000) ────────────────────────────────────
  describe("configurable supply", () => {
    // Expected scaled rarity counts for a given N, mirroring _revealShuffle:
    // rarer tiers floor-scaled from the per-100 ratio [46,30,15,5,1,3]
    // ([Common,Uncommon,Rare,Epic,Legendary,Mythic]); Common absorbs the remainder.
    function expectedCounts(n: number): number[] {
      const uncommon = Math.floor((30 * n) / 100);
      const rare = Math.floor((15 * n) / 100);
      const epic = Math.floor((5 * n) / 100);
      const legendary = Math.floor((1 * n) / 100);
      const mythic = Math.floor((3 * n) / 100);
      const common = n - (uncommon + rare + epic + legendary + mythic);
      return [common, uncommon, rare, epic, legendary, mythic];
    }

    // Launch an NFT-only collection of size n, mint to sellout in batches, reveal,
    // and return { nft, revealGas, counts } where counts is the tallied rarity
    // distribution decoded straight from packedRarity storage.
    async function launchSelloutReveal(n: number, batch = 250) {
      const params = makeParams({ ticker: "S" + n, maxSupply: BigInt(n), wideWindow: true });
      const tx = await launchpad.connect(creator).launchCollection(params);
      const rc = await tx.wait();
      const parsed = rc!.logs
        .map((l) => { try { return launchpad.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "CollectionLaunched");
      const collection = (parsed as any).args.collection as string;
      const nft = await ethers.getContractAt("HoodseaNFT", collection);

      expect(await nft.maxSupply()).to.equal(BigInt(n));

      // mint to sellout in batches (mintPrice + platformFee = 0 -> free).
      let minted = 0;
      while (minted < n) {
        const q = Math.min(batch, n - minted);
        await nft.connect(user).mint(q, [], { value: 0, gasLimit: 20_000_000 });
        minted += q;
      }
      expect(await nft.totalMinted()).to.equal(BigInt(n));
      const inf = await nft.getCollectionInfo();
      expect(inf.bondingComplete).to.equal(true); // bonding triggered at sellout

      // advance past REVEAL_DELAY (bondingBlock + 5) then reveal (permissionless)
      await ethers.provider.send("hardhat_mine", ["0x10"]); // 16 blocks
      // Explicit gasLimit: the whole-supply shuffle+pack is one tx. Measured ~18.85M
      // gas at N=10000, which a wallet must provision (trivial vs this chain's
      // ~1.1e15 block gas limit). auto-estimate under-provisions it in EDR.
      const rtx = await nft.revealRarities({ gasLimit: 40_000_000 });
      const rrc = await rtx.wait();
      expect(await nft.isRevealed()).to.equal(true);

      // Decode rarities straight from packedRarity storage (85 entries/word, 3 bits
      // each) — far cheaper than N eth_calls, and it also validates the packing.
      const perWord = 85;
      const words = Math.ceil(n / perWord);
      const packed: bigint[] = [];
      for (let w = 0; w < words; w++) packed.push(await nft.packedRarity(w));
      const counts = [0, 0, 0, 0, 0, 0];
      for (let pos = 0; pos < n; pos++) {
        const w = Math.floor(pos / perWord);
        const shift = BigInt((pos % perWord) * 3);
        const val = Number((packed[w] >> shift) & 7n);
        counts[val]++;
      }
      return { nft, revealGas: rrc!.gasUsed, counts };
    }

    it("supply out of range reverts (9 too low, 10001 too high)", async () => {
      await expect(launchpad.connect(creator).launchCollection(makeParams({ maxSupply: 9n }))).to.be.reverted;
      await expect(launchpad.connect(creator).launchCollection(makeParams({ maxSupply: 10001n }))).to.be.reverted;
    });

    it("accepts the min (10) and max (10000) bounds at launch", async () => {
      await launchpad.connect(creator).launchCollection(makeParams({ ticker: "MIN", maxSupply: 10n }));
      await launchpad.connect(creator).launchCollection(makeParams({ ticker: "MAX", maxSupply: 10000n }));
      const cols = await launchpad.getAllCollections();
      expect(await (await ethers.getContractAt("HoodseaNFT", cols[0])).maxSupply()).to.equal(10n);
      expect(await (await ethers.getContractAt("HoodseaNFT", cols[1])).maxSupply()).to.equal(10000n);
    });

    it("supply = 10 (min): sells out, rarity sums to N, reveal completes", async function () {
      this.timeout(120000);
      const { counts } = await launchSelloutReveal(10, 10);
      expect(counts.reduce((a, b) => a + b, 0)).to.equal(10);
      expect(counts).to.deep.equal(expectedCounts(10)); // [6,3,1,0,0,0]
    });

    it("supply = 100 (regression): exact original distribution [46,30,15,5,1,3]", async () => {
      const { counts } = await launchSelloutReveal(100, 100);
      expect(counts.reduce((a, b) => a + b, 0)).to.equal(100);
      expect(counts).to.deep.equal([46, 30, 15, 5, 1, 3]);
    });

    it("supply = 1000: sells out, rarity sums to N, ratios preserved", async () => {
      const { counts } = await launchSelloutReveal(1000);
      expect(counts.reduce((a, b) => a + b, 0)).to.equal(1000);
      expect(counts).to.deep.equal(expectedCounts(1000)); // [460,300,150,50,10,30]
    });

    it("supply = 10000 (max): sells out, reveal completes in one tx, sums to N", async function () {
      this.timeout(300000);
      const { nft, revealGas, counts } = await launchSelloutReveal(10000);
      expect(counts.reduce((a, b) => a + b, 0)).to.equal(10000);
      expect(counts).to.deep.equal(expectedCounts(10000)); // [4600,3000,1500,500,100,300]
      // packedRarity length = ceil(10000/85) = 118 words
      await expect(nft.packedRarity(117)).to.not.be.reverted;
      // Spot-check getRarity() agrees with the decoded packing for a few token ids.
      const perWord = 85;
      const words: bigint[] = [];
      for (let w = 0; w < 118; w++) words.push(await nft.packedRarity(w));
      for (const tid of [1, 85, 86, 5000, 10000]) {
        const pos = tid - 1;
        const decoded = Number((words[Math.floor(pos / perWord)] >> BigInt((pos % perWord) * 3)) & 7n);
        expect(Number(await nft.getRarity(tid))).to.equal(decoded);
      }
      console.log(`      [gas] revealRarities() for N=10000: ${revealGas.toString()} gas`);
    });
  });
});
