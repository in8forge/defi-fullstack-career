import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { AAVE_CONFIG } from "../config/aaveLiquidation.config.js";
import dotenv from "dotenv";

dotenv.config();

// Read from .env
const EXECUTION_ENABLED = process.env.ENABLE_LIQUIDATION === "true";
const LIQUIDATOR_ADDRESS = process.env.FLASH_LIQUIDATOR_BASE;

console.log("DEBUG - ENABLE_LIQUIDATION:", process.env.ENABLE_LIQUIDATION);
console.log("DEBUG - FLASH_LIQUIDATOR_BASE:", process.env.FLASH_LIQUIDATOR_BASE);

// ABIs
const POOL_ABI = [
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)"
];

const POOL_DATA_PROVIDER_ABI = [
  "function getAllReservesTokens() external view returns ((string symbol, address tokenAddress)[])",
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)"
];

const ORACLE_ABI = [
  "function getAssetPrice(address asset) external view returns (uint256)"
];

const ATOKEN_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

const LIQUIDATOR_ABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external",
  "function withdrawProfit(address token) external"
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)"
];

async function getHealthFactor(pool, userAddress) {
  try {
    const data = await pool.getUserAccountData(userAddress);
    return {
      totalCollateralUSD: Number(formatUnits(data.totalCollateralBase, 8)),
      totalDebtUSD: Number(formatUnits(data.totalDebtBase, 8)),
      healthFactor: Number(formatUnits(data.healthFactor, 18)),
      ltv: Number(data.ltv) / 100
    };
  } catch {
    return null;
  }
}

async function getUserPositionDetails(dataProvider, oracle, user) {
  const details = { collaterals: [], debts: [] };
  
  for (const [symbol, asset] of Object.entries(AAVE_CONFIG.assets)) {
    try {
      const reserveData = await dataProvider.getUserReserveData(asset.address, user);
      const price = await oracle.getAssetPrice(asset.address);
      const priceUSD = Number(formatUnits(price, 8));
      
      if (reserveData.currentATokenBalance > 0n) {
        const amount = Number(formatUnits(reserveData.currentATokenBalance, asset.decimals));
        details.collaterals.push({ symbol, address: asset.address, amount, valueUSD: amount * priceUSD });
      }
      
      const totalDebt = reserveData.currentStableDebt + reserveData.currentVariableDebt;
      if (totalDebt > 0n) {
        const amount = Number(formatUnits(totalDebt, asset.decimals));
        details.debts.push({ symbol, address: asset.address, amount, rawAmount: totalDebt, valueUSD: amount * priceUSD, decimals: asset.decimals });
      }
    } catch {}
  }
  
  return details;
}

async function findLiquidatablePositions(provider) {
  console.log("\n🔍 Scanning Aave V3 for liquidatable positions...\n");
  
  const pool = new Contract(AAVE_CONFIG.poolAddress, POOL_ABI, provider);
  const dataProvider = new Contract(AAVE_CONFIG.poolDataProvider, POOL_DATA_PROVIDER_ABI, provider);
  const oracle = new Contract(AAVE_CONFIG.oracle, ORACLE_ABI, provider);
  
  const liquidatable = [];
  const checked = new Set();
  
  for (const asset of Object.values(AAVE_CONFIG.assets)) {
    if (!asset.aToken) continue;
    
    const aToken = new Contract(asset.aToken, ATOKEN_ABI, provider);
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 500;
    
    try {
      const filter = aToken.filters.Transfer();
      const events = await aToken.queryFilter(filter, fromBlock, currentBlock);
      
      for (const event of events) {
        const user = event.args.to;
        if (checked.has(user) || user === "0x0000000000000000000000000000000000000000") continue;
        checked.add(user);
        
        const health = await getHealthFactor(pool, user);
        
        if (health && health.healthFactor < 1.0 && health.healthFactor > 0 && health.totalDebtUSD > 10) {
          const details = await getUserPositionDetails(dataProvider, oracle, user);
          
          if (details.collaterals.length > 0 && details.debts.length > 0) {
            const bestCollateral = details.collaterals.sort((a, b) => b.valueUSD - a.valueUSD)[0];
            const bestDebt = details.debts.sort((a, b) => b.valueUSD - a.valueUSD)[0];
            
            const maxDebtToCover = bestDebt.valueUSD * 0.5;
            const expectedProfit = maxDebtToCover * 0.05;
            
            liquidatable.push({
              user,
              healthFactor: health.healthFactor,
              totalCollateralUSD: health.totalCollateralUSD,
              totalDebtUSD: health.totalDebtUSD,
              collateralAsset: bestCollateral.address,
              collateralSymbol: bestCollateral.symbol,
              debtAsset: bestDebt.address,
              debtSymbol: bestDebt.symbol,
              debtToCover: bestDebt.rawAmount / 2n,
              debtToCoverUSD: maxDebtToCover,
              expectedProfit
            });
            
            console.log(`🚨 LIQUIDATABLE: ${user.slice(0, 10)}...`);
            console.log(`   Health Factor: ${health.healthFactor.toFixed(4)}`);
            console.log(`   Collateral: $${health.totalCollateralUSD.toFixed(2)} (${bestCollateral.symbol})`);
            console.log(`   Debt: $${health.totalDebtUSD.toFixed(2)} (${bestDebt.symbol})`);
            console.log(`   💰 Expected Profit: $${expectedProfit.toFixed(2)}\n`);
          }
        }
      }
    } catch {}
  }
  
  console.log(`📊 Checked ${checked.size} users`);
  return liquidatable;
}

