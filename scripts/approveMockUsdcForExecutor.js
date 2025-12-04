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

  console.log("Approver wallet:", wallet.address);
  console.log("Executor address:", executorAddress);
  console.log("MockUSDC token:", mockUsdcAddress);

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function approve(address,uint256) returns (bool)"
  ];

  const token = new ethers.Contract(mockUsdcAddress, erc20Abi, wallet);
  const decimals = await token.decimals();

  const amountHuman = "1000"; // approve 1,000 mUSDC
  const amount = ethers.parseUnits(amountHuman, decimals);

  console.log("Approving", amountHuman, "mUSDC for executor to spend...");
  const tx = await token.approve(executorAddress, amount);
  console.log("Approve tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Approve confirmed in block:", receipt.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
