import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// 🎯 EVENT-BASED LIQUIDATOR - Instant reaction to price changes
// No polling - subscribe to oracle updates
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// Chainlink Price Feeds (these emit events on price updates)
const PRICE_FEEDS = {
  base: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
    'cbETH/USD': '0xd7818272B9e248357d13057AAb0B417aF31E817d',
  },
  arbitrum: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'USDC/USD': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
    'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6',
  },
  polygon: {
    'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945',
    'MATIC/USD': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0',
    'USDC/USD': '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7',
  },
  avalanche: {
    'ETH/USD': '0x976B3D034E162d8bD72D6b9C989d545b839003b0',
    'AVAX/USD': '0x0A77230d17318075983913bC2145DB16C7366156',
    'USDC/USD': '0xF096872672F44d6EBA71458D74fe67F9a77a23B9',
  },
};

// Aave V3 pools
const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL },
};

// Compound V3
const COMPOUND_MARKETS = {
  base: {
    USDC: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
    WETH: '0x46e6b214b524310239732D51387075E0e70970bf',
  },
  arbitrum: { USDC: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA' },
  polygon: { USDC: '0xF25212E676D1F7F89Cd72fFEe66158f541246445' },
};

const CHAINLINK_ABI = [
  'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)',
];

const AAVE_ABI = [
  'function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)',
];

const COMPOUND_ABI = [
  'function isLiquidatable(address) view returns (bool)',
  'function borrowBalanceOf(address) view returns (uint256)',
  'function absorb(address, address[])',
];

const LIQUIDATOR_ABI = ['function executeLiquidation(address,address,address,uint256) external'];

// State
let providers = {};
let wsProviders = {};
let wallets = {};
let aavePools = {};
let compoundMarkets = {};
let liquidatorContracts = {};
let borrowers = { aave: {}, compound: {} };
let priceFeeds = {};

let eventCount = 0;
let checkCount = 0;
let liquidationCount = 0;
let earnings = 0;

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🎯 EVENT-BASED LIQUIDATOR                                           ║
║  ⚡ Instant reaction to price oracle updates                         ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;

  // Load liquidator contracts
  let liquidatorAddresses = {};
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  // Initialize providers
  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;

    try {
      // HTTP provider for transactions
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      aavePools[chain] = new ethers.Contract(config.pool, AAVE_ABI, providers[chain]);

      if (liquidatorAddresses[chain]) {
        liquidatorContracts[chain] = new ethers.Contract(liquidatorAddresses[chain], LIQUIDATOR_ABI, wallets[chain]);
      }

      // WebSocket provider for events (if available)
      if (config.ws) {
        wsProviders[chain] = new ethers.WebSocketProvider(config.ws);
        console.log(`✅ ${chain}: HTTP + WebSocket`);
      } else {
        // Fallback: use HTTP provider for events (less efficient)
        wsProviders[chain] = providers[chain];
        console.log(`✅ ${chain}: HTTP only (add WS for faster events)`);
      }

      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`   Balance: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH`);
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
  await loadBorrowers();

  console.log(`\n📊 Borrowers loaded:`);
  for (const [chain, users] of Object.entries(borrowers.aave)) {
    console.log(`   ${chain}: ${users.length} Aave`);
  }
}

async function loadBorrowers() {
  // Aave
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      const c = chain.toLowerCase();
      if (aavePools[c]) {
        borrowers.aave[c] = users.map(u => u.user);
      }
    }
  } catch {}

  // Compound
  try {
    const data = JSON.parse(fs.readFileSync('data/compound_borrowers.json', 'utf8'));
    for (const [chain, markets] of Object.entries(data)) {
      const c = chain.toLowerCase();
      if (!borrowers.compound[c]) borrowers.compound[c] = {};
      for (const [market, users] of Object.entries(markets)) {
        borrowers.compound[c][market] = users;
      }
    }
  } catch {}
}

// ============================================================
// PRICE EVENT HANDLERS
// ============================================================

async function onPriceUpdate(chain, asset, newPrice, oldPrice) {
  eventCount++;
  
  const changePercent = ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice) * 100).toFixed(2);
  
  // Only react to significant moves (>0.5%)
  if (Math.abs(parseFloat(changePercent)) < 0.5) return;

  console.log(`\n⚡ PRICE UPDATE: ${chain} ${asset}`);
  console.log(`   ${changePercent > 0 ? '📈' : '📉'} ${changePercent}% | $${(Number(newPrice) / 1e8).toFixed(2)}`);

  // Immediately check all positions on this chain
  await checkChainPositions(chain);
}

