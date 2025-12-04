import hre from "hardhat";
import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

async function getBalances(provider, tokenAddress, walletAddress, executorAddress) {
  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)"
  ];

  const token = new ethers.Contract(tokenAddress, erc20Abi, provider);
  const decimals = await token.decimals();

  const [walletRaw, executorRaw] = await Promise.all([
    token.balanceOf(walletAddress),
    token.balanceOf(executorAddress),
  ]);

  const oneUnit = ethers.parseUnits("1", decimals);

  return {
    decimals,
    walletRaw,
    executorRaw,
    walletHuman: Number(walletRaw * 1n / oneUnit),
    executorHuman: Number(executorRaw * 1n / oneUnit),
  };
}

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

  console.log("Caller (wallet):", wallet.address);
  console.log("Executor:", executorAddress);
  console.log("MockUSDC:", mockUsdcAddress);

  const before = await getBalances(provider, mockUsdcAddress, wallet.address, executorAddress);

  console.log("=== BEFORE CYCLE ===");
  console.log("Wallet mUSDC (raw):   ", before.walletRaw.toString());
  console.log("Wallet mUSDC (approx):", before.walletHuman);
  console.log("Exec mUSDC (raw):     ", before.executorRaw.toString());
  console.log("Exec mUSDC (approx):  ", before.executorHuman);

  const artifact = await hre.artifacts.readArtifact("FlashLoanExecutor");
  const executor = new ethers.Contract(executorAddress, artifact.abi, wallet);

  const amount = ethers.parseUnits("100", 6); // 100 mUSDC

  console.log("\nRunning testMockCycle(100 mUSDC)...");
  const tx = await executor.testMockCycle(mockUsdcAddress, amount);
  console.log("testMockCycle tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("testMockCycle mined in block:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());

  const after = await getBalances(provider, mockUsdcAddress, wallet.address, executorAddress);

  console.log("\n=== AFTER CYCLE ===");
  console.log("Wallet mUSDC (raw):   ", after.walletRaw.toString());
  console.log("Wallet mUSDC (approx):", after.walletHuman);
  console.log("Exec mUSDC (raw):     ", after.executorRaw.toString());
  console.log("Exec mUSDC (approx):  ", after.executorHuman);

  const walletDelta = after.walletRaw - before.walletRaw;
  const execDelta = after.executorRaw - before.executorRaw;

  console.log("\n=== DELTAS (AFTER - BEFORE) ===");
  console.log("Wallet delta (raw):   ", walletDelta.toString());
  console.log("Exec delta (raw):     ", execDelta.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
