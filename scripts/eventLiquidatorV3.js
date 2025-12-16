import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// ⚡ EVENT LIQUIDATOR V3 - Flash Loans + Parallel Execution
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL },
};

const TOKENS = {
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    WETH: '0x4200000000000000000000000000000000000006',
    cbETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  },
  polygon: {
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
  },
  avalanche: {
    USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    WETH: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
  },
};

const COMPOUND_MARKETS = {
  base: { USDC: '0xb125E6687d4313864e53df431d5425969c15Eb2F', WETH: '0x46e6b214b524310239732D51387075E0e70970bf' },
  arbitrum: { USDC: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA' },
  polygon: { USDC: '0xF25212E676D1F7F89Cd72fFEe66158f541246445' },
};

const PRICE_FEEDS = {
  base: { 'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', 'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B' },
  arbitrum: { 'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', 'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6' },
  polygon: { 'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945', 'MATIC/USD': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0' },
  avalanche: { 'ETH/USD': '0x976B3D034E162d8bD72D6b9C989d545b839003b0', 'AVAX/USD': '0x0A77230d17318075983913bC2145DB16C7366156' },
};

// ABIs
const MULTICALL_ABI = ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'];
const CHAINLINK_ABI = ['event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)', 'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'];
const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const COMPOUND_ABI = ['function isLiquidatable(address) view returns (bool)', 'function borrowBalanceOf(address) view returns (uint256)', 'function absorb(address, address[])'];
const FLASH_LIQUIDATOR_ABI = [
  'function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external',
  'function withdrawProfit(address token) external',
  'function owner() view returns (address)',
];

// State
let providers = {};
let wsProviders = {};
let wallets = {};
let multicalls = {};
let flashLiquidators = {};
let priceFeeds = {};
let borrowers = { aave: {}, compound: {} };
let stats = { events: 0, checks: 0, liquidations: 0, earnings: 0 };

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ EVENT LIQUIDATOR V3 - Flash Loans + Parallel Execution           ║
║  🎯 Aave + Compound | 4 Chains | UNLIMITED Liquidation Size          ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  
  let flashLiquidatorAddresses = {};
  try { 
    flashLiquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); 
  } catch {}

  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;

    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      
      wsProviders[chain] = config.ws ? new ethers.WebSocketProvider(config.ws) : providers[chain];

      const bal = await providers[chain].getBalance(wallets[chain].address);
      
      // Check flash liquidator
      let flashStatus = '❌ Not deployed';
      if (flashLiquidatorAddresses[chain]) {
        const code = await providers[chain].getCode(flashLiquidatorAddresses[chain]);
        if (code !== '0x' && code.length > 10) {
          flashLiquidators[chain] = new ethers.Contract(flashLiquidatorAddresses[chain], FLASH_LIQUIDATOR_ABI, wallets[chain]);
          flashStatus = '⚡ FLASH LOANS ENABLED';
        }
      }
      
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH | ${flashStatus}`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message}`);
    }
  }

  await loadBorrowers();
  printStats();
}

async function loadBorrowers() {
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      const c = chain.toLowerCase();
      if (providers[c]) borrowers.aave[c] = users.map(u => u.user || u);
    }
  } catch {}

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

function printStats() {
  const aaveTotal = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0);
  const compTotal = Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  
  console.log(`
📊 POSITIONS: ${aaveTotal} Aave + ${compTotal} Compound = ${aaveTotal + compTotal} total
⚡ FLASH LOANS: ${Object.keys(flashLiquidators).join(', ') || 'None'}
💰 MAX LIQUIDATION: ${Object.keys(flashLiquidators).length > 0 ? 'UNLIMITED (flash loans)' : 'Wallet balance only'}
`);
}

// ============================================================
// MULTICALL CHECKS
// ============================================================

