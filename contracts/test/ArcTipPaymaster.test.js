const { expect } = require("chai");
const { ethers } = require("hardhat");

const FLOOR = ethers.parseEther("0.25");

// An MSCA routes everything through execute(address,uint256,bytes); the
// paymaster only ever sees that outer call, so the tests build it by hand.
const EXECUTE_ABI = ["function execute(address target, uint256 value, bytes func)"];
const executeIface = new ethers.Interface(EXECUTE_ABI);

describe("ArcTipPaymaster", () => {
  let owner, treasury, creator, fan, outsider;
  let tipJar, paymaster, entryPoint, tipJarIface;

  beforeEach(async () => {
    [owner, treasury, creator, fan, outsider] = await ethers.getSigners();

    const TipJar = await ethers.getContractFactory("TipJar");
    tipJar = await TipJar.deploy(treasury.address, owner.address);
    await tipJar.waitForDeployment();
    tipJarIface = tipJar.interface;

    const MockEntryPoint = await ethers.getContractFactory("MockEntryPoint");
    entryPoint = await MockEntryPoint.deploy();
    await entryPoint.waitForDeployment();

    const Paymaster = await ethers.getContractFactory("ArcTipPaymaster");
    paymaster = await Paymaster.deploy(
      await entryPoint.getAddress(),
      await tipJar.getAddress(),
      owner.address
    );
    await paymaster.waitForDeployment();

    await tipJar.connect(creator).register("rowan");
  });

  function tipCallData(value, handle = "rowan", message = "") {
    const inner = tipJarIface.encodeFunctionData("tip", [handle, message, 200]);
    return executeIface.encodeFunctionData("execute", [tipJar.target, value, inner]);
  }

  function userOp(callData, sender = fan.address) {
    return {
      sender,
      nonce: 0,
      initCode: "0x",
      callData,
      accountGasLimits: ethers.ZeroHash,
      preVerificationGas: 0,
      gasFees: ethers.ZeroHash,
      paymasterAndData: "0x",
      signature: "0x",
    };
  }

  const validate = (callData, maxCost = ethers.parseEther("0.01"), sender) =>
    entryPoint.callValidate.staticCall(paymaster.target, userOp(callData, sender), maxCost);

  describe("deployment", () => {
    it("rejects a zero EntryPoint or TipJar", async () => {
      const Paymaster = await ethers.getContractFactory("ArcTipPaymaster");
      await expect(
        Paymaster.deploy(ethers.ZeroAddress, tipJar.target, owner.address)
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
      await expect(
        Paymaster.deploy(entryPoint.target, ethers.ZeroAddress, owner.address)
      ).to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("starts at the measured floor with empty counters", async () => {
      expect(await paymaster.minSponsoredTip()).to.equal(FLOOR);
      expect(await paymaster.sponsoredOps()).to.equal(0);
      expect(await paymaster.gasSponsored()).to.equal(0);
      expect(await paymaster.feesReceived()).to.equal(0);
      // No gas sponsored yet must not read as infinite coverage.
      expect(await paymaster.feeCoverageBps()).to.equal(0);
    });
  });

  describe("what it agrees to pay for", () => {
    it("sponsors a tip at or above the floor", async () => {
      const [context] = await validate(tipCallData(FLOOR));
      expect(ethers.AbiCoder.defaultAbiCoder().decode(["address"], context)[0]).to.equal(
        fan.address
      );
    });

    it("refuses a tip below the floor, where the fee stops covering the gas", async () => {
      await expect(validate(tipCallData(FLOOR - 1n)))
        .to.be.revertedWithCustomError(paymaster, "TipBelowFloor")
        .withArgs(FLOOR - 1n, FLOOR);
    });

    it("refuses a zero-value call dressed up as a tip", async () => {
      await expect(validate(tipCallData(0))).to.be.revertedWithCustomError(
        paymaster,
        "TipBelowFloor"
      );
    });

    it("refuses anything that is not an execute call", async () => {
      const direct = tipJarIface.encodeFunctionData("tip", ["rowan", "", 200]);
      await expect(validate(direct)).to.be.revertedWithCustomError(
        paymaster,
        "NotAnExecuteCall"
      );
      await expect(validate("0x")).to.be.revertedWithCustomError(
        paymaster,
        "NotAnExecuteCall"
      );
      await expect(validate("0x1234")).to.be.revertedWithCustomError(
        paymaster,
        "NotAnExecuteCall"
      );
    });

    it("refuses an execute aimed somewhere other than the TipJar", async () => {
      const inner = tipJarIface.encodeFunctionData("tip", ["rowan", "", 200]);
      const callData = executeIface.encodeFunctionData("execute", [
        outsider.address,
        ethers.parseEther("1"),
        inner,
      ]);
      await expect(validate(callData)).to.be.revertedWithCustomError(paymaster, "NotATipCall");
    });

    it("refuses a call into the TipJar that is not tip()", async () => {
      // register() would otherwise let anyone claim handles on our budget.
      const inner = tipJarIface.encodeFunctionData("register", ["freeloader"]);
      const callData = executeIface.encodeFunctionData("execute", [
        tipJar.target,
        ethers.parseEther("1"),
        inner,
      ]);
      await expect(validate(callData)).to.be.revertedWithCustomError(paymaster, "NotATipCall");

      const empty = executeIface.encodeFunctionData("execute", [
        tipJar.target,
        ethers.parseEther("1"),
        "0x",
      ]);
      await expect(validate(empty)).to.be.revertedWithCustomError(paymaster, "NotATipCall");
    });

    it("refuses an operation costing more than the per-op cap", async () => {
      const cap = await paymaster.maxCostPerOp();
      await expect(validate(tipCallData(ethers.parseEther("1")), cap + 1n))
        .to.be.revertedWithCustomError(paymaster, "CostAboveCap")
        .withArgs(cap + 1n, cap);
    });

    it("only the EntryPoint can ask for sponsorship", async () => {
      await expect(
        paymaster.connect(outsider).validatePaymasterUserOp(userOp(tipCallData(FLOOR)), ethers.ZeroHash, 0)
      ).to.be.revertedWithCustomError(paymaster, "NotEntryPoint");

      await expect(
        paymaster.connect(outsider).postOp(0, ethers.AbiCoder.defaultAbiCoder().encode(["address"], [fan.address]), 1, 1)
      ).to.be.revertedWithCustomError(paymaster, "NotEntryPoint");
    });
  });

  describe("accounting", () => {
    const context = () => ethers.AbiCoder.defaultAbiCoder().encode(["address"], [fan.address]);

    it("books what each sponsorship actually cost", async () => {
      const cost = ethers.parseEther("0.0039"); // the measured cost of a sponsored tip
      await expect(entryPoint.callPostOp(paymaster.target, 0, context(), cost))
        .to.emit(paymaster, "Sponsored")
        .withArgs(fan.address, cost);

      expect(await paymaster.sponsoredOps()).to.equal(1);
      expect(await paymaster.gasSponsored()).to.equal(cost);
    });

    it("still books the cost when the tip itself reverted", async () => {
      // The EntryPoint has already charged the deposit by then; refusing to
      // record it would only hide gas we have genuinely spent.
      const cost = ethers.parseEther("0.001");
      await entryPoint.callPostOp(paymaster.target, 1, context(), cost);
      expect(await paymaster.sponsoredOps()).to.equal(1);
      expect(await paymaster.gasSponsored()).to.equal(cost);
    });

    it("counts fees arriving from the TipJar", async () => {
      await fan.sendTransaction({ to: paymaster.target, value: ethers.parseEther("0.02") });
      expect(await paymaster.feesReceived()).to.equal(ethers.parseEther("0.02"));
    });

    it("reports coverage in bps once gas has been sponsored", async () => {
      await fan.sendTransaction({ to: paymaster.target, value: ethers.parseEther("0.02") });
      await entryPoint.callPostOp(paymaster.target, 0, context(), ethers.parseEther("0.0039"));
      // 0.02 of fees against 0.0039 of gas — the 5x margin the floor is set from.
      expect(await paymaster.feeCoverageBps()).to.equal(51282);
    });
  });

  describe("funding", () => {
    it("accepts fees within the gas budget TipJar forwards them under", async () => {
      // TipJar pays fees out with a 50k gas bound; receive() must fit inside it
      // or fees land in pendingWithdrawal instead of funding sponsorship.
      await tipJar.connect(owner).setTreasury(paymaster.target);
      const tx = await tipJar.connect(fan).tip("rowan", "", 200, { value: ethers.parseEther("1") });
      await tx.wait();

      expect(await paymaster.feesReceived()).to.equal(ethers.parseEther("0.02"));
      await expect(tipJar.pendingWithdrawal(paymaster.target)).to.eventually.equal(0);
    });

    it("moves collected fees into the deposit, and anyone may trigger it", async () => {
      await fan.sendTransaction({ to: paymaster.target, value: ethers.parseEther("0.5") });
      await expect(paymaster.connect(outsider).sweepToDeposit())
        .to.emit(paymaster, "SponsorshipFunded")
        .withArgs(ethers.parseEther("0.5"), ethers.parseEther("0.5"));

      expect(await paymaster.deposit()).to.equal(ethers.parseEther("0.5"));
      expect(await ethers.provider.getBalance(paymaster.target)).to.equal(0);
    });

    it("reverts a sweep with nothing to move", async () => {
      await expect(paymaster.sweepToDeposit()).to.be.revertedWithCustomError(
        paymaster,
        "NothingToSweep"
      );
    });

    it("takes a direct top-up", async () => {
      await paymaster.connect(owner).fundDeposit({ value: ethers.parseEther("1") });
      expect(await paymaster.deposit()).to.equal(ethers.parseEther("1"));
    });

    it("reports how many more tips it can sponsor", async () => {
      await paymaster.connect(owner).fundDeposit({ value: ethers.parseEther("1") });
      // 1 USDC of deposit against a 0.05 per-op cap
      expect(await paymaster.sponsorshipRunway()).to.equal(20);
    });
  });

  describe("admin", () => {
    it("only the owner moves the floor and the cap", async () => {
      await expect(paymaster.connect(outsider).setMinSponsoredTip(1))
        .to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      await expect(paymaster.connect(outsider).setMaxCostPerOp(1))
        .to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");

      await expect(paymaster.connect(owner).setMinSponsoredTip(ethers.parseEther("0.5")))
        .to.emit(paymaster, "MinSponsoredTipUpdated")
        .withArgs(ethers.parseEther("0.5"));
      expect(await paymaster.minSponsoredTip()).to.equal(ethers.parseEther("0.5"));
    });

    it("a raised floor takes effect immediately", async () => {
      await paymaster.connect(owner).setMinSponsoredTip(ethers.parseEther("1"));
      await expect(validate(tipCallData(FLOOR))).to.be.revertedWithCustomError(
        paymaster,
        "TipBelowFloor"
      );
    });

    it("stakes, unlocks and withdraws through the EntryPoint", async () => {
      await paymaster.connect(owner).addStake(86400, { value: ethers.parseEther("1") });
      expect(await entryPoint.stakeOf(paymaster.target)).to.equal(ethers.parseEther("1"));
      expect(await entryPoint.unstakeDelayOf(paymaster.target)).to.equal(86400);

      await paymaster.connect(owner).unlockStake();
      await paymaster.connect(owner).withdrawStake(owner.address);
      expect(await entryPoint.stakeOf(paymaster.target)).to.equal(0);
    });

    it("only the owner touches the stake or the deposit, and never to zero", async () => {
      await expect(paymaster.connect(outsider).addStake(1, { value: 1 }))
        .to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      await expect(paymaster.connect(outsider).withdrawDeposit(outsider.address, 1))
        .to.be.revertedWithCustomError(paymaster, "OwnableUnauthorizedAccount");
      await expect(paymaster.connect(owner).withdrawDeposit(ethers.ZeroAddress, 1))
        .to.be.revertedWithCustomError(paymaster, "ZeroAddress");
      await expect(paymaster.connect(owner).withdrawStake(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(paymaster, "ZeroAddress");
    });

    it("pulls sponsorship funds back out", async () => {
      await paymaster.connect(owner).fundDeposit({ value: ethers.parseEther("1") });
      await paymaster.connect(owner).withdrawDeposit(outsider.address, ethers.parseEther("0.4"));
      expect(await paymaster.deposit()).to.equal(ethers.parseEther("0.6"));
    });

    it("pausing stops sponsorship without stopping tips", async () => {
      await paymaster.connect(owner).pause();
      await expect(validate(tipCallData(ethers.parseEther("1")))).to.be.revertedWithCustomError(
        paymaster,
        "EnforcedPause"
      );

      // The tip itself still goes through, with the fan paying their own gas.
      await expect(
        tipJar.connect(fan).tip("rowan", "", 200, { value: ethers.parseEther("1") })
      ).to.emit(tipJar, "Tipped");

      await paymaster.connect(owner).unpause();
      const [context] = await validate(tipCallData(ethers.parseEther("1")));
      expect(context).to.not.equal("0x");
    });

    it("transfers ownership in two steps", async () => {
      await paymaster.connect(owner).transferOwnership(outsider.address);
      expect(await paymaster.owner()).to.equal(owner.address);
      await paymaster.connect(outsider).acceptOwnership();
      expect(await paymaster.owner()).to.equal(outsider.address);
    });
  });
});
