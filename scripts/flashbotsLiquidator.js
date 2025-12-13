import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { FlashbotsBundleProvider } from "@flashbots/ethers-provider-bundle";
import { alertLiquidation } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

// Your deployed liquidator
const FLASH_LIQUIDATOR = process.env.FLASH_LIQUIDATOR_BASE;

const LIQUIDATOR_ABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external"
];

const AAVE_POOL_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

// Base doesn't have Flashbots, but Arbitrum/Ethereum do
// For Base, we use private transactions via Alchemy

async function executeLiquidation(user, debtAsset, collateralAsset, debtAmount, chain) {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  const liquidator = new Contract(FLASH_LIQUIDATOR, LIQUIDATOR_ABI, wallet);
  
  console.log(`\n🎯 EXECUTING LIQUIDATION`);
  console.log(`   User: ${user}`);
  console.log(`   Debt: $${debtAmount}`);
  
  try {
    // Get optimal gas price (slightly higher to win)
    const feeData = await provider.getFeeData();
    const maxFee = feeData.maxFeePerGas * 120n / 100n; // 20% higher
    const priorityFee = feeData.maxPriorityFeePerGas * 150n / 100n; // 50% higher priority
    
    console.log(`   Gas: ${formatUnits(maxFee, 'gwei')} gwei (boosted)`);
    
    // Execute with boosted gas
    const tx = await liquidator.executeLiquidation(
      collateralAsset,
      debtAsset,
      user,
      parseUnits(debtAmount.toString(), 6), // Assuming USDC debt
      {
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: priorityFee,
        gasLimit: 800000
      }
    );
    
    console.log(`   📤 TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      const gasUsed = receipt.gasUsed;
      const gasCost = Number(formatUnits(gasUsed * maxFee, 18));
      const profit = debtAmount * 0.05 - gasCost; // 5% bonus - gas
      
      console.log(`   ✅ SUCCESS!`);
      console.log(`   💰 Estimated Profit: $${profit.toFixed(2)}`);
      
      await alertLiquidation(
        `🎉 **LIQUIDATION SUCCESSFUL!**\n\n` +
        `User: \`${user.slice(0,10)}...\`\n` +
        `Debt Covered: $${debtAmount.toFixed(2)}\n` +
        `Gas Cost: $${gasCost.toFixed(4)}\n` +
        `**Profit: $${profit.toFixed(2)}**\n\n` +
        `TX: ${tx.hash}`
      );
      
      return { success: true, profit, txHash: tx.hash };
    } else {
      console.log(`   ❌ TX Failed`);
      return { success: false };
    }
    
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 50)}`);
    return { success: false, error: e.message };
  }
}

// Priority gas auction - outbid competitors
async function calculateWinningGas(provider, estimatedProfit) {
  const feeData = await provider.getFeeData();
  
  // Willing to pay up to 50% of profit for gas
  const maxGasBudget = estimatedProfit * 0.5;
  const gasLimit = 500000n;
  
  // Calculate max we can pay per gas
  const maxGasPrice = parseUnits((maxGasBudget / 500000).toFixed(9), 'gwei');
  
  return {
    maxFeePerGas: maxGasPrice > feeData.maxFeePerGas ? maxGasPrice : feeData.maxFeePerGas * 2n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 3n,
    gasLimit
  };
}

// Monitor and execute
async function monitorAndExecute() {
  console.log("\n" + "=".repeat(60));
  console.log("⚡ COMPETITIVE LIQUIDATION BOT");
  console.log("=".repeat(60));
  console.log("\n🎯 Strategy: Boosted gas + instant execution\n");
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const pool = new Contract("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", AAVE_POOL_ABI, provider);
  
  // Load discovered borrowers
  let borrowers = [];
  try {
    const data = JSON.parse(require('fs').readFileSync('./data/borrowers.json', 'utf8'));
    borrowers = data.Base || [];
    console.log(`📋 Loaded ${borrowers.length} Base borrowers\n`);
  } catch {
    console.log("⚠️ No borrowers file found. Run discoverBorrowers.js first.\n");
  }
  
  let scans = 0;
  let executions = 0;
  let profits = 0;
  
  while (true) {
    scans++;
    
    for (const borrower of borrowers) {
      try {
        const data = await pool.getUserAccountData(borrower.user);
        const debt = Number(formatUnits(data[1], 8));
        const hf = Number(formatUnits(data[5], 18));
        
        // LIQUIDATABLE!
        if (hf > 0 && hf < 1.0 && debt > 50) {
          console.log(`\n🚨 LIQUIDATABLE: ${borrower.user.slice(0,10)}... | HF: ${hf.toFixed(4)} | Debt: $${debt.toFixed(0)}`);
          
          // Calculate if profitable
          const bonus = debt * 0.05; // 5% liquidation bonus
          const estimatedGas = 0.50; // ~$0.50 on Base
          const profit = bonus - estimatedGas;
          
          if (profit > 1) { // Only if profit > $1
            console.log(`   💰 Expected Profit: $${profit.toFixed(2)}`);
            
            // EXECUTE!
            const result = await executeLiquidation(
              borrower.user,
              "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
              "0x4200000000000000000000000000000000000006", // WETH
              debt * 0.5, // Liquidate 50%
              "Base"
            );
            
            if (result.success) {
              executions++;
              profits += result.profit;
            }
          }
        }
        
      } catch {}
    }
    
    if (scans % 10 === 0) {
      const time = new Date().toLocaleTimeString();
      console.log(`[${time}] Scans: ${scans} | Executions: ${executions} | Profits: $${profits.toFixed(2)}`);
    }
    
    // Scan every 3 seconds for speed
    await new Promise(r => setTimeout(r, 3000));
  }
}

monitorAndExecute();
