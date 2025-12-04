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

  console.log("Minter wallet:", wallet.address);
  console.log("Executor address:", executorAddress);
  console.log("MockUSDC token:", mockUsdcAddress);

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)",
    "function mint(address,uint256) external"
  ];

  const mockUsdc = new ethers.Contract(mockUsdcAddress, erc20Abi, wallet);
  const decimals = await mockUsdc.decimals();

  const amountWallet = ethers.parseUnits("10000", decimals);   // 10,000 mUSDC
  const amountExecutor = ethers.parseUnits("5000", decimals);  // 5,000 mUSDC

  console.log("Minting 10,000 mUSDC to wallet...");
  let tx = await mockUsdc.mint(wallet.address, amountWallet);
  console.log("Mint wallet tx:", tx.hash);
  await tx.wait();

  console.log("Minting 5,000 mUSDC to executor...");
  tx = await mockUsdc.mint(executorAddress, amountExecutor);
  console.log("Mint executor tx:", tx.hash);
  await tx.wait();

  console.log("Minting complete.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
