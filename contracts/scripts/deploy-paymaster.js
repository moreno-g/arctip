const { ethers, network } = require("hardhat");

// Deploys ArcTipPaymaster against an existing TipJar, stakes it, and funds the
// deposit that pays for sponsored tips.
//
// Two things have to be true before sponsorship actually works, and both are
// easy to forget:
//
//   1. The paymaster must be staked with the EntryPoint. It reads its own
//      storage while validating, and under ERC-7562 bundlers reject operations
//      from an unstaked paymaster that does so.
//   2. TipJar's treasury must point at the paymaster, or the fees never reach
//      the thing they are supposed to be funding. That is a TipJar owner call,
//      so this script reports on it rather than assuming it can make it.

// The v0.7 singleton, identical across chains and confirmed live on Arc testnet.
const DEFAULT_ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

// A day's delay is the usual floor bundlers expect before they will trust a
// paymaster's stake.
const UNSTAKE_DELAY_SEC = 86_400;

async function main() {
  const [deployer] = await ethers.getSigners();
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  const tipJarAddress = process.env.TIPJAR_ADDRESS;
  const entryPoint = process.env.ENTRY_POINT_ADDRESS || DEFAULT_ENTRY_POINT;
  const owner = process.env.OWNER_ADDRESS || (isLocal ? deployer.address : null);

  if (!tipJarAddress) {
    throw new Error("TIPJAR_ADDRESS is not set. Point it at the deployed TipJar.");
  }
  if (!owner) {
    throw new Error(
      "OWNER_ADDRESS is not set. Point it at a wallet you control — not the deployer key."
    );
  }
  for (const [label, value] of [
    ["TIPJAR_ADDRESS", tipJarAddress],
    ["ENTRY_POINT_ADDRESS", entryPoint],
    ["OWNER_ADDRESS", owner],
  ]) {
    if (!ethers.isAddress(value)) throw new Error(`${label} is not a valid address: ${value}`);
  }

  // A paymaster pointed at an address with no code would accept operations and
  // then fail every one of them, silently, at the bundler.
  if (!isLocal) {
    for (const [label, value] of [["EntryPoint", entryPoint], ["TipJar", tipJarAddress]]) {
      const code = await ethers.provider.getCode(value);
      if (code === "0x") throw new Error(`${label} has no contract code at ${value}.`);
    }
  }

  const stake = ethers.parseEther(process.env.PAYMASTER_STAKE || "0.1");
  const deposit = ethers.parseEther(process.env.PAYMASTER_DEPOSIT || "1");

  console.log(`Network:    ${network.name}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Owner:      ${owner}`);
  console.log(`EntryPoint: ${entryPoint}`);
  console.log(`TipJar:     ${tipJarAddress}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} (native USDC on Arc)`);
  if (balance < stake + deposit) {
    throw new Error(
      `Deployer holds ${ethers.formatEther(balance)} but the stake and deposit need ` +
        `${ethers.formatEther(stake + deposit)}. Top it up, or lower PAYMASTER_STAKE / PAYMASTER_DEPOSIT.`
    );
  }

  const Paymaster = await ethers.getContractFactory("ArcTipPaymaster");
  // Deploy owned by the deployer so this script can stake and fund in one run,
  // then hand ownership over at the end.
  const paymaster = await Paymaster.deploy(entryPoint, tipJarAddress, deployer.address);
  await paymaster.waitForDeployment();
  const address = await paymaster.getAddress();
  console.log(`\nArcTipPaymaster deployed to: ${address}`);

  console.log(`Staking ${ethers.formatEther(stake)}…`);
  await (await paymaster.addStake(UNSTAKE_DELAY_SEC, { value: stake })).wait();

  console.log(`Funding deposit with ${ethers.formatEther(deposit)}…`);
  await (await paymaster.fundDeposit({ value: deposit })).wait();

  const runway = await paymaster.sponsorshipRunway();
  console.log(`Deposit covers at least ${runway} sponsored tips at the current per-op cap.`);

  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log(`\nTransferring ownership to ${owner}…`);
    await (await paymaster.transferOwnership(owner)).wait();
    console.log("Ownership offered — Ownable2Step, so the new owner must call acceptOwnership().");
  } else if (!isLocal) {
    console.warn(
      "\n  WARNING: the deployer key would own this paymaster, which means a key in\n" +
        "  .env could withdraw the whole deposit. Set OWNER_ADDRESS to a hardware\n" +
        "  wallet or multisig before a real launch.\n"
    );
  }

  // The loop only closes if TipJar actually sends its fees here.
  const tipJar = await ethers.getContractAt("TipJar", tipJarAddress);
  const treasury = await tipJar.treasury();
  console.log("\nNext steps:");
  if (treasury.toLowerCase() !== address.toLowerCase()) {
    console.log(
      `  1. TipJar's treasury is ${treasury}, not the paymaster. Until its owner calls\n` +
        `     setTreasury(${address}), fees will not fund the sponsorship.`
    );
  } else {
    console.log("  1. TipJar already pays its fees to this paymaster.");
  }
  console.log(`  2. Set PAYMASTER_ADDRESS in website/js/config.js to ${address}.`);
  console.log("  3. Call sweepToDeposit() periodically to move collected fees into the deposit.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
