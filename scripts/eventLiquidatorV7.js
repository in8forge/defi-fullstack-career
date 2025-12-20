import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_PROFIT_USD = 5;

const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL },
};

const VENUS_CONFIG = {
  rpc: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
  comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
};

const VENUS_VTOKENS = {
  vBNB: { address: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', underlying: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  vUSDC: { address: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', underlying: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' },
  vUSDT: { address: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', underlying: '0x55d398326f99059fF775485246999027B3197955' },
  vBTC: { address: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', underlying: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c' },
  vETH: { address: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8', underlying: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8' },
};

const CHAIN_ASSETS = {
  base: [
    { symbol: 'WETH', token: '0x4200000000000000000000000000000000000006', aToken: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7', debtToken: '0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E', decimals: 18 },
    { symbol: 'USDC', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', aToken: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB', debtToken: '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28', decimals: 6 },
  ],
  polygon: [
    { symbol: 'WETH', token: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18 },
    { symbol: 'USDC', token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6 },
  ],
  arbitrum: [
    { symbol: 'WETH', token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18 },
    { symbol: 'USDC', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', aToken: '0x724dc807b04555b71ed48a6896b6F41593b8C637', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6 },
  ],
  avalanche: [
    { symbol: 'WAVAX', token: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97', debtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8', decimals: 18 },
    { symbol: 'USDC', token: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6 },
  ],
};

const COMPOUND_MARKETS = {
  base: { USDC: '0xb125E6687d4313864e53df431d5425969c15Eb2F' },
  arbitrum: { USDC: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA' },
  polygon: { USDC: '0xF25212E676D1F7F89Cd72fFEe66158f541246445' },
};

const PRICE_FEEDS = {
  base: { 'ETH/USD': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70' },
  arbitrum: { 'ETH/USD': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612' },
  polygon: { 'ETH/USD': '0xF9680D99D6C9589e2a93a78A04A279e509205945' },
  avalanche: { 'AVAX/USD': '0x0A77230d17318075983913bC2145DB16C7366156' },
};

// ABIs
const MULTICALL_ABI = ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'];
const CHAINLINK_ABI = ['event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)', 'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'];
const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const COMPOUND_ABI = ['function isLiquidatable(address) view returns (bool)', 'function borrowBalanceOf(address) view returns (uint256)'];
const VENUS_ABI = ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)'];
const VTOKEN_ABI = ['function balanceOf(address) view returns (uint256)', 'function borrowBalanceStored(address) view returns (uint256)'];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];
const AAVE_LIQUIDATOR_ABI = ['function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover)'];
const BNB_LIQUIDATOR_ABI = ['function executeLiquidation(address debtAsset, uint256 debtAmount, address vTokenBorrowed, address vTokenCollateral, address borrower)'];

let providers = {}, wsProviders = {}, wallets = {}, multicalls = {}, liquidators = {};
let borrowers = { aave: {}, compound: {}, venus: new Set() };
let badDebtCache = new Set();
let executionLock = new Set();
let stats = { events: 0, checks: 0, liquidations: 0, badDebt: 0, attempted: 0, failed: 0 };
let venusProvider, venusWallet, venusComptroller, venusLiquidator;
let liquidatorAddresses = {};

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ EVENT LIQUIDATOR V7 - WITH EXECUTION                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      wsProviders[chain] = config.ws ? new ethers.WebSocketProvider(config.ws) : null;
      
      if (liquidatorAddresses[chain]) {
        liquidators[chain] = new ethers.Contract(liquidatorAddresses[chain], AAVE_LIQUIDATOR_ABI, wallets[chain]);
        console.log(`✅ ${chain}: Liquidator ${liquidatorAddresses[chain].slice(0,10)}...`);
      } else {
        console.log(`⚠️  ${chain}: No liquidator deployed`);
      }
      
      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`   Balance: ${Number(ethers.formatEther(bal)).toFixed(4)} native`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 40)}`);
    }
  }

  // Venus/BNB setup
  if (VENUS_CONFIG.rpc) {
    try {
      venusProvider = new ethers.JsonRpcProvider(VENUS_CONFIG.rpc);
      venusWallet = new ethers.Wallet(pk, venusProvider);
      venusComptroller = new ethers.Contract(VENUS_CONFIG.comptroller, VENUS_ABI, venusProvider);
      
      if (liquidatorAddresses.bnb) {
        venusLiquidator = new ethers.Contract(liquidatorAddresses.bnb, BNB_LIQUIDATOR_ABI, venusWallet);
        console.log(`✅ bnb: Liquidator ${liquidatorAddresses.bnb.slice(0,10)}...`);
      }
      
      const bal = await venusProvider.getBalance(venusWallet.address);
      console.log(`   Balance: ${Number(ethers.formatEther(bal)).toFixed(4)} BNB`);
      
      borrowers.venus = new Set([
        '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc',
        '0x7589dD3355DAE848FDbF75044A3495351655cB1A',
        '0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296',
      ]);
    } catch (e) {
      console.log(`❌ bnb: ${e.message.slice(0, 40)}`);
    }
  }

  await loadBorrowers();
  
  const aaveTotal = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0);
  const compTotal = Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  console.log(`\n📊 POSITIONS: ${aaveTotal} Aave + ${compTotal} Compound + ${borrowers.venus.size} Venus`);
  console.log(`🛡️  EXECUTION: ENABLED\n`);
}

async function loadBorrowers() {
  try {
    const data = JSON.parse(fs.readFileSync('data/borrowers.json', 'utf8'));
    for (const [chain, users] of Object.entries(data)) {
      if (providers[chain.toLowerCase()]) borrowers.aave[chain.toLowerCase()] = users.map(u => u.user || u);
    }
  } catch {}
  try {
    const data = JSON.parse(fs.readFileSync('data/compound_borrowers.json', 'utf8'));
    for (const [chain, markets] of Object.entries(data)) {
      if (!borrowers.compound[chain.toLowerCase()]) borrowers.compound[chain.toLowerCase()] = {};
      for (const [market, users] of Object.entries(markets)) {
        borrowers.compound[chain.toLowerCase()][market] = users;
      }
    }
  } catch {}
}

async function hasAaveCollateral(chain, user) {
  const assets = CHAIN_ASSETS[chain];
  if (!assets) return { has: false };
  const iface = new ethers.Interface(ERC20_ABI);
  const calls = assets.map(a => ({ target: a.aToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) }));
  try {
    const results = await multicalls[chain].aggregate3(calls);
    for (let i = 0; i < results.length; i++) {
      if (results[i].success) {
        const bal = iface.decodeFunctionResult('balanceOf', results[i].returnData)[0];
        if (bal > 0n) return { has: true, asset: assets[i] };
      }
    }
  } catch {}
  return { has: false };
}

async function getAaveDebtAsset(chain, user) {
  const assets = CHAIN_ASSETS[chain];
  if (!assets) return null;
  const iface = new ethers.Interface(ERC20_ABI);
  const calls = assets.map(a => ({ target: a.debtToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) }));
  try {
    const results = await multicalls[chain].aggregate3(calls);
    let maxDebt = 0n, debtAsset = null;
    for (let i = 0; i < results.length; i++) {
      if (results[i].success) {
        const bal = iface.decodeFunctionResult('balanceOf', results[i].returnData)[0];
        if (bal > maxDebt) { maxDebt = bal; debtAsset = assets[i]; }
      }
    }
    return debtAsset ? { asset: debtAsset, amount: maxDebt } : null;
  } catch { return null; }
}

async function hasVenusCollateral(user) {
  for (const [symbol, config] of Object.entries(VENUS_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(config.address, VTOKEN_ABI, venusProvider);
      if ((await vToken.balanceOf(user)) > 0n) return { has: true, vToken: symbol, config };
    } catch {}
  }
  return { has: false };
}

async function getVenusDebt(user) {
  for (const [symbol, config] of Object.entries(VENUS_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(config.address, VTOKEN_ABI, venusProvider);
      const debt = await vToken.borrowBalanceStored(user);
      if (debt > 0n) return { vToken: symbol, config, amount: debt };
    } catch {}
  }
  return null;
}

// ============================================================
// EXECUTION LOGIC
// ============================================================

async function executeAaveLiquidation(chain, pos) {
  const key = `aave-${chain}-${pos.user}`;
  if (executionLock.has(key)) return;
  executionLock.add(key);
  
  try {
    if (!liquidators[chain]) {
      console.log(`   ⚠️  No liquidator for ${chain}`);
      return;
    }
    
    const collateral = await hasAaveCollateral(chain, pos.user);
    if (!collateral.has) {
      console.log(`   💀 No collateral found for ${pos.user.slice(0,10)}`);
      return;
    }
    
    const debt = await getAaveDebtAsset(chain, pos.user);
    if (!debt) {
      console.log(`   ⚠️  No debt found for ${pos.user.slice(0,10)}`);
      return;
    }
    
    // Liquidate 50% of debt (max allowed)
    const debtToCover = debt.amount / 2n;
    
    console.log(`   🔥 EXECUTING: ${chain} ${pos.user.slice(0,10)}...`);
    console.log(`      Collateral: ${collateral.asset.symbol}`);
    console.log(`      Debt: ${debt.asset.symbol} (${ethers.formatUnits(debtToCover, debt.asset.decimals)})`);
    
    stats.attempted++;
    
    const tx = await liquidators[chain].executeLiquidation(
      collateral.asset.token,
      debt.asset.token,
      pos.user,
      debtToCover,
      { gasLimit: 1000000 }
    );
    
    console.log(`   ⏳ TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      stats.liquidations++;
      console.log(`   ✅ SUCCESS! Gas: ${receipt.gasUsed.toString()}`);
      await sendDiscord(`✅ LIQUIDATION SUCCESS!\n${chain} Aave\n${pos.user.slice(0,16)}...\nTX: ${tx.hash}`, true);
    } else {
      stats.failed++;
      console.log(`   ❌ FAILED`);
    }
  } catch (e) {
    stats.failed++;
    console.log(`   ❌ Error: ${e.message.slice(0, 60)}`);
  } finally {
    executionLock.delete(key);
  }
}

