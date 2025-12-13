import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const SCAN_INTERVAL = 2000;      // 2 seconds between position checks
const DISCOVERY_INTERVAL = 300000; // Discover new borrowers every 5 minutes
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
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)",
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)"
];

const LIQUIDATOR_ABI = [
  "function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external"
];

// ============ DISCOVERY ============
async function discoverNewBorrowers(chain, chainConfig, existingUsers) {
  try {
    const provider = new JsonRpcProvider(chainConfig.rpc);
    const pool = new Contract(chainConfig.pool, AAVE_ABI, provider);
    
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = currentBlock - 1000; // Last ~30 minutes
    
    const events = await pool.queryFilter(pool.filters.Borrow(), fromBlock, currentBlock);
    
    const newUsers = [];
    for (const event of events) {
      const user = event.args?.user || event.args?.onBehalfOf;
      if (user && !existingUsers.has(user)) {
        newUsers.push(user);
        existingUsers.add(user);
      }
    }
    
    return newUsers;
  } catch {
    return [];
  }
}

async function discoverAllChains(allUsers) {
  let totalNew = 0;
  
  for (const [chain, config] of Object.entries(CHAINS)) {
    if (!allUsers[chain]) allUsers[chain] = new Set();
    
    const newUsers = await discoverNewBorrowers(chain, config, allUsers[chain]);
    
    if (newUsers.length > 0) {
      console.log(`   📥 ${chain}: +${newUsers.length} new borrowers`);
      totalNew += newUsers.length;
    }
  }
  
  return totalNew;
}

// ============ POSITION CHECK ============
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

// ============ EXECUTION ============
async function executeLiquidation(chain, chainConfig, user, debt) {
  if (!chainConfig.liquidator || !AUTO_EXECUTE) return { success: false };
  
  try {
    const provider = new JsonRpcProvider(chainConfig.rpc);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    const liquidator = new Contract(chainConfig.liquidator, LIQUIDATOR_ABI, wallet);
    
    const debtToCover = parseUnits((debt * 0.5).toFixed(6), 6);
    
    console.log(`\n   🚀 EXECUTING on ${chain}...`);
    
    const tx = await liquidator.executeLiquidation(
      chainConfig.weth,
      chainConfig.usdc,
      user,
      debtToCover,
      { gasLimit: 800000 }
    );
    
    console.log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      const profit = debt * 0.5 * 0.05;
      console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
      
      await alertLiquidation(
        `🎉🎉🎉 **LIQUIDATION SUCCESS!** 🎉🎉🎉\n\n` +
        `**${chain}**\n` +
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

// ============ MAIN ============
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🏆 WINNING LIQUIDATION BOT - AUTO DISCOVERY");
  console.log("=".repeat(70));
  console.log(`\n⚡ Scan interval: ${SCAN_INTERVAL}ms`);
  console.log(`🔍 Discovery interval: ${DISCOVERY_INTERVAL / 1000}s`);
  console.log(`💰 Min profit: $${MIN_PROFIT_USD}`);
  console.log(`🤖 Auto-execute: ${AUTO_EXECUTE ? "ON 🟢" : "OFF 🔴"}`);
  
  console.log(`\n📋 Liquidators:`);
  for (const [chain, config] of Object.entries(CHAINS)) {
    console.log(`   ✅ ${chain}: ${config.liquidator}`);
  }

  // Load existing borrowers
  let borrowersData = {};
  try {
    borrowersData = JSON.parse(fs.readFileSync('./data/borrowers.json', 'utf8'));
  } catch {}
  
  // Convert to Sets for easy lookup
  const allUsers = {};
  for (const [chain, users] of Object.entries(borrowersData)) {
    allUsers[chain] = new Set(users.map(u => u.user));
  }
  
  const totalUsers = Object.values(allUsers).reduce((s, set) => s + set.size, 0);
  console.log(`\n📊 Loaded ${totalUsers} existing borrowers`);
  
  await alertLiquidation(
    `🏆 **Auto-Discovery Liquidator Started!**\n\n` +
    `⚡ ${SCAN_INTERVAL}ms scans\n` +
    `🔍 Discovers new borrowers every 5 min\n` +
    `📊 ${totalUsers} borrowers loaded\n` +
    `🌐 5 chains active`
  );
  
  let scans = 0;
  let discoveries = 0;
  let executions = 0;
  let totalProfit = 0;
  let lastDiscovery = 0;
  const alerted = new Set();
  
  while (true) {
    scans++;
    const now = Date.now();
    
    // ============ DISCOVER NEW BORROWERS ============
    if (now - lastDiscovery > DISCOVERY_INTERVAL) {
      lastDiscovery = now;
      discoveries++;
      console.log(`\n🔍 Discovery #${discoveries}...`);
      
      const newCount = await discoverAllChains(allUsers);
      
      if (newCount > 0) {
        console.log(`   ✅ Found ${newCount} new borrowers!`);
        
        // Save updated list
        const saveData = {};
        for (const [chain, users] of Object.entries(allUsers)) {
          saveData[chain] = [...users].map(u => ({ user: u }));
        }
        fs.writeFileSync('./data/borrowers.json', JSON.stringify(saveData, null, 2));
      } else {
        console.log(`   No new borrowers found`);
      }
    }
    
    // ============ CHECK ALL POSITIONS ============
    for (const [chain, users] of Object.entries(allUsers)) {
      const chainConfig = CHAINS[chain];
      if (!chainConfig) continue;
      
      for (const user of users) {
        const pos = await checkPosition(chainConfig, user);
        if (!pos || pos.debt < 100) continue;
        
        // 🚨 LIQUIDATABLE
        if (pos.hf > 0 && pos.hf < 1.0) {
          const profit = pos.debt * 0.05;
          
          if (!alerted.has(user)) {
            alerted.add(user);
            
            console.log(`\n🚨🚨🚨 LIQUIDATABLE! 🚨🚨🚨`);
            console.log(`   ${chain} | ${user}`);
            console.log(`   Debt: $${pos.debt.toLocaleString()} | HF: ${pos.hf.toFixed(4)}`);
            console.log(`   💰 Profit: $${profit.toLocaleString()}`);
            
            await alertLiquidation(
              `🚨 **LIQUIDATABLE!**\n\n` +
              `**${chain}**\n` +
              `User: \`${user}\`\n` +
              `Debt: $${pos.debt.toLocaleString()}\n` +
              `HF: ${pos.hf.toFixed(4)}\n` +
              `💰 Profit: $${profit.toLocaleString()}`
            );
            
            if (profit >= MIN_PROFIT_USD) {
              const result = await executeLiquidation(chain, chainConfig, user, pos.debt);
              if (result.success) {
                executions++;
                totalProfit += result.profit;
              }
            }
          }
        }
        
        // ⚠️ Very close
        else if (pos.hf < 1.05 && scans % 30 === 0) {
          console.log(`⚠️ CLOSE: ${chain} | ${user.slice(0,12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
        }
      }
    }
    
    // Status every 60 scans
    if (scans % 60 === 0) {
      const time = new Date().toLocaleTimeString();
      const totalUsers = Object.values(allUsers).reduce((s, set) => s + set.size, 0);
      console.log(`\n[${time}] Scans: ${scans} | Users: ${totalUsers} | Executions: ${executions} | Profit: $${totalProfit.toFixed(2)}`);
    }
    
    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

main();
