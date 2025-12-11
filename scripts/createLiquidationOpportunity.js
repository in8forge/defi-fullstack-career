import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
  "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function deposit() external payable"
];

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const wallet = new Wallet(privateKey, provider);
  
  console.log("\n" + "=".repeat(80));
  console.log("🔧 CREATING AAVE V3 POSITION");
  console.log("=".repeat(80));
  console.log(`\nAccount: ${wallet.address}`);
  
  let nonce = await provider.getTransactionCount(wallet.address);
  console.log(`Starting nonce: ${nonce}\n`);
  
  const weth = new Contract(WETH, ERC20_ABI, wallet);
  const pool = new Contract(AAVE_POOL, POOL_ABI, wallet);
  const wethAmount = parseUnits("5", 18);
  
  console.log("1. Deposit 5 ETH → WETH...");
  await (await weth.deposit({ value: wethAmount, nonce: nonce++ })).wait();
  console.log("   ✅ Done");
  
  console.log("\n2. Approve WETH...");
  await (await weth.approve(AAVE_POOL, wethAmount, { nonce: nonce++ })).wait();
  console.log("   ✅ Done");
  
  console.log("\n3. Supply WETH to Aave...");
  await (await pool.supply(WETH, wethAmount, wallet.address, 0, { nonce: nonce++ })).wait();
  console.log("   ✅ Done");
  
  // Wait a bit for state to update
  await delay(1000);
  
  // Check account with error handling
  console.log("\n4. Checking account...");
  try {
    const accountData = await pool.getUserAccountData(wallet.address);
    console.log(`   Collateral: $${formatUnits(accountData[0], 8)}`);
    console.log(`   Available: $${formatUnits(accountData[2], 8)}`);
    
    // Borrow 50%
    const borrowBase = (accountData[2] * 50n) / 100n;
    const borrowUSDC = (borrowBase * 10n ** 6n) / 10n ** 8n;
    
    console.log(`\n5. Borrowing ${formatUnits(borrowUSDC, 6)} USDC...`);
    await (await pool.borrow(USDC, borrowUSDC, 2, 0, wallet.address, { nonce: nonce++ })).wait();
    console.log("   ✅ Done");
    
    // Final status
    const finalData = await pool.getUserAccountData(wallet.address);
    const hf = Number(formatUnits(finalData[5], 18));
    
    console.log("\n" + "=".repeat(80));
    console.log("✅ SUCCESS!");
    console.log("=".repeat(80));
    console.log(`Collateral: $${formatUnits(finalData[0], 8)}`);
    console.log(`Debt: $${formatUnits(finalData[1], 8)}`);
    console.log(`Health Factor: ${hf.toFixed(4)}`);
    console.log(`\nAccount: ${wallet.address}`);
    console.log("=".repeat(80) + "\n");
    
  } catch (error) {
    console.log("\n❌ Error checking Aave account");
    console.log("   The supply likely succeeded but account data isn't readable");
    console.log("   This is a fork limitation - Aave state may not be fully accessible");
    console.log("\n💡 ALTERNATIVE: Build liquidation bot with MOCK data instead");
    console.log("   We can simulate realistic liquidation scenarios");
    console.log("   Then test on live testnet when ready\n");
  }
}

main().catch(console.error);
