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

  console.log("Approver (wallet):", wallet.address);
  console.log("Executor:", executorAddress);
  console.log("MockUSDC:", mockUsdcAddress);

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];

  const token = new ethers.Contract(mockUsdcAddress, erc20Abi, wallet);

  const [decimals, symbol] = await Promise.all([
    token.decimals(),
    token.symbol(),
  ]);

  const currentAllowance = await token.allowance(wallet.address, executorAddress);

  console.log("Token symbol:", symbol, "decimals:", decimals.toString());
  console.log("Current allowance (raw):", currentAllowance.toString());

  // Approve 1,000,000 mUSDC (more than enough for tests)
  const amountToApprove = ethers.parseUnits("1000000", decimals);
  console.log("New allowance target (raw):", amountToApprove.toString());

  const tx = await token.approve(executorAddress, amountToApprove);
  console.log("Approve tx hash:", tx.hash);

  const receipt = await tx.wait();
  console.log("Approve tx mined in block:", receipt.blockNumber);

  const newAllowance = await token.allowance(wallet.address, executorAddress);
  console.log("Updated allowance (raw):", newAllowance.toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
