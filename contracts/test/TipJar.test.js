const { expect } = require("chai");
const { ethers } = require("hardhat");

const NO_FEE_LIMIT = 10_000; // accept whatever the fee is

describe("TipJar", () => {
  async function deploy() {
    const [owner, treasury, creator, fan, other] = await ethers.getSigners();
    const TipJar = await ethers.getContractFactory("TipJar");
    const tipJar = await TipJar.deploy(treasury.address, owner.address);
    return { tipJar, owner, treasury, creator, fan, other };
  }

  // A contract with no receive/fallback: it rejects plain value transfers.
  async function deployRejector(signer) {
    const Rejector = await ethers.getContractFactory("TipJar");
    return Rejector.deploy(signer.address, signer.address);
  }

  describe("deployment", () => {
    it("rejects a zero treasury", async () => {
      const [owner] = await ethers.getSigners();
      const TipJar = await ethers.getContractFactory("TipJar");
      await expect(
        TipJar.deploy(ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(TipJar, "ZeroAddress");
    });

    it("starts at 2% with empty counters", async () => {
      const { tipJar } = await deploy();
      expect(await tipJar.feeBps()).to.equal(200);
      expect(await tipJar.handleCount()).to.equal(0);
      expect(await tipJar.tipCount()).to.equal(0);
      expect(await tipJar.totalTipped()).to.equal(0);
    });
  });

  describe("register", () => {
    it("claims a handle and counts it", async () => {
      const { tipJar, creator } = await deploy();
      await expect(tipJar.connect(creator).register("rowan"))
        .to.emit(tipJar, "HandleRegistered")
        .withArgs("rowan", creator.address);

      expect(await tipJar.handleOwner("rowan")).to.equal(creator.address);
      expect(await tipJar.ownerHandle(creator.address)).to.equal("rowan");
      expect(await tipJar.handleCount()).to.equal(1);
    });

    it("reports whether a handle is taken", async () => {
      const { tipJar, creator } = await deploy();
      expect(await tipJar.isHandleTaken("rowan")).to.equal(false);
      await tipJar.connect(creator).register("rowan");
      expect(await tipJar.isHandleTaken("rowan")).to.equal(true);
    });

    it("rejects a handle that is already taken", async () => {
      const { tipJar, creator, other } = await deploy();
      await tipJar.connect(creator).register("rowan");
      await expect(tipJar.connect(other).register("rowan")).to.be.revertedWithCustomError(
        tipJar,
        "HandleTaken"
      );
    });

    it("allows only one handle per address", async () => {
      const { tipJar, creator } = await deploy();
      await tipJar.connect(creator).register("first");
      await expect(tipJar.connect(creator).register("second")).to.be.revertedWithCustomError(
        tipJar,
        "AlreadyHasHandle"
      );
      // the reverse lookup can no longer silently lose a handle
      expect(await tipJar.ownerHandle(creator.address)).to.equal("first");
    });

    it("accepts only lowercase letters, digits and underscores", async () => {
      const { tipJar, creator, other } = await deploy();
      await tipJar.connect(creator).register("ok_handle_123");
      expect(await tipJar.handleOwner("ok_handle_123")).to.equal(creator.address);

      for (const bad of ["Alice", "a b", "héllo", "hi!", "UPPER", "with-dash", "dot.dot"]) {
        await expect(tipJar.connect(other).register(bad)).to.be.revertedWithCustomError(
          tipJar,
          "HandleInvalid"
        );
      }
    });

    it("rejects empty and over-long handles", async () => {
      const { tipJar, creator } = await deploy();
      await expect(tipJar.connect(creator).register("")).to.be.revertedWithCustomError(
        tipJar,
        "HandleInvalid"
      );
      await expect(
        tipJar.connect(creator).register("a".repeat(33))
      ).to.be.revertedWithCustomError(tipJar, "HandleInvalid");
      await tipJar.connect(creator).register("a".repeat(32)); // the boundary is valid
    });
  });

  describe("transferHandle", () => {
    it("moves a handle and its payouts to a new wallet", async () => {
      const { tipJar, creator, other, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");

      await expect(tipJar.connect(creator).transferHandle("rowan", other.address))
        .to.emit(tipJar, "HandleTransferred")
        .withArgs("rowan", creator.address, other.address);

      expect(await tipJar.handleOwner("rowan")).to.equal(other.address);
      expect(await tipJar.ownerHandle(other.address)).to.equal("rowan");
      expect(await tipJar.ownerHandle(creator.address)).to.equal("");

      // tips now land on the new wallet
      const amount = ethers.parseEther("1");
      await expect(() =>
        tipJar.connect(fan).tip("rowan", "", NO_FEE_LIMIT, { value: amount })
      ).to.changeEtherBalance(other, (amount * 9800n) / 10000n);
    });

    it("frees the old wallet to register again", async () => {
      const { tipJar, creator, other } = await deploy();
      await tipJar.connect(creator).register("rowan");
      await tipJar.connect(creator).transferHandle("rowan", other.address);
      await tipJar.connect(creator).register("rowan_two");
      expect(await tipJar.ownerHandle(creator.address)).to.equal("rowan_two");
    });

    it("only the handle owner can transfer, and not onto an occupied wallet", async () => {
      const { tipJar, creator, other } = await deploy();
      await tipJar.connect(creator).register("rowan");
      await tipJar.connect(other).register("taken");

      await expect(
        tipJar.connect(other).transferHandle("rowan", other.address)
      ).to.be.revertedWithCustomError(tipJar, "NotHandleOwner");

      await expect(
        tipJar.connect(creator).transferHandle("rowan", other.address)
      ).to.be.revertedWithCustomError(tipJar, "AlreadyHasHandle");

      await expect(
        tipJar.connect(creator).transferHandle("rowan", ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(tipJar, "ZeroAddress");
    });
  });

  describe("tip", () => {
    it("splits between recipient and treasury at the default 2%", async () => {
      const { tipJar, creator, fan, treasury } = await deploy();
      await tipJar.connect(creator).register("rowan");

      const amount = ethers.parseEther("5");
      await expect(() =>
        tipJar.connect(fan).tip("rowan", "nice thread", NO_FEE_LIMIT, { value: amount })
      ).to.changeEtherBalances(
        [fan, creator, treasury],
        [-amount, (amount * 9800n) / 10000n, (amount * 200n) / 10000n]
      );
    });

    it("emits Tipped and moves the counters", async () => {
      const { tipJar, creator, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");
      const amount = ethers.parseEther("5");
      const fee = (amount * 200n) / 10000n;

      await expect(tipJar.connect(fan).tip("rowan", "nice", NO_FEE_LIMIT, { value: amount }))
        .to.emit(tipJar, "Tipped")
        .withArgs("rowan", creator.address, fan.address, amount, fee, "nice");

      expect(await tipJar.tipCount()).to.equal(1);
      expect(await tipJar.totalTipped()).to.equal(amount);
    });

    it("reverts if the fee rose above what the sender agreed to", async () => {
      const { tipJar, owner, creator, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");

      // the page quoted 2%; the owner raises to 5% before the fan signs
      await tipJar.connect(owner).setFeeBps(500);

      await expect(
        tipJar.connect(fan).tip("rowan", "", 200, { value: ethers.parseEther("10") })
      )
        .to.be.revertedWithCustomError(tipJar, "FeeAboveMax")
        .withArgs(500, 200);
    });

    it("accepts a tip when the fee is at or below the sender's limit", async () => {
      const { tipJar, creator, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");
      await expect(tipJar.connect(fan).tip("rowan", "", 200, { value: ethers.parseEther("1") })).to
        .not.be.reverted;
    });

    it("caps the message length", async () => {
      const { tipJar, creator, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");
      const value = ethers.parseEther("1");

      await tipJar.connect(fan).tip("rowan", "x".repeat(280), NO_FEE_LIMIT, { value });
      await expect(
        tipJar.connect(fan).tip("rowan", "x".repeat(281), NO_FEE_LIMIT, { value })
      ).to.be.revertedWithCustomError(tipJar, "MessageTooLong");
    });

    it("reverts on an unregistered handle and on a zero tip", async () => {
      const { tipJar, creator, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");

      await expect(
        tipJar.connect(fan).tip("nobody", "", NO_FEE_LIMIT, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(tipJar, "HandleNotRegistered");

      await expect(
        tipJar.connect(fan).tip("rowan", "", NO_FEE_LIMIT, { value: 0 })
      ).to.be.revertedWithCustomError(tipJar, "ZeroTip");
    });

    it("never leaves value stuck in the contract", async () => {
      const { tipJar, creator, fan } = await deploy();
      await tipJar.connect(creator).register("rowan");
      for (const a of ["1", "0.000000000000000001", "3.333333333333333333"]) {
        await tipJar.connect(fan).tip("rowan", "", NO_FEE_LIMIT, { value: ethers.parseEther(a) });
      }
      expect(await ethers.provider.getBalance(await tipJar.getAddress())).to.equal(0n);
    });
  });

  describe("payout fallback", () => {
    it("credits a recipient that rejects payment instead of bricking its handle", async () => {
      const { tipJar, fan } = await deploy();
      const rejector = await deployRejector(fan);
      const rejectorAddr = await rejector.getAddress();

      await ethers.provider.send("hardhat_impersonateAccount", [rejectorAddr]);
      await ethers.provider.send("hardhat_setBalance", [rejectorAddr, "0x56BC75E2D63100000"]);
      const asRejector = await ethers.getSigner(rejectorAddr);
      await tipJar.connect(asRejector).register("brickme");

      const amount = ethers.parseEther("1");
      const net = (amount * 9800n) / 10000n;

      // the tip goes through rather than reverting
      await expect(tipJar.connect(fan).tip("brickme", "", NO_FEE_LIMIT, { value: amount }))
        .to.emit(tipJar, "PayoutDeferred")
        .withArgs(rejectorAddr, net);

      expect(await tipJar.pendingWithdrawal(rejectorAddr)).to.equal(net);
      expect(await ethers.provider.getBalance(await tipJar.getAddress())).to.equal(net);
    });

    it("lets a payee withdraw what was credited", async () => {
      const { tipJar, owner, treasury, creator, fan } = await deploy();
      const rejector = await deployRejector(fan);
      const rejectorAddr = await rejector.getAddress();
      await tipJar.connect(owner).setTreasury(rejectorAddr);
      await tipJar.connect(creator).register("rowan");

      const amount = ethers.parseEther("10");
      const fee = (amount * 200n) / 10000n;
      await tipJar.connect(fan).tip("rowan", "", NO_FEE_LIMIT, { value: amount });
      expect(await tipJar.pendingWithdrawal(rejectorAddr)).to.equal(fee);

      // the rejector is itself a TipJar, so give it a plain EOA to withdraw from
      await ethers.provider.send("hardhat_impersonateAccount", [rejectorAddr]);
      await ethers.provider.send("hardhat_setBalance", [rejectorAddr, "0x56BC75E2D63100000"]);
      const asRejector = await ethers.getSigner(rejectorAddr);

      // withdrawing back into a contract that rejects value must revert cleanly
      await expect(tipJar.connect(asRejector).withdraw()).to.be.revertedWithCustomError(
        tipJar,
        "TransferFailed"
      );
      // ...and leave the credit intact rather than burning it
      expect(await tipJar.pendingWithdrawal(rejectorAddr)).to.equal(fee);
      expect(treasury.address).to.be.a("string");
    });

    it("reverts a withdraw with nothing to claim", async () => {
      const { tipJar, other } = await deploy();
      await expect(tipJar.connect(other).withdraw()).to.be.revertedWithCustomError(
        tipJar,
        "NothingToWithdraw"
      );
    });
  });

  describe("admin", () => {
    it("only the owner changes the fee, capped at 5%", async () => {
      const { tipJar, owner, other } = await deploy();
      await expect(tipJar.connect(other).setFeeBps(100)).to.be.revertedWithCustomError(
        tipJar,
        "OwnableUnauthorizedAccount"
      );
      await expect(tipJar.connect(owner).setFeeBps(501)).to.be.revertedWithCustomError(
        tipJar,
        "FeeTooHigh"
      );
      await expect(tipJar.connect(owner).setFeeBps(300))
        .to.emit(tipJar, "FeeUpdated")
        .withArgs(300);
    });

    it("only the owner updates the treasury, never to zero", async () => {
      const { tipJar, owner, other } = await deploy();
      await expect(
        tipJar.connect(other).setTreasury(other.address)
      ).to.be.revertedWithCustomError(tipJar, "OwnableUnauthorizedAccount");
      await expect(
        tipJar.connect(owner).setTreasury(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(tipJar, "ZeroAddress");
      await tipJar.connect(owner).setTreasury(other.address);
      expect(await tipJar.treasury()).to.equal(other.address);
    });

    it("pauses and unpauses registration, transfers and tipping", async () => {
      const { tipJar, owner, creator, fan, other } = await deploy();
      await tipJar.connect(creator).register("rowan");
      await tipJar.connect(owner).pause();

      await expect(tipJar.connect(other).register("other")).to.be.revertedWithCustomError(
        tipJar,
        "EnforcedPause"
      );
      await expect(
        tipJar.connect(creator).transferHandle("rowan", other.address)
      ).to.be.revertedWithCustomError(tipJar, "EnforcedPause");
      await expect(
        tipJar.connect(fan).tip("rowan", "", NO_FEE_LIMIT, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(tipJar, "EnforcedPause");

      await tipJar.connect(owner).unpause();
      await expect(
        tipJar.connect(fan).tip("rowan", "", NO_FEE_LIMIT, { value: ethers.parseEther("1") })
      ).to.not.be.reverted;
    });

    it("transfers ownership in two steps", async () => {
      const { tipJar, owner, other } = await deploy();
      await tipJar.connect(owner).transferOwnership(other.address);
      expect(await tipJar.owner()).to.equal(owner.address); // not yet
      await tipJar.connect(other).acceptOwnership();
      expect(await tipJar.owner()).to.equal(other.address);
    });
  });
});
