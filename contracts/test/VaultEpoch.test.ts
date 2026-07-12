import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { HoodseaVault, AirdropDistributor, MockLockToken } from "../typechain-types";

const DEAD = "0x000000000000000000000000000000000000dEaD";

describe("HoodseaVault.executeEpoch -> AirdropDistributor", () => {
  let vault: HoodseaVault, dist: AirdropDistributor, token: MockLockToken;
  let owner: SignerWithAddress, oracle: SignerWithAddress, creator: SignerWithAddress;
  const SUPPLY = ethers.parseEther("1000000000"); // 1B like HoodseaToken

  beforeEach(async () => {
    [owner, oracle, creator] = await ethers.getSigners();
    const V = await ethers.getContractFactory("HoodseaVault");
    vault = await V.deploy(owner.address, oracle.address);
    const D = await ethers.getContractFactory("AirdropDistributor");
    dist = await D.deploy(owner.address, oracle.address);
    await dist.connect(owner).setVault(await vault.getAddress());
    await vault.connect(owner).setAirdropDistributor(await dist.getAddress());

    const T = await ethers.getContractFactory("MockLockToken");
    token = await T.deploy(SUPPLY);
    // lock: 50% to vault + register
    await token.lock(await vault.getAddress(), creator.address);
  });

  it("epoch 0 burns 9% and funds the distributor with 1% (nothing burned from airdrop)", async () => {
    const t = await token.getAddress();
    await time.increase(24 * 3600 + 10); // pass day-1 epoch

    const burnExpected = (SUPPLY * 900n) / 10000n;   // 9%
    const airExpected = (SUPPLY * 100n) / 10000n;    // 1%

    await expect(vault.executeEpoch(t, 0))
      .to.emit(vault, "BurnExecuted").withArgs(t, 0, burnExpected)
      .and.to.emit(vault, "AirdropExecuted").withArgs(t, 0, airExpected, 0);

    expect(await token.balanceOf(DEAD)).to.equal(burnExpected);
    expect(await token.balanceOf(await dist.getAddress())).to.equal(airExpected);
    expect(await dist.totalFunded(t)).to.equal(airExpected);
    // vault keeps the rest (50% - 10%)
    expect(await token.balanceOf(await vault.getAddress())).to.equal(SUPPLY / 2n - burnExpected - airExpected);
  });

  it("reverts if distributor not set", async () => {
    await vault.connect(owner).setAirdropDistributor(ethers.ZeroAddress);
    await time.increase(24 * 3600 + 10);
    await expect(vault.executeEpoch(await token.getAddress(), 0)).to.be.reverted // "Distributor not set" (revert strings stripped);
  });

  it("reverts before the epoch matures", async () => {
    await expect(vault.executeEpoch(await token.getAddress(), 0)).to.be.reverted // "Epoch not ready yet" (revert strings stripped);
  });

  it("cannot execute the same epoch twice", async () => {
    const t = await token.getAddress();
    await time.increase(24 * 3600 + 10);
    await vault.executeEpoch(t, 0);
    await expect(vault.executeEpoch(t, 0)).to.be.reverted // "Already executed" (revert strings stripped);
  });
});
