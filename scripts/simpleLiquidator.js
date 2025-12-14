import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// SIMPLE ROBUST LIQUIDATOR - WITH TIMEOUTS
// ============================================================

const SCAN_INTERVAL = 1000;
const RPC_TIMEOUT = 5000;

const AAVE_POOLS = {
  base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  arbitrum: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

const POOL_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];

let providers = {};
let pools = {};
let borrowers = [];
let scanCount = 0;

// Timeout wrapper
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
}

async function init() {
  console.log('\n🚀 SIMPLE LIQUIDATOR\n');

  const rpcs = {
    base: process.env.BASE_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    arbitrum: process.env.ARBITRUM_RPC_URL,
  };

  for (const [chain, rpc] of Object.entries(rpcs)) {
    if (rpc) {
      try {
        providers[chain] = new ethers.JsonRpcProvider(rpc);
        pools[chain] = new ethers.Contract(AAVE_POOLS[chain], POOL_ABI, providers[chain]);
        console.log(`✅ ${chain}`);
      } catch (e) {
        console.log(`❌ ${chain}: ${e.message}`);
      }
    }
  }

  // Load borrowers
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      for (const u of users) {
        borrowers.push({ chain: chain.toLowerCase(), user: u.user });
      }
    }
    console.log(`\n📊 ${borrowers.length} borrowers loaded\n`);
  } catch {
    console.log('\n⚠️ No borrowers file\n');
  }
}

async function checkUser(chain, user) {
  try {
    const pool = pools[chain];
    if (!pool) return null;
    
    const data = await withTimeout(pool.getUserAccountData(user), RPC_TIMEOUT);
    const debt = Number(data[1]) / 1e8;
    const hf = Number(data[5]) / 1e18;
    
    return { chain, user, debt, hf };
  } catch {
    return null;
  }
}

async function scan() {
  scanCount++;
  
  // Check 10 random borrowers per scan for speed
  const sample = borrowers.sort(() => Math.random() - 0.5).slice(0, 10);
  
  for (const b of sample) {
    const result = await checkUser(b.chain, b.user);
    if (!result) continue;
    
    if (result.hf < 1.0 && result.debt > 100) {
      console.log(`\n💀 LIQUIDATABLE! ${result.chain} | $${result.debt.toFixed(0)} | HF: ${result.hf.toFixed(4)}`);
    } else if (result.hf < 1.05 && result.debt > 1000) {
      console.log(`⚠️ CLOSE: ${result.chain} | $${result.debt.toFixed(0)} | HF: ${result.hf.toFixed(4)}`);
    }
  }
  
  if (scanCount % 30 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount}`);
  }
}

async function main() {
  await init();
  
  console.log('Starting scans...\n');
  
  setInterval(async () => {
    try {
      await scan();
    } catch (e) {
      console.log(`Scan error: ${e.message}`);
    }
  }, SCAN_INTERVAL);
}

main().catch(console.error);
