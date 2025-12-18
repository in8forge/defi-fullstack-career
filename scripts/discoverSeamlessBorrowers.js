import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// Seamless Protocol on Base (Aave V3 fork)
const SEAMLESS_POOL = '0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7';
const PROVIDER = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);

const POOL_ABI = [
  'event Borrow(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 referralCode)',
  'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
];

async function main() {
  console.log('\n🔍 Discovering Seamless Protocol borrowers on Base...\n');
  
  const pool = new ethers.Contract(SEAMLESS_POOL, POOL_ABI, PROVIDER);
  
  const currentBlock = await PROVIDER.getBlockNumber();
  const fromBlock = currentBlock - 500000; // ~2 weeks
  
  console.log(`Scanning blocks ${fromBlock} to ${currentBlock}...`);
  
  const borrowers = new Set();
  const batchSize = 10000;
  
  for (let start = fromBlock; start < currentBlock; start += batchSize) {
    const end = Math.min(start + batchSize - 1, currentBlock);
    try {
      const events = await pool.queryFilter('Borrow', start, end);
      events.forEach(e => borrowers.add(e.args.user));
      process.stdout.write(`\r  Scanned to block ${end}, found ${borrowers.size} borrowers`);
    } catch (e) {
      console.log(`\n  ⚠️ Error at block ${start}: ${e.message.slice(0, 50)}`);
    }
  }
  
  console.log(`\n\n✅ Found ${borrowers.size} unique borrowers`);
  
  // Filter active borrowers
  console.log('\nFiltering active borrowers with debt...');
  const activeBorrowers = [];
  
  for (const user of borrowers) {
    try {
      const data = await pool.getUserAccountData(user);
      const debt = Number(data.totalDebtBase) / 1e8;
      const hf = Number(data.healthFactor) / 1e18;
      
      if (debt > 100) {
        activeBorrowers.push({ user, debt, hf });
      }
    } catch {}
  }
  
  console.log(`✅ ${activeBorrowers.length} active borrowers with >$100 debt`);
  
  // Save
  const file = 'data/seamless_borrowers.json';
  fs.writeFileSync(file, JSON.stringify(activeBorrowers, null, 2));
  console.log(`\n💾 Saved to ${file}`);
  
  // Show whales
  const whales = activeBorrowers.filter(b => b.debt > 10000).sort((a, b) => b.debt - a.debt);
  console.log(`\n🐋 Top whales:`);
  whales.slice(0, 10).forEach(w => {
    console.log(`   $${w.debt.toFixed(0)} | HF: ${w.hf.toFixed(4)} | ${w.user.slice(0, 10)}...`);
  });
}

main().catch(console.error);
