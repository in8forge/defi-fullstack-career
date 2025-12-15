import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// 🎯 EVENT LIQUIDATOR V3 - Multi-Protocol
// Aave + Compound + Morpho + Radiant + Silo
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';

// ============================================================
// PROTOCOL CONFIGURATIONS
// ============================================================

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

// Morpho Blue - Permissionless lending markets
const MORPHO_BLUE = {
  base: {
    morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    markets: [
      { id: '0xdba352d93a64b17c71104cbddc6aef85cd432322a1446b5b65163cbbc615cd0c', name: 'WETH/USDC' },
      { id: '0xa066f3893b780833699043f824e5bb88b8df039886f524f62b9a1ac83cb7f1f0', name: 'cbETH/USDC' },
    ],
  },
  ethereum: {
    morpho: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
    markets: [
      { id: '0xc54d7acf14de29e0e5527cabd7a576506870346a78a11a6762e2cca66322ec41', name: 'wstETH/WETH' },
      { id: '0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc', name: 'wstETH/USDC' },
    ],
  },
};

// Radiant V2 - Omnichain lending
const RADIANT_POOLS = {
  arbitrum: {
    pool: '0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1',
    oracle: '0xC0cA5a9E1FaB2DE71b3bf97153177d784c6cb5f6',
  },
};

// Silo Finance - Isolated lending
const SILO_MARKETS = {
  arbitrum: {
    lens: '0xBDb843c7a7e48Dc543424474d7Aa63b61B5D9536',
    silos: [
      { address: '0x69eC552BE56E6505703f0C861c40039e5702037A', name: 'WETH' },
      { address: '0x0696E6808EE11a5750733a3d821F9bB847E584FB', name: 'ARB' },
    ],
  },
};

