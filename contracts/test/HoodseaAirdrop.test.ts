import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HoodseaAirdrop, MockERC20 } from "../typechain-types";

const E = (n: string | number) => ethers.parseEther(String(n));

function buildTree(entries: [string, bigint][]) {
  return StandardMerkleTree.of(entries.map(([a, amt]) => [a, amt.toString()]), ["address", "uint256"]);
}
function proofFor(tree: StandardMerkleTree<any>, account: string) {
  for (const [i, v] of tree.entries()) {
    if ((v[0] as string).toLowerCase() === account.toLowerCase()) return tree.getProof(i);
  }
  throw new Error("not in tree");
}

describe("HoodseaAirdrop", () => {
  let drop: HoodseaAirdrop;
  let token: MockERC20;       // airdropped token
  let gate: MockERC20;        // gate token for FCFS
  let creator: SignerWithAddress, a: SignerWithAddress, b: SignerWithAddress, c: SignerWithAddress;
  let future: number;

  beforeEach(async () => {
    [creator, a, b, c] = await ethers.getSigners();
    const T = await ethers.getContractFactory("MockERC20");
    token = await T.connect(creator).deploy(E(1_000_000)) as any;
    gate = await T.connect(creator).deploy(E(1_000_000)) as any;
    const D = await ethers.getContractFactory("HoodseaAirdrop");
    drop = await D.deploy() as any;
    future = (await time.latest()) + 7 * 86400;
  });

  // -------------------------------------------------------------- MERKLE
  describe("merkle campaign", () => {
    it("eligible accounts claim their exact amount, double-claim blocked", async () => {
      const tree = buildTree([[a.address, E(100)], [b.address, E(200)]]);
      await token.connect(creator).approve(await drop.getAddress(), E(300));
      await drop.connect(creator).createMerkleCampaign(await token.getAddress(), tree.root, E(300), future);

      await drop.connect(a).claimMerkle(0, E(100), proofFor(tree, a.address));
      expect(await token.balanceOf(a.address)).to.equal(E(100));
      expect((await drop.campaigns(0)).remaining).to.equal(E(200));

      await expect(drop.connect(a).claimMerkle(0, E(100), proofFor(tree, a.address)))
        .to.be.revertedWithCustomError(drop, "AlreadyClaimed");

      await drop.connect(b).claimMerkle(0, E(200), proofFor(tree, b.address));
      expect((await drop.campaigns(0)).remaining).to.equal(0);
    });

    it("rejects wrong amount and forged proof", async () => {
      const tree = buildTree([[a.address, E(100)]]);
      await token.connect(creator).approve(await drop.getAddress(), E(100));
      await drop.connect(creator).createMerkleCampaign(await token.getAddress(), tree.root, E(100), future);
      // right proof, wrong amount -> proof no longer verifies
      await expect(drop.connect(a).claimMerkle(0, E(101), proofFor(tree, a.address)))
        .to.be.revertedWithCustomError(drop, "BadProof");
      // someone not in the tree
      await expect(drop.connect(c).claimMerkle(0, E(100), proofFor(tree, a.address)))
        .to.be.revertedWithCustomError(drop, "BadProof");
    });
  });

  // -------------------------------------------------------------- FCFS
  describe("fcfs campaign", () => {
    it("hands out fixed amount first-come until the pool empties", async () => {
      await token.connect(creator).approve(await drop.getAddress(), E(100));
      await drop.connect(creator).createFcfsCampaign(await token.getAddress(), E(50), E(100), ethers.ZeroAddress, 0, future);

      await drop.connect(a).claimFcfs(0);
      await drop.connect(b).claimFcfs(0);
      expect(await token.balanceOf(a.address)).to.equal(E(50));
      expect(await token.balanceOf(b.address)).to.equal(E(50));
      await expect(drop.connect(c).claimFcfs(0)).to.be.revertedWithCustomError(drop, "PoolEmpty");
      await expect(drop.connect(a).claimFcfs(0)).to.be.revertedWithCustomError(drop, "AlreadyClaimed");
    });

    it("enforces the optional holder gate", async () => {
      await gate.connect(creator).transfer(a.address, E(5));
      await token.connect(creator).approve(await drop.getAddress(), E(100));
      await drop.connect(creator).createFcfsCampaign(await token.getAddress(), E(50), E(100), await gate.getAddress(), E(1), future);

      await drop.connect(a).claimFcfs(0);
      expect(await token.balanceOf(a.address)).to.equal(E(50));
      await expect(drop.connect(c).claimFcfs(0)).to.be.revertedWithCustomError(drop, "NotEligible");
    });
  });

  // -------------------------------------------------------------- expiry + sweep
  describe("expiry and sweep", () => {
    it("blocks claims after expiry; only creator sweeps leftover after expiry, once", async () => {
      await token.connect(creator).approve(await drop.getAddress(), E(100));
      await drop.connect(creator).createFcfsCampaign(await token.getAddress(), E(50), E(100), ethers.ZeroAddress, 0, future);
      await drop.connect(a).claimFcfs(0); // remaining 50

      await expect(drop.connect(creator).sweep(0)).to.be.revertedWithCustomError(drop, "NotExpired");

      await time.increaseTo(future + 1);
      await expect(drop.connect(b).claimFcfs(0)).to.be.revertedWithCustomError(drop, "Expired");
      await expect(drop.connect(a).sweep(0)).to.be.revertedWithCustomError(drop, "NotCreator");

      const before = await token.balanceOf(creator.address);
      await drop.connect(creator).sweep(0);
      expect(await token.balanceOf(creator.address)).to.equal(before + E(50));
      await expect(drop.connect(creator).sweep(0)).to.be.revertedWithCustomError(drop, "AlreadySwept");
    });
  });

  // -------------------------------------------------------------- isolation
  it("campaigns sharing a token are isolated (one cannot drain another)", async () => {
    const tree = buildTree([[a.address, E(100)]]);
    await token.connect(creator).approve(await drop.getAddress(), E(400));
    await drop.connect(creator).createMerkleCampaign(await token.getAddress(), tree.root, E(100), future); // id 0
    await drop.connect(creator).createFcfsCampaign(await token.getAddress(), E(50), E(300), ethers.ZeroAddress, 0, future); // id 1

    await drop.connect(a).claimMerkle(0, E(100), proofFor(tree, a.address));
    expect((await drop.campaigns(0)).remaining).to.equal(0);
    expect((await drop.campaigns(1)).remaining).to.equal(E(300)); // untouched
  });

  // -------------------------------------------------------------- views
  it("eligibility views match claim behavior", async () => {
    const tree = buildTree([[a.address, E(100)]]);
    await token.connect(creator).approve(await drop.getAddress(), E(150));
    await drop.connect(creator).createMerkleCampaign(await token.getAddress(), tree.root, E(100), future); // id 0
    await drop.connect(creator).createFcfsCampaign(await token.getAddress(), E(50), E(50), ethers.ZeroAddress, 0, future); // id 1

    expect(await drop.merkleEligible(0, a.address, E(100), proofFor(tree, a.address))).to.equal(true);
    expect(await drop.merkleEligible(0, c.address, E(100), proofFor(tree, a.address))).to.equal(false);

    let [ok, amt] = await drop.fcfsEligible(1, a.address);
    expect(ok).to.equal(true); expect(amt).to.equal(E(50));
    await drop.connect(a).claimFcfs(1);
    [ok, amt] = await drop.fcfsEligible(1, a.address);
    expect(ok).to.equal(false);
  });

  // -------------------------------------------------------------- security hardening (audit 2026-06-23)
  describe("security hardening", () => {
    it("fee-on-transfer: credits ACTUAL received, never over-credits the pool", async () => {
      const F = await ethers.getContractFactory("MockFeeToken");
      const fee = await F.connect(creator).deploy(E(1_000_000), 100) as any; // 1% fee
      const tree = buildTree([[a.address, E(100)]]);
      await fee.connect(creator).approve(await drop.getAddress(), E(300));
      await drop.connect(creator).createMerkleCampaign(await fee.getAddress(), tree.root, E(300), future);

      // sent 300, 1% burned -> contract received 297; campaign credited 297, not 300
      expect((await drop.campaigns(0)).deposited).to.equal(E(297));
      expect(await fee.balanceOf(await drop.getAddress())).to.equal(E(297));

      // claim 100: contract sends 100 (1% burned), claimer nets 99; remaining drops by the nominal 100
      await drop.connect(a).claimMerkle(0, E(100), proofFor(tree, a.address));
      expect(await fee.balanceOf(a.address)).to.equal(E(99));
      expect((await drop.campaigns(0)).remaining).to.equal(E(197));
      // invariant: contract balance still equals remaining (no cross-campaign shortfall)
      expect(await fee.balanceOf(await drop.getAddress())).to.equal((await drop.campaigns(0)).remaining);
    });

    it("reentrancy: a malicious token cannot re-enter to drain a second payout", async () => {
      const R = await ethers.getContractFactory("MockReentrantToken");
      const evil = await R.connect(creator).deploy(E(1_000_000)) as any;
      await evil.connect(creator).approve(await drop.getAddress(), E(100));
      await drop.connect(creator).createFcfsCampaign(await evil.getAddress(), E(50), E(100), ethers.ZeroAddress, 0, future);
      await evil.arm(await drop.getAddress(), 0); // re-enter during the next payout

      await drop.connect(a).claimFcfs(0);

      expect(await evil.reentryAttempts()).to.equal(1n);
      expect(await evil.reentryBlocked()).to.equal(true);      // guard rejected the re-entry
      expect(await evil.balanceOf(a.address)).to.equal(E(50)); // exactly one payout
      expect((await drop.campaigns(0)).remaining).to.equal(E(50)); // not drained twice
      expect(await evil.balanceOf(await drop.getAddress())).to.equal(E(50));
    });

    it("under-funded merkle: later claimants revert InsufficientPool (documented)", async () => {
      const tree = buildTree([[a.address, E(100)], [b.address, E(100)]]); // sum 200
      await token.connect(creator).approve(await drop.getAddress(), E(150)); // only 150 funded
      await drop.connect(creator).createMerkleCampaign(await token.getAddress(), tree.root, E(150), future);

      await drop.connect(a).claimMerkle(0, E(100), proofFor(tree, a.address)); // remaining 50
      await expect(drop.connect(b).claimMerkle(0, E(100), proofFor(tree, b.address)))
        .to.be.revertedWithCustomError(drop, "InsufficientPool");
    });

    it("FCFS balanceOf gate is not Sybil-proof: moving the gate token lets another wallet claim (documented)", async () => {
      await gate.connect(creator).transfer(a.address, E(5));
      await token.connect(creator).approve(await drop.getAddress(), E(100));
      await drop.connect(creator).createFcfsCampaign(await token.getAddress(), E(50), E(100), await gate.getAddress(), E(1), future);

      await drop.connect(a).claimFcfs(0);            // a holds the gate -> ok
      await gate.connect(a).transfer(c.address, E(5)); // pass the same gate balance along
      await drop.connect(c).claimFcfs(0);            // c now holds it -> also claims
      expect((await drop.campaigns(0)).remaining).to.equal(0); // both claimed off one gate balance
    });
  });
});
