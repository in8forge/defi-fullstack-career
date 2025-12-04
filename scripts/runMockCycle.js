import hre from "hardhat";
import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC;
  const privateKey = process.env.PRIVATE_KEY;
  const executorAddress = process.env.FLASH_EXECUTOR_ADDRESS;
  const mockUsdcAddress = process.env.MOCK_USDC_ADDRESS;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC is not set in .env");
  if (!privateKey) throw new Error("PRIVATE_KEY is not set in .env");
  if (!executorAddress) throw new Error("FLASH_EXECUTOR_ADDRESS is not set in .env");
  if (!mockUsdcAddress) throw new Error("MOCK_USDC_ADDRESS is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Caller:", wallet.address);
  console.log("Executor:", executorAddress);
  console.log("MockUSDC:", mockUsdcAddress);

  const artifact = await hre.artifacts.readArtifact("FlashLoanExecutor");
  const executor = new ethers.Contract(executorAddress, artifact.abi, wallet);

  const amount = ethers.parseUnits("100", 6); // 100 mUSDC

  console.log("Running testMockCycle with 100 mUSDC...");
  const tx = await executor.testMockCycle(mockUsdcAddress, amount);
  console.log("testMockCycle tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("testMockCycle mined in block:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
