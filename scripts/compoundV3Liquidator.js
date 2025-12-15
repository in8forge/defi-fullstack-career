import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// COMPOUND V3 (Comet) LIQUIDATION SCANNER
// ============================================================

// Compound V3 Comet contracts (main markets)
const COMET_CONTRACTS = {
  base: {
    USDC: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    USDbC: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
    WETH: '0x46e6b214b524310239732D51387075E0e70970bf',
  },
  arbitrum: {
    USDC: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
    USDC_native: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
    WETH: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
  },
  polygon: {
    USDC: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
  },
  optimism: {
    USDC: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
    WETH: '0xE36A30D249f7761327fd973001A32010b521b6Fd',
  },
  ethereum: {
    USDC: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
    WETH: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
  },
};

const COMET_ABI = [
  'function isLiquidatable(address account) view returns (bool)',
  'function borrowBalanceOf(address account) view returns (uint256)',
  'function getAssetInfo(uint8 i) view returns (uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap)',
  'function numAssets() view returns (uint8)',
  'function absorb(address absorber, address[] memory accounts)',
  'function quoteCollateral(address asset, uint baseAmount) view returns (uint)',
  'event AbsorbDebt(address indexed absorber, address indexed borrower, uint104 basePaidOut, uint usdValue)',
];

const BULKER_ABI = [
  'function invoke(bytes32[] calldata actions, bytes[] calldata data) external payable',
];

// Known Compound V3 borrowers (we'll discover more)
let borrowers = {};

async function loadBorrowers() {
  try {
    const data = JSON.parse(fs.readFileSync('data/compound_borrowers.json', 'utf8'));
    borrowers = data;
    const total = Object.values(data).reduce((sum, chains) => {
      return sum + Object.values(chains).reduce((s, arr) => s + arr.length, 0);
    }, 0);
    console.log(`📊 Loaded ${total} Compound V3 borrowers`);
  } catch {
    console.log('📊 No existing Compound borrowers, starting fresh');
  }
}

async function saveBorrowers() {
  fs.writeFileSync('data/compound_borrowers.json', JSON.stringify(borrowers, null, 2));
}

async function discoverBorrowers(chain, market, cometAddress, provider) {
  console.log(`\n🔍 Discovering ${chain}/${market}...`);
  
  const comet = new ethers.Contract(cometAddress, [
    'event Withdraw(address indexed src, address indexed to, uint amount)',
    'event Supply(address indexed from, address indexed dst, uint amount)', 
    'event AbsorbDebt(address indexed absorber, address indexed borrower, uint104 basePaidOut, uint usdValue)',
  ], provider);
  
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 100000);
  
  const discovered = new Set();
  
  try {
    // Get Withdraw events (borrowers withdraw collateral or borrow)
    const withdrawEvents = await comet.queryFilter(comet.filters.Withdraw(), fromBlock, currentBlock);
    withdrawEvents.forEach(e => discovered.add(e.args.src));
    
    console.log(`   Found ${discovered.size} potential borrowers`);
  } catch (e) {
    console.log(`   ⚠️ Error: ${e.message}`);
  }
  
  return Array.from(discovered);
}

async function checkLiquidatable(chain, market, cometAddress, provider, addresses) {
  const comet = new ethers.Contract(cometAddress, COMET_ABI, provider);
  const liquidatable = [];
  
  for (let i = 0; i < addresses.length; i += 10) {
    const batch = addresses.slice(i, i + 10);
    
    const results = await Promise.allSettled(
      batch.map(async (account) => {
        const [isLiq, debt] = await Promise.all([
          comet.isLiquidatable(account),
          comet.borrowBalanceOf(account),
        ]);
        return { account, isLiq, debt: Number(debt) / 1e6 };
      })
    );
    
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        if (r.value.isLiq) {
          liquidatable.push(r.value);
        }
      }
    });
    
    await new Promise(r => setTimeout(r, 100));
  }
  
  return liquidatable;
}

async function executeLiquidation(chain, cometAddress, wallet, account) {
  console.log(`\n💀 LIQUIDATING ${account} on ${chain}`);
  
  const comet = new ethers.Contract(cometAddress, COMET_ABI, wallet);
  
  try {
    // absorb() liquidates the position and gives us the collateral
    const tx = await comet.absorb(wallet.address, [account], { gasLimit: 500000 });
    console.log(`   📤 TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`   ✅ SUCCESS! Gas used: ${receipt.gasUsed.toString()}`);
    return true;
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🏦 COMPOUND V3 LIQUIDATION SCANNER                                  ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  const rpcs = {
    base: process.env.BASE_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    arbitrum: process.env.ARBITRUM_RPC_URL,
    optimism: process.env.OPTIMISM_RPC_URL,
  };

  await loadBorrowers();

  // Discover borrowers first
  console.log('\n📡 DISCOVERY PHASE\n');
  
  for (const [chain, markets] of Object.entries(COMET_CONTRACTS)) {
    if (!rpcs[chain]) continue;
    
    const provider = new ethers.JsonRpcProvider(rpcs[chain]);
    
    if (!borrowers[chain]) borrowers[chain] = {};
    
    for (const [market, address] of Object.entries(markets)) {
      const discovered = await discoverBorrowers(chain, market, address, provider);
      
      const existing = new Set(borrowers[chain][market] || []);
      discovered.forEach(a => existing.add(a));
      borrowers[chain][market] = Array.from(existing);
      
      console.log(`   ${chain}/${market}: ${borrowers[chain][market].length} total borrowers`);
    }
  }
  
  await saveBorrowers();

  // Scan for liquidatable positions
  console.log('\n\n🔥 SCANNING FOR LIQUIDATABLE POSITIONS\n');
  
  let scanCount = 0;
  
  while (true) {
    scanCount++;
    
    for (const [chain, markets] of Object.entries(COMET_CONTRACTS)) {
      if (!rpcs[chain]) continue;
      
      const provider = new ethers.JsonRpcProvider(rpcs[chain]);
      const wallet = new ethers.Wallet(pk, provider);
      
      for (const [market, address] of Object.entries(markets)) {
        const accounts = borrowers[chain]?.[market] || [];
        if (!accounts.length) continue;
        
        const liquidatable = await checkLiquidatable(chain, market, address, provider, accounts);
        
        for (const pos of liquidatable) {
          console.log(`\n🚨 LIQUIDATABLE: ${chain}/${market}`);
          console.log(`   Account: ${pos.account}`);
          console.log(`   Debt: $${pos.debt.toFixed(2)}`);
          
          await executeLiquidation(chain, address, wallet, pos.account);
        }
      }
    }
    
    if (scanCount % 60 === 0) {
      const total = Object.values(borrowers).reduce((sum, chains) => {
        return sum + Object.values(chains).reduce((s, arr) => s + arr.length, 0);
      }, 0);
      console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | Monitoring: ${total} positions`);
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(console.error);
