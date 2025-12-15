import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// ⚡ FAST LIQUIDATOR - Sub-second reaction time
// ============================================================

const SCAN_MS = 100; // 100ms scans
const PRIORITY_THRESHOLD = 1.02; // Track positions < 1.02 HF closely
const CRITICAL_THRESHOLD = 1.005; // < 0.5% from liquidation = max priority

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// Aave V3 pools
const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL },
};

// Compound V3 markets
const COMPOUND_MARKETS = {
  base: { 
    USDC: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    WETH: '0x46e6b214b524310239732D51387075E0e70970bf',
  },
  arbitrum: { USDC: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA' },
  polygon: { USDC: '0xF25212E676D1F7F89Cd72fFEe66158f541246445' },
};

const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const COMPOUND_ABI = [
  'function isLiquidatable(address) view returns (bool)',
  'function borrowBalanceOf(address) view returns (uint256)',
  'function absorb(address, address[])',
];
const LIQUIDATOR_ABI = ['function executeLiquidation(address,address,address,uint256) external'];

// Priority queues - positions closest to liquidation
let criticalPositions = []; // < 1.005 HF - check every scan
let priorityPositions = []; // < 1.02 HF - check frequently
let normalPositions = [];   // > 1.02 HF - check occasionally

let providers = {};
let wallets = {};
let aavePools = {};
let compoundMarkets = {};
let liquidatorContracts = {};

let scanCount = 0;
let liquidationCount = 0;
let earnings = 0;

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ FAST LIQUIDATOR - 100ms SCANS                                    ║
║  🔥 REAL EXECUTION | 📢 Discord: ${DISCORD_WEBHOOK ? 'ON' : 'OFF'}                              ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  
  // Load liquidator addresses
  let liquidatorAddresses = {};
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  // Initialize Aave
  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      aavePools[chain] = new ethers.Contract(config.pool, AAVE_ABI, providers[chain]);
      
      if (liquidatorAddresses[chain]) {
        liquidatorContracts[chain] = new ethers.Contract(liquidatorAddresses[chain], LIQUIDATOR_ABI, wallets[chain]);
      }
      
      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message}`);
    }
  }

  // Initialize Compound
  for (const [chain, markets] of Object.entries(COMPOUND_MARKETS)) {
    if (!providers[chain]) continue;
    compoundMarkets[chain] = {};
    for (const [market, address] of Object.entries(markets)) {
      compoundMarkets[chain][market] = new ethers.Contract(address, COMPOUND_ABI, wallets[chain]);
    }
  }

  // Load borrowers
  await loadAndClassifyPositions();
  
  console.log(`\n📊 Positions loaded:`);
  console.log(`   🔴 Critical (<1.005 HF): ${criticalPositions.length}`);
  console.log(`   🟠 Priority (<1.02 HF): ${priorityPositions.length}`);
  console.log(`   🟢 Normal: ${normalPositions.length}`);
  console.log(`\n🚀 Starting 100ms scan loop...\n`);
}

async function loadAndClassifyPositions() {
  // Load Aave borrowers
  try {
    const aaveData = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(aaveData)) {
      const c = chain.toLowerCase();
      if (!aavePools[c]) continue;
      
      for (const u of users) {
        normalPositions.push({ 
          protocol: 'aave', 
          chain: c, 
          user: u.user,
          lastHF: u.hf || 2,
          debt: u.debt || 0,
        });
      }
    }
  } catch {}

  // Load Compound borrowers
  try {
    const compData = JSON.parse(fs.readFileSync('data/compound_borrowers.json', 'utf8'));
    for (const [chain, markets] of Object.entries(compData)) {
      const c = chain.toLowerCase();
      if (!compoundMarkets[c]) continue;
      
      for (const [market, users] of Object.entries(markets)) {
        for (const user of users) {
          normalPositions.push({
            protocol: 'compound',
            chain: c,
            market,
            user,
            lastHF: 2,
            debt: 0,
          });
        }
      }
    }
  } catch {}
}

async function checkAavePosition(pos) {
  try {
    const data = await aavePools[pos.chain].getUserAccountData(pos.user);
    const debt = Number(data[1]) / 1e8;
    const hf = Number(data[5]) / 1e18;
    return { ...pos, debt, hf, liquidatable: hf < 1.0 };
  } catch {
    return null;
  }
}

async function checkCompoundPosition(pos) {
  try {
    const comet = compoundMarkets[pos.chain][pos.market];
    const [isLiq, debt] = await Promise.all([
      comet.isLiquidatable(pos.user),
      comet.borrowBalanceOf(pos.user),
    ]);
    return { ...pos, debt: Number(debt) / 1e6, hf: isLiq ? 0.99 : 1.5, liquidatable: isLiq };
  } catch {
    return null;
  }
}

async function executeAaveLiquidation(pos) {
  console.log(`\n💀 AAVE LIQUIDATION: ${pos.chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  
  if (!liquidatorContracts[pos.chain]) {
    console.log('   ⚠️ No liquidator contract');
    return;
  }

  try {
    const tx = await liquidatorContracts[pos.chain].executeLiquidation(
      ethers.ZeroAddress, // collateral (let contract figure it out)
      ethers.ZeroAddress, // debt asset
      pos.user,
      ethers.parseUnits(String(Math.floor(pos.debt * 0.5)), 6),
      { gasLimit: 1000000 }
    );
    console.log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      liquidationCount++;
      const profit = pos.debt * 0.05;
      earnings += profit;
      console.log(`   ✅ SUCCESS! Est. profit: $${profit.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 50)}`);
  }
}