async function executeLiquidation(position, wallet) {
  if (!EXECUTION_ENABLED) {
    console.log("\n⚠️  EXECUTION DISABLED - Set ENABLE_LIQUIDATION=true");
    return false;
  }
  
  if (!LIQUIDATOR_ADDRESS) {
    console.log("\n⚠️  LIQUIDATOR NOT DEPLOYED");
    return false;
  }
  
  console.log(`\n⚡ EXECUTING LIQUIDATION!`);
  console.log(`   Target: ${position.user}`);
  console.log(`   Debt: $${position.debtToCoverUSD.toFixed(2)} ${position.debtSymbol}`);
  
  try {
    const liquidator = new Contract(LIQUIDATOR_ADDRESS, LIQUIDATOR_ABI, wallet);
    
    const tx = await liquidator.executeLiquidation(
      position.collateralAsset,
      position.debtAsset,
      position.user,
      position.debtToCover
    );
    
    console.log(`   TX: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`   ✅ SUCCESS! Block: ${receipt.blockNumber}`);
    return true;
    
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("💀 AAVE V3 LIQUIDATION BOT - BASE");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`\n✅ Connected to Base`);
  console.log(`👛 Wallet: ${wallet.address}`);
  
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`💰 ETH: ${formatUnits(ethBalance, 18)} ETH`);
  
  console.log(`\n📊 Settings:`);
  console.log(`   Pool: ${AAVE_CONFIG.poolAddress}`);
  console.log(`   Min Profit: $${AAVE_CONFIG.settings.minProfitUSD}`);
  console.log(`   Execution: ${EXECUTION_ENABLED ? "✅ ENABLED" : "❌ DISABLED"}`);
  console.log(`   Liquidator: ${LIQUIDATOR_ADDRESS || "NOT SET"}`);
  
  console.log("\n" + "=".repeat(80));
  console.log("👀 SCANNING...");
  console.log("=".repeat(80));
  
  let scans = 0, found = 0, executed = 0;
  
  while (true) {
    try {
      scans++;
      const positions = await findLiquidatablePositions(provider);
      found += positions.length;
      
      for (const pos of positions) {
        if (pos.expectedProfit >= AAVE_CONFIG.settings.minProfitUSD) {
          console.log("\n💰💰💰 PROFITABLE LIQUIDATION! 💰💰💰");
          if (await executeLiquidation(pos, wallet)) executed++;
        }
      }
      
      const now = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(`\n[${now}] Scan #${scans} | Found: ${found} | Executed: ${executed} | Waiting 60s...\n`);
      console.log("=".repeat(80));
      
      await new Promise(r => setTimeout(r, 60000));
    } catch (error) {
      console.log(`⚠️ ${error.message}`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

main().catch(console.error);
