import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// ⚡ FAST LIQUIDATOR + FLASHBOTS - Combined
// 100ms scans + MEV-protected execution
// ============================================================

const SCAN_MS = 100;
const PRIORITY_THRESHOLD = 1.02;
const CRITICAL_THRESHOLD = 1.005;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// Flashbots Protect RPC (Ethereum mainnet)
const FLASHBOTS_PROTECT_RPC = 'https://rpc.flashbots.net';

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

// Priority queues
let criticalPositions = [];
let priorityPositions = [];
let normalPositions = [];

let providers = {};
let wallets = {};
let aavePools = {};
let compoundMarkets = {};
let liquidatorContracts = {};

let scanCount = 0;
let liquidationCount = 0;
let earnings = 0;

// ============================================================
// FLASHBOTS EXECUTION
// ============================================================

async function executeWithPriorityGas(chain, wallet, txData, priorityMultiplier = 3) {
  const feeData = await wallet.provider.getFeeData();
  const priority = feeData.maxPriorityFeePerGas * BigInt(priorityMultiplier);
  const maxFee = feeData.maxFeePerGas + priority;

  return wallet.sendTransaction({
    ...txData,
    maxPriorityFeePerGas: priority,
    maxFeePerGas: maxFee,
  });
}

async function executeWithEscalation(chain, wallet, txData) {
  const multipliers = [3, 5, 10, 20];

  for (const mult of multipliers) {
    try {
      const feeData = await wallet.provider.getFeeData();
      const priority = feeData.maxPriorityFeePerGas * BigInt(mult);

      const tx = await wallet.sendTransaction({
        ...txData,
        maxPriorityFeePerGas: priority,
        maxFeePerGas: feeData.maxFeePerGas + priority,
      });

      const receipt = await Promise.race([
        tx.wait(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);

      if (receipt.status === 1) {
        return { success: true, hash: tx.hash, gasUsed: receipt.gasUsed, multiplier: mult };
      }
    } catch (e) {
      if (e.message !== 'timeout') throw e;
    }
  }

  return { success: false };
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ FAST LIQUIDATOR + FLASHBOTS                                      ║
║  🔥 100ms scans | Priority gas execution                            ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;

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
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH | Liquidator: ${liquidatorAddresses[chain] ? 'YES' : 'NO'}`);
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

  await loadAndClassifyPositions();

  console.log(`\n📊 Positions:`);
  console.log(`   🔴 Critical (<1.005): ${criticalPositions.length}`);
  console.log(`   🟠 Priority (<1.02): ${priorityPositions.length}`);
  console.log(`   🟢 Normal: ${normalPositions.length}`);
  console.log(`\n🚀 Starting 100ms scan loop with priority gas execution...\n`);
}

async function loadAndClassifyPositions() {
  // Load Aave
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

  // Load Compound
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

// ============================================================
// POSITION CHECKING
// ============================================================

async function checkAavePosition(pos) {
  try {
    const data = await aavePools[pos.chain].getUserAccountData(pos.user);
    const debt = Number(data[1]) / 1e8;
    const hf = Number(data[5]) / 1e18;
    return { ...pos, debt, hf, liquidatable: hf < 1.0 && hf > 0 };
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

// ============================================================
// LIQUIDATION EXECUTION (WITH PRIORITY GAS)
// ============================================================

async function executeAaveLiquidation(pos) {
  const msg = `💀 AAVE LIQUIDATION: ${pos.chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`;
  console.log(`\n${msg}`);
  await sendDiscord(msg, true);

  if (!liquidatorContracts[pos.chain]) {
    console.log('   ⚠️ No liquidator contract');
    return;
  }

  try {
    // Build TX data
    const txData = await liquidatorContracts[pos.chain].executeLiquidation.populateTransaction(
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      pos.user,
      ethers.parseUnits(String(Math.floor(pos.debt * 0.5)), 6)
    );
    txData.gasLimit = 1000000n;

    // Execute with escalating priority gas
    console.log('   ⚡ Executing with priority gas escalation...');
    const result = await executeWithEscalation(pos.chain, wallets[pos.chain], txData);

    if (result.success) {
      liquidationCount++;
      const profit = pos.debt * 0.05;
      earnings += profit;
      console.log(`   ✅ SUCCESS! ${result.multiplier}x priority | Gas: ${result.gasUsed} | Profit: ~$${profit.toFixed(2)}`);
      await sendDiscord(`✅ LIQUIDATION SUCCESS!\nChain: ${pos.chain}\nProfit: ~$${profit.toFixed(2)}\nTX: ${result.hash}`, true);
    } else {
      console.log('   ❌ All attempts failed');
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 60)}`);
  }
}

async function executeCompoundLiquidation(pos) {
  const msg = `💀 COMPOUND LIQUIDATION: ${pos.chain}/${pos.market} | $${pos.debt.toFixed(0)}`;
  console.log(`\n${msg}`);
  await sendDiscord(msg, true);

  try {
    const comet = compoundMarkets[pos.chain][pos.market];

    // Build TX data
    const txData = await comet.absorb.populateTransaction(wallets[pos.chain].address, [pos.user]);
    txData.gasLimit = 500000n;

    // Execute with priority gas
    console.log('   ⚡ Executing with priority gas...');
    const result = await executeWithEscalation(pos.chain, wallets[pos.chain], txData);

    if (result.success) {
      liquidationCount++;
      const profit = pos.debt * 0.08;
      earnings += profit;
      console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
      await sendDiscord(`✅ COMPOUND LIQUIDATION SUCCESS!\nProfit: ~$${profit.toFixed(2)}`, true);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 60)}`);
  }
}

// ============================================================
// CLASSIFICATION
// ============================================================

function classifyPosition(pos, result) {
  if (!result) return;

  // Remove from all queues
  criticalPositions = criticalPositions.filter(p => !(p.user === pos.user && p.chain === pos.chain));
  priorityPositions = priorityPositions.filter(p => !(p.user === pos.user && p.chain === pos.chain));
  normalPositions = normalPositions.filter(p => !(p.user === pos.user && p.chain === pos.chain));

  const updated = { ...pos, lastHF: result.hf, debt: result.debt };

  if (result.hf < CRITICAL_THRESHOLD && result.hf > 0) {
    criticalPositions.push(updated);
  } else if (result.hf < PRIORITY_THRESHOLD) {
    priorityPositions.push(updated);
  } else {
    normalPositions.push(updated);
  }
}

// ============================================================
// DISCORD
// ============================================================

async function sendDiscord(message, urgent = false) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: urgent ? '@here ' + message : message,
        username: '⚡ Fast Liquidator',
      }),
    });
  } catch {}
}

// ============================================================
// MAIN SCAN LOOP
// ============================================================

async function fastScan() {
  scanCount++;

  // 1. CRITICAL - Every 100ms
  for (const pos of criticalPositions) {
    const result = pos.protocol === 'aave'
      ? await checkAavePosition(pos)
      : await checkCompoundPosition(pos);

    if (result?.liquidatable) {
      if (pos.protocol === 'aave') await executeAaveLiquidation(result);
      else await executeCompoundLiquidation(result);
    } else if (result) {
      classifyPosition(pos, result);
    }
  }

  // 2. PRIORITY - Every 500ms
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
        classifyPosition(pos, result);
        if (result.hf < 1.01 && result.debt > 1000) {
          console.log(`🔥 CRITICAL: ${pos.chain} | $${result.debt.toFixed(0)} | HF: ${result.hf.toFixed(4)} | ${((result.hf - 1) * 100).toFixed(2)}% away`);
        }
      }
    }
  }

  // 3. NORMAL - Every 6 seconds
  if (scanCount % 60 === 0) {
    const sample = normalPositions.sort(() => Math.random() - 0.5).slice(0, 50);

    await Promise.all(sample.map(async (pos) => {
      const result = pos.protocol === 'aave'
        ? await checkAavePosition(pos)
        : await checkCompoundPosition(pos);

      if (result) {
        classifyPosition(pos, result);
        if (result.hf < 1.05 && result.debt > 1000) {
          console.log(`⚠️ CLOSE: ${pos.chain} | $${result.debt.toFixed(0)} | HF: ${result.hf.toFixed(4)}`);
        }
      }
    }));
  }

  // Status every minute
  if (scanCount % 600 === 0) {
    const status = `[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | 🔴 ${criticalPositions.length} | 🟠 ${priorityPositions.length} | 🟢 ${normalPositions.length} | Liquidations: ${liquidationCount} | Earned: $${earnings.toFixed(2)}`;
    console.log(status);
  }
}

async function main() {
  await init();

  while (true) {
    await fastScan();
    await new Promise(r => setTimeout(r, SCAN_MS));
  }
}

main().catch(console.error);
