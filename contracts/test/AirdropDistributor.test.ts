import { expect } from "chai";
import { ethers } from "hardhat";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { AirdropDistributor, MockERC20 } from "../typechain-types";

// Build a cumulative tree the same way the oracle will: leaves are [address, cumulativeAmount].
function buildTree(entries: [string, bigint][]) {
  return StandardMerkleTree.of(
    entries.map(([a, amt]) => [a, amt.toString()]),
    ["address", "uint256"]
  );
}
function proofFor(tree: StandardMerkleTree<any>, account: string) {
  for (const [i, v] of tree.entries()) {
    if ((v[0] as string).toLowerCase() === account.toLowerCase()) return tree.getProof(i);
  }
  throw new Error("not in tree");
}

describe("AirdropDistributor", () => {
  let dist: AirdropDistributor;
  let token: MockERC20;
  let owner: SignerWithAddress, oracle: SignerWithAddress, vault: SignerWithAddress;
  let a: SignerWithAddress, b: SignerWithAddress, c: SignerWithAddress;

  beforeEach(async () => {
    [owner, oracle, vault, a, b, c] = await ethers.getSigners();
    const D = await ethers.getContractFactory("AirdropDistributor");
    dist = await D.deploy(owner.address, oracle.address);
    const T = await ethers.getContractFactory("MockERC20");
    token = await T.deploy(ethers.parseEther("1000000"));
    await dist.connect(owner).setVault(vault.address);
    // fund the pool: vault gets tokens then funds via approve+fund
    await token.transfer(vault.address, ethers.parseEther("100000"));
    await token.connect(vault).approve(await dist.getAddress(), ethers.MaxUint256);
    await dist.connect(vault).fund(await token.getAddress(), ethers.parseEther("100000"));
  });

  it("funds only from the vault", async () => {
    await token.transfer(a.address, ethers.parseEther("10"));
    await token.connect(a).approve(await dist.getAddress(), ethers.MaxUint256);
    await expect(dist.connect(a).fund(await token.getAddress(), 1)).to.be.reverted // "Only vault" (revert strings stripped by compiler config);
  });

  it("only oracle can set roots", async () => {
    await expect(dist.connect(a).setRoot(await token.getAddress(), ethers.ZeroHash))
      .to.be.reverted // "Not oracle" (revert strings stripped);
  });

  it("claims the cumulative amount and prevents double claim", async () => {
    const t = await token.getAddress();
    const tree = buildTree([[a.address, ethers.parseEther("100")], [b.address, ethers.parseEther("50")]]);
    await dist.connect(oracle).setRoot(t, tree.root);

    const pa = proofFor(tree, a.address);
    await expect(dist.connect(a).claim(t, ethers.parseEther("100"), pa))
      .to.emit(dist, "Claimed").withArgs(t, a.address, ethers.parseEther("100"));
    expect(await token.balanceOf(a.address)).to.equal(ethers.parseEther("100"));

    // second claim against the same root: nothing left
    await expect(dist.connect(a).claim(t, ethers.parseEther("100"), pa))
      .to.be.reverted // "Nothing to claim" (revert strings stripped);
  });

  it("tops up when a new cumulative root raises the amount (rollover / next-day snapshot)", async () => {
    const t = await token.getAddress();
    let tree = buildTree([[a.address, ethers.parseEther("100")]]);
    await dist.connect(oracle).setRoot(t, tree.root);
    await dist.connect(a).claim(t, ethers.parseEther("100"), proofFor(tree, a.address));
    expect(await token.balanceOf(a.address)).to.equal(ethers.parseEther("100"));

    // next day: a is allocated more (cumulative 250). They claim only the 150 delta.
    tree = buildTree([[a.address, ethers.parseEther("250")], [b.address, ethers.parseEther("10")]]);
    await dist.connect(oracle).setRoot(t, tree.root);
    await dist.connect(a).claim(t, ethers.parseEther("250"), proofFor(tree, a.address));
    expect(await token.balanceOf(a.address)).to.equal(ethers.parseEther("250"));
    expect(await dist.totalClaimed(t)).to.equal(ethers.parseEther("250"));
  });

  it("rejects a forged amount (wrong leaf)", async () => {
    const t = await token.getAddress();
    const tree = buildTree([[a.address, ethers.parseEther("100")]]);
    await dist.connect(oracle).setRoot(t, tree.root);
    await expect(dist.connect(a).claim(t, ethers.parseEther("999"), proofFor(tree, a.address)))
      .to.be.reverted // "Invalid proof" (revert strings stripped);
  });

  it("claimMany claims across tokens in one tx", async () => {
    const T = await ethers.getContractFactory("MockERC20");
    const token2 = await T.deploy(ethers.parseEther("1000000"));
    const t1 = await token.getAddress();
    const t2 = await token2.getAddress();
    await token2.transfer(vault.address, ethers.parseEther("100000"));
    await token2.connect(vault).approve(await dist.getAddress(), ethers.MaxUint256);
    await dist.connect(vault).fund(t2, ethers.parseEther("100000"));

    const tree1 = buildTree([[a.address, ethers.parseEther("100")]]);
    const tree2 = buildTree([[a.address, ethers.parseEther("70")]]);
    await dist.connect(oracle).setRoot(t1, tree1.root);
    await dist.connect(oracle).setRoot(t2, tree2.root);

    await dist.connect(a).claimMany(
      [t1, t2],
      [ethers.parseEther("100"), ethers.parseEther("70")],
      [proofFor(tree1, a.address), proofFor(tree2, a.address)]
    );
    expect(await token.balanceOf(a.address)).to.equal(ethers.parseEther("100"));
    expect(await token2.balanceOf(a.address)).to.equal(ethers.parseEther("70"));
  });
});
