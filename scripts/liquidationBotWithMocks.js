import { formatUnits, parseUnits } from "ethers";

// Mock Aave V3 position data (realistic scenarios)
const MOCK_POSITIONS = [
  {
    account: "0x1234567890123456789012345678901234567890",
    collateral: parseUnits("50000", 8), // $50k in base currency (8 decimals)
    debt: parseUnits("45000", 8),        // $45k debt
    collateralAsset: "WETH",
    debtAsset: "USDC",
    liquidationThreshold: 8250, // 82.5%
    liquidationBonus: 500,      // 5%
    status: "healthy"
  },
  {
    account: "0x2345678901234567890123456789012345678901",
    collateral: parseUnits("100000", 8),
    debt: parseUnits("85000", 8),
    collateralAsset: "WBTC",
    debtAsset: "USDC",
    liquidationThreshold: 8000,
    liquidationBonus: 750, // 7.5%
    status: "risky"
  },
  {
    account: "0x3456789012345678901234567890123456789012",
    collateral: parseUnits("20000", 8),
    debt: parseUnits("19500", 8), // Very close to liquidation!
    collateralAsset: "WETH",
    debtAsset: "DAI",
    liquidationThreshold: 8250,
    liquidationBonus: 500,
    status: "danger"
  },
  {
    account: "0x4567890123456789012345678901234567890123",
    collateral: parseUnits("75000", 8),
    debt: parseUnits("76000", 8), // UNDERWATER!
    collateralAsset: "WETH",
    debtAsset: "USDC",
    liquidationThreshold: 8250,
    liquidationBonus: 500,
    status: "liquidatable"
  }
];

function calculateHealthFactor(collateral, debt, liquidationThreshold) {
  // HF = (collateral * liquidationThreshold / 10000) / debt
  const adjustedCollateral = (collateral * BigInt(liquidationThreshold)) / 10000n;
  if (debt === 0n) return 999999n;
  return (adjustedCollateral * parseUnits("1", 18)) / debt;
}

function calculateLiquidationProfit(position) {
  const maxLiquidatable = (position.debt * 50n) / 100n; // Can liquidate 50% max
  const bonusMultiplier = 10000n + BigInt(position.liquidationBonus);
  const collateralSeized = (maxLiquidatable * bonusMultiplier) / 10000n;
  const profit = collateralSeized - maxLiquidatable;
  
  return {
    debtToRepay: formatUnits(maxLiquidatable, 8),
    collateralReceived: formatUnits(collateralSeized, 8),
    netProfit: formatUnits(profit, 8),
    roi: Number(profit * 10000n / maxLiquidatable) / 100
  };
}

function scanPositions() {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 AAVE V3 LIQUIDATION SCANNER (MOCK DATA)");
  console.log("=".repeat(80));
  console.log("\nScanning for underwater positions...\n");
  
  const results = [];
  
  for (const position of MOCK_POSITIONS) {
    const hf = calculateHealthFactor(
      position.collateral,
      position.debt,
      position.liquidationThreshold
    );
    
    const hfNum = Number(formatUnits(hf, 18));
    const isLiquidatable = hf < parseUnits("1", 18);
    
    const status = isLiquidatable ? "🚨 LIQUIDATABLE" : 
                   hfNum < 1.1 ? "⚠️  DANGER" :
                   hfNum < 1.5 ? "⚠️  RISKY" : "✅ HEALTHY";
    
    console.log(`${status} ${position.account}`);
    console.log(`   Collateral: $${formatUnits(position.collateral, 8)} ${position.collateralAsset}`);
    console.log(`   Debt: $${formatUnits(position.debt, 8)} ${position.debtAsset}`);
    console.log(`   Health Factor: ${hfNum.toFixed(4)}`);
    
    if (isLiquidatable) {
      const profit = calculateLiquidationProfit(position);
      console.log(`   💰 LIQUIDATION OPPORTUNITY:`);
      console.log(`      Repay: $${profit.debtToRepay} ${position.debtAsset}`);
      console.log(`      Receive: $${profit.collateralReceived} ${position.collateralAsset}`);
      console.log(`      Profit: $${profit.netProfit} (${profit.roi.toFixed(2)}% ROI)`);
      
      results.push({ position, profit, hf: hfNum });
    }
    console.log();
  }
  
  return results;
}

