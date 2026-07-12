import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HoodseaLaunchpad, HoodseaNFTDeployer, MockTokenFactory, HoodseaVault, HoodseaNFT, HoodseaFeeSplitter } from "../typechain-types";

// EIP-2981 + OpenSea contractURI + four-way royalty splitter (creator 100 / platform
// 20 / kas 20 / airdrop 10 of 150, identical to HoodseaFeeSplitter's swap-fee split).
// Revert strings are stripped (debug.revertStrings: "strip"), so failures assert with
// .reverted, not .revertedWith("...").
describe("HoodseaNFT royalties + contractURI (OpenSea)", () => {
  let launchpad: HoodseaLaunchpad;
  let vault: HoodseaVault;
  let nftDeployer: HoodseaNFTDeployer;
  let mockFactory: MockTokenFactory;
  let owner: SignerWithAddress;   // launchpad owner
  let platform: SignerWithAddress;
  let kas: SignerWithAddress;
  let creator: SignerWithAddress;
  let user: SignerWithAddress;

  const ERC2981_ID = "0x2a55205a";
  const ERC1155_ID = "0xd9b67a26";
  const ERC165_ID = "0x01ffc9a7";
  const BAD_ID = "0xffffffff";

  const defaultPhotos: [string, string, string, string, string, string] = [
    "ipfs://photoA", "ipfs://photoB", "ipfs://photoC", "", "", ""
  ];
  const zeroRoot = ethers.ZeroHash;

  function makeParams(overrides: Partial<{ name: string; ticker: string; bio: string; maxSupply: bigint }> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const p0end = now + 60 * 86400;
    return {
      name: overrides.name ?? "Cool Creator",
      ticker: overrides.ticker ?? "COOL",
      bio: overrides.bio ?? "The best collection",
      photoURIs: defaultPhotos,
      photoCount: 3,
      socialX: "@cool",
      socialGithub: "coolgh",
      socialFarcaster: "coolfc",
      mintPriceWei: 0n,
      tokenEnabled: false,
      tokenFeeBps: 0n,
      decaySeconds: 0n,
      feeReceiveType: 0,
      startMcPairWei: 0n,
      pairIsUSDC: false,
      phaseRoots: [zeroRoot, zeroRoot, zeroRoot, zeroRoot] as [string, string, string, string],
      phaseStarts: [now, p0end, p0end + 100, p0end + 200] as [number, number, number, number],
      phaseEnds: [p0end, p0end + 100, p0end + 200, p0end + 300] as [number, number, number, number],
      phaseMaxPerWallet: [0n, 0n, 0n, 0n] as [bigint, bigint, bigint, bigint],
      allowlistCID: "",
      maxSupply: overrides.maxSupply ?? 100n,
    };
  }

  async function launch(params = makeParams()): Promise<{ nft: HoodseaNFT; splitter: HoodseaFeeSplitter }> {
    const tx = await launchpad.connect(creator).launchCollection(params);
    const rc = await tx.wait();
    const parsed = rc!.logs
      .map((l) => { try { return launchpad.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "CollectionLaunched");
    const collection = (parsed as any).args.collection as string;
    const nft = (await ethers.getContractAt("HoodseaNFT", collection)) as unknown as HoodseaNFT;
    const splitterAddr = await nft.royaltyReceiver();
    const splitter = (await ethers.getContractAt("HoodseaFeeSplitter", splitterAddr)) as unknown as HoodseaFeeSplitter;
    return { nft, splitter };
  }

  beforeEach(async () => {
    [owner, platform, kas, creator, user] = await ethers.getSigners();

    // vault is the shared airdrop sink (has receive()).
    vault = await ethers.deployContract("HoodseaVault", [owner.address, owner.address]);
    mockFactory = await ethers.deployContract("MockTokenFactory", [
      platform.address, await vault.getAddress(), kas.address
    ]);
    nftDeployer = await ethers.deployContract("HoodseaNFTDeployer", []);
    launchpad = await ethers.deployContract("HoodseaLaunchpad", [
      platform.address,            // platformTreasury
      await vault.getAddress(),    // airdropVault
      kas.address,                 // kasWallet
      await mockFactory.getAddress(),
      await nftDeployer.getAddress(),
    ]);
    await nftDeployer.setLaunchpad(await launchpad.getAddress());
  });

  describe("supportsInterface", () => {
    it("advertises ERC-2981 (0x2a55205a), ERC-1155 and ERC-165, not garbage", async () => {
      const { nft } = await launch();
      expect(await nft.supportsInterface(ERC2981_ID)).to.equal(true);
      expect(await nft.supportsInterface(ERC1155_ID)).to.equal(true);
      expect(await nft.supportsInterface(ERC165_ID)).to.equal(true);
      expect(await nft.supportsInterface(BAD_ID)).to.equal(false);
    });
  });

  describe("royaltyInfo (EIP-2981)", () => {
    it("returns the splitter receiver and salePrice * 500 / 10000 (5% default)", async () => {
      const { nft, splitter } = await launch();
      expect(await nft.royaltyBps()).to.equal(500n);
      const salePrice = ethers.parseEther("2");
      const [receiver, amount] = await nft.royaltyInfo(1n, salePrice);
      expect(receiver).to.equal(await splitter.getAddress());
      expect(amount).to.equal((salePrice * 500n) / 10000n); // 0.1 ETH
    });

    it("tracks royaltyBps after the creator changes it", async () => {
      const { nft } = await launch();
      await nft.connect(creator).setRoyaltyBps(750n);
      const salePrice = ethers.parseEther("1");
      const [, amount] = await nft.royaltyInfo(42n, salePrice);
      expect(amount).to.equal((salePrice * 750n) / 10000n);
    });
  });

  describe("setRoyaltyBps (bounded + onlyOwner)", () => {
    it("owner/creator can set within the 1000 (10%) cap", async () => {
      const { nft } = await launch();
      await nft.connect(creator).setRoyaltyBps(1000n);
      expect(await nft.royaltyBps()).to.equal(1000n);
    });
    it("reverts above MAX_ROYALTY_BPS (1000)", async () => {
      const { nft } = await launch();
      await expect(nft.connect(creator).setRoyaltyBps(1001n)).to.be.reverted;
    });
    it("reverts for a non-owner", async () => {
      const { nft } = await launch();
      await expect(nft.connect(user).setRoyaltyBps(600n)).to.be.reverted;
    });
  });

  describe("royalty receiver = HoodseaFeeSplitter with the four collection addresses", () => {
    it("wires creator / platform / kas / airdrop(vault) and ETH-only mode", async () => {
      const { splitter } = await launch();
      expect(await splitter.creator()).to.equal(creator.address);
      expect(await splitter.platform()).to.equal(platform.address);
      expect(await splitter.kas()).to.equal(kas.address);
      expect(await splitter.airdrop()).to.equal(await vault.getAddress());
      expect(await splitter.feeReceiveType()).to.equal(0n); // ETH only, no buyback
      expect(await splitter.router()).to.equal(ethers.ZeroAddress);
    });

    it("distribute() splits royalty ETH 100/20/20/10 of 150 (matches swap-fee split)", async () => {
      const { splitter } = await launch();
      const splitterAddr = await splitter.getAddress();
      const vaultAddr = await vault.getAddress();

      // Send 1.5 ETH of royalties into the splitter, then release.
      const amount = ethers.parseEther("1.5");
      await user.sendTransaction({ to: splitterAddr, value: amount });

      const before = {
        creator: await ethers.provider.getBalance(creator.address),
        platform: await ethers.provider.getBalance(platform.address),
        kas: await ethers.provider.getBalance(kas.address),
        vault: await ethers.provider.getBalance(vaultAddr),
      };

      // Called by `user` so gas never touches the four recipients' balances.
      await splitter.connect(user).distribute();

      const dCreator = (await ethers.provider.getBalance(creator.address)) - before.creator;
      const dPlatform = (await ethers.provider.getBalance(platform.address)) - before.platform;
      const dKas = (await ethers.provider.getBalance(kas.address)) - before.kas;
      const dVault = (await ethers.provider.getBalance(vaultAddr)) - before.vault;

      // 150 -> creator 100 / platform 20 / kas 20 / airdrop 10
      expect(dCreator).to.equal((amount * 100n) / 150n); // 1.0 ETH
      expect(dPlatform).to.equal((amount * 20n) / 150n); // 0.2 ETH
      expect(dVault).to.equal((amount * 10n) / 150n);    // 0.1 ETH (airdrop)
      expect(dKas).to.equal(amount - dCreator - dPlatform - dVault); // remainder ~0.2 ETH
      // Everything left the splitter.
      expect(await ethers.provider.getBalance(splitterAddr)).to.equal(0n);
    });
  });

  describe("contractURI (OpenSea collection metadata)", () => {
    it("returns a base64 JSON data URI with name/description/image", async () => {
      const { nft } = await launch(makeParams({ name: "My Gallery", bio: "Fine on-chain art" }));
      const uri = await nft.contractURI();
      expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
      const b64 = uri.slice("data:application/json;base64,".length);
      const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
      expect(json.name).to.equal("My Gallery");
      expect(json.description).to.equal("Fine on-chain art");
      expect(json.image).to.equal("ipfs://photoA"); // first photo
    });
  });

  describe("launch -> mint still works with royalties wired", () => {
    it("mints an NFT after launch (no regression)", async () => {
      const { nft } = await launch();
      await nft.connect(user).mint(1n, [], { value: 0 });
      expect(await nft.totalMinted()).to.equal(1n);
      expect(await nft.balanceOf(user.address, 1n)).to.equal(1n);
    });
  });
});
