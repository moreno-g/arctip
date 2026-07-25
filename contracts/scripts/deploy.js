const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY_ADDRESS || deployer.address;

  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Treasury: ${treasury}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} (native USDC on Arc)`);

  const TipJar = await ethers.getContractFactory("TipJar");
  const tipJar = await TipJar.deploy(treasury, deployer.address);
  await tipJar.waitForDeployment();

  const address = await tipJar.getAddress();
  console.log(`TipJar deployed to: ${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
