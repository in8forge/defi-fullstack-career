import { formatUnits, JsonRpcProvider, Contract } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

// Aave V3 on Arbitrum
const AAVE_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const POOL_DATA_PROVIDER = "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654";

const POOL_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

const provider = new JsonRpcProvider(process.env.ARBITRUM_RPC_URL);

// Known Arbitrum borrowers (we'll discover more)
const USERS_TO_MONITOR = [
  "0x8F9c9D47e587d367c205C22098b02F89d7E8d957",
  "0x1234567890123456789012345678901234567890", // placeholder
];

async function discoverBorrowers() {
  console.log("🔍 Discovering Arbitrum borrowers...");
  
  // Get recent Borrow events
  const poolContract = new Contract(AAVE_POOL, [
    "event Borrow(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 referralCode)"
  ], provider);
  
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = currentBlock - 50000; // ~2 days of blocks
  
  const filter = poolContract.filters.Borrow();
  const events = await poolContract.queryFilter(filter, fromBlock, currentBlock);
  
  const users = [...new Set(events.map(e => e.args.user || e.args.onBehalfOf))];
  console.log(`   Found ${users.length} unique borrowers`);
  
  return users;
}

async function checkPosition(user) {
  const pool = new Contract(AAVE_POOL, POOL_ABI, provider);
  
  try {
    const data = await pool.getUserAccountData(user);
    const totalCollateral = Number(formatUnits(data[0], 8));
    const totalDebt = Number(formatUnits(data[1], 8));
    const healthFactor = Number(formatUnits(data[5], 18));
    
    return { user, collateral: totalCollateral, debt: totalDebt, hf: healthFactor };
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("💀 ARBITRUM LIQUIDATION BOT");
  console.log("=".repeat(60));
  console.log(`\n✅ Connected to Arbitrum`);
  
  await alertLiquidation("🔵 **Arbitrum Bot Started!**\nScanning for liquidation opportunities...");
  
  // Discover borrowers
  let users = await discoverBorrowers();
  
  let checks = 0;
  
  while (true) {
    try {
      checks++;
      
      // Re-discover borrowers every 100 checks
      if (checks % 100 === 0) {
        users = await discoverBorrowers();
      }
      
      let atRisk = 0;
      let liquidatable = 0;
      
      for (const user of users.slice(0, 50)) { // Check top 50
        const position = await checkPosition(user);
        
        if (!position || position.debt === 0) continue;
        
        if (position.hf < 1.5 && position.hf > 0) {
          atRisk++;
          console.log(`⚠️  ${position.user.slice(0,10)}... | HF: ${position.hf.toFixed(4)} | Debt: $${position.debt.toFixed(0)}`);
        }
        
        if (position.hf < 1.0 && position.hf > 0) {
          liquidatable++;
          const msg = `🚨 **ARBITRUM LIQUIDATION!**\n\nUser: \`${position.user.slice(0,10)}...\`\nDebt: $${position.debt.toFixed(2)}\nCollateral: $${position.collateral.toFixed(2)}\nHealth Factor: ${position.hf.toFixed(4)}`;
          console.log(msg);
          await alertLiquidation(msg);
        }
      }
      
      if (checks % 10 === 0) {
        const time = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`\n[${time}] Check #${checks} | Users: ${users.length} | At Risk: ${atRisk} | Liquidatable: ${liquidatable}`);
      }
      
      await new Promise(r => setTimeout(r, 30000)); // Every 30 seconds
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

main().catch(console.error);
