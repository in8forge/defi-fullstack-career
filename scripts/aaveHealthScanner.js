import { formatUnits, parseUnits, JsonRpcProvider, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Aave V3 addresses
const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const AAVE_ORACLE = "0x54586bE62E3c3580375aE3723C145253060Ca0C2";

// Token addresses
const TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfEDbC6b525Ea9450",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
};

// Aave Pool ABI
const POOL_ABI = [
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getReserveData(address asset) external view returns (tuple(tuple(uint256 data) configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))"
];

// Oracle ABI
const ORACLE_ABI = [
  "function getAssetPrice(address asset) external view returns (uint256)"
];

// Sample test accounts (these are well-known DeFi protocol addresses for testing)
const TEST_ACCOUNTS = [
  "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9", // Aave V2 lending pool
  "0x464C71f6c2F760DdA6093dCB91C24c39e5d6e18c", // Compound
  "0x3dfd23a6c5e8bbcfc9581d2e864a68feb6a076d3", // Another DeFi address
];

async function getAccountHealth(account, provider) {
  try {
    const pool = new Contract(AAVE_POOL, POOL_ABI, provider);
    const accountData = await pool.getUserAccountData(account);
    
    const totalCollateral = accountData[0];
    const totalDebt = accountData[1];
    const healthFactor = accountData[5];
    
    return {
      account,
      totalCollateral: formatUnits(totalCollateral, 8), // Base currency has 8 decimals
      totalDebt: formatUnits(totalDebt, 8),
      healthFactor: formatUnits(healthFactor, 18),
      healthFactorNum: Number(formatUnits(healthFactor, 18)),
      isLiquidatable: healthFactor < parseUnits("1", 18),
      hasDebt: totalDebt > 0n
    };
  } catch (error) {
    return null;
  }
}

async function scanForLiquidations(accounts, provider) {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 AAVE V3 LIQUIDATION SCANNER");
  console.log("=".repeat(80));
  console.log(`\nScanning ${accounts.length} accounts for liquidation opportunities...\n`);
  
  const results = [];
  const liquidatable = [];
  
  for (const account of accounts) {
    const health = await getAccountHealth(account, provider);
    
    if (health) {
      results.push(health);
      
      if (health.hasDebt) {
        const status = health.isLiquidatable ? "🚨 LIQUIDATABLE" : "✅ HEALTHY";
        console.log(`${status} - ${account}`);
        console.log(`   Collateral: $${health.totalCollateral}`);
        console.log(`   Debt: $${health.totalDebt}`);
        console.log(`   Health Factor: ${health.healthFactor}`);
        console.log();
        
        if (health.isLiquidatable) {
          liquidatable.push(health);
        }
      }
    }
  }
  
  return { results, liquidatable };
}

async function calculateLiquidationProfit(account, provider) {
  const pool = new Contract(AAVE_POOL, POOL_ABI, provider);
  const oracle = new Contract(AAVE_ORACLE, ORACLE_ABI, provider);
  
  // Get account data
  const accountData = await pool.getUserAccountData(account);
  const totalDebt = accountData[1];
  
  // Liquidation bonus is typically 5-15% depending on collateral
  // For simulation, assume 10%
  const liquidationBonus = 0.10;
  const maxLiquidationPercent = 0.50; // Can liquidate up to 50% of debt
  
  const debtToLiquidate = totalDebt * BigInt(Math.floor(maxLiquidationPercent * 100)) / 100n;
  const collateralSeized = debtToLiquidate * BigInt(Math.floor((1 + liquidationBonus) * 100)) / 100n;
  const profit = collateralSeized - debtToLiquidate;
  
  return {
    debtToLiquidate: formatUnits(debtToLiquidate, 8),
    collateralSeized: formatUnits(collateralSeized, 8),
    estimatedProfit: formatUnits(profit, 8),
    profitPercent: liquidationBonus * 100
  };
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  // Scan for liquidations
  const { results, liquidatable } = await scanForLiquidations(TEST_ACCOUNTS, provider);
  
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`\nTotal accounts scanned: ${results.length}`);
  console.log(`Accounts with debt: ${results.filter(r => r.hasDebt).length}`);
  console.log(`Liquidatable positions: ${liquidatable.length}`);
  
  if (liquidatable.length > 0) {
    console.log("\n" + "=".repeat(80));
    console.log("💰 LIQUIDATION OPPORTUNITIES");
    console.log("=".repeat(80));
    
    for (const account of liquidatable) {
      console.log(`\n🎯 Account: ${account.account}`);
      console.log(`   Health Factor: ${account.healthFactor}`);
      console.log(`   Total Debt: $${account.totalDebt}`);
      
      const profit = await calculateLiquidationProfit(account.account, provider);
      console.log(`\n   📊 Liquidation Details:`);
      console.log(`   • Debt to liquidate: $${profit.debtToLiquidate}`);
      console.log(`   • Collateral seized: $${profit.collateralSeized}`);
      console.log(`   • Estimated profit: $${profit.estimatedProfit} (${profit.profitPercent}%)`);
    }
  } else {
    console.log("\n✅ No liquidation opportunities found");
    console.log("   This is normal - liquidations are rare events");
    console.log("   Strategy: Monitor continuously and act fast when they appear");
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("HOW LIQUIDATIONS WORK:");
  console.log("=".repeat(80));
  console.log("\n1. Health Factor < 1.0 = Position is underwater");
  console.log("2. Anyone can liquidate up to 50% of debt");
  console.log("3. Liquidator receives collateral + bonus (5-15%)");
  console.log("4. Use flash loan = ZERO capital needed");
  console.log("\n💡 Example:");
  console.log("   • User owes $10,000 USDC");
  console.log("   • Health Factor drops to 0.95");
  console.log("   • You flash loan $5,000 USDC");
  console.log("   • Repay their debt");
  console.log("   • Receive $5,500 worth of ETH collateral");
  console.log("   • Sell ETH → USDC");
  console.log("   • Repay flash loan ($5,000)");
  console.log("   • Keep $500 profit (10% bonus)");
  console.log("\n" + "=".repeat(80) + "\n");
}

main().catch(console.error);
