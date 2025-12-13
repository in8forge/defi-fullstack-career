import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const SCAN_INTERVAL = 1000;
const MIN_PROFIT_USD = 10;
const GAS_BOOST = 2;
const AUTO_EXECUTE = process.env.ENABLE_EXECUTION === "true";

const CHAINS = {
  Base: {
    rpc: process.env.BASE_RPC_URL,
    pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    liquidator: process.env.FLASH_LIQUIDATOR_BASE
  },
  Polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    liquidator: null
  },
  Avalanche: {
    rpc: process.env.AVALANCHE_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    liquidator: null
  }
};

const AAVE_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

async function checkPosition(chainConfig, user) {
  try {
    const provider = new JsonRpcProvider(chainConfig.rpc);
    const pool = new Contract(chainConfig.pool, AAVE_ABI, provider);
    const data = await pool.getUserAccountData(user);
    return {
      collateral: Number(formatUnits(data[0], 8)),
      debt: Number(formatUnits(data[1], 8)),
      hf: Number(formatUnits(data[5], 18))
    };
  } catch { return null; }
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🏆 WINNING LIQUIDATION BOT");
  console.log("=".repeat(70));
  console.log(`\n⚡ Speed: ${SCAN_INTERVAL}ms`);
  console.log(`💰 Min profit: $${MIN_PROFIT_USD}`);
  console.log(`🤖 Auto-execute: ${AUTO_EXECUTE ? "ON" : "OFF"}\n`);

  const borrowers = JSON.parse(fs.readFileSync('./data/borrowers.json', 'utf8'));
  
  const criticalUsers = [];
  for (const [chain, users] of Object.entries(borrowers)) {
    if (!CHAINS[chain]) continue;
    for (const u of users) {
      if (u.hf < 1.15) criticalUsers.push({ chain, ...u });
    }
  }
  
  console.log(`🎯 Monitoring ${criticalUsers.length} critical positions\n`);
  
  await alertLiquidation(`🏆 **Winning Bot Started!**\n\n⚡ ${SCAN_INTERVAL}ms scans\n🎯 ${criticalUsers.length} critical positions`);
  
  let scans = 0;
  const alerted = new Set();
  
  while (true) {
    scans++;
    
    for (const target of criticalUsers) {
      const chainConfig = CHAINS[target.chain];
      const pos = await checkPosition(chainConfig, target.user);
      
      if (!pos || pos.debt < 100) continue;
      
      if (pos.hf > 0 && pos.hf < 1.0 && !alerted.has(target.user)) {
        alerted.add(target.user);
        const profit = pos.debt * 0.05;
        
        console.log(`\n🚨🚨🚨 LIQUIDATABLE! 🚨🚨🚨`);
        console.log(`   ${target.chain} | ${target.user}`);
        console.log(`   Debt: $${pos.debt.toLocaleString()} | HF: ${pos.hf.toFixed(4)}`);
        console.log(`   💰 Profit: $${profit.toLocaleString()}`);
        
        await alertLiquidation(
          `🚨 **LIQUIDATABLE!**\n\n` +
          `**${target.chain}**\n` +
          `User: \`${target.user}\`\n` +
          `Debt: $${pos.debt.toLocaleString()}\n` +
          `HF: ${pos.hf.toFixed(4)}\n` +
          `💰 Profit: $${profit.toLocaleString()}`
        );
      }
      
      else if (pos.hf < 1.02 && scans % 20 === 0) {
        console.log(`⚠️ CLOSE: ${target.chain} | ${target.user.slice(0,12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      }
    }
    
    if (scans % 60 === 0) {
      const time = new Date().toLocaleTimeString();
      console.log(`\n[${time}] Scans: ${scans} | Monitoring ${criticalUsers.length} positions`);
    }
    
    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

main();