function simulateLiquidation(position, profit) {
  console.log("\n" + "=".repeat(80));
  console.log("⚡ SIMULATING LIQUIDATION EXECUTION");
  console.log("=".repeat(80));
  console.log(`\nTarget: ${position.account}`);
  console.log(`Strategy: Flash Loan Liquidation\n`);
  
  console.log("Step 1: Flash loan $" + profit.debtToRepay + " " + position.debtAsset);
  console.log("  ✅ Borrowed from Aave V3");
  
  console.log("\nStep 2: Liquidate position");
  console.log("  ✅ Called liquidationCall()");
  console.log("  ✅ Repaid $" + profit.debtToRepay + " debt");
  console.log("  ✅ Received $" + profit.collateralReceived + " " + position.collateralAsset);
  
  console.log("\nStep 3: Swap collateral → debt asset");
  console.log("  ✅ Swapped " + position.collateralAsset + " → " + position.debtAsset);
  console.log("  ✅ Received $" + profit.collateralReceived + " " + position.debtAsset);
  
  console.log("\nStep 4: Repay flash loan");
  console.log("  ✅ Repaid $" + profit.debtToRepay);
  console.log("  ✅ Flash loan fee: $" + (parseFloat(profit.debtToRepay) * 0.0005).toFixed(2));
  
  const flashLoanFee = parseFloat(profit.debtToRepay) * 0.0005;
  const finalProfit = parseFloat(profit.netProfit) - flashLoanFee;
  
  console.log("\n" + "=".repeat(80));
  console.log("💰 LIQUIDATION SUCCESSFUL!");
  console.log("=".repeat(80));
  console.log(`Gross Profit: $${profit.netProfit}`);
  console.log(`Flash Loan Fee: $${flashLoanFee.toFixed(2)}`);
  console.log(`Net Profit: $${finalProfit.toFixed(2)}`);
  console.log(`ROI: ${(finalProfit / parseFloat(profit.debtToRepay) * 100).toFixed(2)}%`);
  console.log("=".repeat(80) + "\n");
  
  return finalProfit;
}

async function main() {
  // Scan for opportunities
  const opportunities = scanPositions();
  
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total positions scanned: ${MOCK_POSITIONS.length}`);
  console.log(`Liquidatable positions: ${opportunities.length}`);
  
  if (opportunities.length > 0) {
    const totalProfit = opportunities.reduce((sum, opp) => 
      sum + parseFloat(opp.profit.netProfit), 0
    );
    console.log(`Total potential profit: $${totalProfit.toFixed(2)}`);
    
    // Simulate liquidating the best opportunity
    const best = opportunities.sort((a, b) => 
      parseFloat(b.profit.netProfit) - parseFloat(a.profit.netProfit)
    )[0];
    
    console.log(`\nBest opportunity: $${best.profit.netProfit} profit`);
    
    const finalProfit = simulateLiquidation(best.position, best.profit);
    
    console.log("\n" + "=".repeat(80));
    console.log("KEY LEARNINGS:");
    console.log("=".repeat(80));
    console.log("\n✅ Liquidations work with ZERO capital (flash loans)");
    console.log("✅ Profit = (collateral bonus) - (flash loan fee)");
    console.log("✅ One good liquidation = $" + finalProfit.toFixed(0) + " profit");
    console.log("✅ Real liquidations are rare but HIGH value");
    console.log("\n💡 Next: Build actual liquidator contract + scanner");
    console.log("=".repeat(80) + "\n");
  }
}

main().catch(console.error);
