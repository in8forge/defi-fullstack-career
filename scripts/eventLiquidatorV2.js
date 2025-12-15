import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// 🎯 EVENT LIQUIDATOR V2 - Multicall + WebSocket
// Checks 100+ positions in single RPC call
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

const PRICE_FEEDS = {
  base: {
    'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70',
    'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B',
  },
  arbitrum: {
    'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612',
    'USDC/USD': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3',
  },
  polygon: {
    'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945',
    'USDC/USD': '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7',
  },
  avalanche: {
    'ETH/USD': '0x976B3D034E162d8bD72D6b9C989d545b839003b0',
    'AVAX/USD': '0x0A77230d17318075983913bC2145DB16C7366156',
  },
};

const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL },
};

const COMPOUND_MARKETS = {
  base: { USDC: '0xb125E6687d4313864e53df431d5425969c15Eb2F', WETH: '0x46e6b214b524310239732D51387075E0e70970bf' },
  arbitrum: { USDC: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA' },
  polygon: { USDC: '0xF25212E676D1F7F89Cd72fFEe66158f541246445' },
};

const MULTICALL_ABI = ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'];
const CHAINLINK_ABI = ['event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)', 'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'];
const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const COMPOUND_ABI = ['function isLiquidatable(address) view returns (bool)', 'function borrowBalanceOf(address) view returns (uint256)', 'function absorb(address, address[])'];
const LIQUIDATOR_ABI = ['function executeLiquidation(address,address,address,uint256) external'];

let providers = {};
let wsProviders = {};
let wallets = {};
let multicalls = {};
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
// MULTICALL - Check 100+ positions in 1 RPC call
// ============================================================

async function multicallAaveCheck(chain, users) {
  if (!users.length) return [];
  
  const poolAddress = AAVE_POOLS[chain].pool;
  const aaveInterface = new ethers.Interface(AAVE_ABI);
  
  const calls = users.map(user => ({
    target: poolAddress,
    allowFailure: true,
    callData: aaveInterface.encodeFunctionData('getUserAccountData', [user]),
  }));
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    
    return results.map((r, i) => {
      if (!r.success) return null;
      try {
        const decoded = aaveInterface.decodeFunctionResult('getUserAccountData', r.returnData);
        const debt = Number(decoded[1]) / 1e8;
        const hf = Number(decoded[5]) / 1e18;
        return { user: users[i], debt, hf, liquidatable: hf < 1.0 && hf > 0 && debt > 100 };
      } catch { return null; }
    }).filter(Boolean);
  } catch (e) {
    console.log(`   Multicall error ${chain}: ${e.message}`);
    return [];
  }
}

async function multicallCompoundCheck(chain, market, users) {
  if (!users.length) return [];
  
  const cometAddress = COMPOUND_MARKETS[chain][market];
  const compInterface = new ethers.Interface(COMPOUND_ABI);
  
  const calls = users.flatMap(user => [
    { target: cometAddress, allowFailure: true, callData: compInterface.encodeFunctionData('isLiquidatable', [user]) },
    { target: cometAddress, allowFailure: true, callData: compInterface.encodeFunctionData('borrowBalanceOf', [user]) },
  ]);
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    
    const decoded = [];
    for (let i = 0; i < users.length; i++) {
      const liqR = results[i * 2];
      const debtR = results[i * 2 + 1];
      if (!liqR.success || !debtR.success) continue;
      
      try {
        const isLiq = compInterface.decodeFunctionResult('isLiquidatable', liqR.returnData)[0];
        const debt = Number(compInterface.decodeFunctionResult('borrowBalanceOf', debtR.returnData)[0]) / 1e6;
        if (debt > 100) decoded.push({ user: users[i], debt, liquidatable: isLiq, hf: isLiq ? 0.99 : 1.5 });
      } catch {}
    }
    return decoded;
  } catch { return []; }
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🎯 EVENT LIQUIDATOR V2 - Multicall + WebSocket                      ║
║  ⚡ 100+ positions checked in single RPC call                        ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  let liquidatorAddresses = {};
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      aavePools[chain] = new ethers.Contract(config.pool, AAVE_ABI, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      
      if (liquidatorAddresses[chain]) {
        liquidatorContracts[chain] = new ethers.Contract(liquidatorAddresses[chain], LIQUIDATOR_ABI, wallets[chain]);
      }

      if (config.ws) {
        wsProviders[chain] = new ethers.WebSocketProvider(config.ws);
        console.log(`✅ ${chain}: HTTP + WebSocket + Multicall`);
      } else {
        wsProviders[chain] = providers[chain];
        console.log(`✅ ${chain}: HTTP + Multicall`);
      }

      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`   Balance: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message}`);
    }
  }

  for (const [chain, markets] of Object.entries(COMPOUND_MARKETS)) {
    if (!providers[chain]) continue;
    compoundMarkets[chain] = {};
    for (const [market, address] of Object.entries(markets)) {
      compoundMarkets[chain][market] = new ethers.Contract(address, COMPOUND_ABI, wallets[chain]);
    }
  }

  await loadBorrowers();
  
  const totalAave = Object.values(borrowers.aave).reduce((s, a) => s + a.length, 0);
  const totalComp = Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  console.log(`\n📊 ${totalAave} Aave + ${totalComp} Compound = ${totalAave + totalComp} total positions`);
}

