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

  const executorAddress = process.env.FLASH_EXECUTOR_ADDRESS;
  if (!executorAddress) {
    throw new Error("Set FLASH_EXECUTOR_ADDRESS in .env to your deployed FlashLoanExecutor address");
  }

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

  console.log("Caller:", wallet.address);

  const artifact = await hre.artifacts.readArtifact("FlashLoanExecutor");
  const executor = new ethers.Contract(executorAddress, artifact.abi, wallet);

  const asset = config.usdc;
  const amount = ethers.parseUnits("1000", 6); // 1,000 USDC

  console.log("Requesting flash loan");
  console.log("  Asset:", asset);
  console.log("  Amount (raw):", amount.toString());

  const tx = await executor.requestFlashLoan(asset, amount);
  console.log("Flash loan tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Flash loan tx mined in block:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
