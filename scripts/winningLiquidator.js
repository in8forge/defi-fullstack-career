import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const SCAN_INTERVAL = 1000;
const MIN_PROFIT_USD = 10;
const AUTO_EXECUTE = process.env.ENABLE_EXECUTION === "true";

const CHAINS = {
  Base: {
    rpc: process.env.BASE_RPC_URL,
    pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    liquidator: process.env.FLASH_LIQUIDATOR_BASE,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    weth: "0x4200000000000000000000000000000000000006"
  },
  Polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    liquidator: process.env.FLASH_LIQUIDATOR_POLYGON,
    usdc: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    weth: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619"
  },
  Avalanche: {
    rpc: process.env.AVALANCHE_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    liquidator: process.env.FLASH_LIQUIDATOR_AVALANCHE,
    usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    weth: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB"
  },
  Arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    liquidator: process.env.FLASH_LIQUIDATOR_ARBITRUM,
    usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
  },
  Optimism: {
    rpc: process.env.OPTIMISM_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    liquidator: process.env.FLASH_LIQUIDATOR_OPTIMISM,
    usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    weth: "0x4200000000000000000000000000000000000006"
  }
};

const AAVE_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

const LIQUIDATOR_ABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external"
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

async function executeLiquidation(chain, chainConfig, user, debt) {
  if (!chainConfig.liquidator) {
    console.log(`   ⚠️ No liquidator on ${chain}`);
    return { success: false };
  }
  
  if (!AUTO_EXECUTE) {
    console.log(`   ⚠️ Auto-execute OFF. Set ENABLE_EXECUTION=true`);
    return { success: false };
  }
  
  try {
    const provider = new JsonRpcProvider(chainConfig.rpc);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    const liquidator = new Contract(chainConfig.liquidator, LIQUIDATOR_ABI, wallet);
    
    const debtToCover = parseUnits((debt * 0.5).toFixed(6), 6);
    
    console.log(`\n   🚀 EXECUTING on ${chain}...`);
    console.log(`   Debt to cover: $${(debt * 0.5).toFixed(2)}`);
    
    const tx = await liquidator.executeLiquidation(
      chainConfig.weth,
      chainConfig.usdc,
      user,
      debtToCover
    );
    
    console.log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      const profit = debt * 0.5 * 0.05;
      console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
      
      await alertLiquidation(
        `🎉🎉🎉 **LIQUIDATION SUCCESS!** 🎉🎉🎉\n\n` +
        `**${chain}**\n` +
        `User: \`${user}\`\n` +
        `Profit: ~$${profit.toFixed(2)}\n` +
        `TX: \`${tx.hash}\``
      );
      
      return { success: true, profit };
    }
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 50)}`);
  }
  
  return { success: false };
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🏆 WINNING LIQUIDATION BOT - ALL CHAINS");
  console.log("=".repeat(70));
  console.log(`\n⚡ Speed: ${SCAN_INTERVAL}ms`);
  console.log(`💰 Min profit: $${MIN_PROFIT_USD}`);
  console.log(`🤖 Auto-execute: ${AUTO_EXECUTE ? "ON 🟢" : "OFF 🔴"}`);
  
  // Show liquidators
  console.log(`\n📋 Liquidators deployed:`);
  for (const [chain, config] of Object.entries(CHAINS)) {
    const status = config.liquidator ? "✅" : "❌";
    console.log(`   ${status} ${chain}: ${config.liquidator || "Not deployed"}`);
  }

  const borrowers = JSON.parse(fs.readFileSync('./data/borrowers.json', 'utf8'));
  
  const criticalUsers = [];
  for (const [chain, users] of Object.entries(borrowers)) {
    if (!CHAINS[chain]) continue;
    for (const u of users) {
      if (u.hf < 1.15) criticalUsers.push({ chain, ...u });
    }
  }
  
  // Sort by HF (lowest first = most urgent)
  criticalUsers.sort((a, b) => a.hf - b.hf);
  
  console.log(`\n🎯 Monitoring ${criticalUsers.length} critical positions`);
  console.log(`💰 Total potential: $${criticalUsers.reduce((s, u) => s + u.debt * 0.05, 0).toLocaleString()}\n`);
  
  await alertLiquidation(
    `🏆 **Multi-Chain Liquidator Started!**\n\n` +
    `⚡ ${SCAN_INTERVAL}ms scans\n` +
    `🎯 ${criticalUsers.length} critical positions\n` +
    `🌐 5 chains active\n` +
    `💰 $${criticalUsers.reduce((s, u) => s + u.debt * 0.05, 0).toLocaleString()} potential`
  );
  
  let scans = 0;
  let executions = 0;
  let totalProfit = 0;
  const alerted = new Set();
  
  while (true) {
    scans++;
    
    for (const target of criticalUsers) {
      const chainConfig = CHAINS[target.chain];
      const pos = await checkPosition(chainConfig, target.user);
      
      if (!pos || pos.debt < 100) continue;
      
      // 🚨 LIQUIDATABLE
      if (pos.hf > 0 && pos.hf < 1.0) {
        const profit = pos.debt * 0.05;
        
        if (!alerted.has(target.user)) {
          alerted.add(target.user);
          
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
          
          // Execute if profitable
          if (profit >= MIN_PROFIT_USD) {
            const result = await executeLiquidation(target.chain, chainConfig, target.user, pos.debt);
            if (result.success) {
              executions++;
              totalProfit += result.profit;
            }
          }
        }
      }
      
      // ⚠️ Very close - log it
      else if (pos.hf < 1.02 && scans % 20 === 0) {
        console.log(`⚠️ CLOSE: ${target.chain} | ${target.user.slice(0,12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      }
    }
    
    // Status every 60 scans
    if (scans % 60 === 0) {
      const time = new Date().toLocaleTimeString();
      console.log(`\n[${time}] Scans: ${scans} | Executions: ${executions} | Profit: $${totalProfit.toFixed(2)}`);
    }
    
    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

main();
