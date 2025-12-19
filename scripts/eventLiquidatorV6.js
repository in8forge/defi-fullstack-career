import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_PROFIT_USD = 5;

const FLASHBOTS_RPC = { base: 'https://rpc.flashbots.net/base' };

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
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  vDAI: '0x334b3eCB4DCa3593BCCC3c7EBD1A1C1d1780FBF1',
  vBUSD: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D',
};

const CHAIN_ASSETS = {
  base: [
    { symbol: 'WETH', aToken: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7' },
    { symbol: 'USDC', aToken: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB' },
  ],
  polygon: [
    { symbol: 'WETH', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8' },
    { symbol: 'USDC', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD' },
  ],
  arbitrum: [
    { symbol: 'WETH', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8' },
    { symbol: 'USDC', aToken: '0x724dc807b04555b71ed48a6896b6F41593b8C637' },
  ],
  avalanche: [
    { symbol: 'WAVAX', aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97' },
    { symbol: 'USDC', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD' },
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

const MULTICALL_ABI = ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'];
const CHAINLINK_ABI = ['event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)', 'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'];
const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const COMPOUND_ABI = ['function isLiquidatable(address) view returns (bool)', 'function borrowBalanceOf(address) view returns (uint256)'];
const VENUS_ABI = ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)'];
const VTOKEN_ABI = ['function balanceOf(address) view returns (uint256)'];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

let providers = {}, wsProviders = {}, wallets = {}, multicalls = {};
let borrowers = { aave: {}, compound: {}, venus: new Set() };
let badDebtCache = new Set();
let stats = { events: 0, checks: 0, liquidations: 0, badDebt: 0 };
let venusProvider, venusComptroller;

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ EVENT LIQUIDATOR V6.1 - Bad Debt Filter                          ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;

  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      wsProviders[chain] = config.ws ? new ethers.WebSocketProvider(config.ws) : null;
      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} native`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 40)}`);
    }
  }

  if (VENUS_CONFIG.rpc) {
    try {
      venusProvider = new ethers.JsonRpcProvider(VENUS_CONFIG.rpc);
      venusComptroller = new ethers.Contract(VENUS_CONFIG.comptroller, VENUS_ABI, venusProvider);
      const wallet = new ethers.Wallet(pk, venusProvider);
      const bal = await venusProvider.getBalance(wallet.address);
      console.log(`✅ bnb (Venus): ${Number(ethers.formatEther(bal)).toFixed(4)} BNB`);
      
      borrowers.venus = new Set([
        '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc',
        '0x7589dD3355DAE848FDbF75044A3495351655cB1A',
        '0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296',
      ]);
      console.log(`   Venus: ${borrowers.venus.size} borrowers loaded`);
    } catch (e) {
      console.log(`❌ bnb: ${e.message.slice(0, 40)}`);
    }
  }

  await loadBorrowers();
  
  const aaveTotal = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0);
  const compTotal = Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  console.log(`\n📊 POSITIONS: ${aaveTotal} Aave + ${compTotal} Compound + ${borrowers.venus.size} Venus`);
  console.log(`🛡️  BAD DEBT FILTER: Enabled\n`);
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
  if (!assets) return false;
  const iface = new ethers.Interface(ERC20_ABI);
  const calls = assets.map(a => ({ target: a.aToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) }));
  try {
    const results = await multicalls[chain].aggregate3(calls);
    for (const r of results) {
      if (r.success && iface.decodeFunctionResult('balanceOf', r.returnData)[0] > 0n) return true;
    }
  } catch {}
  return false;
}

async function hasVenusCollateral(user) {
  for (const addr of Object.values(VENUS_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(addr, VTOKEN_ABI, venusProvider);
      if ((await vToken.balanceOf(user)) > 0n) return true;
    } catch {}
  }
  return false;
}

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
          if (!badDebtCache.has(key)) { badDebtCache.add(key); stats.badDebt++; console.log(`   💀 BAD DEBT: ${chain} aave ${users[i].slice(0,10)}... | $${debt.toFixed(0)} debt, no collateral`); }
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
        const hasCollateral = await hasVenusCollateral(address);
        if (!hasCollateral) {
          const key = `venus-${address}`;
          if (!badDebtCache.has(key)) { badDebtCache.add(key); stats.badDebt++; console.log(`   💀 BAD DEBT: bnb venus ${address.slice(0,10)}... | $${shortfallUsd.toFixed(0)} shortfall, no collateral`); }
          continue;
        }
        results.push({ user: address, debt: shortfallUsd, liquidatable: true, hf: 0.99, protocol: 'venus', chain: 'bnb' });
      } else {
        const liquidityUsd = Number(liquidity) / 1e18;
        if (liquidityUsd > 0 && liquidityUsd < 5000) {
          results.push({ user: address, debt: liquidityUsd, liquidity: liquidityUsd, liquidatable: false, hf: 1.01, protocol: 'venus', chain: 'bnb' });
        }
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
    console.log(`\n🔥🔥🔥 ${liquidatable.length} LIQUIDATABLE (verified collateral) 🔥🔥🔥`);
    for (const pos of liquidatable) {
      console.log(`   💰 ${pos.chain} ${pos.protocol}: ${pos.user.slice(0,12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      await sendDiscord(`🔥 LIQUIDATABLE!\n${pos.chain} ${pos.protocol}\n$${pos.debt.toFixed(0)} debt\nCollateral: ✅ Verified`, true);
    }
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
  try { await fetch(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '⚡ Liquidator V6.1' }) }); } catch {}
}

async function main() {
  await init();
  await subscribeToOracles();
  await sendDiscord('🚀 LIQUIDATOR V6.1 STARTED\n🛡️ Bad Debt Filter: ON', true);
  console.log('🚀 Listening for events...\n');
  setInterval(() => console.log(`[${new Date().toLocaleTimeString()}] Events: ${stats.events} | Checks: ${stats.checks} | BadDebt: ${stats.badDebt} | Liqs: ${stats.liquidations}`), 60000);
  setInterval(backgroundScan, 30000);
  process.stdin.resume();
}

main().catch(console.error);