// Price feeds
const PRICE_FEEDS = {
  base: { 'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', 'USDC/USD': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B' },
  arbitrum: { 'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', 'ARB/USD': '0xb2A824043730FE05F3DA2efaFa1CBbe83fa548D6' },
  polygon: { 'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945', 'MATIC/USD': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0' },
  avalanche: { 'ETH/USD': '0x976B3D034E162d8bD72D6b9C989d545b839003b0', 'AVAX/USD': '0x0A77230d17318075983913bC2145DB16C7366156' },
};

// ============================================================
// ABIs
// ============================================================

const MULTICALL_ABI = ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'];
const CHAINLINK_ABI = ['event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)', 'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'];
const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const COMPOUND_ABI = ['function isLiquidatable(address) view returns (bool)', 'function borrowBalanceOf(address) view returns (uint256)', 'function absorb(address, address[])'];
const LIQUIDATOR_ABI = ['function executeLiquidation(address,address,address,uint256) external'];

// Morpho Blue ABI
const MORPHO_ABI = [
  'function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)',
  'function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)',
  'function liquidate(bytes32 id, address borrower, uint256 seizedAssets, uint256 repaidShares, bytes calldata data)',
  'event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)',
];

// Radiant ABI
const RADIANT_ABI = [
  'function getUserAccountData(address user) view returns (uint256 totalCollateralETH, uint256 totalDebtETH, uint256 availableBorrowsETH, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)',
  'function liquidationCall(address collateralAsset, address debtAsset, address user, uint256 debtToCover, bool receiveAToken)',
];

// Silo ABI
const SILO_LENS_ABI = [
  'function getUserLTV(address silo, address user) view returns (uint256)',
  'function getUserMaximumLTV(address silo, address user) view returns (uint256)',
  'function getBorrowerSilos(address user) view returns (address[])',
];

// ============================================================
// STATE
// ============================================================

let providers = {};
let wsProviders = {};
let wallets = {};
let multicalls = {};
let liquidatorContracts = {};
let priceFeeds = {};

let borrowers = {
  aave: {},
  compound: {},
  morpho: {},
  radiant: {},
  silo: {},
};

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
║  🎯 EVENT LIQUIDATOR V3 - Multi-Protocol                            ║
║  ⚡ Aave + Compound + Morpho + Radiant + Silo                        ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  let liquidatorAddresses = {};
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  // Initialize all chains
  const allChains = new Set([
    ...Object.keys(AAVE_POOLS),
    ...Object.keys(COMPOUND_MARKETS),
    ...Object.keys(MORPHO_BLUE),
    ...Object.keys(RADIANT_POOLS),
    ...Object.keys(SILO_MARKETS),
  ]);

  for (const chain of allChains) {
    const rpc = process.env[`${chain.toUpperCase()}_RPC_URL`];
    const ws = process.env[`${chain.toUpperCase()}_WS_URL`];
    
    if (!rpc) continue;
    
    try {
      providers[chain] = new ethers.JsonRpcProvider(rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      
      if (liquidatorAddresses[chain]) {
        liquidatorContracts[chain] = new ethers.Contract(liquidatorAddresses[chain], LIQUIDATOR_ABI, wallets[chain]);
      }

      if (ws) {
        wsProviders[chain] = new ethers.WebSocketProvider(ws);
      } else {
        wsProviders[chain] = providers[chain];
      }

      const bal = await providers[chain].getBalance(wallets[chain].address);
      const protocols = [];
      if (AAVE_POOLS[chain]) protocols.push('Aave');
      if (COMPOUND_MARKETS[chain]) protocols.push('Compound');
      if (MORPHO_BLUE[chain]) protocols.push('Morpho');
      if (RADIANT_POOLS[chain]) protocols.push('Radiant');
      if (SILO_MARKETS[chain]) protocols.push('Silo');
      
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH | ${protocols.join(', ')}`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message}`);
    }
  }

  await loadAllBorrowers();
  await discoverMorphoBorrowers();
  await discoverRadiantBorrowers();
  
  printStats();
}

async function loadAllBorrowers() {
  // Aave
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      const c = chain.toLowerCase();
      if (providers[c]) borrowers.aave[c] = users.map(u => u.user);
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

async function discoverMorphoBorrowers() {
  console.log('\n📡 Discovering Morpho borrowers...');
  
  for (const [chain, config] of Object.entries(MORPHO_BLUE)) {
    if (!providers[chain]) continue;
    
    const morpho = new ethers.Contract(config.morpho, [
      'event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)',
    ], providers[chain]);
    
    borrowers.morpho[chain] = {};
    
    try {
      const currentBlock = await providers[chain].getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 200000);
      
      for (const market of config.markets) {
        const events = await morpho.queryFilter(morpho.filters.Borrow(market.id), fromBlock, currentBlock);
        const users = [...new Set(events.map(e => e.args.onBehalf))];
        borrowers.morpho[chain][market.id] = users;
        console.log(`   ${chain} Morpho ${market.name}: ${users.length} borrowers`);
      }
    } catch (e) {
      console.log(`   ❌ ${chain} Morpho: ${e.message}`);
    }
  }
}

async function discoverRadiantBorrowers() {
  console.log('\n📡 Discovering Radiant borrowers...');
  
  for (const [chain, config] of Object.entries(RADIANT_POOLS)) {
    if (!providers[chain]) continue;
    
    const pool = new ethers.Contract(config.pool, [
      'event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint256 borrowRateMode, uint256 borrowRate, uint16 indexed referral)',
    ], providers[chain]);
    
    try {
      const currentBlock = await providers[chain].getBlockNumber();
      const fromBlock = Math.max(0, currentBlock - 200000);
      
      const events = await pool.queryFilter(pool.filters.Borrow(), fromBlock, currentBlock);
      const users = [...new Set(events.map(e => e.args.onBehalfOf))];
      borrowers.radiant[chain] = users;
      console.log(`   ${chain} Radiant: ${users.length} borrowers`);
    } catch (e) {
      console.log(`   ❌ ${chain} Radiant: ${e.message}`);
    }
  }
}

function printStats() {
  const aaveTotal = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0);
  const compTotal = Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  const morphoTotal = Object.values(borrowers.morpho).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  const radiantTotal = Object.values(borrowers.radiant).reduce((s, a) => s + (a?.length || 0), 0);
  
  console.log(`
📊 TOTAL POSITIONS:
   Aave:     ${aaveTotal}
   Compound: ${compTotal}
   Morpho:   ${morphoTotal}
   Radiant:  ${radiantTotal}
   ─────────────────
   TOTAL:    ${aaveTotal + compTotal + morphoTotal + radiantTotal}
`);
}

// ============================================================
// MULTICALL CHECKS
// ============================================================

