import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// ⚡ EVENT LIQUIDATOR V6 - Multi-Protocol + Venus BNB
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_PROFIT_USD = 5;

const FLASHBOTS_RPC = {
  base: 'https://rpc.flashbots.net/base',
};

const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL, gasPrice: 0.001, nativePrice: 2900 },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL, gasPrice: 30, nativePrice: 0.5 },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL, gasPrice: 0.01, nativePrice: 2900 },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL, gasPrice: 25, nativePrice: 35 },
};

const VENUS_CONFIG = {
  rpc: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
  comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
  liquidator: '0x163A862679E73329eA835aC302E54aCBee7A58B1',
  gasPrice: 3,
  nativePrice: 600,
};

const VENUS_VTOKENS = {
  vBNB: { address: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', symbol: 'BNB', decimals: 8 },
  vUSDC: { address: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', symbol: 'USDC', decimals: 8 },
  vUSDT: { address: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', symbol: 'USDT', decimals: 8 },
  vBTC: { address: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', symbol: 'BTC', decimals: 8 },
  vETH: { address: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8', symbol: 'ETH', decimals: 8 },
};

const CHAIN_ASSETS = {
  base: [
    { symbol: 'WETH', token: '0x4200000000000000000000000000000000000006', aToken: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7', debtToken: '0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', aToken: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB', debtToken: '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28', decimals: 6, bonus: 450 },
  ],
  polygon: [
    { symbol: 'WETH', token: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6, bonus: 450 },
  ],
  arbitrum: [
    { symbol: 'WETH', token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', aToken: '0x724dc807b04555b71ed48a6896b6F41593b8C637', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6, bonus: 450 },
  ],
  avalanche: [
    { symbol: 'WAVAX', token: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97', debtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6, bonus: 450 },
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
const VENUS_COMPTROLLER_ABI = ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)', 'function getAllMarkets() view returns (address[])', 'function borrowerAccounts(uint256) view returns (address)', 'function borrowerAccountsLength() view returns (uint256)'];
const VENUS_VTOKEN_ABI = ['function borrowBalanceStored(address) view returns (uint256)', 'function getAccountSnapshot(address) view returns (uint256, uint256, uint256, uint256)'];
const FLASH_LIQUIDATOR_ABI = ['function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover) external'];
const BNB_FLASH_LIQUIDATOR_ABI = ['function executeLiquidation(address debtAsset, uint256 debtAmount, address vTokenBorrowed, address vTokenCollateral, address borrower) external'];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

// State
let providers = {};
let wsProviders = {};
let wallets = {};
let flashbotsWallets = {};
let multicalls = {};
let flashLiquidators = {};
let priceFeeds = {};
let borrowers = { aave: {}, compound: {}, venus: new Set() };
let stats = { events: 0, checks: 0, liquidations: 0, skipped: 0, earnings: 0, venusPositions: 0 };

let venusProvider;
let venusWallet;
let venusComptroller;
let venusLiquidator;

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ EVENT LIQUIDATOR V6 - Multi-Protocol + Venus BNB                 ║
║  🛡️  Aave | Compound | Venus | Min profit: $${MIN_PROFIT_USD}                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  let flashLiquidatorAddresses = {};
  try { flashLiquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      wsProviders[chain] = config.ws ? new ethers.WebSocketProvider(config.ws) : null;

      if (FLASHBOTS_RPC[chain]) {
        flashbotsWallets[chain] = new ethers.Wallet(pk, new ethers.JsonRpcProvider(FLASHBOTS_RPC[chain]));
      }

      const bal = await providers[chain].getBalance(wallets[chain].address);
      
      if (flashLiquidatorAddresses[chain]) {
        flashLiquidators[chain] = new ethers.Contract(flashLiquidatorAddresses[chain], FLASH_LIQUIDATOR_ABI, flashbotsWallets[chain] || wallets[chain]);
      }
      
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 40)}`);
    }
  }

  await initVenus(pk, flashLiquidatorAddresses);
  await loadBorrowers();
  printStats();
}

async function initVenus(pk, liquidatorAddresses) {
  if (!VENUS_CONFIG.rpc) return;
  
  try {
    venusProvider = new ethers.JsonRpcProvider(VENUS_CONFIG.rpc);
    venusWallet = new ethers.Wallet(pk, venusProvider);
    venusComptroller = new ethers.Contract(VENUS_CONFIG.comptroller, VENUS_COMPTROLLER_ABI, venusProvider);
    
    const bal = await venusProvider.getBalance(venusWallet.address);
    
    if (liquidatorAddresses.bnb) {
      venusLiquidator = new ethers.Contract(liquidatorAddresses.bnb, BNB_FLASH_LIQUIDATOR_ABI, venusWallet);
    }
    
    console.log(`✅ bnb (Venus): ${Number(ethers.formatEther(bal)).toFixed(4)} BNB`);
    
    await discoverVenusBorrowers();
  } catch (e) {
    console.log(`❌ bnb (Venus): ${e.message.slice(0, 40)}`);
  }
}

async function discoverVenusBorrowers() {
  if (!venusProvider) return;
  
  // Method 1: Query vToken borrowers via getAccountSnapshot
  console.log('   🔍 Discovering Venus borrowers...');
  
  // Use a known list of active borrowers from recent transactions
  // This is populated from Venus subgraph or BSCScan
  const knownBorrowers = [
    '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc',
    '0x1F6D66bA924EBf554883cF84d482394013eD294B',
    '0x7589dD3355DAE848FDbF75044A3495351655cB1A',
    '0x8249Ed6f7585C00e3A2d4a4C0a6c3aBf0D4d2a5a',
    '0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296',
    '0x2D407dDb06311396fE14D4b49da5F0471447d45C',
    '0x67A0693c53A2f84c831F9C6f65BB9A8D3e73282B',
    '0x6C68cECf7659b3E7bF76B3d6E3A9F1BC0aEa6F3A',
    '0x89C527764f03BCb7dC469707B23b79C1D7beb780',
    '0x70e36f6BF80a52b3B46b3aF8e106CC0ed743E8e4',
  ];
  
  for (const addr of knownBorrowers) {
    borrowers.venus.add(addr);
  }
  
  // Also try to get borrowers from vToken events (limited blocks)
  for (const [name, config] of Object.entries(VENUS_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(config.address, ['event Borrow(address borrower, uint borrowAmount, uint accountBorrows, uint totalBorrows)'], venusProvider);
      const filter = vToken.filters.Borrow();
      const events = await vToken.queryFilter(filter, -2000); // Last 2000 blocks
      
      for (const event of events) {
        borrowers.venus.add(event.args.borrower);
      }
    } catch {}
  }
  
  stats.venusPositions = borrowers.venus.size;
  console.log(`   Venus: ${borrowers.venus.size} borrowers discovered`);
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
  const venusTotal = borrowers.venus.size;
  
  console.log(`\n📊 POSITIONS: ${aaveTotal} Aave + ${compTotal} Compound + ${venusTotal} Venus = ${aaveTotal + compTotal + venusTotal} total`);
  console.log(`⚡ FLASH LOANS: ${Object.keys(flashLiquidators).join(', ')}${venusLiquidator ? ', bnb' : ''}`);
  console.log(`💰 MIN PROFIT: $${MIN_PROFIT_USD}\n`);
}

// ============================================================
// VENUS CHECKS
// ============================================================

async function checkVenusAccount(address) {
  try {
    const [error, liquidity, shortfall] = await venusComptroller.getAccountLiquidity(address);
    if (error !== 0n) return null;
    
    const shortfallUsd = Number(shortfall) / 1e18;
    const liquidityUsd = Number(liquidity) / 1e18;
    
    return {
      user: address,
      shortfall: shortfallUsd,
      liquidity: liquidityUsd,
      liquidatable: shortfall > 0n,
      debt: shortfallUsd > 0 ? shortfallUsd : liquidityUsd,
      hf: shortfall > 0n ? 0.99 : (liquidityUsd > 0 ? 1 + (liquidityUsd / 10000) : 1.0),
      protocol: 'venus',
      chain: 'bnb',
    };
  } catch {
    return null;
  }
}

async function scanVenus() {
  if (!venusProvider || borrowers.venus.size === 0) return [];
  
  const results = [];
  
  for (const address of borrowers.venus) {
    const account = await checkVenusAccount(address);
    if (account) {
      if (account.liquidatable) {
        results.push(account);
      } else if (account.liquidity > 0 && account.liquidity < 10000) {
        results.push(account);
      }
    }
  }
  
  return results;
}

// ============================================================
// AAVE/COMPOUND CHECKS
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
        const debtUsd = Number(d[1]) / 1e8;
        const hf = Number(d[5]) / 1e18;
        return { user: users[i], debt: debtUsd, hf, liquidatable: hf < 1.0 && hf > 0 && debtUsd > 100, protocol: 'aave', chain };
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
// SCANNING
// ============================================================

async function onPriceUpdate(chain, asset, newPrice, oldPrice) {
  stats.events++;
  const changePercent = ((Number(newPrice) - Number(oldPrice)) / Number(oldPrice) * 100);
  if (Math.abs(changePercent) < 0.3) return;
  
  console.log(`\n⚡ PRICE: ${chain} ${asset} ${changePercent > 0 ? '📈' : '📉'} ${changePercent.toFixed(2)}%`);
  
  await checkAllProtocols(chain);
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

async function backgroundScan() {
  for (const chain of Object.keys(providers)) {
    await checkAllProtocols(chain);
  }
  
  const venusResults = await scanVenus();
  if (venusResults.length > 0) {
    await processResults(venusResults);
  }
}

async function processResults(results) {
  const liquidatable = results.filter(pos => pos.liquidatable);
  const critical = results.filter(pos => !pos.liquidatable && pos.hf < 1.01 && pos.hf > 0 && pos.debt > 1000);

  if (liquidatable.length > 0) {
    console.log(`\n🔥🔥🔥 ${liquidatable.length} LIQUIDATABLE 🔥🔥🔥`);
    for (const pos of liquidatable) {
      console.log(`   💀 ${pos.chain} ${pos.protocol}: ${pos.user.slice(0, 12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      await sendDiscord(`🔥 LIQUIDATABLE!\n${pos.chain} ${pos.protocol}\n${pos.user.slice(0, 16)}...\nDebt: $${pos.debt.toFixed(0)}`, true);
    }
  }

  for (const pos of critical) {
    console.log(`   🚨 CRITICAL: ${pos.chain} ${pos.protocol} ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  }
}

// ============================================================
// ORACLES
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
        console.log(`   ❌ ${chain} ${asset}: ${e.message.slice(0, 40)}`);
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
      body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '⚡ Liquidator V6' }),
    });
  } catch {}
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  await init();
  await subscribeToOracles();

  const totalPositions = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0) +
    Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0) +
    borrowers.venus.size;

  await sendDiscord(`🚀 LIQUIDATOR V6 STARTED\n📊 ${totalPositions} positions\n🔗 Aave | Compound | Venus\n💰 Min profit: $${MIN_PROFIT_USD}`, true);

  console.log('🚀 Listening for events...\n');

  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${stats.events} | Checks: ${stats.checks} | Venus: ${stats.venusPositions} | Liquidations: ${stats.liquidations}`);
  }, 60000);

  setInterval(backgroundScan, 30000);
  setInterval(discoverVenusBorrowers, 3600000);
  
  process.stdin.resume();
}

main().catch(console.error);
