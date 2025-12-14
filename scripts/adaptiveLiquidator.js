import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// ADAPTIVE LIQUIDATOR - MILLISECOND MODE ON VOLATILITY
// ============================================================

const MIN_PROFIT_USD = 5;
const NORMAL_SCAN_MS = 1000;      // 1 second normally
const FAST_SCAN_MS = 150;         // 150ms during volatility
const VOLATILITY_THRESHOLD = 0.5; // 0.5% price move = volatility
const VOLATILITY_WINDOW = 60000;  // Check price change over 1 min

// Aave V3 addresses
const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', oracle: '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156' },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', oracle: '0xb023e699F5a33916Ea823A16485e259257cA8Bd1' },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', oracle: '0xEBd36016B3eD09D4693Ed4251c67Bd858c3c7C9C' },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', oracle: '0xb56c2F0B653B2e0b10C9b928C8580Ac5Df02C7C7' },
};

const POOL_ABI = [
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
  'function liquidationCall(address,address,address,uint256,bool) external',
];

const ORACLE_ABI = [
  'function getAssetPrice(address) view returns (uint256)',
];

// ETH address for price tracking
const WETH = {
  base: '0x4200000000000000000000000000000000000006',
  polygon: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  avalanche: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
  arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
};

let providers = {};
let pools = {};
let oracles = {};
let wallet;
let borrowers = { Base: [], Polygon: [], Avalanche: [], Arbitrum: [] };

// Volatility tracking
let priceHistory = [];
let isVolatileMode = false;
let currentScanMs = NORMAL_SCAN_MS;
let scanCount = 0;
let lastVolatilityCheck = 0;

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🚀 ADAPTIVE LIQUIDATOR - MILLISECOND MODE                           ║
╠══════════════════════════════════════════════════════════════════════╣
║  Normal: ${NORMAL_SCAN_MS}ms  |  Volatile: ${FAST_SCAN_MS}ms  |  Threshold: ${VOLATILITY_THRESHOLD}%       ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  wallet = new ethers.Wallet(process.env.PRIVATE_KEY);
  console.log(`👛 Wallet: ${wallet.address}\n`);

  const rpcs = {
    base: process.env.BASE_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    avalanche: process.env.AVALANCHE_RPC_URL,
    arbitrum: process.env.ARBITRUM_RPC_URL,
  };

  for (const [chain, rpc] of Object.entries(rpcs)) {
    if (rpc && AAVE_POOLS[chain]) {
      try {
        providers[chain] = new ethers.JsonRpcProvider(rpc);
        pools[chain] = new ethers.Contract(AAVE_POOLS[chain].pool, POOL_ABI, providers[chain]);
        oracles[chain] = new ethers.Contract(AAVE_POOLS[chain].oracle, ORACLE_ABI, providers[chain]);
        const block = await providers[chain].getBlockNumber();
        console.log(`   ✅ ${chain}: Block ${block}`);
      } catch (e) {
        console.log(`   ❌ ${chain}: ${e.message}`);
      }
    }
  }

  // Load existing borrowers
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    borrowers = data;
    const total = Object.values(borrowers).flat().length;
    console.log(`\n📊 Loaded ${total} borrowers`);
  } catch {
    console.log('\n📊 Starting fresh borrower list');
  }
  
  // Initialize price history
  await updatePriceHistory();
}

async function updatePriceHistory() {
  try {
    // Get ETH price from Base (fastest)
    if (oracles.base && WETH.base) {
      const price = await oracles.base.getAssetPrice(WETH.base);
      const priceUsd = Number(price) / 1e8;
      const now = Date.now();
      
      priceHistory.push({ price: priceUsd, time: now });
      
      // Keep only last 2 minutes of data
      priceHistory = priceHistory.filter(p => now - p.time < 120000);
      
      return priceUsd;
    }
  } catch {
    return null;
  }
}

