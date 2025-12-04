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

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)"
  ];

  const token = new ethers.Contract(mockUsdcAddress, erc20Abi, provider);

  const [decimals, walletRaw, executorRaw] = await Promise.all([
    token.decimals(),
    token.balanceOf(wallet.address),
    token.balanceOf(executorAddress),
  ]);

  const divisor = ethers.parseUnits("1", decimals);

  console.log("MockUSDC token:", mockUsdcAddress);
  console.log("Decimals:", decimals);
  console.log("Wallet address:", wallet.address);
  console.log("Wallet mUSDC (raw):", walletRaw.toString());
  console.log("Wallet mUSDC:", walletRaw * 1n / divisor, "(truncated)");
  console.log("Executor address:", executorAddress);
  console.log("Executor mUSDC (raw):", executorRaw.toString());
  console.log("Executor mUSDC:", executorRaw * 1n / divisor, "(truncated)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
