import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// PRODUCTION LIQUIDATOR - WITH DISCORD ALERTS
// ============================================================

const MIN_PROFIT_USD = 5;
const NORMAL_SCAN_MS = 1000;
const FAST_SCAN_MS = 150;
const RPC_TIMEOUT = 3000;

const EXECUTE_REAL = true;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const AAVE_POOLS = {
  base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  avalanche: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

const ASSETS = {
  base: { WETH: '0x4200000000000000000000000000000000000006', USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  polygon: { WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' },
  arbitrum: { WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
  avalanche: { WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E' },
};

const POOL_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const LIQUIDATOR_ABI = ['function executeLiquidation(address,address,address,uint256) external'];

let providers = {};
let pools = {};
let liquidators = {};
let wallets = {};
let borrowers = [];
let scanCount = 0;
let liquidationCount = 0;
let currentScanMs = NORMAL_SCAN_MS;
let alertedPositions = new Set(); // Don't spam same position

function timeout(ms) {
  return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));
}

function withTimeout(promise, ms) {
  return Promise.race([promise, timeout(ms)]);
}

async function sendDiscord(message, urgent = false) {
  if (!DISCORD_WEBHOOK) return;
  
  try {
    const payload = {
      content: urgent ? '@here ' + message : message,
      username: '🤖 Liquidator Bot',
    };
    
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.log('Discord error:', e.message);
  }
}

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🚀 PRODUCTION LIQUIDATOR | 🔥 REAL EXECUTION: ${EXECUTE_REAL ? 'ON ' : 'OFF'}                  ║
║  📢 Discord Alerts: ${DISCORD_WEBHOOK ? 'ENABLED' : 'DISABLED'}                                     ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  const rpcs = {
    base: process.env.BASE_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    arbitrum: process.env.ARBITRUM_RPC_URL,
    avalanche: process.env.AVALANCHE_RPC_URL,
  };

  let liquidatorAddresses = {};
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  for (const [chain, rpc] of Object.entries(rpcs)) {
    if (!rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      pools[chain] = new ethers.Contract(AAVE_POOLS[chain], POOL_ABI, providers[chain]);
      
      if (liquidatorAddresses[chain]) {
        liquidators[chain] = new ethers.Contract(liquidatorAddresses[chain], LIQUIDATOR_ABI, wallets[chain]);
      }
      
      const bal = await withTimeout(providers[chain].getBalance(wallets[chain].address), RPC_TIMEOUT);
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} | Liq: ${liquidatorAddresses[chain] ? 'YES' : 'NO'}`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message}`);
    }
  }

  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      const c = chain.toLowerCase();
      if (pools[c]) users.forEach(u => borrowers.push({ chain: c, user: u.user }));
    }
    console.log(`\n📊 ${borrowers.length} borrowers\n`);
  } catch {}

  // Send startup notification
  await sendDiscord(`🟢 **Liquidator Bot Started**\n📊 Watching ${borrowers.length} borrowers across ${Object.keys(pools).length} chains\n⚡ Real execution: ${EXECUTE_REAL ? 'ENABLED' : 'DISABLED'}`);
}

async function checkPosition(chain, user) {
  try {
    const data = await withTimeout(pools[chain].getUserAccountData(user), RPC_TIMEOUT);
    const debt = Number(data[1]) / 1e8;
    const hf = Number(data[5]) / 1e18;
    if (debt < 100) return null;
    return { chain, user, debt, hf };
  } catch { return null; }
}

async function executeLiquidation(pos) {
  const msg = `
💀 **LIQUIDATABLE POSITION DETECTED!**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 Chain: **${pos.chain.toUpperCase()}**
👤 User: \`${pos.user.slice(0,10)}...${pos.user.slice(-6)}\`
💰 Debt: **$${pos.debt.toFixed(2)}**
❤️ Health Factor: **${pos.hf.toFixed(4)}**
💵 Est. Profit: **$${(pos.debt * 0.05).toFixed(2)} - $${(pos.debt * 0.10).toFixed(2)}**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  console.log(msg);
  await sendDiscord(msg, true);

  if (!EXECUTE_REAL || !liquidators[pos.chain]) {
    console.log('   ⚠️ No execution (simulation or no contract)');
    await sendDiscord('⚠️ Not executing - simulation mode or no contract');
    return;
  }

  try {
    const assets = ASSETS[pos.chain];
    const collateral = Object.values(assets)[0];
    const debtAsset = Object.values(assets)[1];
    const debtToCover = ethers.parseUnits(String(Math.floor(pos.debt * 0.5)), 6);

    console.log('   🚀 Executing...');
    await sendDiscord('🚀 Executing flash loan liquidation...');
    
    const tx = await liquidators[pos.chain].executeLiquidation(collateral, debtAsset, pos.user, debtToCover, { gasLimit: 1000000 });
    console.log(`   📤 TX: ${tx.hash}`);
    await sendDiscord(`📤 TX Submitted: https://${pos.chain === 'polygon' ? 'polygonscan.com' : pos.chain + '.etherscan.io'}/tx/${tx.hash}`);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('   ✅ SUCCESS!');
      liquidationCount++;
      await sendDiscord(`✅ **LIQUIDATION SUCCESS!**\n💰 Profit captured!\nGas used: ${receipt.gasUsed.toString()}`, true);
    } else {
      console.log('   ❌ FAILED');
      await sendDiscord('❌ Transaction failed');
    }
  } catch (e) {
    console.log(`   ❌ ${e.message}`);
    await sendDiscord(`❌ Execution error: ${e.message}`);
  }
}

async function scan() {
  scanCount++;
  
  const sample = borrowers.sort(() => Math.random() - 0.5).slice(0, 10);
  
  for (const b of sample) {
    const pos = await checkPosition(b.chain, b.user);
    if (!pos) continue;
    
    const posKey = `${pos.chain}-${pos.user}`;
    
    if (pos.hf < 1.0) {
      // 🔥 LIQUIDATABLE!
      await executeLiquidation(pos);
    } else if (pos.hf < 1.02 && pos.debt > 500 && !alertedPositions.has(posKey)) {
      // ⚠️ CRITICAL - Alert once
      alertedPositions.add(posKey);
      const msg = `⚠️ **CRITICAL POSITION**\n🔗 ${pos.chain.toUpperCase()} | 💰 $${pos.debt.toFixed(0)} | ❤️ HF: ${pos.hf.toFixed(4)}\n📉 Only ${((pos.hf - 1) * 100).toFixed(1)}% from liquidation!`;
      console.log(msg);
      await sendDiscord(msg, true);
    } else if (pos.hf < 1.05 && pos.debt > 1000 && scanCount % 30 === 0) {
      console.log(`⚠️ CLOSE: ${pos.chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
    }
  }
  
  // Hourly status update to Discord
  if (scanCount % 3600 === 0) {
    await sendDiscord(`📊 **Hourly Status**\nScans: ${scanCount}\nLiquidations: ${liquidationCount}\nWatching: ${borrowers.length} positions`);
  }
  
  if (scanCount % 60 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | Liquidations: ${liquidationCount}`);
  }
}

async function main() {
  await init();
  console.log('🚀 Scanning...\n');
  
  setInterval(async () => {
    try { await scan(); } catch {}
  }, currentScanMs);
}

main().catch(console.error);
