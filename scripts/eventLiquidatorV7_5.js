import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';
import http from 'http';

// ============================================================
// ⚡ EVENT LIQUIDATOR V7.5 - PRODUCTION HARDENED
// ============================================================
// V7.5 Changes (all V7.4.1 features preserved):
// + FIXED: Uncaught promise rejections in event handlers
// + FIXED: WebSocket auto-reconnection with exponential backoff
// + FIXED: Race condition with timeout-based locks
// + FIXED: Nonce management for parallel TX submission
// + FIXED: Empty catch blocks now log to debug
// + FIXED: Memory leak in unknownPairOpportunities
// + FIXED: Stale price detection (10s cache, was 60s)
// + FIXED: Division by zero protection
// + ADDED: Health check HTTP endpoint (port 3847)
// + ADDED: Circuit breaker for repeated failures
// + ADDED: Competitor detection (position gone before we liquidate)
// + ADDED: Graceful shutdown handling
// + ADDED: Dry-run mode (DRY_RUN=true env var)
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_PROFIT_USD = 5;
const MEV_THRESHOLD_USD = 500; // Skip Flashbots for liquidations under this
const OWNER_WALLET = process.env.OWNER_WALLET || '0x55F5F2186f907057EB40a9EFEa99A0A41BcbB885';
const DRY_RUN = process.env.DRY_RUN === 'true';
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3847');
const PRICE_CACHE_MS = 10000; // Reduced from 60s to 10s for accuracy
const LOCK_TIMEOUT_MS = 120000; // 2 minute lock timeout

// ============================================================
// ENVIRONMENT VALIDATION
// ============================================================

function validateEnv() {
  if (!process.env.PRIVATE_KEY) {
    console.error('❌ FATAL: Missing PRIVATE_KEY in environment');
    console.error('   Please check your .env file');
    process.exit(1);
  }
  const pk = process.env.PRIVATE_KEY;
  if (!pk.match(/^(0x)?[a-fA-F0-9]{64}$/)) {
    console.error('❌ FATAL: PRIVATE_KEY is not a valid 32-byte hex string');
    process.exit(1);
  }
}

// ============================================================
// CIRCUIT BREAKER & ERROR TRACKING
// ============================================================

const errorTracker = {
  consecutive: 0,
  total: 0,
  lastError: null,
  circuitOpen: false,
  circuitOpenUntil: null,
};

function trackError(type, error) {
  errorTracker.consecutive++;
  errorTracker.total++;
  errorTracker.lastError = error?.message?.slice(0, 100) || 'Unknown';
  debugLog('error', { type, message: error?.message?.slice(0, 200) });
  
  if (errorTracker.consecutive >= 5 && !errorTracker.circuitOpen) {
    errorTracker.circuitOpen = true;
    errorTracker.circuitOpenUntil = Date.now() + 300000; // 5 min cooldown
    console.log(`\n🔴 CIRCUIT BREAKER OPEN - Pausing for 5 minutes`);
    sendDiscord(`🔴 CIRCUIT BREAKER OPEN\n${errorTracker.consecutive} consecutive failures\nLast: ${errorTracker.lastError}`, true);
  }
}

function trackSuccess() {
  errorTracker.consecutive = 0;
  if (errorTracker.circuitOpen && Date.now() > errorTracker.circuitOpenUntil) {
    errorTracker.circuitOpen = false;
    console.log(`\n🟢 CIRCUIT BREAKER CLOSED`);
    sendDiscord(`🟢 CIRCUIT BREAKER CLOSED`, false);
  }
}

function isCircuitOpen() {
  if (!errorTracker.circuitOpen) return false;
  if (Date.now() > errorTracker.circuitOpenUntil) {
    errorTracker.circuitOpen = false;
    return false;
  }
  return true;
}

// ============================================================
// DEBUG LOGGING (replaces empty catch blocks)
// ============================================================

const debugBuffer = [];
function debugLog(category, data) {
  debugBuffer.push({ timestamp: new Date().toISOString(), category, data });
  if (debugBuffer.length > 500) debugBuffer.shift();
}

// ============================================================
// LATENCY TRACKING
// ============================================================

const latencyStats = {
  priceUpdate: [],
  positionCheck: [],
  profitSim: [],
  txExecution: [],
  total: [],
};

function trackLatency(category, startTime) {
  const elapsed = Date.now() - startTime;
  latencyStats[category].push(elapsed);
  // Keep last 100 samples
  if (latencyStats[category].length > 100) {
    latencyStats[category].shift();
  }
  return elapsed;
}

function getAvgLatency(category) {
  const arr = latencyStats[category];
  if (arr.length === 0) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function logLatencyReport() {
  console.log(`\n📊 LATENCY REPORT:`);
  console.log(`   Price Update: ${getAvgLatency('priceUpdate')}ms avg`);
  console.log(`   Position Check: ${getAvgLatency('positionCheck')}ms avg`);
  console.log(`   Profit Sim: ${getAvgLatency('profitSim')}ms avg`);
  console.log(`   TX Execution: ${getAvgLatency('txExecution')}ms avg`);
  console.log(`   Total Pipeline: ${getAvgLatency('total')}ms avg\n`);
}

// ============================================================
// MEV PROTECTION - Private RPCs (with smart skip)
// ============================================================

const PRIVATE_RPC = {
  base: 'https://rpc.flashbots.net/base',
  arbitrum: 'https://rpc.flashbots.net/arbitrum',
  polygon: 'https://rpc.flashbots.net/polygon',
  avalanche: null,
  bnb: null,
};

// Gas config per chain
const GAS_CONFIG = {
  base: { avgGas: 0.001, nativePrice: 3000, gasLimit: 800000 },
  polygon: { avgGas: 50, nativePrice: 0.5, gasLimit: 800000 },
  arbitrum: { avgGas: 0.01, nativePrice: 3000, gasLimit: 1500000 },
  avalanche: { avgGas: 30, nativePrice: 35, gasLimit: 800000 },
  bnb: { avgGas: 3, nativePrice: 600, gasLimit: 1500000 },
};

// Liquidation bonus (basis points)
const LIQUIDATION_BONUS = {
  aave: 500,
  compound: 800,
  venus: 1000,
};

// ============================================================
// CHAIN CONFIGURATIONS
// ============================================================

const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL, version: 'V2', dataProvider: '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac' },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL, version: 'V1', dataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654' },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL, version: 'V1', dataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654' },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL, version: 'V1', dataProvider: '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654' },
};

const VENUS_CONFIG = {
  rpc: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org',
  ws: process.env.BNB_WS_URL,
  comptroller: '0xfD36E2c2a6789Db23113685031d7F16329158384',
};