async function checkChainPositions(chain) {
  checkCount++;

  // Check Aave positions
  const aaveUsers = borrowers.aave[chain] || [];
  
  // Check in parallel batches of 20
  for (let i = 0; i < aaveUsers.length; i += 20) {
    const batch = aaveUsers.slice(i, i + 20);
    
    const results = await Promise.allSettled(
      batch.map(async (user) => {
        const data = await aavePools[chain].getUserAccountData(user);
        const debt = Number(data[1]) / 1e8;
        const hf = Number(data[5]) / 1e18;
        return { user, debt, hf, liquidatable: hf < 1.0 && hf > 0 };
      })
    );

    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const pos = r.value;

      if (pos.liquidatable && pos.debt > 100) {
        await executeAaveLiquidation(chain, pos);
      } else if (pos.hf < 1.02 && pos.hf > 0 && pos.debt > 500) {
        console.log(`   🔥 CLOSE: ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      }
    }
  }

  // Check Compound positions
  const compMarkets = borrowers.compound[chain] || {};
  
  for (const [market, users] of Object.entries(compMarkets)) {
    const comet = compoundMarkets[chain]?.[market];
    if (!comet) continue;

    for (let i = 0; i < users.length; i += 20) {
      const batch = users.slice(i, i + 20);
      
      const results = await Promise.allSettled(
        batch.map(async (user) => {
          const [isLiq, debt] = await Promise.all([
            comet.isLiquidatable(user),
            comet.borrowBalanceOf(user),
          ]);
          return { user, debt: Number(debt) / 1e6, liquidatable: isLiq };
        })
      );

      for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const pos = r.value;

        if (pos.liquidatable && pos.debt > 100) {
          await executeCompoundLiquidation(chain, market, pos);
        }
      }
    }
  }
}

// ============================================================
// EXECUTION (WITH PRIORITY GAS)
// ============================================================

async function executeWithPriorityGas(chain, txData, multiplier = 5) {
  const wallet = wallets[chain];
  const feeData = await wallet.provider.getFeeData();
  
  const priority = feeData.maxPriorityFeePerGas * BigInt(multiplier);
  
  return wallet.sendTransaction({
    ...txData,
    maxPriorityFeePerGas: priority,
    maxFeePerGas: feeData.maxFeePerGas + priority,
  });
}

async function executeAaveLiquidation(chain, pos) {
  console.log(`\n💀 AAVE LIQUIDATION: ${chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  await sendDiscord(`💀 LIQUIDATABLE: ${chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`, true);

  if (!liquidatorContracts[chain]) {
    console.log('   ⚠️ No liquidator contract');
    return;
  }

  try {
    const txData = await liquidatorContracts[chain].executeLiquidation.populateTransaction(
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      pos.user,
      ethers.parseUnits(String(Math.floor(pos.debt * 0.5)), 6)
    );
    txData.gasLimit = 1000000n;

    console.log('   ⚡ Executing with 5x priority gas...');
    const tx = await executeWithPriorityGas(chain, txData, 5);
    console.log(`   📤 TX: ${tx.hash}`);

    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      liquidationCount++;
      const profit = pos.debt * 0.05;
      earnings += profit;
      console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
      await sendDiscord(`✅ SUCCESS! ${chain} | Profit: ~$${profit.toFixed(2)} | TX: ${tx.hash}`, true);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 60)}`);
  }
}

async function executeCompoundLiquidation(chain, market, pos) {
  console.log(`\n💀 COMPOUND LIQUIDATION: ${chain}/${market} | $${pos.debt.toFixed(0)}`);
  await sendDiscord(`💀 COMPOUND LIQUIDATABLE: ${chain}/${market} | $${pos.debt.toFixed(0)}`, true);

  try {
    const comet = compoundMarkets[chain][market];
    const txData = await comet.absorb.populateTransaction(wallets[chain].address, [pos.user]);
    txData.gasLimit = 500000n;

    const tx = await executeWithPriorityGas(chain, txData, 5);
    console.log(`   📤 TX: ${tx.hash}`);

    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      liquidationCount++;
      const profit = pos.debt * 0.08;
      earnings += profit;
      console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 60)}`);
  }
}

// ============================================================
// EVENT SUBSCRIPTIONS
// ============================================================

async function subscribeToOracles() {
  console.log('\n📡 Subscribing to price oracles...\n');

  for (const [chain, feeds] of Object.entries(PRICE_FEEDS)) {
    if (!wsProviders[chain]) continue;

    for (const [asset, address] of Object.entries(feeds)) {
      try {
        const feed = new ethers.Contract(address, CHAINLINK_ABI, wsProviders[chain]);
        
        // Get current price
        const [, currentPrice] = await feed.latestRoundData();
        priceFeeds[`${chain}-${asset}`] = currentPrice;

        // Subscribe to updates
        feed.on('AnswerUpdated', (newPrice, roundId, updatedAt) => {
          const oldPrice = priceFeeds[`${chain}-${asset}`];
          priceFeeds[`${chain}-${asset}`] = newPrice;
          onPriceUpdate(chain, asset, newPrice, oldPrice);
        });

        console.log(`   ✅ ${chain} ${asset}: $${(Number(currentPrice) / 1e8).toFixed(2)}`);
      } catch (e) {
        console.log(`   ❌ ${chain} ${asset}: ${e.message}`);
      }
    }
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
        username: '🎯 Event Liquidator',
      }),
    });
  } catch {}
}

// ============================================================
// BACKGROUND SCAN (Fallback)
// ============================================================

async function backgroundScan() {
  // Scan all chains every 30 seconds as backup
  for (const chain of Object.keys(aavePools)) {
    await checkChainPositions(chain);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  await init();
  await subscribeToOracles();

  console.log('\n🚀 Listening for price events...\n');

  // Status updates every 60 seconds
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${eventCount} | Checks: ${checkCount} | Liquidations: ${liquidationCount} | Earned: $${earnings.toFixed(2)}`);
  }, 60000);

  // Background scan every 30 seconds (fallback)
  setInterval(backgroundScan, 30000);

  // Keep alive
  process.stdin.resume();
}

main().catch(console.error);