async function loadBorrowers() {
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      const c = chain.toLowerCase();
      if (aavePools[c]) borrowers.aave[c] = users.map(u => u.user);
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

// ============================================================
// PRICE EVENT HANDLER - Uses Multicall
// ============================================================

async function onPriceUpdate(chain, asset, newPrice, oldPrice) {
  eventCount++;
  const changePercent = ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice) * 100);
  
  if (Math.abs(changePercent) < 0.3) return; // React to smaller moves now
  
  console.log(`\n⚡ PRICE: ${chain} ${asset} ${changePercent > 0 ? '📈' : '📉'} ${changePercent.toFixed(2)}%`);
  
  const start = Date.now();
  await checkChainPositions(chain);
  console.log(`   ⏱️ Checked in ${Date.now() - start}ms`);
}

async function checkChainPositions(chain) {
  checkCount++;
  
  // AAVE - Check ALL positions in ONE call
  const aaveUsers = borrowers.aave[chain] || [];
  if (aaveUsers.length) {
    const results = await multicallAaveCheck(chain, aaveUsers);
    
    for (const pos of results) {
      if (pos.liquidatable) {
        await executeAaveLiquidation(chain, pos);
      } else if (pos.hf < 1.02 && pos.debt > 500) {
        console.log(`   🔥 CLOSE: ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      }
    }
  }
  
  // COMPOUND - Check each market
  const compMarkets = borrowers.compound[chain] || {};
  for (const [market, users] of Object.entries(compMarkets)) {
    if (!users.length) continue;
    const results = await multicallCompoundCheck(chain, market, users);
    
    for (const pos of results) {
      if (pos.liquidatable) {
        await executeCompoundLiquidation(chain, market, pos);
      }
    }
  }
}

// ============================================================
// EXECUTION
// ============================================================

async function executeWithPriorityGas(chain, txData, mult = 5) {
  const feeData = await wallets[chain].provider.getFeeData();
  const priority = feeData.maxPriorityFeePerGas * BigInt(mult);
  return wallets[chain].sendTransaction({ ...txData, maxPriorityFeePerGas: priority, maxFeePerGas: feeData.maxFeePerGas + priority });
}

async function executeAaveLiquidation(chain, pos) {
  console.log(`\n💀 AAVE LIQUIDATION: ${chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  await sendDiscord(`💀 LIQUIDATABLE: ${chain} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`, true);

  if (!liquidatorContracts[chain]) { console.log('   ⚠️ No contract'); return; }

  try {
    const txData = await liquidatorContracts[chain].executeLiquidation.populateTransaction(
      ethers.ZeroAddress, ethers.ZeroAddress, pos.user, ethers.parseUnits(String(Math.floor(pos.debt * 0.5)), 6)
    );
    txData.gasLimit = 1000000n;

    console.log('   ⚡ Executing with 5x priority...');
    const tx = await executeWithPriorityGas(chain, txData, 5);
    console.log(`   📤 TX: ${tx.hash}`);

    const receipt = await tx.wait();
    if (receipt.status === 1) {
      liquidationCount++;
      const profit = pos.debt * 0.05;
      earnings += profit;
      console.log(`   ✅ SUCCESS! ~$${profit.toFixed(2)}`);
      await sendDiscord(`✅ SUCCESS! ${chain} | ~$${profit.toFixed(2)}`, true);
    }
  } catch (e) { console.log(`   ❌ ${e.message.slice(0, 50)}`); }
}

async function executeCompoundLiquidation(chain, market, pos) {
  console.log(`\n💀 COMPOUND: ${chain}/${market} | $${pos.debt.toFixed(0)}`);
  await sendDiscord(`💀 COMPOUND: ${chain}/${market} | $${pos.debt.toFixed(0)}`, true);

  try {
    const comet = compoundMarkets[chain][market];
    const txData = await comet.absorb.populateTransaction(wallets[chain].address, [pos.user]);
    txData.gasLimit = 500000n;

    const tx = await executeWithPriorityGas(chain, txData, 5);
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      liquidationCount++;
      earnings += pos.debt * 0.08;
      console.log(`   ✅ SUCCESS!`);
    }
  } catch (e) { console.log(`   ❌ ${e.message.slice(0, 50)}`); }
}

// ============================================================
// SUBSCRIPTIONS
// ============================================================

async function subscribeToOracles() {
  console.log('\n📡 Subscribing to oracles...\n');

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
        console.log(`   ❌ ${chain} ${asset}: ${e.message}`);
      }
    }
  }
}

async function sendDiscord(message, urgent = false) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '🎯 Event Liq V2' }),
    });
  } catch {}
}

async function backgroundScan() {
  for (const chain of Object.keys(aavePools)) {
    await checkChainPositions(chain);
  }
}

async function main() {
  await init();
  await subscribeToOracles();

  console.log('\n🚀 Listening...\n');

  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${eventCount} | Checks: ${checkCount} | Liquidations: ${liquidationCount} | Earned: $${earnings.toFixed(2)}`);
  }, 60000);

  setInterval(backgroundScan, 30000);
  process.stdin.resume();
}

main().catch(console.error);
