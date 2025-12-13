import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const AAVE_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

const CHAINS = {
  Base: { rpc: process.env.BASE_RPC_URL, pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" },
  Arbitrum: { rpc: process.env.ARBITRUM_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  Optimism: { rpc: process.env.OPTIMISM_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  Polygon: { rpc: process.env.POLYGON_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  Avalanche: { rpc: process.env.AVALANCHE_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" }
};

// Load discovered borrowers
function loadBorrowers() {
  try {
    return JSON.parse(fs.readFileSync('./data/borrowers.json', 'utf8'));
  } catch {
    console.log("❌ No borrowers file. Run discoverBorrowers.js first!");
    process.exit(1);
  }
}

async function checkPosition(chain, user) {
  try {
    const config = CHAINS[chain];
    const provider = new JsonRpcProvider(config.rpc);
    const pool = new Contract(config.pool, AAVE_ABI, provider);
    const data = await pool.getUserAccountData(user);
    
    return {
      collateral: Number(formatUnits(data[0], 8)),
      debt: Number(formatUnits(data[1], 8)),
      hf: Number(formatUnits(data[5], 18))
    };
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("⚡ COMPETITIVE LIQUIDATION MONITOR");
  console.log("=".repeat(70));
  
  const borrowers = loadBorrowers();
  
  // Count total
  let total = 0;
  for (const chain of Object.keys(borrowers)) {
    total += borrowers[chain].length;
  }
  console.log(`\n📋 Monitoring ${total} borrowers across 5 chains`);
  console.log(`⏱️  Scanning every 5 seconds for speed\n`);
  
  await alertLiquidation(
    `⚡ **Competitive Liquidator Started!**\n\n` +
    `Monitoring **${total} borrowers**:\n` +
    `• Base: ${borrowers.Base?.length || 0}\n` +
    `• Arbitrum: ${borrowers.Arbitrum?.length || 0}\n` +
    `• Optimism: ${borrowers.Optimism?.length || 0}\n` +
    `• Polygon: ${borrowers.Polygon?.length || 0}\n` +
    `• Avalanche: ${borrowers.Avalanche?.length || 0}`
  );
  
  let scans = 0;
  let alertsSent = {};
  
  while (true) {
    scans++;
    
    let liquidatable = [];
    let critical = [];
    
    for (const [chain, users] of Object.entries(borrowers)) {
      for (const userData of users) {
        const user = userData.user;
        const pos = await checkPosition(chain, user);
        
        if (!pos || pos.debt < 50) continue;
        
        // LIQUIDATABLE (HF < 1.0)
        if (pos.hf > 0 && pos.hf < 1.0) {
          liquidatable.push({ chain, user, ...pos });
          
          // Alert once per user
          if (!alertsSent[user]) {
            alertsSent[user] = true;
            const profit = pos.debt * 0.05;
            
            console.log(`\n🚨🚨🚨 LIQUIDATABLE 🚨🚨🚨`);
            console.log(`   Chain: ${chain}`);
            console.log(`   User: ${user}`);
            console.log(`   Debt: $${pos.debt.toFixed(2)}`);
            console.log(`   HF: ${pos.hf.toFixed(4)}`);
            console.log(`   💰 Potential Profit: $${profit.toFixed(2)}`);
            
            await alertLiquidation(
              `🚨🚨🚨 **LIQUIDATABLE POSITION!** 🚨🚨🚨\n\n` +
              `**Chain:** ${chain}\n` +
              `**User:** \`${user}\`\n` +
              `**Debt:** $${pos.debt.toLocaleString()}\n` +
              `**Collateral:** $${pos.collateral.toLocaleString()}\n` +
              `**Health Factor:** ${pos.hf.toFixed(4)}\n\n` +
              `💰 **Potential Profit: $${profit.toLocaleString()}**`
            );
          }
        }
        
        // CRITICAL (HF < 1.05)
        else if (pos.hf > 0 && pos.hf < 1.05) {
          critical.push({ chain, user, ...pos });
        }
      }
    }
    
    // Status update every 20 scans
    if (scans % 20 === 0) {
      const time = new Date().toLocaleTimeString();
      console.log(`\n[${time}] Scan #${scans}`);
      console.log(`   🚨 Liquidatable: ${liquidatable.length}`);
      console.log(`   ⚠️  Critical (HF < 1.05): ${critical.length}`);
      
      if (critical.length > 0) {
        console.log(`\n   CRITICAL POSITIONS:`);
        for (const p of critical.slice(0, 5)) {
          console.log(`   ${p.chain}: ${p.user.slice(0,10)}... | $${p.debt.toFixed(0)} | HF: ${p.hf.toFixed(4)}`);
        }
      }
    }
    
    // Fast scanning - 5 seconds
    await new Promise(r => setTimeout(r, 5000));
  }
}

main();
