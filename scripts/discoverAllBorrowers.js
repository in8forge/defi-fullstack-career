import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// Aave V3 Pool contracts
const POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL },
  optimism: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.OPTIMISM_RPC_URL },
};

const POOL_ABI = [
  'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)',
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)',
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
];

async function discoverBorrowers(chain, config) {
  console.log(`\n🔍 Scanning ${chain}...`);
  
  if (!config.rpc) {
    console.log(`   ⚠️ No RPC for ${chain}`);
    return [];
  }

  const provider = new ethers.JsonRpcProvider(config.rpc);
  const pool = new ethers.Contract(config.pool, POOL_ABI, provider);
  
  const borrowers = new Set();
  const currentBlock = await provider.getBlockNumber();
  
  // Scan last 50,000 blocks (~1-2 weeks depending on chain)
  const fromBlock = Math.max(0, currentBlock - 200000);
  const batchSize = 5000;
  
  console.log(`   📦 Blocks ${fromBlock} → ${currentBlock}`);
  
  for (let start = fromBlock; start < currentBlock; start += batchSize) {
    const end = Math.min(start + batchSize - 1, currentBlock);
    
    try {
      // Get Borrow events
      const borrowFilter = pool.filters.Borrow();
      const borrowEvents = await pool.queryFilter(borrowFilter, start, end);
      borrowEvents.forEach(e => borrowers.add(e.args.onBehalfOf || e.args.user));
      
      process.stdout.write(`\r   📊 ${borrowers.size} unique borrowers found (block ${end})`);
    } catch (e) {
      // Rate limited, wait and retry
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  console.log(`\n   ✅ ${chain}: ${borrowers.size} borrowers`);
  return Array.from(borrowers);
}

async function filterActiveBorrowers(chain, config, addresses) {
  console.log(`   🔬 Filtering active borrowers on ${chain}...`);
  
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const pool = new ethers.Contract(config.pool, POOL_ABI, provider);
  
  const active = [];
  const batchSize = 20;
  
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    
    const results = await Promise.allSettled(
      batch.map(async (user) => {
        const data = await pool.getUserAccountData(user);
        const debt = Number(data[1]) / 1e8;
        const hf = Number(data[5]) / 1e18;
        return { user, debt, hf };
      })
    );
    
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.debt > 100) {
        active.push(r.value);
      }
    });
    
    process.stdout.write(`\r   📊 Checked ${Math.min(i + batchSize, addresses.length)}/${addresses.length} | Active: ${active.length}`);
    
    await new Promise(r => setTimeout(r, 100)); // Rate limit
  }
  
  console.log(`\n   ✅ ${active.length} active borrowers with debt > $100`);
  return active;
}

async function main() {
  console.log('🚀 BORROWER DISCOVERY - Expanding Database\n');
  
  const allBorrowers = {};
  
  for (const [chain, config] of Object.entries(POOLS)) {
    try {
      const addresses = await discoverBorrowers(chain, config);
      const active = await filterActiveBorrowers(chain, config, addresses);
      
      allBorrowers[chain.charAt(0).toUpperCase() + chain.slice(1)] = active.map(b => ({
        user: b.user,
        debt: b.debt,
        hf: b.hf
      }));
    } catch (e) {
      console.log(`   ❌ ${chain} error: ${e.message}`);
    }
  }
  
  // Merge with existing
  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
  } catch {}
  
  // Combine and dedupe
  for (const [chain, users] of Object.entries(allBorrowers)) {
    const existingUsers = new Set((existing[chain] || []).map(u => u.user));
    const newUsers = users.filter(u => !existingUsers.has(u.user));
    existing[chain] = [...(existing[chain] || []), ...newUsers];
    console.log(`\n📈 ${chain}: Added ${newUsers.length} new borrowers (total: ${existing[chain].length})`);
  }
  
  // Save
  fs.writeFileSync('data/borrowers.json', JSON.stringify(existing, null, 2));
  
  const total = Object.values(existing).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`\n✅ COMPLETE: ${total} total borrowers saved to data/borrowers.json`);
}

main().catch(console.error);