async function executeVenusLiquidation(pos) {
  const key = `venus-${pos.user}`;
  if (executionLock.has(key)) return;
  executionLock.add(key);
  
  try {
    if (!venusLiquidator) {
      console.log(`   ⚠️  No Venus liquidator deployed`);
      return;
    }
    
    const collateral = await hasVenusCollateral(pos.user);
    if (!collateral.has) {
      console.log(`   💀 No collateral for ${pos.user.slice(0,10)}`);
      return;
    }
    
    const debt = await getVenusDebt(pos.user);
    if (!debt) {
      console.log(`   ⚠️  No debt found for ${pos.user.slice(0,10)}`);
      return;
    }
    
    console.log(`   🔥 EXECUTING VENUS: ${pos.user.slice(0,10)}...`);
    console.log(`      Collateral: ${collateral.vToken}`);
    console.log(`      Debt: ${debt.vToken}`);
    
    stats.attempted++;
    
    const tx = await venusLiquidator.executeLiquidation(
      debt.config.underlying,
      debt.amount / 2n,
      debt.config.address,
      collateral.config.address,
      pos.user,
      { gasLimit: 1500000 }
    );
    
    console.log(`   ⏳ TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      stats.liquidations++;
      console.log(`   ✅ SUCCESS!`);
      await sendDiscord(`✅ VENUS LIQUIDATION!\n${pos.user.slice(0,16)}...\nTX: ${tx.hash}`, true);
    } else {
      stats.failed++;
    }
  } catch (e) {
    stats.failed++;
    console.log(`   ❌ Error: ${e.message.slice(0, 60)}`);
  } finally {
    executionLock.delete(key);
  }
}

// ============================================================
// SCANNING
// ============================================================

async function multicallAaveCheck(chain, users) {
  if (!users?.length || !AAVE_POOLS[chain]) return [];
  const iface = new ethers.Interface(AAVE_ABI);
  const calls = users.map(user => ({ target: AAVE_POOLS[chain].pool, allowFailure: true, callData: iface.encodeFunctionData('getUserAccountData', [user]) }));
  try {
    const results = await multicalls[chain].aggregate3(calls);
    const positions = [];
    for (let i = 0; i < results.length; i++) {
      if (!results[i].success) continue;
      try {
        const d = iface.decodeFunctionResult('getUserAccountData', results[i].returnData);
        const collateral = Number(d[0]) / 1e8, debt = Number(d[1]) / 1e8, hf = Number(d[5]) / 1e18;
        if (debt < 100) continue;
        const liquidatable = hf < 1.0 && hf > 0;
        if (liquidatable && collateral < 10) {
          const key = `aave-${chain}-${users[i]}`;
          if (!badDebtCache.has(key)) { badDebtCache.add(key); stats.badDebt++; }
          continue;
        }
        positions.push({ user: users[i], debt, collateral, hf, liquidatable, protocol: 'aave', chain });
      } catch {}
    }
    return positions;
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
    const positions = [];
    for (let i = 0; i < users.length; i++) {
      if (!results[i*2].success || !results[i*2+1].success) continue;
      try {
        const isLiq = iface.decodeFunctionResult('isLiquidatable', results[i*2].returnData)[0];
        const debt = Number(iface.decodeFunctionResult('borrowBalanceOf', results[i*2+1].returnData)[0]) / 1e6;
        if (debt > 100) positions.push({ user: users[i], debt, liquidatable: isLiq, hf: isLiq ? 0.99 : 1.5, protocol: 'compound', market, chain });
      } catch {}
    }
    return positions;
  } catch { return []; }
}

async function scanVenus() {
  if (!venusProvider || borrowers.venus.size === 0) return [];
  const results = [];
  for (const address of borrowers.venus) {
    try {
      const [error, liquidity, shortfall] = await venusComptroller.getAccountLiquidity(address);
      if (error !== 0n) continue;
      const shortfallUsd = Number(shortfall) / 1e18;
      const liquidatable = shortfall > 0n;
      
      if (liquidatable) {
        const collateral = await hasVenusCollateral(address);
        if (!collateral.has) {
          const key = `venus-${address}`;
          if (!badDebtCache.has(key)) { badDebtCache.add(key); stats.badDebt++; console.log(`   💀 BAD DEBT: venus ${address.slice(0,10)}...`); }
          continue;
        }
        results.push({ user: address, debt: shortfallUsd, liquidatable: true, hf: 0.99, protocol: 'venus', chain: 'bnb' });
      }
    } catch {}
  }
  return results;
}

async function checkAllProtocols(chain) {
  stats.checks++;
  const allPositions = [];
  const aaveUsers = borrowers.aave[chain] || [];
  if (aaveUsers.length) allPositions.push(...await multicallAaveCheck(chain, aaveUsers));
  const compMarkets = borrowers.compound[chain] || {};
  for (const [market, users] of Object.entries(compMarkets)) {
    if (users.length) allPositions.push(...await multicallCompoundCheck(chain, market, users));
  }
  await processResults(allPositions);
}

async function backgroundScan() {
  for (const chain of Object.keys(providers)) await checkAllProtocols(chain);
  const venusResults = await scanVenus();
  if (venusResults.length > 0) await processResults(venusResults);
}

async function processResults(results) {
  const liquidatable = results.filter(p => p.liquidatable);
  const critical = results.filter(p => !p.liquidatable && p.hf < 1.02 && p.hf > 0 && p.debt > 1000);
  
  if (liquidatable.length > 0) {
    console.log(`\n🔥🔥🔥 ${liquidatable.length} LIQUIDATABLE 🔥🔥🔥`);
    
    // Execute in parallel
    const executions = liquidatable.map(async (pos) => {
      console.log(`   💰 ${pos.chain} ${pos.protocol}: ${pos.user.slice(0,12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      
      if (pos.protocol === 'aave') {
        await executeAaveLiquidation(pos.chain, pos);
      } else if (pos.protocol === 'venus') {
        await executeVenusLiquidation(pos);
      }
    });
    
    await Promise.all(executions);
  }
  
  for (const pos of critical) {
    console.log(`   🚨 CRITICAL: ${pos.chain} ${pos.protocol} ${pos.user.slice(0,10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  }
}

async function subscribeToOracles() {
  console.log('📡 Subscribing to oracles...\n');
  for (const [chain, feeds] of Object.entries(PRICE_FEEDS)) {
    if (!wsProviders[chain]) continue;
    for (const [asset, address] of Object.entries(feeds)) {
      try {
        const feed = new ethers.Contract(address, CHAINLINK_ABI, wsProviders[chain]);
        const [, price] = await feed.latestRoundData();
        console.log(`   ✅ ${chain} ${asset}: $${(Number(price) / 1e8).toFixed(2)}`);
        feed.on('AnswerUpdated', () => { stats.events++; checkAllProtocols(chain); });
      } catch (e) { console.log(`   ❌ ${chain} ${asset}`); }
    }
  }
}

async function sendDiscord(message, urgent = false) {
  if (!DISCORD_WEBHOOK) return;
  try { await fetch(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '⚡ Liquidator V7' }) }); } catch {}
}

async function main() {
  await init();
  await subscribeToOracles();
  await sendDiscord('🚀 LIQUIDATOR V7 STARTED\n🛡️ EXECUTION: ENABLED', true);
  console.log('🚀 Listening for events...\n');
  setInterval(() => console.log(`[${new Date().toLocaleTimeString()}] Events: ${stats.events} | Checks: ${stats.checks} | Attempted: ${stats.attempted} | Success: ${stats.liquidations} | Failed: ${stats.failed}`), 60000);
  setInterval(backgroundScan, 30000);
  process.stdin.resume();
}

main().catch(console.error);
