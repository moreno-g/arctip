const { ethers, network } = require("hardhat");

// The deployer key is a hot key sitting in .env. It should never end up owning
// the contract or receiving its revenue on a real network, so both roles are
// read from config and the script refuses to quietly fall back to the deployer.
async function main() {
  const [deployer] = await ethers.getSigners();
  const isLocal = network.name === "hardhat" || network.name === "localhost";

  const treasury = process.env.TREASURY_ADDRESS || (isLocal ? deployer.address : null);
  const owner = process.env.OWNER_ADDRESS || treasury;

  if (!treasury) {
    throw new Error(
      "TREASURY_ADDRESS is not set. Point it at a wallet you control — not the deployer key."
    );
  }
  for (const [label, value] of [["TREASURY_ADDRESS", treasury], ["OWNER_ADDRESS", owner]]) {
    if (!ethers.isAddress(value)) throw new Error(`${label} is not a valid address: ${value}`);
  }

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Treasury: ${treasury}`);
  console.log(`Owner:    ${owner}`);

  if (!isLocal && owner.toLowerCase() === deployer.address.toLowerCase()) {
    console.warn(
      "\n  WARNING: the deployer key would own this contract, which means a key in\n" +
        "  .env could change fees, pause tipping and redirect revenue. Set\n" +
        "  OWNER_ADDRESS to a hardware wallet or multisig before a real launch.\n"
    );
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} (native USDC on Arc)`);

  const TipJar = await ethers.getContractFactory("TipJar");
  const tipJar = await TipJar.deploy(treasury, owner);
  await tipJar.waitForDeployment();

  const address = await tipJar.getAddress();
  console.log(`\nTipJar deployed to: ${address}`);
  console.log("Remember to update TIPJAR_ADDRESS in website/js/config.js.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