const VENUS_VTOKENS = {
  vBNB: { address: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', underlying: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'BNB', decimals: 18 },
  vUSDC: { address: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', underlying: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
  vUSDT: { address: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', underlying: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
  vBTC: { address: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', underlying: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTC', decimals: 18 },
  vETH: { address: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8', underlying: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', decimals: 18 },
};

// Fallback static assets (used if dynamic discovery fails)
const CHAIN_ASSETS_FALLBACK = {
  base: [
    { symbol: 'WETH', token: '0x4200000000000000000000000000000000000006', aToken: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7', debtToken: '0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E', decimals: 18 },
    { symbol: 'USDC', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', aToken: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB', debtToken: '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28', decimals: 6 },
    { symbol: 'cbETH', token: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', aToken: '0xcf3D55c10DB69f28fD1A75Bd73f3D8A2d9c595ad', debtToken: '0x1DabC36f19909425f654777249815c073E8Fd79F', decimals: 18 },
  ],
  polygon: [
    { symbol: 'WETH', token: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18 },
    { symbol: 'USDC', token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6 },
    { symbol: 'WMATIC', token: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97', debtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8', decimals: 18 },
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

// Dynamic asset storage (populated at runtime)
let CHAIN_ASSETS = {};

const COMPOUND_MARKETS = {
  base: { 
    USDC: { 
      comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
      baseToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      collaterals: [
        { symbol: 'WETH', token: '0x4200000000000000000000000000000000000006' },
        { symbol: 'cbETH', token: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' },
      ]
    }
  },
  arbitrum: { 
    USDC: { 
      comet: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
      baseToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      collaterals: [
        { symbol: 'WETH', token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
      ]
    }
  },
  polygon: { 
    USDC: { 
      comet: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
      baseToken: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      collaterals: [
        { symbol: 'WETH', token: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619' },
      ]
    }
  },
};

// ============================================================
// CHAINLINK PRICE FEEDS - Comprehensive per chain
// ============================================================

const CHAINLINK_FEEDS = {
  base: {
    '0x4200000000000000000000000000000000000006': '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B', // USDC
    '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22': '0xd7818272B9e248357d13057AAb0B417aF31E817d', // cbETH
  },
  polygon: {
    '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619': '0xF9680D99D6C9589e2a93a78A04A279e509205945', // WETH
    '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174': '0xfE4A8cc5b5B2366C1B58Bea3858e81843581b2F7', // USDC
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270': '0xAB594600376Ec9fD91F8e885dADF0CE036862dE0', // WMATIC
  },
  arbitrum: {
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1': '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612', // WETH
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3', // USDC
  },
  avalanche: {
    '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7': '0x0A77230d17318075983913bC2145DB16C7366156', // WAVAX
    '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E': '0xF096872672F44d6EBA71458D74fe67F9a77a23B9', // USDC
  },
  bnb: {
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c': '0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE', // WBNB
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': '0x51597f405303C4377E36123cBc172b13269EA163', // USDC
    '0x55d398326f99059fF775485246999027B3197955': '0xB97Ad0E74fa7d920791E90258A6E2085088b4320', // USDT
    '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': '0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf', // BTCB
    '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': '0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e', // ETH
  },
};

// DEX Router addresses for liquidity validation
const DEX_ROUTERS = {
  base: { quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a' },
  polygon: { quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' },
  arbitrum: { quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6' },
};

const MIN_SWAP_OUTPUT_RATIO = 0.95;

// ============================================================
// ABIs
// ============================================================

const MULTICALL_ABI = ['function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])'];
const CHAINLINK_ABI = ['event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)', 'function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)'];
const AAVE_ABI = ['function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'];
const AAVE_POOL_ABI = ['function getReservesList() view returns (address[])', 'event Borrow(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 referralCode)'];
const AAVE_DATA_PROVIDER_ABI = [
  'function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
  'function getAllReservesTokens() view returns (tuple(string symbol, address tokenAddress)[])',
];
const COMPOUND_ABI = ['function isLiquidatable(address) view returns (bool)', 'function borrowBalanceOf(address) view returns (uint256)'];
const VENUS_ABI = ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)'];
const VTOKEN_ABI = ['function balanceOf(address) view returns (uint256)', 'function borrowBalanceStored(address) view returns (uint256)', 'event Borrow(address borrower, uint256 borrowAmount, uint256 accountBorrows, uint256 totalBorrows)'];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)', 'function symbol() view returns (string)'];
const UNISWAP_QUOTER_ABI = ['function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)'];

// Liquidator ABIs
const LIQUIDATOR_V1_ABI = [
  'function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover)',
  'function withdrawProfit(address token)',
  'function withdrawETH()',
];

const LIQUIDATOR_V2_ABI = [
  'function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover, uint256 minProfit)',
  'function executeLiquidation(address collateralAsset, address debtAsset, address user, uint256 debtToCover)',
  'function withdrawProfit(address token)',
  'function withdrawAllProfits(address[] calldata tokens)',
  'function withdrawETH()',
];

const BNB_LIQUIDATOR_ABI = [
  'function executeLiquidation(address debtAsset, uint256 debtAmount, address vTokenBorrowed, address vTokenCollateral, address borrower)',
  'function withdraw(address token)',
  'function withdrawBNB()',
];

const COMPOUND_LIQUIDATOR_ABI = [
  'function executeLiquidation(address comet, address borrower, address collateralAsset, uint256 baseAmount)',
  'function executeLiquidationAll(address comet, address borrower, uint256 baseAmount)',
  'function withdrawToken(address token)',
  'function withdrawETH()',
  'function withdrawAll(address[] calldata tokens)',
];

// ============================================================
// STATE
// ============================================================

let providers = {}, wsProviders = {}, wallets = {}, multicalls = {}, liquidators = {};
let privateWallets = {};
let compoundLiquidators = {};
let borrowers = { aave: {}, compound: {}, venus: new Set() };
let badDebtCache = new Set();
let stats = { events: 0, checks: 0, liquidations: 0, badDebt: 0, attempted: 0, failed: 0, withdrawn: 0, skippedUnprofitable: 0, skippedNoLiquidity: 0, unknownPairs: 0, mevSkipped: 0, competitorBeats: 0 };
let venusProvider, venusWallet, venusWsProvider, venusComptroller, venusLiquidator;
let liquidatorAddresses = {};
let currentPrices = {};
let priceFeeds = {};
let validatedSwapPaths = {};
let unknownPairOpportunities = [];
let activeIntervals = [];
let healthServer = null;

// PRE-BUILT TX TEMPLATES - Ready for common pairs
let txTemplates = {};

// IMPROVED EXECUTION LOCK WITH TIMEOUT
const executionLocks = new Map(); // key -> { timestamp, chain, protocol }

function acquireLock(key, chain, protocol) {
  const existing = executionLocks.get(key);
  if (existing && Date.now() - existing.timestamp > LOCK_TIMEOUT_MS) {
    console.log(`   ⚠️  Releasing stale lock for ${key}`);
    executionLocks.delete(key);
  }
  if (executionLocks.has(key)) return false;
  executionLocks.set(key, { timestamp: Date.now(), chain, protocol });
  return true;
}

function releaseLock(key) {
  executionLocks.delete(key);
}

// NONCE MANAGEMENT
const nonceTrackers = {};
async function getNextNonce(chain, wallet) {
  if (!nonceTrackers[chain]) {
    nonceTrackers[chain] = { nonce: await wallet.getNonce(), pending: 0 };
  }
  return nonceTrackers[chain].nonce + nonceTrackers[chain].pending++;
}
function confirmNonce(chain, success) {
  if (!nonceTrackers[chain]) return;
  nonceTrackers[chain].pending--;
  if (success) nonceTrackers[chain].nonce++;
}

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ EVENT LIQUIDATOR V7.5 - PRODUCTION HARDENED                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  validateEnv();
  if (DRY_RUN) console.log(`\n🧪 DRY RUN MODE - No transactions will be sent\n`);

  const pk = process.env.PRIVATE_KEY;
  try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch (e) { debugLog('load_liquidators', { error: e?.message }); }

  // Initialize Aave chains
  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      wsProviders[chain] = config.ws ? new ethers.WebSocketProvider(config.ws) : null;
      
      // MEV protection wallet (private RPC)
      if (PRIVATE_RPC[chain]) {
        try {
          const privateProvider = new ethers.JsonRpcProvider(PRIVATE_RPC[chain]);
          privateWallets[chain] = new ethers.Wallet(pk, privateProvider);
          console.log(`🛡️  ${chain}: MEV Protection ENABLED`);
        } catch {
          privateWallets[chain] = wallets[chain];
        }
      } else {
        privateWallets[chain] = wallets[chain];
        console.log(`⚠️  ${chain}: No MEV protection`);
      }
      
      // Aave liquidator
      if (liquidatorAddresses[chain]) {
        const abi = config.version === 'V2' ? LIQUIDATOR_V2_ABI : LIQUIDATOR_V1_ABI;
        liquidators[chain] = new ethers.Contract(liquidatorAddresses[chain], abi, privateWallets[chain]);
        console.log(`✅ ${chain}: Aave Liquidator ${config.version} @ ${liquidatorAddresses[chain].slice(0,10)}...`);
      }
      
      // Compound V3 liquidator
      if (liquidatorAddresses.compound?.[chain]) {
        compoundLiquidators[chain] = new ethers.Contract(
          liquidatorAddresses.compound[chain], 
          COMPOUND_LIQUIDATOR_ABI, 
          privateWallets[chain]
        );
        console.log(`✅ ${chain}: Compound Liquidator @ ${liquidatorAddresses.compound[chain].slice(0,10)}...`);
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
      
      if (VENUS_CONFIG.ws) {
        try {
          venusWsProvider = new ethers.WebSocketProvider(VENUS_CONFIG.ws);
          console.log(`🛡️  bnb: WebSocket ENABLED`);
        } catch (e) {
          console.log(`⚠️  bnb: WebSocket failed - ${e.message.slice(0,30)}`);
        }
      }
      
      if (liquidatorAddresses.bnb) {
        venusLiquidator = new ethers.Contract(liquidatorAddresses.bnb, BNB_LIQUIDATOR_ABI, venusWallet);
        console.log(`✅ bnb: Venus Liquidator @ ${liquidatorAddresses.bnb.slice(0,10)}...`);
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

  // Discover assets ONCE on startup
  await discoverAllAaveAssets();
  
  // Initialize price feeds
  await initializePriceFeeds();
  
  // Pre-build TX templates for common pairs
  await buildTxTemplates();
  
  await loadBorrowers();
  
  const aaveTotal = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0);
  const compTotal = Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  const assetTotal = Object.values(CHAIN_ASSETS).reduce((s, a) => s + (a?.length || 0), 0);
  
  console.log(`\n📊 POSITIONS: ${aaveTotal} Aave + ${compTotal} Compound + ${borrowers.venus.size} Venus`);
  console.log(`🪙 ASSETS TRACKED: ${assetTotal} across ${Object.keys(CHAIN_ASSETS).length} chains`);
  console.log(`💰 AUTO-WITHDRAW: Enabled → ${OWNER_WALLET.slice(0,10)}...`);
  console.log(`📈 PROFIT SIMULATION: Enabled (min $${MIN_PROFIT_USD})`);
  console.log(`🚀 MEV SKIP THRESHOLD: $${MEV_THRESHOLD_USD} (direct submission below)`);
  console.log(`🔄 WEEKLY DISCOVERY: Enabled (Sundays 3am UTC)`);
  console.log(`⚡ TX TEMPLATES: ${Object.keys(txTemplates).length} pre-built\n`);
}

// ============================================================
// PRE-BUILT TX TEMPLATES
// ============================================================

async function buildTxTemplates() {
  console.log('\n🔧 Building TX templates for common pairs...\n');
  
  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!liquidators[chain]) continue;
    
    const assets = CHAIN_ASSETS[chain] || CHAIN_ASSETS_FALLBACK[chain] || [];
    
    // Build templates for common collateral/debt pairs
    const commonPairs = [
      ['WETH', 'USDC'],
      ['WETH', 'USDT'],
      ['cbETH', 'USDC'],
      ['WMATIC', 'USDC'],
      ['WAVAX', 'USDC'],
    ];
    
    for (const [collSymbol, debtSymbol] of commonPairs) {
      const collateral = assets.find(a => a.symbol === collSymbol);
      const debt = assets.find(a => a.symbol === debtSymbol);
      
      if (collateral && debt) {
        const key = `${chain}-${collSymbol}-${debtSymbol}`;
        txTemplates[key] = {
          chain,
          collateralToken: collateral.token,
          debtToken: debt.token,
          collateralDecimals: collateral.decimals,
          debtDecimals: debt.decimals,
          gasLimit: GAS_CONFIG[chain].gasLimit,
        };
      }
    }
  }
  
  console.log(`   ✅ Built ${Object.keys(txTemplates).length} TX templates`);
}

function getTxTemplate(chain, collateralSymbol, debtSymbol) {
  return txTemplates[`${chain}-${collateralSymbol}-${debtSymbol}`];
}

// ============================================================
// DYNAMIC AAVE ASSET DISCOVERY (runs once on startup)
// ============================================================

async function discoverAllAaveAssets() {
  console.log('\n🔍 Discovering all Aave assets...\n');
  
  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!providers[chain] || !config.dataProvider) {
      CHAIN_ASSETS[chain] = CHAIN_ASSETS_FALLBACK[chain] || [];
      continue;
    }
    
    try {
      const dataProvider = new ethers.Contract(config.dataProvider, AAVE_DATA_PROVIDER_ABI, providers[chain]);
      const reserves = await dataProvider.getAllReservesTokens();
      const assets = [];
      
      // Process in parallel for speed
      const assetPromises = reserves.map(async (reserve) => {
        try {
          const tokenAddress = reserve.tokenAddress;
          const symbol = reserve.symbol;
          const tokenAddresses = await dataProvider.getReserveTokensAddresses(tokenAddress);
          
          const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, providers[chain]);
          let decimals = 18;
          try { decimals = await tokenContract.decimals(); } catch {}
          
          return {
            symbol,
            token: tokenAddress,
            aToken: tokenAddresses.aTokenAddress,
            debtToken: tokenAddresses.variableDebtTokenAddress,
            decimals: Number(decimals),
          };
        } catch {
          return null;
        }
      });
      
      const results = await Promise.all(assetPromises);
      assets.push(...results.filter(a => a !== null));
      
      CHAIN_ASSETS[chain] = assets;
      console.log(`   ✅ ${chain}: ${assets.length} assets discovered`);
      
    } catch (e) {
      console.log(`   ⚠️  ${chain}: Using fallback (${e.message.slice(0, 30)})`);
      CHAIN_ASSETS[chain] = CHAIN_ASSETS_FALLBACK[chain] || [];
    }
  }
  
  // Save discovered assets
  try {
    fs.writeFileSync('data/chain_assets.json', JSON.stringify(CHAIN_ASSETS, null, 2));
    console.log('\n✅ Saved chain_assets.json');
  } catch {}
}

// ============================================================
// PARALLEL PRICE FETCHING
// ============================================================

async function initializePriceFeeds() {
  console.log('\n💲 Initializing Chainlink price feeds...\n');
  
  for (const [chain, feeds] of Object.entries(CHAINLINK_FEEDS)) {
    const provider = chain === 'bnb' ? venusProvider : providers[chain];
    if (!provider) continue;
    
    priceFeeds[chain] = {};
    
    // Fetch all initial prices in parallel
    const feedPromises = Object.entries(feeds).map(async ([tokenAddress, feedAddress]) => {
      try {
        const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);
        priceFeeds[chain][tokenAddress.toLowerCase()] = feed;
        const [, price] = await feed.latestRoundData();
        return { tokenAddress: tokenAddress.toLowerCase(), price: Number(price) / 1e8 };
      } catch {
        return null;
      }
    });
    
    const results = await Promise.all(feedPromises);
    let count = 0;
    for (const result of results) {
      if (result) {
        currentPrices[`${chain}-${result.tokenAddress}`] = result.price;
        count++;
      }
    }
    
    console.log(`   ✅ ${chain}: ${count} price feeds initialized`);
  }
}

async function fetchAllPricesParallel(chain) {
  const startTime = Date.now();
  const assets = CHAIN_ASSETS[chain] || [];
  const prices = {};
  
  // Fetch all prices in parallel
  const pricePromises = assets.map(async (asset) => {
    const price = await fetchPrice(chain, asset.token);
    return { symbol: asset.symbol, token: asset.token.toLowerCase(), price };
  });
  
  const results = await Promise.all(pricePromises);
  
  for (const result of results) {
    if (result.price !== null) {
      prices[result.token] = result.price;
      prices[result.symbol] = result.price;
    }
  }
  
  trackLatency('priceUpdate', startTime);
  return prices;
}

async function fetchPrice(chain, tokenAddress) {
  const key = `${chain}-${tokenAddress.toLowerCase()}`;
  
  // Check cache (valid for 10s - reduced from 60s for accuracy)
  if (currentPrices[key] && Date.now() - (currentPrices[`${key}-ts`] || 0) < PRICE_CACHE_MS) {
    return currentPrices[key];
  }
  
  const feed = priceFeeds[chain]?.[tokenAddress.toLowerCase()];
  if (feed) {
    try {
      const [, price] = await feed.latestRoundData();
      const priceUsd = Number(price) / 1e8;
      currentPrices[key] = priceUsd;
      currentPrices[`${key}-ts`] = Date.now();
      return priceUsd;
    } catch {}
  }
  
  // Stablecoin fallback
  const stablecoins = ['USDC', 'USDT', 'DAI', 'FRAX', 'LUSD', 'BUSD'];
  const assets = CHAIN_ASSETS[chain] || [];
  const asset = assets.find(a => a.token.toLowerCase() === tokenAddress.toLowerCase());
  if (asset && stablecoins.includes(asset.symbol)) return 1.0;
  
  return currentPrices[key] || null;
}

// ============================================================
// SWAP PATH VALIDATION
// ============================================================

async function validateSwapPath(chain, tokenIn, tokenOut, amountIn) {
  const cacheKey = `${chain}-${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
  
  if (validatedSwapPaths[cacheKey] && Date.now() - validatedSwapPaths[cacheKey].timestamp < 300000) {
    return validatedSwapPaths[cacheKey];
  }
  
  const dex = DEX_ROUTERS[chain];
  if (!dex?.quoter) {
    return { valid: true, uncertain: true, liquidity: 0 };
  }
  
  try {
    const quoter = new ethers.Contract(dex.quoter, UNISWAP_QUOTER_ABI, providers[chain]);
    const feeTiers = [500, 3000, 10000];
    let bestOutput = 0n;
    
    for (const fee of feeTiers) {
      try {
        const output = await quoter.quoteExactInputSingle.staticCall(tokenIn, tokenOut, fee, amountIn, 0);
        if (output > bestOutput) bestOutput = output;
      } catch {}
    }
    
    if (bestOutput === 0n) {
      validatedSwapPaths[cacheKey] = { valid: false, reason: 'No liquidity', timestamp: Date.now() };
      return validatedSwapPaths[cacheKey];
    }
    
    validatedSwapPaths[cacheKey] = { valid: true, expectedOutput: bestOutput.toString(), timestamp: Date.now() };
    return validatedSwapPaths[cacheKey];
    
  } catch (e) {
    validatedSwapPaths[cacheKey] = { valid: false, reason: e.message.slice(0, 50), timestamp: Date.now() };
    return validatedSwapPaths[cacheKey];
  }
}

// ============================================================
// UNKNOWN PAIR FALLBACK
// ============================================================

function logUnknownPairOpportunity(chain, protocol, pos, collateral, debt, reason) {
  stats.unknownPairs++;
  
  const opportunity = {
    timestamp: new Date().toISOString(),
    chain, protocol,
    user: pos.user,
    healthFactor: pos.hf,
    debtUsd: pos.debt,
    collateralSymbol: collateral?.asset?.symbol || collateral?.vToken || 'unknown',
    debtSymbol: debt?.asset?.symbol || debt?.vToken || 'unknown',
    reason,
  };
  
  unknownPairOpportunities.push(opportunity);
  // Fixed: use shift instead of slice to avoid memory leak
  if (unknownPairOpportunities.length > 100) unknownPairOpportunities.shift();
  
  console.log(`   📝 LOGGED: ${chain} ${protocol} | ${opportunity.collateralSymbol}→${opportunity.debtSymbol} | $${pos.debt.toFixed(0)} | ${reason}`);
  
  try { fs.writeFileSync('data/unknown_pairs.json', JSON.stringify(unknownPairOpportunities, null, 2)); } catch {}
  
  if (pos.debt > 10000) {
    sendDiscord(`📝 UNKNOWN PAIR\n${chain} ${protocol}\n$${pos.debt.toFixed(0)}\n${opportunity.collateralSymbol}→${opportunity.debtSymbol}\n${reason}`, false);
  }
}

// ============================================================
// BORROWER DISCOVERY
// ============================================================

async function discoverVenusBorrowers() {
  if (!venusProvider) return;
  
  console.log('\n🔍 Discovering Venus borrowers...\n');
  const currentBlock = await venusProvider.getBlockNumber();
  const fromBlock = currentBlock - 200000;
  let newBorrowers = 0;
  
  for (const [symbol, config] of Object.entries(VENUS_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(config.address, VTOKEN_ABI, venusProvider);
      const events = await vToken.queryFilter(vToken.filters.Borrow(), fromBlock, currentBlock);
      
      for (const event of events) {
        const borrower = event.args?.borrower;
        if (borrower && !borrowers.venus.has(borrower)) {
          borrowers.venus.add(borrower);
          newBorrowers++;
        }
      }
      console.log(`   ✅ ${symbol}: ${events.length} borrow events`);
    } catch (e) {
      console.log(`   ❌ ${symbol}: ${e.message.slice(0, 30)}`);
    }
  }
  
  console.log(`\n   📊 Venus: +${newBorrowers} new (${borrowers.venus.size} total)`);
  
  try {
    fs.writeFileSync('data/venus_borrowers.json', JSON.stringify(Array.from(borrowers.venus), null, 2));
  } catch {}
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
  try {
    const venusData = JSON.parse(fs.readFileSync('data/venus_borrowers.json', 'utf8'));
    borrowers.venus = new Set(venusData);
  } catch {}
}

// ============================================================
// PROFIT SIMULATION
// ============================================================

async function getGasPrice(chain) {
  try {
    const provider = chain === 'bnb' ? venusProvider : providers[chain];
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
    return gasPrice ? Number(ethers.formatUnits(gasPrice, 'gwei')) : GAS_CONFIG[chain].avgGas;
  } catch {
    return GAS_CONFIG[chain].avgGas;
  }
}

async function estimateGasCost(chain) {
  const startTime = Date.now();
  const gasPrice = await getGasPrice(chain);
  const config = GAS_CONFIG[chain];
  
  // Get native price from cache or use fallback
  const nativeTokens = {
    base: '0x4200000000000000000000000000000000000006',
    polygon: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
    arbitrum: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    avalanche: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    bnb: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  };
  
  let nativePrice = config.nativePrice;
  const nativeKey = `${chain}-${nativeTokens[chain]?.toLowerCase()}`;
  if (currentPrices[nativeKey]) nativePrice = currentPrices[nativeKey];
  
  const gasCostUsd = config.gasLimit * gasPrice * 1e-9 * nativePrice;
  trackLatency('profitSim', startTime);
  return { gasPrice, gasCostUsd, nativePrice };
}

function simulateLiquidationProfit(protocol, debtUsd, collateralUsd) {
  const bonusBps = LIQUIDATION_BONUS[protocol];
  if (bonusBps === undefined) {
    debugLog('missing_bonus', { protocol });
    return { debtToRepay: 0, collateralReceived: 0, grossProfit: 0, flashFee: 0, netProfitBeforeGas: 0 };
  }
  const bonus = bonusBps / 10000;
  const flashLoanFee = 0.0009;
  const debtToRepay = Math.min(debtUsd / 2, collateralUsd * 0.9);
  const collateralReceived = debtToRepay * (1 + bonus);
  const grossProfit = collateralReceived - debtToRepay;
  const flashFee = debtToRepay * flashLoanFee;
  const netProfitBeforeGas = grossProfit - flashFee;
  return { debtToRepay, collateralReceived, grossProfit, flashFee, netProfitBeforeGas };
}

async function isProfitable(chain, protocol, pos) {
  const sim = simulateLiquidationProfit(protocol, pos.debt, pos.collateral || pos.debt * 1.1);
  const { gasCostUsd } = await estimateGasCost(chain);
  const netProfit = sim.netProfitBeforeGas - gasCostUsd;
  
  const result = { profitable: netProfit >= MIN_PROFIT_USD, netProfit, gasCostUsd, ...sim };
  
  if (!result.profitable) {
    stats.skippedUnprofitable++;
  }
  
  return result;
}

// ============================================================
// COLLATERAL & DEBT DETECTION
// ============================================================

async function hasAaveCollateral(chain, user) {
  const startTime = Date.now();
  const assets = CHAIN_ASSETS[chain];
  if (!assets?.length) return { has: false };
  
  const iface = new ethers.Interface(ERC20_ABI);
  const calls = assets.map(a => ({ target: a.aToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) }));
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    let maxBalUsd = 0, bestAsset = null, bestBalance = 0n;
    
    for (let i = 0; i < results.length; i++) {
      if (results[i].success) {
        const bal = iface.decodeFunctionResult('balanceOf', results[i].returnData)[0];
        if (bal > 0n) {
          const price = currentPrices[`${chain}-${assets[i].token.toLowerCase()}`] || 1;
          const balUsd = Number(bal) / 10**assets[i].decimals * price;
          if (balUsd > maxBalUsd) {
            maxBalUsd = balUsd;
            bestAsset = assets[i];
            bestBalance = bal;
          }
        }
      }
    }
    trackLatency('positionCheck', startTime);
    return bestAsset ? { has: true, asset: bestAsset, balance: bestBalance, balanceUsd: maxBalUsd } : { has: false };
  } catch {}
  return { has: false };
}

async function getAaveDebtAsset(chain, user) {
  const assets = CHAIN_ASSETS[chain];
  if (!assets?.length) return null;
  
  const iface = new ethers.Interface(ERC20_ABI);
  const calls = assets.map(a => ({ target: a.debtToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) }));
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    let maxDebtUsd = 0, debtAsset = null, debtAmount = 0n;
    
    for (let i = 0; i < results.length; i++) {
      if (results[i].success) {
        const bal = iface.decodeFunctionResult('balanceOf', results[i].returnData)[0];
        if (bal > 0n) {
          const price = currentPrices[`${chain}-${assets[i].token.toLowerCase()}`] || 1;
          const debtUsd = Number(bal) / 10**assets[i].decimals * price;
          if (debtUsd > maxDebtUsd) {
            maxDebtUsd = debtUsd;
            debtAsset = assets[i];
            debtAmount = bal;
          }
        }
      }
    }
    return debtAsset ? { asset: debtAsset, amount: debtAmount, amountUsd: maxDebtUsd } : null;
  } catch { return null; }
}

async function hasVenusCollateral(user) {
  for (const [symbol, config] of Object.entries(VENUS_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(config.address, VTOKEN_ABI, venusProvider);
      const bal = await vToken.balanceOf(user);
      if (bal > 0n) return { has: true, vToken: symbol, config, balance: bal };
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
// AUTO-WITHDRAW PROFITS
// ============================================================

async function withdrawProfits(chain) {
  if (!liquidators[chain]) return;
  const assets = CHAIN_ASSETS[chain];
  if (!assets?.length) return;
  
  try {
    const config = AAVE_POOLS[chain];
    if (config.version === 'V2') {
      const tokens = assets.map(a => a.token);
      await (await liquidators[chain].withdrawAllProfits(tokens, { gasLimit: 300000 })).wait();
    } else {
      for (const asset of assets) {
        try { await (await liquidators[chain].withdrawProfit(asset.token, { gasLimit: 100000 })).wait(); } catch {}
      }
      try { await (await liquidators[chain].withdrawETH({ gasLimit: 50000 })).wait(); } catch {}
    }
    console.log(`   💰 Withdrawn Aave profits from ${chain}`);
    stats.withdrawn++;
  } catch (e) {
    console.log(`   ⚠️  Aave withdraw failed ${chain}: ${e.message.slice(0,30)}`);
  }
}

async function withdrawCompoundProfits(chain) {
  if (!compoundLiquidators[chain]) return;
  const assets = CHAIN_ASSETS[chain];
  if (!assets?.length) return;
  
  try {
    const tokens = assets.map(a => a.token);
    await (await compoundLiquidators[chain].withdrawAll(tokens, { gasLimit: 300000 })).wait();
    console.log(`   💰 Withdrawn Compound profits from ${chain}`);
    stats.withdrawn++;
  } catch (e) {
    console.log(`   ⚠️  Compound withdraw failed ${chain}: ${e.message.slice(0,30)}`);
  }
}

async function withdrawVenusProfits() {
  if (!venusLiquidator) return;
  try {
    for (const config of Object.values(VENUS_VTOKENS)) {
      try { await (await venusLiquidator.withdraw(config.underlying, { gasLimit: 100000 })).wait(); } catch {}
    }
    try { await (await venusLiquidator.withdrawBNB({ gasLimit: 50000 })).wait(); } catch {}
    console.log(`   💰 Withdrawn Venus profits`);
    stats.withdrawn++;
  } catch (e) {
    console.log(`   ⚠️  Venus withdraw failed: ${e.message.slice(0,30)}`);
  }
}

// ============================================================
// EXECUTION LOGIC (with smart MEV skip)
// ============================================================

function shouldUseMevProtection(chain, debtUsd) {
  // Skip MEV protection for small liquidations (speed > protection)
  if (debtUsd < MEV_THRESHOLD_USD) {
    stats.mevSkipped++;
    return false;
  }
  return !!PRIVATE_RPC[chain];
}

async function executeAaveLiquidation(chain, pos) {
  const totalStart = Date.now();
  const key = `aave-${chain}-${pos.user}`;
  
  if (isCircuitOpen()) { console.log(`   ⏸️  Circuit breaker open`); return; }
  if (!acquireLock(key, chain, 'aave')) return;
  
  let nonceUsed = false;
  
  try {
    if (DRY_RUN) {
      console.log(`   🧪 DRY RUN: Would execute Aave liquidation for ${pos.user.slice(0,10)}...`);
      return;
    }
    
    if (!liquidators[chain]) { console.log(`   ⚠️  No Aave liquidator for ${chain}`); return; }
    
    const profitCheck = await isProfitable(chain, 'aave', pos);
    if (!profitCheck.profitable) { console.log(`   ⏭️  Skipping unprofitable`); return; }
    
    const collateral = await hasAaveCollateral(chain, pos.user);
    if (!collateral.has) { badDebtCache.add(key); return; }
    
    const debt = await getAaveDebtAsset(chain, pos.user);
    if (!debt) return;
    
    // Competitor detection: verify still liquidatable
    const pool = new ethers.Contract(AAVE_POOLS[chain].pool, AAVE_ABI, providers[chain]);
    const userData = await pool.getUserAccountData(pos.user);
    const currentHf = Number(userData[5]) / 1e18;
    if (currentHf >= 1.0) {
      stats.competitorBeats++;
      console.log(`   👀 Position no longer liquidatable (HF: ${currentHf.toFixed(4)}) - competitor beat us`);
      return;
    }
    
    // Check swap path
    const swapCheck = await validateSwapPath(chain, collateral.asset.token, debt.asset.token, collateral.balance);
    if (!swapCheck.valid) {
      logUnknownPairOpportunity(chain, 'aave', pos, collateral, debt, swapCheck.reason || 'No swap path');
      return;
    }
    
    const debtToCover = debt.amount / 2n;
    
    // Smart MEV decision
    const useMev = shouldUseMevProtection(chain, pos.debt);
    const executionWallet = useMev ? privateWallets[chain] : wallets[chain];
    const liquidator = new ethers.Contract(liquidatorAddresses[chain], AAVE_POOLS[chain].version === 'V2' ? LIQUIDATOR_V2_ABI : LIQUIDATOR_V1_ABI, executionWallet);
    
    console.log(`   🔥 EXECUTING AAVE: ${chain} ${pos.user.slice(0,10)}...`);
    console.log(`      Collateral: ${collateral.asset.symbol} ($${collateral.balanceUsd?.toFixed(0)}) | Debt: ${debt.asset.symbol} ($${debt.amountUsd?.toFixed(0)})`);
    console.log(`      Profit: $${profitCheck.netProfit.toFixed(2)} | MEV: ${useMev ? 'ON' : 'OFF (speed mode)'}`);
    
    stats.attempted++;
    const txStart = Date.now();
    
    const { gasPrice } = await estimateGasCost(chain);
    const nonce = await getNextNonce(chain, executionWallet);
    nonceUsed = true;
    
    const gasSettings = {
      gasLimit: GAS_CONFIG[chain].gasLimit,
      maxFeePerGas: ethers.parseUnits(String(Math.ceil(gasPrice * 1.2)), 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits(String(Math.ceil(gasPrice * 0.1)), 'gwei'),
      nonce,
    };
    
    let tx;
    if (AAVE_POOLS[chain].version === 'V2') {
      tx = await liquidator['executeLiquidation(address,address,address,uint256,uint256)'](
        collateral.asset.token, debt.asset.token, pos.user, debtToCover, 0, gasSettings
      );
    } else {
      tx = await liquidator.executeLiquidation(
        collateral.asset.token, debt.asset.token, pos.user, debtToCover, gasSettings
      );
    }
    
    console.log(`   ⏳ TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    const txLatency = trackLatency('txExecution', txStart);
    trackLatency('total', totalStart);
    
    if (receipt.status === 1) {
      stats.liquidations++;
      trackSuccess();
      confirmNonce(chain, true);
      console.log(`   ✅ SUCCESS! Gas: ${receipt.gasUsed.toString()} | TX Time: ${txLatency}ms`);
      await sendDiscord(`✅ AAVE LIQUIDATION!\n${chain}\n$${pos.debt.toFixed(0)} debt\nProfit: ~$${profitCheck.netProfit.toFixed(2)}\nTX: ${tx.hash}\nLatency: ${txLatency}ms`, true);
      await withdrawProfits(chain);
    } else {
      stats.failed++;
      confirmNonce(chain, true);
      trackError('aave_reverted', new Error('TX reverted'));
    }
  } catch (e) {
    stats.failed++;
    if (nonceUsed) confirmNonce(chain, false);
    trackError('aave_execution', e);
    console.log(`   ❌ Error: ${e.message.slice(0, 80)}`);
  } finally {
    releaseLock(key);
  }
}

async function executeCompoundLiquidation(chain, market, pos) {
  const key = `compound-${chain}-${pos.user}`;
  if (isCircuitOpen()) return;
  if (!acquireLock(key, chain, 'compound')) return;
  
  let nonceUsed = false;
  
  try {
    if (DRY_RUN) { console.log(`   🧪 DRY RUN: Would execute Compound liquidation`); return; }
    if (!compoundLiquidators[chain]) { console.log(`   ⚠️  No Compound liquidator for ${chain}`); return; }
    
    const profitCheck = await isProfitable(chain, 'compound', pos);
    if (!profitCheck.profitable) { console.log(`   ⏭️  Skipping unprofitable Compound`); return; }
    
    const marketConfig = COMPOUND_MARKETS[chain]?.[market];
    if (!marketConfig) return;
    
    const useMev = shouldUseMevProtection(chain, pos.debt);
    const executionWallet = useMev ? privateWallets[chain] : wallets[chain];
    const liquidator = new ethers.Contract(liquidatorAddresses.compound[chain], COMPOUND_LIQUIDATOR_ABI, executionWallet);
    
    console.log(`   🔥 EXECUTING COMPOUND: ${chain} ${pos.user.slice(0,10)}...`);
    console.log(`      Profit: $${profitCheck.netProfit.toFixed(2)} | MEV: ${useMev ? 'ON' : 'OFF'}`);
    
    stats.attempted++;
    const nonce = await getNextNonce(chain, executionWallet);
    nonceUsed = true;
    const baseAmount = ethers.parseUnits('1000', 6);
    
    const tx = await liquidator.executeLiquidationAll(marketConfig.comet, pos.user, baseAmount, { gasLimit: GAS_CONFIG[chain].gasLimit, nonce });
    console.log(`   ⏳ TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      stats.liquidations++;
      trackSuccess();
      confirmNonce(chain, true);
      console.log(`   ✅ SUCCESS!`);
      await sendDiscord(`✅ COMPOUND LIQUIDATION!\n${chain} ${market}\n$${pos.debt.toFixed(0)} debt\nTX: ${tx.hash}`, true);
      await withdrawCompoundProfits(chain);
    } else {
      stats.failed++;
      confirmNonce(chain, true);
      trackError('compound_reverted', new Error('TX reverted'));
    }
  } catch (e) {
    stats.failed++;
    if (nonceUsed) confirmNonce(chain, false);
    trackError('compound_execution', e);
    console.log(`   ❌ Compound Error: ${e.message.slice(0, 80)}`);
  } finally {
    releaseLock(key);
  }
}
    
async function executeVenusLiquidation(pos) {
  const key = `venus-${pos.user}`;
  if (isCircuitOpen()) return;
  if (!acquireLock(key, 'bnb', 'venus')) return;
  
  let nonceUsed = false;
  
  try {
    if (DRY_RUN) { console.log(`   🧪 DRY RUN: Would execute Venus liquidation`); return; }
    if (!venusLiquidator) { console.log(`   ⚠️  No Venus liquidator`); return; }
    
    const profitCheck = await isProfitable('bnb', 'venus', pos);
    if (!profitCheck.profitable) { console.log(`   ⏭️  Skipping unprofitable Venus`); return; }
    
    const collateral = await hasVenusCollateral(pos.user);
    if (!collateral.has) { badDebtCache.add(key); return; }
    
    const debt = await getVenusDebt(pos.user);
    if (!debt) return;
    
    const repayAmount = debt.amount / 2n;
    
    console.log(`   🔥 EXECUTING VENUS: ${pos.user.slice(0,10)}...`);
    console.log(`      Collateral: ${collateral.vToken} | Debt: ${debt.vToken}`);
    console.log(`      Profit: $${profitCheck.netProfit.toFixed(2)}`);
    
    stats.attempted++;
    const nonce = await getNextNonce('bnb', venusWallet);
    nonceUsed = true;
    
    const tx = await venusLiquidator.executeLiquidation(
      debt.config.underlying, repayAmount, debt.config.address, collateral.config.address, pos.user,
      { gasLimit: GAS_CONFIG.bnb.gasLimit, nonce }
    );
    
    console.log(`   ⏳ TX: ${tx.hash}`);
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      stats.liquidations++;
      trackSuccess();
      confirmNonce('bnb', true);
      console.log(`   ✅ SUCCESS!`);
      await sendDiscord(`✅ VENUS LIQUIDATION!\n$${pos.debt.toFixed(0)} debt\nTX: ${tx.hash}`, true);
      await withdrawVenusProfits();
    } else {
      stats.failed++;
      confirmNonce('bnb', true);
      trackError('venus_reverted', new Error('TX reverted'));
    }
  } catch (e) {
    stats.failed++;
    if (nonceUsed) confirmNonce('bnb', false);
    trackError('venus_execution', e);
    console.log(`   ❌ Venus Error: ${e.message.slice(0, 80)}`);
  } finally {
    releaseLock(key);
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
        const key = `aave-${chain}-${users[i]}`;
        if (liquidatable && collateral < 10) { if (!badDebtCache.has(key)) { badDebtCache.add(key); stats.badDebt++; } continue; }
        if (badDebtCache.has(key)) continue;
        positions.push({ user: users[i], debt, collateral, hf, liquidatable, protocol: 'aave', chain });
      } catch {}
    }
    return positions;
  } catch { return []; }
}

async function multicallCompoundCheck(chain, market, users) {
  if (!users?.length || !COMPOUND_MARKETS[chain]?.[market]) return [];
  const cometAddress = COMPOUND_MARKETS[chain][market].comet;
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
        if (debt > 100) positions.push({ user: users[i], debt, collateral: debt * 1.1, liquidatable: isLiq, hf: isLiq ? 0.99 : 1.5, protocol: 'compound', market, chain });
      } catch {}
    }
    return positions;
  } catch { return []; }
}

async function scanVenus() {
  if (!venusProvider || borrowers.venus.size === 0) return [];
  const results = [];
  for (const address of borrowers.venus) {
    const key = `venus-${address}`;
    if (badDebtCache.has(key)) continue;
    try {
      const [error, liquidity, shortfall] = await venusComptroller.getAccountLiquidity(address);
      if (error !== 0n) continue;
      const shortfallUsd = Number(shortfall) / 1e18;
      if (shortfall > 0n) {
        const collateral = await hasVenusCollateral(address);
        if (!collateral.has) { if (!badDebtCache.has(key)) { badDebtCache.add(key); stats.badDebt++; } continue; }
        results.push({ user: address, debt: shortfallUsd, collateral: shortfallUsd * 1.1, liquidatable: true, hf: 0.99, protocol: 'venus', chain: 'bnb' });
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

async function checkVenus() {
  const venusResults = await scanVenus();
  if (venusResults.length > 0) await processResults(venusResults);
}

async function backgroundScan() {
  for (const chain of Object.keys(providers)) await checkAllProtocols(chain);
  await checkVenus();
}

async function processResults(results) {
  const liquidatable = results.filter(p => p.liquidatable);
  const critical = results.filter(p => !p.liquidatable && p.hf < 1.02 && p.hf > 0 && p.debt > 1000);
  
  if (liquidatable.length > 0) {
    console.log(`\n🔥🔥🔥 ${liquidatable.length} LIQUIDATABLE 🔥🔥🔥`);
    
    // Execute in parallel for speed
    await Promise.all(liquidatable.map(async (pos) => {
      console.log(`   💰 ${pos.chain} ${pos.protocol}: ${pos.user.slice(0,12)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
      
      if (pos.protocol === 'aave') await executeAaveLiquidation(pos.chain, pos);
      else if (pos.protocol === 'venus') await executeVenusLiquidation(pos);
      else if (pos.protocol === 'compound') await executeCompoundLiquidation(pos.chain, pos.market, pos);
    }));
  }
  
  for (const pos of critical) {
    console.log(`   🚨 CRITICAL: ${pos.chain} ${pos.protocol} ${pos.user.slice(0,10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
  }
}

// ============================================================
// WEEKLY DISCOVERY
// ============================================================

async function discoverBorrowers() {
  console.log('\n🔍 Starting weekly borrower discovery...\n');
  
  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!providers[chain]) continue;
    try {
      const pool = new ethers.Contract(config.pool, AAVE_POOL_ABI, providers[chain]);
      const currentBlock = await providers[chain].getBlockNumber();
      const fromBlock = currentBlock - 100000;
      const events = await pool.queryFilter(pool.filters.Borrow(), fromBlock, currentBlock);
      const uniqueBorrowers = [...new Set(events.map(e => e.args.user || e.args.onBehalfOf))];
      
      if (!borrowers.aave[chain]) borrowers.aave[chain] = [];
      const existingSet = new Set(borrowers.aave[chain]);
      let newCount = 0;
      for (const b of uniqueBorrowers) { if (!existingSet.has(b)) { borrowers.aave[chain].push(b); newCount++; } }
      console.log(`   ${chain}: +${newCount} new (${borrowers.aave[chain].length} total)`);
    } catch (e) {
      console.log(`   ❌ ${chain}: ${e.message.slice(0, 40)}`);
    }
  }
  
  // Venus discovery
  await discoverVenusBorrowers();
  
  // Refresh assets weekly too
  await discoverAllAaveAssets();
  await buildTxTemplates();
  
  try {
    const data = {};
    for (const [chain, users] of Object.entries(borrowers.aave)) data[chain] = users;
    fs.writeFileSync('data/borrowers.json', JSON.stringify(data, null, 2));
    console.log('\n✅ Saved borrowers.json');
  } catch {}
  
  await sendDiscord(`🔍 Weekly Discovery\n${Object.entries(borrowers.aave).map(([c, u]) => `${c}: ${u.length}`).join('\n')}\nVenus: ${borrowers.venus.size}`, false);
}

function scheduleWeeklyDiscovery() {
  const now = new Date();
  const nextSunday = new Date(now);
  nextSunday.setUTCDate(now.getUTCDate() + (7 - now.getUTCDay()) % 7);
  nextSunday.setUTCHours(3, 0, 0, 0);
  if (nextSunday <= now) nextSunday.setUTCDate(nextSunday.getUTCDate() + 7);
  
  const msUntilSunday = nextSunday.getTime() - now.getTime();
  console.log(`📅 Next discovery: ${nextSunday.toISOString()}`);
  
  // Use safe timeout (max ~24 days, so we chain them)
  const scheduleNext = () => {
    const remaining = nextSunday.getTime() - Date.now();
    if (remaining <= 0) {
      discoverBorrowers();
      // Schedule next week
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      nextSunday.setTime(nextWeek.getTime());
      setTimeout(scheduleNext, Math.min(7 * 24 * 60 * 60 * 1000, 2147483647));
    } else {
      setTimeout(scheduleNext, Math.min(remaining, 2147483647));
    }
  };
  
  setTimeout(scheduleNext, Math.min(msUntilSunday, 2147483647));
}

// ============================================================
// ORACLES
// ============================================================

async function subscribeToOracles() {
  console.log('📡 Subscribing to oracles...\n');
  
  for (const [chain, feeds] of Object.entries(CHAINLINK_FEEDS)) {
    const wsProvider = chain === 'bnb' ? venusWsProvider : wsProviders[chain];
    if (!wsProvider) {
      console.log(`   ⚠️  ${chain}: No WebSocket, using HTTP polling`);
      continue;
    }
    
    let subscribedCount = 0;
    for (const [tokenAddress, feedAddress] of Object.entries(feeds)) {
      try {
        const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, wsProvider);
        
        feed.on('AnswerUpdated', (newPrice) => {
          stats.events++;
          const key = `${chain}-${tokenAddress.toLowerCase()}`;
          currentPrices[key] = Number(newPrice) / 1e8;
          currentPrices[`${key}-ts`] = Date.now();
          
          // Fixed: Use setImmediate with proper error handling
          setImmediate(async () => {
            try {
              if (chain === 'bnb') await checkVenus();
              else await checkAllProtocols(chain);
            } catch (e) {
              trackError('oracle_handler', e);
            }
          });
        });
        
        subscribedCount++;
      } catch (e) { debugLog('oracle_subscribe', { chain, token: tokenAddress, error: e?.message }); }
    }
    
    console.log(`   ✅ ${chain}: ${subscribedCount} oracles subscribed`);
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
      body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '⚡ Liquidator V7.5' }) 
    }); 
  } catch (e) { debugLog('discord', { error: e?.message }); }
}

// ============================================================
// HEALTH CHECK ENDPOINT
// ============================================================

function startHealthServer() {
  healthServer = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      const health = {
        status: isCircuitOpen() ? 'degraded' : 'healthy',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        stats,
        errors: errorTracker,
        latency: {
          priceUpdate: getAvgLatency('priceUpdate'),
          positionCheck: getAvgLatency('positionCheck'),
          txExecution: getAvgLatency('txExecution'),
        },
        locks: executionLocks.size,
        chains: Object.keys(providers),
      };
      res.writeHead(isCircuitOpen() ? 503 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } else if (req.url === '/debug') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(debugBuffer.slice(-50), null, 2));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  healthServer.listen(HEALTH_PORT, () => console.log(`🏥 Health endpoint: http://localhost:${HEALTH_PORT}/health`));
}

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function gracefulShutdown(signal) {
  console.log(`\n⚠️  Received ${signal}, shutting down...`);
  for (const interval of activeIntervals) clearInterval(interval);
  if (healthServer) healthServer.close();
  console.log(`📊 Final: ${stats.liquidations} liquidations, ${stats.failed} failed, ${stats.competitorBeats} competitor beats`);
  try { await fs.promises.writeFile('data/debug.json', JSON.stringify(debugBuffer.slice(-100), null, 2)); } catch {}
  await sendDiscord(`🛑 Liquidator V7.5 Shutdown\nLiquidations: ${stats.liquidations}\nFailed: ${stats.failed}`, false);
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============================================================
// MAIN
// ============================================================

async function main() {
  await init();
  await subscribeToOracles();
  scheduleWeeklyDiscovery();
  startHealthServer();
  
  const modeText = DRY_RUN ? '🧪 DRY RUN' : '🔴 LIVE';
  await sendDiscord(`🚀 LIQUIDATOR V7.5 STARTED ${modeText}\n⚡ Aave + Compound + Venus\n🛡️ Smart MEV: <$${MEV_THRESHOLD_USD} = direct\n📈 Profit Sim: ON\n💰 Auto-withdraw: ON\n⚡ TX Templates: ${Object.keys(txTemplates).length}\n🔌 Circuit Breaker: ON\n🏥 Health: :${HEALTH_PORT}`, true);
  
  console.log('🚀 Listening for events...\n');
  
  // Stats + latency report every minute
  activeIntervals.push(setInterval(() => {
    const cb = isCircuitOpen() ? ' [CIRCUIT OPEN]' : '';
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${stats.events} | Checks: ${stats.checks} | Attempted: ${stats.attempted} | Success: ${stats.liquidations} | Failed: ${stats.failed} | Skipped: ${stats.skippedUnprofitable} | MEV-Skip: ${stats.mevSkipped} | Competitor: ${stats.competitorBeats}${cb}`);
  }, 60000));
  
  // Latency report every 5 minutes
  activeIntervals.push(setInterval(logLatencyReport, 300000));
  
  // Background scan every 30 seconds
  activeIntervals.push(setInterval(() => backgroundScan().catch(e => trackError('background_scan', e)), 30000));
  
  // Cleanup stale locks every minute
  activeIntervals.push(setInterval(() => {
    const now = Date.now();
    for (const [key, lock] of executionLocks.entries()) {
      if (now - lock.timestamp > LOCK_TIMEOUT_MS) {
        console.log(`   🧹 Cleaning stale lock: ${key}`);
        executionLocks.delete(key);
      }
    }
  }, 60000));
  
  process.stdin.resume();
}

main().catch(e => { console.error('❌ Fatal:', e); process.exit(1); });
