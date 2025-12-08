const hre = require("hardhat");

const AAVE_POOL_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";

async function main() {
  console.log("Deploying FlashLoanExecutor...");

  const FlashLoanExecutor = await hre.ethers.getContractFactory("FlashLoanExecutor");
  const executor = await FlashLoanExecutor.deploy(AAVE_POOL_PROVIDER);

  await executor.waitForDeployment();

  const address = await executor.getAddress();
  console.log("FlashLoanExecutor deployed to:", address);
  console.log("Owner:", await executor.owner());
  console.log("Max flash amount:", (await executor.maxFlashAmount()).toString());

  return address;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