async function multicallAaveCheck(chain, users) {
  if (!users?.length || !AAVE_POOLS[chain]) return [];
  
  const poolAddress = AAVE_POOLS[chain].pool;
  const iface = new ethers.Interface(AAVE_ABI);
  
  const calls = users.map(user => ({
    target: poolAddress,
    allowFailure: true,
    callData: iface.encodeFunctionData('getUserAccountData', [user]),
  }));
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    return results.map((r, i) => {
      if (!r.success) return null;
      try {
        const d = iface.decodeFunctionResult('getUserAccountData', r.returnData);
        const debt = Number(d[1]) / 1e8;
        const hf = Number(d[5]) / 1e18;
        return { user: users[i], debt, hf, liquidatable: hf < 1.0 && hf > 0 && debt > 100, protocol: 'aave' };
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
        if (debt > 100) decoded.push({ user: users[i], debt, liquidatable: isLiq, hf: isLiq ? 0.99 : 1.5, protocol: 'compound', market });
      } catch {}
    }
    return decoded;
  } catch { return []; }
}

async function multicallRadiantCheck(chain, users) {
  if (!users?.length || !RADIANT_POOLS[chain]) return [];
  
  const poolAddress = RADIANT_POOLS[chain].pool;
  const iface = new ethers.Interface(RADIANT_ABI);
  
  const calls = users.map(user => ({
    target: poolAddress,
    allowFailure: true,
    callData: iface.encodeFunctionData('getUserAccountData', [user]),
  }));
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    return results.map((r, i) => {
      if (!r.success) return null;
      try {
        const d = iface.decodeFunctionResult('getUserAccountData', r.returnData);
        const debt = Number(d[1]) / 1e18 * 3100; // Convert ETH to USD approx
        const hf = Number(d[5]) / 1e18;
        return { user: users[i], debt, hf, liquidatable: hf < 1.0 && hf > 0 && debt > 100, protocol: 'radiant' };
      } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

async function checkMorphoPositions(chain) {
  if (!MORPHO_BLUE[chain] || !borrowers.morpho[chain]) return [];
  
  const morpho = new ethers.Contract(MORPHO_BLUE[chain].morpho, MORPHO_ABI, providers[chain]);
  const results = [];
  
  for (const market of MORPHO_BLUE[chain].markets) {
    const users = borrowers.morpho[chain][market.id] || [];
    
    for (const user of users.slice(0, 50)) { // Limit per market
      try {
        const [pos, mkt] = await Promise.all([
          morpho.position(market.id, user),
          morpho.market(market.id),
        ]);
        
        const borrowShares = Number(pos.borrowShares);
        const collateral = Number(pos.collateral);
        
        if (borrowShares === 0) continue;
        
        // Calculate approximate health
        const totalBorrowAssets = Number(mkt.totalBorrowAssets);
        const totalBorrowShares = Number(mkt.totalBorrowShares);
        const borrowAssets = totalBorrowShares > 0 ? (borrowShares * totalBorrowAssets) / totalBorrowShares : 0;
        
        // Simplified HF calculation (needs oracle for accuracy)
        const hf = collateral > 0 && borrowAssets > 0 ? (collateral * 0.8) / borrowAssets : 2;
        
        if (borrowAssets > 100e6) { // > $100
          results.push({
            user,
            debt: borrowAssets / 1e6,
            hf,
            liquidatable: hf < 1.0,
            protocol: 'morpho',
            market: market.name,
            marketId: market.id,
          });
        }
      } catch {}
    }
  }
  
  return results;
}

// ============================================================
// PRICE EVENT HANDLER
// ============================================================

async function onPriceUpdate(chain, asset, newPrice, oldPrice) {
  eventCount++;
  const changePercent = ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice) * 100);
  
  if (Math.abs(changePercent) < 0.3) return;
  
  console.log(`\n⚡ PRICE: ${chain} ${asset} ${changePercent > 0 ? '📈' : '📉'} ${changePercent.toFixed(2)}%`);
  
  const start = Date.now();
  await checkAllProtocols(chain);
  console.log(`   ⏱️ All protocols checked in ${Date.now() - start}ms`);
}

async function checkAllProtocols(chain) {
  checkCount++;
  
  // AAVE
  const aaveUsers = borrowers.aave[chain] || [];
  if (aaveUsers.length) {
    const results = await multicallAaveCheck(chain, aaveUsers);
    await processResults(chain, results);
  }
  
  // COMPOUND
  const compMarkets = borrowers.compound[chain] || {};
  for (const [market, users] of Object.entries(compMarkets)) {
    if (!users.length) continue;
    const results = await multicallCompoundCheck(chain, market, users);
    await processResults(chain, results);
  }
  
  // RADIANT
  const radiantUsers = borrowers.radiant[chain] || [];
  if (radiantUsers.length) {
    const results = await multicallRadiantCheck(chain, radiantUsers);
    await processResults(chain, results);
  }
  
  // MORPHO
  if (MORPHO_BLUE[chain]) {
    const results = await checkMorphoPositions(chain);
    await processResults(chain, results);
  }
}

async function processResults(chain, results) {
  for (const pos of results) {
    if (pos.liquidatable) {
      await executeLiquidation(chain, pos);
    } else if (pos.hf < 1.02 && pos.debt > 500) {
      const marketInfo = pos.market ? `/${pos.market}` : '';
      console.log(`   🔥 CLOSE [${pos.protocol}${marketInfo}]: ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
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

async function executeLiquidation(chain, pos) {
  const marketInfo = pos.market ? `/${pos.market}` : '';
  console.log(`\n💀 ${pos.protocol.toUpperCase()} LIQUIDATION: ${chain}${marketInfo} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  await sendDiscord(`💀 ${pos.protocol.toUpperCase()}: ${chain}${marketInfo} | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`, true);

  try {
    let tx;
    
    if (pos.protocol === 'aave' && liquidatorContracts[chain]) {
      const txData = await liquidatorContracts[chain].executeLiquidation.populateTransaction(
        ethers.ZeroAddress, ethers.ZeroAddress, pos.user, ethers.parseUnits(String(Math.floor(pos.debt * 0.5)), 6)
      );
      txData.gasLimit = 1000000n;
      tx = await executeWithPriorityGas(chain, txData, 5);
      
    } else if (pos.protocol === 'compound') {
      const comet = new ethers.Contract(COMPOUND_MARKETS[chain][pos.market], COMPOUND_ABI, wallets[chain]);
      const txData = await comet.absorb.populateTransaction(wallets[chain].address, [pos.user]);
      txData.gasLimit = 500000n;
      tx = await executeWithPriorityGas(chain, txData, 5);
      
    } else if (pos.protocol === 'radiant') {
      const pool = new ethers.Contract(RADIANT_POOLS[chain].pool, RADIANT_ABI, wallets[chain]);
      // Simplified - would need to get actual collateral/debt assets
      console.log('   ⚠️ Radiant liquidation needs collateral/debt asset detection');
      return;
      
    } else if (pos.protocol === 'morpho') {
      const morpho = new ethers.Contract(MORPHO_BLUE[chain].morpho, MORPHO_ABI, wallets[chain]);
      // Morpho liquidation is more complex - needs seized assets calculation
      console.log('   ⚠️ Morpho liquidation needs seized assets calculation');
      return;
      
    } else {
      console.log('   ⚠️ No liquidator for this protocol');
      return;
    }

    console.log(`   📤 TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      liquidationCount++;
      const profit = pos.debt * 0.05;
      earnings += profit;
      console.log(`   ✅ SUCCESS! ~$${profit.toFixed(2)}`);
      await sendDiscord(`✅ SUCCESS! ${pos.protocol} ${chain} | ~$${profit.toFixed(2)}`, true);
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 50)}`);
  }
}

// ============================================================
// SUBSCRIPTIONS
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
      body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '🎯 Multi-Protocol Liq' }),
    });
  } catch {}
}

async function backgroundScan() {
  for (const chain of Object.keys(providers)) {
    await checkAllProtocols(chain);
  }
}

async function main() {
  await init();
  await subscribeToOracles();

  console.log('🚀 Listening for price events...\n');

  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${eventCount} | Checks: ${checkCount} | Liquidations: ${liquidationCount} | Earned: $${earnings.toFixed(2)}`);
  }, 60000);

  setInterval(backgroundScan, 30000);
  process.stdin.resume();
}

main().catch(console.error);