function checkVolatility() {
  if (priceHistory.length < 2) return false;
  
  const now = Date.now();
  const recentPrices = priceHistory.filter(p => now - p.time < VOLATILITY_WINDOW);
  
  if (recentPrices.length < 2) return false;
  
  const oldest = recentPrices[0].price;
  const newest = recentPrices[recentPrices.length - 1].price;
  const change = Math.abs((newest - oldest) / oldest) * 100;
  
  return change >= VOLATILITY_THRESHOLD;
}

async function checkPosition(chain, user) {
  try {
    const pool = pools[chain];
    if (!pool) return null;

    const data = await pool.getUserAccountData(user);
    const totalDebt = Number(data[1]) / 1e8;
    const healthFactor = Number(data[5]) / 1e18;

    if (totalDebt < 100) return null; // Skip tiny positions

    return { user, chain, debt: totalDebt, hf: healthFactor };
  } catch {
    return null;
  }
}

async function scanPositions() {
  const liquidatable = [];
  const close = [];

  for (const [chain, users] of Object.entries(borrowers)) {
    const chainKey = chain.toLowerCase();
    if (!pools[chainKey]) continue;

    for (const { user } of users.slice(0, 50)) { // Check top 50 per chain for speed
      const pos = await checkPosition(chainKey, user);
      if (!pos) continue;

      if (pos.hf < 1.0) {
        liquidatable.push(pos);
      } else if (pos.hf < 1.05) {
        close.push(pos);
      }
    }
  }

  return { liquidatable, close };
}

async function executeLiquidation(pos) {
  console.log(`\n🚨 EXECUTING LIQUIDATION!`);
  console.log(`   Chain: ${pos.chain}`);
  console.log(`   User: ${pos.user}`);
  console.log(`   Debt: $${pos.debt.toFixed(2)}`);
  console.log(`   HF: ${pos.hf.toFixed(4)}`);
  
  // TODO: Add actual liquidation logic with flash loans
  // For now, just alert
  console.log(`   ⚠️  Manual execution needed - implement flash loan logic`);
}

async function scan() {
  scanCount++;
  
  // Update price and check volatility every 10 scans
  if (scanCount % 10 === 0) {
    await updatePriceHistory();
    const wasVolatile = isVolatileMode;
    isVolatileMode = checkVolatility();
    
    if (isVolatileMode && !wasVolatile) {
      currentScanMs = FAST_SCAN_MS;
      console.log(`\n⚡ VOLATILE MODE ACTIVATED - ${FAST_SCAN_MS}ms scans!`);
    } else if (!isVolatileMode && wasVolatile) {
      currentScanMs = NORMAL_SCAN_MS;
      console.log(`\n😴 Normal mode - ${NORMAL_SCAN_MS}ms scans`);
    }
  }

  const { liquidatable, close } = await scanPositions();

  // LIQUIDATE!
  for (const pos of liquidatable) {
    console.log(`\n💀 LIQUIDATABLE: ${pos.chain} | ${pos.user.slice(0,10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
    await executeLiquidation(pos);
  }

  // Log close positions occasionally
  if (scanCount % 100 === 0 && close.length > 0) {
    console.log(`\n⚠️  ${close.length} positions close to liquidation:`);
    for (const pos of close.slice(0, 3)) {
      console.log(`   ${pos.chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
    }
  }

  // Status update
  if (scanCount % 50 === 0) {
    const mode = isVolatileMode ? '⚡FAST' : '😴NORMAL';
    const price = priceHistory.length > 0 ? `$${priceHistory[priceHistory.length-1].price.toFixed(0)}` : '?';
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | Mode: ${mode} | ETH: ${price} | Interval: ${currentScanMs}ms`);
  }
}

async function main() {
  await init();
  
  console.log(`\n🚀 Starting adaptive scanning...\n`);
  
  while (true) {
    try {
      await scan();
    } catch (e) {
      // Silent continue
    }
    await new Promise(r => setTimeout(r, currentScanMs));
  }
}

main().catch(console.error);