async function multicallAaveCheck(chain, users) {
  if (!users?.length || !AAVE_POOLS[chain]) return [];
  
  const iface = new ethers.Interface(AAVE_ABI);
  const calls = users.map(user => ({
    target: AAVE_POOLS[chain].pool,
    allowFailure: true,
    callData: iface.encodeFunctionData('getUserAccountData', [user]),
  }));
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    return results.map((r, i) => {
      if (!r.success) return null;
      try {
        const d = iface.decodeFunctionResult('getUserAccountData', r.returnData);
        const collateral = Number(d[0]) / 1e8;
        const debt = Number(d[1]) / 1e8;
        const hf = Number(d[5]) / 1e18;
        return { 
          user: users[i], 
          debt, 
          collateral,
          hf, 
          liquidatable: hf < 1.0 && hf > 0 && debt > 100, 
          protocol: 'aave', 
          chain 
        };
      } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

async function multicallCompoundCheck(chain, market, users) {
  if (!users?.length || !COMPOUND_MARKETS[chain]?.[market]) return [];
  
  const cometAddress = COMPOUND_MARKETS[chain][market];
  const iface = new ethers.Interface(COMPOUND_ABI);
  
  const calls = users.flatMap(user => [
    { target: cometAddress, allowFailure: true, callData: iface.encodeFunctionData('isLiquidatable', [user]) },
    { target: cometAddress, allowFailure: true, callData: iface.encodeFunctionData('borrowBalanceOf', [user]) },
  ]);
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    const decoded = [];
    for (let i = 0; i < users.length; i++) {
      const liqR = results[i * 2];
      const debtR = results[i * 2 + 1];
      if (!liqR.success || !debtR.success) continue;
      try {
        const isLiq = iface.decodeFunctionResult('isLiquidatable', liqR.returnData)[0];
        const debt = Number(iface.decodeFunctionResult('borrowBalanceOf', debtR.returnData)[0]) / 1e6;
        if (debt > 100) decoded.push({ user: users[i], debt, liquidatable: isLiq, hf: isLiq ? 0.99 : 1.5, protocol: 'compound', market, chain });
      } catch {}
    }
    return decoded;
  } catch { return []; }
}

// ============================================================
// FLASH LOAN LIQUIDATION
// ============================================================

async function executeWithPriorityGas(chain, txData, mult = 5) {
  const feeData = await wallets[chain].provider.getFeeData();
  const priority = feeData.maxPriorityFeePerGas * BigInt(mult);
  return wallets[chain].sendTransaction({ ...txData, maxPriorityFeePerGas: priority, maxFeePerGas: feeData.maxFeePerGas + priority });
}

async function executeLiquidation(pos) {
  const { chain, protocol, user, debt, hf, market, collateral } = pos;
  
  console.log(`\n💀 LIQUIDATION OPPORTUNITY`);
  console.log(`   Chain: ${chain} | Protocol: ${protocol}`);
  console.log(`   User: ${user}`);
  console.log(`   Debt: $${debt.toFixed(0)} | Collateral: $${(collateral || 0).toFixed(0)} | HF: ${hf.toFixed(4)}`);
  
  await sendDiscord(`💀 LIQUIDATING!\n${chain} ${protocol}\nDebt: $${debt.toFixed(0)} | HF: ${hf.toFixed(4)}`, true);

  try {
    if (protocol === 'aave') {
      // Use USDC as debt asset, WETH as collateral (most common)
      const debtAsset = TOKENS[chain]?.USDC;
      const collateralAsset = TOKENS[chain]?.WETH;
      
      if (!debtAsset || !collateralAsset) {
        console.log(`   ❌ Missing token addresses for ${chain}`);
        return { success: false };
      }
      
      // Liquidate 50% of debt (Aave max is 50%)
      const debtToCover = ethers.parseUnits(String(Math.floor(debt * 0.5)), 6);
      
      if (flashLiquidators[chain]) {
        console.log(`   ⚡ FLASH LOAN: Borrowing $${(debt * 0.5).toFixed(0)} to liquidate`);
        
        const txData = await flashLiquidators[chain].executeLiquidation.populateTransaction(
          collateralAsset,
          debtAsset,
          user,
          debtToCover
        );
        txData.gasLimit = 1500000n;
        
        const tx = await executeWithPriorityGas(chain, txData, 10);
        console.log(`   📤 TX: ${tx.hash}`);
        
        const receipt = await tx.wait();
        
        if (receipt.status === 1) {
          stats.liquidations++;
          const profit = debt * 0.05;
          stats.earnings += profit;
          console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
          await sendDiscord(`✅ FLASH LOAN LIQUIDATION SUCCESS!\n${chain} | Debt: $${debt.toFixed(0)}\nProfit: ~$${profit.toFixed(2)}\nTX: ${tx.hash}`, true);
          return { success: true, profit, hash: tx.hash };
        }
      } else {
        console.log(`   ⚠️ No flash liquidator on ${chain} - skipping large position`);
        await sendDiscord(`⚠️ SKIPPED: No flash liquidator on ${chain}\nMissed $${debt.toFixed(0)} position`, false);
      }
    } else if (protocol === 'compound') {
      // Compound uses absorb() - anyone can call it
      const comet = new ethers.Contract(COMPOUND_MARKETS[chain][market], COMPOUND_ABI, wallets[chain]);
      const txData = await comet.absorb.populateTransaction(wallets[chain].address, [user]);
      txData.gasLimit = 500000n;
      
      const tx = await executeWithPriorityGas(chain, txData, 5);
      console.log(`   📤 TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      if (receipt.status === 1) {
        stats.liquidations++;
        const profit = debt * 0.08;
        stats.earnings += profit;
        console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
        await sendDiscord(`✅ COMPOUND LIQUIDATION SUCCESS!\n${chain}/${market}\nProfit: ~$${profit.toFixed(2)}`, true);
        return { success: true, profit };
      }
    }
    
    return { success: false };
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 100)}`);
    return { success: false, error: e.message };
  }
}

// ============================================================
// PRICE EVENTS & PROCESSING
// ============================================================

async function onPriceUpdate(chain, asset, newPrice, oldPrice) {
  stats.events++;
  const changePercent = ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice) * 100);
  
  if (Math.abs(changePercent) < 0.3) return;
  
  console.log(`\n⚡ PRICE: ${chain} ${asset} ${changePercent > 0 ? '📈' : '📉'} ${changePercent.toFixed(2)}%`);
  
  const start = Date.now();
  await checkAllProtocols(chain);
  console.log(`   ⏱️ ${Date.now() - start}ms`);
}

async function checkAllProtocols(chain) {
  stats.checks++;
  const allPositions = [];
  
  const aaveUsers = borrowers.aave[chain] || [];
  if (aaveUsers.length) {
    const results = await multicallAaveCheck(chain, aaveUsers);
    allPositions.push(...results);
  }
  
  const compMarkets = borrowers.compound[chain] || {};
  for (const [market, users] of Object.entries(compMarkets)) {
    if (!users.length) continue;
    const results = await multicallCompoundCheck(chain, market, users);
    allPositions.push(...results);
  }
  
  await processResults(allPositions);
}

async function processResults(results) {
  const liquidatable = results.filter(pos => pos.liquidatable);
  const critical = results.filter(pos => !pos.liquidatable && pos.hf < 1.01 && pos.hf > 0 && pos.debt > 1000);
  const close = results.filter(pos => !pos.liquidatable && pos.hf >= 1.01 && pos.hf < 1.02 && pos.debt > 500);

  // 🔥 PARALLEL LIQUIDATION
  if (liquidatable.length > 0) {
    console.log(`\n🔥🔥🔥 ${liquidatable.length} LIQUIDATABLE - EXECUTING IN PARALLEL 🔥🔥🔥`);
    await sendDiscord(`🔥 ${liquidatable.length} POSITIONS LIQUIDATABLE!`, true);
    const executions = await Promise.all(liquidatable.map(pos => executeLiquidation(pos)));
    const successful = executions.filter(e => e.success).length;
    console.log(`   Result: ${successful}/${liquidatable.length} successful`);
  }

  // 🚨 CRITICAL (< 1% from liquidation)
  for (const pos of critical) {
    const distance = ((pos.hf - 1) * 100).toFixed(2);
    console.log(`   🚨 CRITICAL: ${pos.chain} ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)} | ${distance}% away`);
    await sendDiscord(`🚨 CRITICAL POSITION!\n${pos.chain} | $${pos.debt.toFixed(0)}\nHF: ${pos.hf.toFixed(4)} | ${distance}% from liquidation`, true);
  }

  // 🔥 CLOSE (1-2% from liquidation)
  for (const pos of close) {
    console.log(`   🔥 CLOSE: ${pos.chain} ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  }
}

// ============================================================
// ORACLE SUBSCRIPTIONS
// ============================================================

async function subscribeToOracles() {
  console.log('📡 Subscribing to oracles...\n');

  for (const [chain, feeds] of Object.entries(PRICE_FEEDS)) {
    if (!wsProviders[chain]) continue;

    for (const [asset, address] of Object.entries(feeds)) {
      try {
        const feed = new ethers.Contract(address, CHAINLINK_ABI, wsProviders[chain]);
        const [, currentPrice] = await feed.latestRoundData();
        priceFeeds[`${chain}-${asset}`] = currentPrice;

        feed.on('AnswerUpdated', (newPrice) => {
          const oldPrice = priceFeeds[`${chain}-${asset}`];
          priceFeeds[`${chain}-${asset}`] = newPrice;
          onPriceUpdate(chain, asset, newPrice, oldPrice);
        });

        console.log(`   ✅ ${chain} ${asset}: $${(Number(currentPrice) / 1e8).toFixed(2)}`);
      } catch (e) {
        console.log(`   ❌ ${chain} ${asset}: ${e.message.slice(0, 50)}`);
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
        username: '⚡ Liquidator V3' 
      }),
    });
  } catch {}
}

async function sendStartupMessage() {
  const totalPositions = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0) +
    Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  
  const flashChains = Object.keys(flashLiquidators);
  
  await sendDiscord(
    `🚀 LIQUIDATOR V3 STARTED\n` +
    `📊 ${totalPositions} positions monitored\n` +
    `⛓️ Chains: ${Object.keys(providers).join(', ')}\n` +
    `⚡ Flash loans: ${flashChains.length > 0 ? flashChains.join(', ') : 'DISABLED'}\n` +
    `💰 Max liquidation: ${flashChains.length > 0 ? 'UNLIMITED' : 'Wallet balance'}\n` +
    `🎯 Ready!`, 
    true
  );
}

// ============================================================
// BACKGROUND SCAN
// ============================================================

async function backgroundScan() {
  for (const chain of Object.keys(providers)) {
    await checkAllProtocols(chain);
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  await init();
  await subscribeToOracles();
  await sendStartupMessage();

  console.log('🚀 Listening for price events...\n');

  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${stats.events} | Checks: ${stats.checks} | Liquidations: ${stats.liquidations} | Earned: $${stats.earnings.toFixed(2)}`);
  }, 60000);

  setInterval(backgroundScan, 30000);
  process.stdin.resume();
}

main().catch(console.error);
