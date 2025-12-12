import { formatUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { AAVE_CONFIG } from "../config/aaveLiquidation.config.js";
import dotenv from "dotenv";

dotenv.config();

const EXECUTION_ENABLED = process.env.ENABLE_LIQUIDATION === "true";
const LIQUIDATOR_ADDRESS = process.env.FLASH_LIQUIDATOR_BASE;

const POOL_ABI = [
  "function getUserAccountData(address user) external view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)"
];

const POOL_DATA_PROVIDER_ABI = [
  "function getUserReserveData(address asset, address user) external view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)"
];

const ORACLE_ABI = [
  "function getAssetPrice(address asset) external view returns (uint256)"
];

const LIQUIDATOR_ABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external"
];

const knownUsers = new Set();

async function getHealthFactor(pool, user) {
  try {
    const data = await pool.getUserAccountData(user);
    const healthFactor = Number(formatUnits(data.healthFactor, 18));
    if (data.totalDebtBase === 0n || healthFactor > 100) return null;
    return {
      totalCollateralUSD: Number(formatUnits(data.totalCollateralBase, 8)),
      totalDebtUSD: Number(formatUnits(data.totalDebtBase, 8)),
      healthFactor
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
        details.collaterals.push({ symbol, address: asset.address, valueUSD: amount * priceUSD });
      }
      
      const totalDebt = reserveData.currentStableDebt + reserveData.currentVariableDebt;
      if (totalDebt > 0n) {
        const amount = Number(formatUnits(totalDebt, asset.decimals));
        details.debts.push({ symbol, address: asset.address, rawAmount: totalDebt, valueUSD: amount * priceUSD });
      }
    } catch {}
  }
  return details;
}

async function discoverUsers(pool, provider) {
  console.log("🔎 Discovering Aave users (10 block chunks)...");
  
  const currentBlock = await provider.getBlockNumber();
  let totalEvents = 0;
  
  // Scan in 10-block chunks (Alchemy free tier limit)
  for (let i = 0; i < 50; i++) { // 50 chunks = 500 blocks
    const toBlock = currentBlock - (i * 10);
    const fromBlock = toBlock - 9;
    
    try {
      const borrowFilter = pool.filters.Borrow();
      const events = await pool.queryFilter(borrowFilter, fromBlock, toBlock);
      
      for (const event of events) {
        if (event.args.onBehalfOf) knownUsers.add(event.args.onBehalfOf);
      }
      totalEvents += events.length;
    } catch {}
    
    // Small delay to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }
  
  knownUsers.delete("0x0000000000000000000000000000000000000000");
  console.log(`   Found ${totalEvents} borrow events`);
  console.log(`   📊 Total known users: ${knownUsers.size}\n`);
}

async function findLiquidatablePositions(provider) {
  console.log("🔍 Checking users for liquidatable positions...\n");
  
  const pool = new Contract(AAVE_CONFIG.poolAddress, POOL_ABI, provider);
  const dataProvider = new Contract(AAVE_CONFIG.poolDataProvider, POOL_DATA_PROVIDER_ABI, provider);
  const oracle = new Contract(AAVE_CONFIG.oracle, ORACLE_ABI, provider);
  
  const liquidatable = [];
  let checked = 0, withDebt = 0, atRisk = 0;
  
  for (const user of knownUsers) {
    checked++;
    const health = await getHealthFactor(pool, user);
    if (!health) continue;
    
    withDebt++;
    
    if (health.healthFactor < 1.5) {
      atRisk++;
      console.log(`⚠️  AT RISK: ${user.slice(0, 10)}... | HF: ${health.healthFactor.toFixed(4)} | Debt: $${health.totalDebtUSD.toFixed(0)}`);
    }
    
    if (health.healthFactor < 1.0 && health.totalDebtUSD > 10) {
      const details = await getUserPositionDetails(dataProvider, oracle, user);
      
      if (details.collaterals.length > 0 && details.debts.length > 0) {
        const bestCol = details.collaterals.sort((a, b) => b.valueUSD - a.valueUSD)[0];
        const bestDebt = details.debts.sort((a, b) => b.valueUSD - a.valueUSD)[0];
        const expectedProfit = bestDebt.valueUSD * 0.5 * 0.05;
        
        liquidatable.push({
          user,
          healthFactor: health.healthFactor,
          totalCollateralUSD: health.totalCollateralUSD,
          totalDebtUSD: health.totalDebtUSD,
          collateralAsset: bestCol.address,
          collateralSymbol: bestCol.symbol,
          debtAsset: bestDebt.address,
          debtSymbol: bestDebt.symbol,
          debtToCover: bestDebt.rawAmount / 2n,
          debtToCoverUSD: bestDebt.valueUSD * 0.5,
          expectedProfit
        });
        
        console.log(`\n🚨 LIQUIDATABLE: ${user.slice(0, 10)}...`);
        console.log(`   HF: ${health.healthFactor.toFixed(4)} | Debt: $${health.totalDebtUSD.toFixed(0)}`);
        console.log(`   💰 Expected Profit: $${expectedProfit.toFixed(2)}\n`);
      }
    }
  }
  
  console.log(`\n📊 Checked: ${checked} | With Debt: ${withDebt} | At Risk: ${atRisk} | Liquidatable: ${liquidatable.length}`);
  return liquidatable;
}

async function executeLiquidation(position, wallet) {
  if (!EXECUTION_ENABLED || !LIQUIDATOR_ADDRESS) return false;
  
  console.log(`\n⚡ EXECUTING LIQUIDATION on ${position.user.slice(0, 10)}...`);
  
  try {
    const liquidator = new Contract(LIQUIDATOR_ADDRESS, LIQUIDATOR_ABI, wallet);
    const tx = await liquidator.executeLiquidation(
      position.collateralAsset,
      position.debtAsset,
      position.user,
      position.debtToCover
    );
    console.log(`   TX: ${tx.hash}`);
    await tx.wait();
    console.log(`   ✅ SUCCESS!`);
    return true;
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message.slice(0, 80)}`);
    return false;
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("💀 AAVE V3 LIQUIDATION BOT - BASE");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`\n✅ Connected | Wallet: ${wallet.address}`);
  console.log(`💰 ETH: ${formatUnits(await provider.getBalance(wallet.address), 18)}`);
  console.log(`📊 Execution: ${EXECUTION_ENABLED ? "✅ ON" : "❌ OFF"} | Liquidator: ${LIQUIDATOR_ADDRESS ? "✅" : "❌"}\n`);
  
  const pool = new Contract(AAVE_CONFIG.poolAddress, POOL_ABI, provider);
  
  console.log("=".repeat(80));
  await discoverUsers(pool, provider);
  
  let scans = 0, found = 0, executed = 0;
  
  while (true) {
    try {
      scans++;
      if (scans % 5 === 0) await discoverUsers(pool, provider);
      
      const positions = await findLiquidatablePositions(provider);
      found += positions.length;
      
      for (const pos of positions) {
        if (pos.expectedProfit >= AAVE_CONFIG.settings.minProfitUSD) {
          console.log("\n💰💰💰 PROFITABLE! EXECUTING... 💰💰💰");
          if (await executeLiquidation(pos, wallet)) executed++;
        }
      }
      
      const now = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(`\n[${now}] Scan #${scans} | Users: ${knownUsers.size} | Found: ${found} | Executed: ${executed}\n`);
      console.log("=".repeat(80));
      
      await new Promise(r => setTimeout(r, 60000));
    } catch (error) {
      console.log(`⚠️ ${error.message}`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

main().catch(console.error);
