import hre from "hardhat";
import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";
import { networkConfig } from "../aaveConfig.js";

dotenvConfig();

async function main() {
  const chainId = 11155111;
  const config = networkConfig[chainId];
  if (config === undefined) {
    throw new Error("No Aave config for chainId " + String(chainId));
  }

  const providerAddress = config.poolAddressesProvider;

  const rpcUrl = process.env.SEPOLIA_RPC;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error("SEPOLIA_RPC is not set in .env");
  }
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not set in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Deploying from:", wallet.address);
  console.log("Using PoolAddressesProvider:", providerAddress);

  const artifact = await hre.artifacts.readArtifact("FlashLoanExecutor");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  const executor = await factory.deploy(providerAddress);
  console.log("Deployment tx:", executor.deployTransaction?.hash ?? "(pending)");

  await executor.deploymentTransaction()?.wait();
  const address = await executor.getAddress();

  console.log("FlashLoanExecutor deployed to:", address);
  console.log("Set this value in .env as FLASH_EXECUTOR_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
