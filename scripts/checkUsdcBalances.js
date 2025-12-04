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

  const usdcAddress = config.usdc;
  const rpcUrl = process.env.SEPOLIA_RPC;
  const privateKey = process.env.PRIVATE_KEY;
  const executorAddress = process.env.FLASH_EXECUTOR_ADDRESS;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC is not set in .env");
  if (!privateKey) throw new Error("PRIVATE_KEY is not set in .env");
  if (!executorAddress) throw new Error("FLASH_EXECUTOR_ADDRESS is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function balanceOf(address) view returns (uint256)"
  ];

  const usdc = new ethers.Contract(usdcAddress, erc20Abi, provider);

  const [decimals, walletRaw, executorRaw] = await Promise.all([
    usdc.decimals(),
    usdc.balanceOf(wallet.address),
    usdc.balanceOf(executorAddress),
  ]);

  const divisor = ethers.parseUnits("1", decimals);

  console.log("USDC token:", usdcAddress);
  console.log("Decimals:", decimals);
  console.log("Wallet address:", wallet.address);
  console.log("Wallet USDC (raw):", walletRaw.toString());
  console.log("Wallet USDC:", walletRaw * 1n / divisor, "(truncated)");
  console.log("Executor address:", executorAddress);
  console.log("Executor USDC (raw):", executorRaw.toString());
  console.log("Executor USDC:", executorRaw * 1n / divisor, "(truncated)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