async function executeCompoundLiquidation(pos) {
  console.log(`\n💀 COMPOUND LIQUIDATION: ${pos.chain}/${pos.market} | $${pos.debt.toFixed(0)}`);
  
  try {
    const comet = compoundMarkets[pos.chain][pos.market];
    const tx = await comet.absorb(wallets[pos.chain].address, [pos.user], { gasLimit: 500000 });
    console.log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      liquidationCount++;
      const profit = pos.debt * 0.08;
      earnings += profit;
      console.log(`   ✅ SUCCESS! Est. profit: $${profit.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 50)}`);
  }
}

async function classifyPosition(pos, result) {
  if (!result) return;
  
  // Remove from current queue
  criticalPositions = criticalPositions.filter(p => p.user !== pos.user);
  priorityPositions = priorityPositions.filter(p => p.user !== pos.user);
  normalPositions = normalPositions.filter(p => p.user !== pos.user);
  
  // Add to appropriate queue
  const updated = { ...pos, lastHF: result.hf, debt: result.debt };
  
  if (result.hf < CRITICAL_THRESHOLD) {
    criticalPositions.push(updated);
  } else if (result.hf < PRIORITY_THRESHOLD) {
    priorityPositions.push(updated);
  } else {
    normalPositions.push(updated);
  }
}

async function fastScan() {
  scanCount++;
  
  // 1. ALWAYS check critical positions (< 0.5% from liquidation)
  for (const pos of criticalPositions) {
    const result = pos.protocol === 'aave' 
      ? await checkAavePosition(pos)
      : await checkCompoundPosition(pos);
    
    if (result?.liquidatable) {
      if (pos.protocol === 'aave') await executeAaveLiquidation(result);
      else await executeCompoundLiquidation(result);
    } else if (result) {
      await classifyPosition(pos, result);
    }
  }
  
  // 2. Check priority positions every 5 scans (500ms)
  if (scanCount % 5 === 0) {
    const sample = priorityPositions.slice(0, 20);
    for (const pos of sample) {
      const result = pos.protocol === 'aave'
        ? await checkAavePosition(pos)
        : await checkCompoundPosition(pos);
      
      if (result?.liquidatable) {
        if (pos.protocol === 'aave') await executeAaveLiquidation(result);
        else await executeCompoundLiquidation(result);
      } else if (result) {
        await classifyPosition(pos, result);
        
        // Log close positions
        if (result.hf < 1.01 && result.debt > 1000) {
          console.log(`🔥 CRITICAL: ${pos.chain} | $${result.debt.toFixed(0)} | HF: ${result.hf.toFixed(4)} | ${((result.hf - 1) * 100).toFixed(2)}% away`);
        }
      }
    }
  }
  
  // 3. Check normal positions every 60 scans (6 seconds)
  if (scanCount % 60 === 0) {
    const sample = normalPositions.sort(() => Math.random() - 0.5).slice(0, 50);
    
    await Promise.all(sample.map(async (pos) => {
      const result = pos.protocol === 'aave'
        ? await checkAavePosition(pos)
        : await checkCompoundPosition(pos);
      
      if (result) {
        await classifyPosition(pos, result);
        
        if (result.hf < 1.05 && result.debt > 1000) {
          console.log(`⚠️ CLOSE: ${pos.chain} | $${result.debt.toFixed(0)} | HF: ${result.hf.toFixed(4)}`);
        }
      }
    }));
  }
  
  // Status every 600 scans (1 minute)
  if (scanCount % 600 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | 🔴 ${criticalPositions.length} | 🟠 ${priorityPositions.length} | 🟢 ${normalPositions.length} | Liquidations: ${liquidationCount} | Earned: $${earnings.toFixed(2)}`);
  }
}

async function main() {
  await init();
  
  // Main loop - 100ms
  while (true) {
    await fastScan();
    await new Promise(r => setTimeout(r, SCAN_MS));
  }
}

main().catch(console.error);
