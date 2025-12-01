import hre from "hardhat";

async function main() {
  console.log("Deploying ArbitrageBot to Sepolia...");

  const ArbitrageBot = await hre.ethers.getContractFactory("ArbitrageBot");
  const bot = await ArbitrageBot.deploy(
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000"
  );

  await bot.waitForDeployment();
  const address = await bot.getAddress();

  console.log("DEPLOYED!");
  console.log("Bot Address:", address);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

