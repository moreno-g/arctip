const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TipJar", () => {
  async function deploy() {
    const [owner, treasury, creator, fan, other] = await ethers.getSigners();
    const TipJar = await ethers.getContractFactory("TipJar");
    const tipJar = await TipJar.deploy(treasury.address, owner.address);
    return { tipJar, owner, treasury, creator, fan, other };
  }

  it("lets a new handle be claimed", async () => {
    const { tipJar, creator } = await deploy();
    await expect(tipJar.connect(creator).register("rowan"))
      .to.emit(tipJar, "HandleRegistered")
      .withArgs("rowan", creator.address);
    expect(await tipJar.handleOwner("rowan")).to.equal(creator.address);
  });

  it("rejects a handle that is already taken", async () => {
    const { tipJar, creator, other } = await deploy();
    await tipJar.connect(creator).register("rowan");
    await expect(tipJar.connect(other).register("rowan")).to.be.revertedWithCustomError(
      tipJar,
      "HandleTaken"
    );
  });

  it("rejects empty or too-long handles", async () => {
    const { tipJar, creator } = await deploy();
    await expect(tipJar.connect(creator).register("")).to.be.revertedWithCustomError(
      tipJar,
      "HandleInvalid"
    );
    await expect(
      tipJar.connect(creator).register("a".repeat(33))
    ).to.be.revertedWithCustomError(tipJar, "HandleInvalid");
  });

  it("splits a tip between recipient and treasury at the default 2% fee", async () => {
    const { tipJar, creator, fan, treasury } = await deploy();
    await tipJar.connect(creator).register("rowan");

    const amount = ethers.parseEther("5"); // native USDC, 18 decimals
    await expect(() =>
      tipJar.connect(fan).tip("rowan", "nice thread", { value: amount })
    ).to.changeEtherBalances(
      [fan, creator, treasury],
      [-amount, (amount * 9800n) / 10000n, (amount * 200n) / 10000n]
    );
  });

  it("emits Tipped with the amount, fee and message", async () => {
    const { tipJar, creator, fan } = await deploy();
    await tipJar.connect(creator).register("rowan");
    const amount = ethers.parseEther("5");
    const fee = (amount * 200n) / 10000n;

    await expect(tipJar.connect(fan).tip("rowan", "nice thread", { value: amount }))
      .to.emit(tipJar, "Tipped")
      .withArgs("rowan", creator.address, fan.address, amount, fee, "nice thread");
  });

  it("reverts a tip to an unregistered handle", async () => {
    const { tipJar, fan } = await deploy();
    await expect(
      tipJar.connect(fan).tip("nobody", "", { value: ethers.parseEther("1") })
    ).to.be.revertedWithCustomError(tipJar, "HandleNotRegistered");
  });

  it("reverts a zero-value tip", async () => {
    const { tipJar, creator, fan } = await deploy();
    await tipJar.connect(creator).register("rowan");
    await expect(
      tipJar.connect(fan).tip("rowan", "", { value: 0 })
    ).to.be.revertedWithCustomError(tipJar, "ZeroTip");
  });

  it("only lets the owner change the fee, capped at 5%", async () => {
    const { tipJar, owner, other } = await deploy();
    await expect(tipJar.connect(other).setFeeBps(100)).to.be.revertedWithCustomError(
      tipJar,
      "OwnableUnauthorizedAccount"
    );
    await expect(tipJar.connect(owner).setFeeBps(501)).to.be.revertedWithCustomError(
      tipJar,
      "FeeTooHigh"
    );
    await tipJar.connect(owner).setFeeBps(300);
    expect(await tipJar.feeBps()).to.equal(300);
  });

  it("only lets the owner update the treasury", async () => {
    const { tipJar, owner, other } = await deploy();
    await expect(
      tipJar.connect(other).setTreasury(other.address)
    ).to.be.revertedWithCustomError(tipJar, "OwnableUnauthorizedAccount");
    await tipJar.connect(owner).setTreasury(other.address);
    expect(await tipJar.treasury()).to.equal(other.address);
  });

  it("blocks registration and tipping while paused", async () => {
    const { tipJar, owner, creator, fan } = await deploy();
    await tipJar.connect(creator).register("rowan");
    await tipJar.connect(owner).pause();

    await expect(tipJar.connect(creator).register("other")).to.be.revertedWithCustomError(
      tipJar,
      "EnforcedPause"
    );
    await expect(
      tipJar.connect(fan).tip("rowan", "", { value: ethers.parseEther("1") })
    ).to.be.revertedWithCustomError(tipJar, "EnforcedPause");
  });
});
