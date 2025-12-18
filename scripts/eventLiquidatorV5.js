import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// ⚡ EVENT LIQUIDATOR V5 - Flashbots MEV Protection
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const MIN_PROFIT_USD = 5;

// Flashbots Protect RPC (private transactions)
const FLASHBOTS_RPC = {
  base: 'https://rpc.flashbots.net/base',
};

const AAVE_POOLS = {
  base: { pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL, gasPrice: 0.001, nativePrice: 2900 },
  polygon: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL, gasPrice: 30, nativePrice: 0.5 },
  arbitrum: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL, gasPrice: 0.01, nativePrice: 2900 },
  avalanche: { pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD', rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL, gasPrice: 25, nativePrice: 35 },
};

const CHAIN_ASSETS = {
  base: [
    { symbol: 'WETH', token: '0x4200000000000000000000000000000000000006', aToken: '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7', debtToken: '0x24e6e0795b3c7c71D965fCc4f371803d1c1DcA1E', decimals: 18, bonus: 500 },
    { symbol: 'cbETH', token: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', aToken: '0xcf3D55c10DB69f28fD1A75Bd73f3D8A2d9c595ad', debtToken: '0x1DabC36f19909425f654777249815c073E8Fd79F', decimals: 18, bonus: 500 },
    { symbol: 'USDbC', token: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', aToken: '0x0a1d576f3eFeF75b330424287a95A366e8281D54', debtToken: '0x7376b2F323dC56fCd4C191B34163ac8a84702DAB', decimals: 6, bonus: 450 },
    { symbol: 'wstETH', token: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', aToken: '0x99CBC45ea5bb7eF3a5BC08FB1B7E56bB2442Ef0D', debtToken: '0x41A7C3f5904ad176dACbb1D99101F59ef0811DC1', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', aToken: '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB', debtToken: '0x59dca05b6c26dbd64b5381374aAaC5CD05644C28', decimals: 6, bonus: 450 },
    { symbol: 'weETH', token: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A', aToken: '0x7C307e128efA31F540F2E2d976C995E0B65F51F6', debtToken: '0xB8C0c7A1BB7F39dde2515BDe199a9B7eb3A61Bf5', decimals: 18, bonus: 500 },
    { symbol: 'cbBTC', token: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', aToken: '0x59CE2cBF1F65f22D8b35B2B6F007a9E3BB0B0c0D', debtToken: '0x2a0aFe2Cf8C8B938c38c11Bf96e7D1A1E8195125', decimals: 8, bonus: 500 },
  ],
  polygon: [
    { symbol: 'WETH', token: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18, bonus: 500 },
    { symbol: 'WMATIC', token: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97', debtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6, bonus: 450 },
    { symbol: 'USDT', token: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', aToken: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620', debtToken: '0xfb00AC187a8Eb5AFAE4eACE434F493Eb62672df7', decimals: 6, bonus: 450 },
    { symbol: 'WBTC', token: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', aToken: '0x078f358208685046a11C85e8ad32895DED33A249', debtToken: '0x92b42c66840C7AD907b4BF74879FF3eF7c529473', decimals: 8, bonus: 500 },
  ],
  arbitrum: [
    { symbol: 'WETH', token: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', aToken: '0x724dc807b04555b71ed48a6896b6F41593b8C637', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6, bonus: 450 },
    { symbol: 'USDT', token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', aToken: '0x6ab707Aca953eDAeFBc4fD23bA73294241490620', debtToken: '0xfb00AC187a8Eb5AFAE4eACE434F493Eb62672df7', decimals: 6, bonus: 450 },
    { symbol: 'WBTC', token: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', aToken: '0x078f358208685046a11C85e8ad32895DED33A249', debtToken: '0x92b42c66840C7AD907b4BF74879FF3eF7c529473', decimals: 8, bonus: 500 },
    { symbol: 'ARB', token: '0x912CE59144191C1204E64559FE8253a0e49E6548', aToken: '0x6533afac2E7BCCB20dca161449A13A32D391fb00', debtToken: '0x44705f578135cC5d703b4c9c122528C73Eb87145', decimals: 18, bonus: 500 },
  ],
  avalanche: [
    { symbol: 'WAVAX', token: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', aToken: '0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97', debtToken: '0x4a1c3aD6Ed28a636ee1751C69071f6be75DEb8B8', decimals: 18, bonus: 500 },
    { symbol: 'USDC', token: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', aToken: '0x625E7708f30cA75bfd92586e17077590C60eb4cD', debtToken: '0xFCCf3cAbbe80101232d343252614b6A3eE81C989', decimals: 6, bonus: 450 },
    { symbol: 'WETH', token: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', aToken: '0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8', debtToken: '0x0c84331e39d6658Cd6e6b9ba04736cC4c4734351', decimals: 18, bonus: 500 },
    { symbol: 'WBTC', token: '0x50b7545627a5162F82A992c33b87aDc75187B218', aToken: '0x078f358208685046a11C85e8ad32895DED33A249', debtToken: '0x92b42c66840C7AD907b4BF74879FF3eF7c529473', decimals: 8, bonus: 500 },
  ],
};

const PROFIT_TOKENS = {
  base: ['0x4200000000000000000000000000000000000006', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'],
  polygon: ['0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174'],
  arbitrum: ['0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'],
  avalanche: ['0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'],
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
  'function withdrawAllProfits(address[] tokens) external',
  'function withdrawETH() external',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

// State
let providers = {};
let wsProviders = {};
let wallets = {};
let flashbotsWallets = {}; // Separate wallets for Flashbots protected TX
let multicalls = {};
let flashLiquidators = {};
let priceFeeds = {};
let currentPrices = {};
let borrowers = { aave: {}, compound: {} };
let stats = { events: 0, checks: 0, liquidations: 0, skipped: 0, earnings: 0 };

// ============================================================
// INITIALIZATION
// ============================================================

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ EVENT LIQUIDATOR V5 - Flashbots MEV Protection                   ║
║  🛡️  Private TX on Base | Min profit: $${MIN_PROFIT_USD}                          ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  
  let flashLiquidatorAddresses = {};
  try { flashLiquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

  for (const [chain, config] of Object.entries(AAVE_POOLS)) {
    if (!config.rpc) continue;

    try {
      // Standard provider for reading
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      multicalls[chain] = new ethers.Contract(MULTICALL3, MULTICALL_ABI, providers[chain]);
      wsProviders[chain] = config.ws ? new ethers.WebSocketProvider(config.ws) : providers[chain];

      // Flashbots provider for sending (if available)
      if (FLASHBOTS_RPC[chain]) {
        const flashbotsProvider = new ethers.JsonRpcProvider(FLASHBOTS_RPC[chain]);
        flashbotsWallets[chain] = new ethers.Wallet(pk, flashbotsProvider);
        console.log(`🛡️  ${chain}: Flashbots MEV protection ENABLED`);
      }

      const bal = await providers[chain].getBalance(wallets[chain].address);
      
      let flashStatus = '❌ No flash liquidator';
      if (flashLiquidatorAddresses[chain]) {
        const code = await providers[chain].getCode(flashLiquidatorAddresses[chain]);
        if (code !== '0x' && code.length > 10) {
          flashLiquidators[chain] = new ethers.Contract(
            flashLiquidatorAddresses[chain], 
            FLASH_LIQUIDATOR_ABI, 
            flashbotsWallets[chain] || wallets[chain] // Use Flashbots wallet if available
          );
          flashStatus = '⚡ Flash loans READY';
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
  const flashbotsChains = Object.keys(FLASHBOTS_RPC).filter(c => providers[c]);
  
  console.log(`\n📊 POSITIONS: ${aaveTotal} Aave + ${compTotal} Compound = ${aaveTotal + compTotal} total`);
  console.log(`⚡ FLASH LOANS: ${Object.keys(flashLiquidators).join(', ') || 'None'}`);
  console.log(`🛡️  MEV PROTECTION: ${flashbotsChains.join(', ') || 'None'}`);
  console.log(`💰 AUTO-WITHDRAW: Enabled | MIN PROFIT: $${MIN_PROFIT_USD}\n`);
}

// ============================================================
// PROFIT SIMULATION
// ============================================================

async function simulateProfit(chain, pos, collateral, debt) {
  const config = AAVE_POOLS[chain];
  
  const collateralAsset = CHAIN_ASSETS[chain]?.find(a => a.token.toLowerCase() === collateral.asset?.toLowerCase());
  const debtAsset = CHAIN_ASSETS[chain]?.find(a => a.token.toLowerCase() === debt.asset?.toLowerCase());
  
  if (!collateralAsset || !debtAsset) {
    return { profitable: false, reason: 'unknown_assets' };
  }
  
  const debtAmountRaw = Number(debt.balance) / (10 ** debtAsset.decimals);
  const debtToCover = debtAmountRaw * 0.5;
  
  const liquidationBonus = collateralAsset.bonus / 10000;
  const collateralReceived = debtToCover * (1 + liquidationBonus);
  
  const isExoticPair = !['WETH', 'USDC', 'USDT'].includes(collateralAsset.symbol);
  const slippage = isExoticPair ? 0.01 : 0.005;
  const swapOutput = collateralReceived * (1 - slippage);
  
  const flashLoanFee = debtToCover * 0.0009;
  const gasUnits = 550000;
  const gasPrice = await getGasPrice(chain);
  const gasCostNative = gasUnits * gasPrice / 1e9;
  const gasCostUsd = gasCostNative * (config.nativePrice || 2900);
  
  const grossProfit = swapOutput - debtToCover;
  const grossProfitUsd = grossProfit * (pos.debt / debtAmountRaw);
  const netProfitUsd = grossProfitUsd - flashLoanFee - gasCostUsd;
  
  return {
    profitable: netProfitUsd > MIN_PROFIT_USD,
    netProfitUsd,
    grossProfitUsd,
    flashLoanFee,
    gasCostUsd,
    gasPrice,
    debtToCover,
    collateralReceived,
    swapOutput,
    liquidationBonus: collateralAsset.bonus,
    reason: netProfitUsd > MIN_PROFIT_USD ? 'profitable' : 'below_threshold',
  };
}

async function getGasPrice(chain) {
  try {
    const feeData = await providers[chain].getFeeData();
    return Number(feeData.gasPrice) / 1e9;
  } catch {
    return AAVE_POOLS[chain]?.gasPrice || 1;
  }
}

// ============================================================
// COLLATERAL/DEBT DETECTION
// ============================================================

async function detectCollateralAndDebt(chain, user) {
  const assets = CHAIN_ASSETS[chain];
  if (!assets) return { collateral: null, debt: null };
  
  const iface = new ethers.Interface(ERC20_ABI);
  
  const calls = [];
  for (const asset of assets) {
    calls.push({ target: asset.aToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) });
    calls.push({ target: asset.debtToken, allowFailure: true, callData: iface.encodeFunctionData('balanceOf', [user]) });
  }
  
  try {
    const results = await multicalls[chain].aggregate3(calls);
    
    let maxCollateral = { asset: null, balance: 0n, symbol: '' };
    let maxDebt = { asset: null, balance: 0n, symbol: '' };
    
    for (let i = 0; i < assets.length; i++) {
      const aTokenResult = results[i * 2];
      const debtTokenResult = results[i * 2 + 1];
      
      if (aTokenResult.success) {
        const bal = iface.decodeFunctionResult('balanceOf', aTokenResult.returnData)[0];
        if (bal > maxCollateral.balance) {
          maxCollateral = { asset: assets[i].token, balance: bal, symbol: assets[i].symbol, decimals: assets[i].decimals };
        }
      }
      
      if (debtTokenResult.success) {
        const bal = iface.decodeFunctionResult('balanceOf', debtTokenResult.returnData)[0];
        if (bal > maxDebt.balance) {
          maxDebt = { asset: assets[i].token, balance: bal, symbol: assets[i].symbol, decimals: assets[i].decimals };
        }
      }
    }
    
    return { collateral: maxCollateral, debt: maxDebt };
  } catch (e) {
    return { collateral: null, debt: null };
  }
}

// ============================================================
// AUTO-WITHDRAW
// ============================================================

async function withdrawProfits(chain) {
  if (!flashLiquidators[chain]) return;
  
  const tokens = PROFIT_TOKENS[chain] || [];
  const wallet = wallets[chain]; // Use standard wallet for withdrawals
  
  for (const token of tokens) {
    try {
      const tokenContract = new ethers.Contract(token, ERC20_ABI, providers[chain]);
      const liquidatorAddress = await flashLiquidators[chain].getAddress();
      const balance = await tokenContract.balanceOf(liquidatorAddress);
      
      if (balance > 0n) {
        const symbol = await tokenContract.symbol();
        const decimals = await tokenContract.decimals();
        const amount = Number(balance) / (10 ** Number(decimals));
        
        console.log(`   💰 Withdrawing ${amount.toFixed(4)} ${symbol}...`);
        
        const liquidatorWithStandard = new ethers.Contract(liquidatorAddress, FLASH_LIQUIDATOR_ABI, wallet);
        const tx = await liquidatorWithStandard.withdrawProfit(token, { gasLimit: 100000 });
        await tx.wait();
        
        console.log(`   ✅ Withdrawn ${amount.toFixed(4)} ${symbol}`);
        await sendDiscord(`💰 PROFIT WITHDRAWN!\n${chain}: ${amount.toFixed(4)} ${symbol}`, true);
      }
    } catch (e) {
      console.log(`   ⚠️ Withdraw error: ${e.message.slice(0, 50)}`);
    }
  }
}

// ============================================================
// LIQUIDATION EXECUTION (WITH MEV PROTECTION)
// ============================================================

async function executeLiquidation(pos) {
  const { chain, protocol, user, debt, hf } = pos;
  const hasFlashbots = !!FLASHBOTS_RPC[chain];
  
  console.log(`\n💀 LIQUIDATION OPPORTUNITY`);
  console.log(`   Chain: ${chain} | Protocol: ${protocol}`);
  console.log(`   User: ${user}`);
  console.log(`   Debt: $${debt.toFixed(0)} | HF: ${hf.toFixed(4)}`);
  console.log(`   🛡️  MEV Protection: ${hasFlashbots ? 'ENABLED (Flashbots)' : 'DISABLED'}`);

  try {
    if (protocol === 'aave') {
      console.log(`   🔍 Detecting collateral/debt...`);
      const { collateral, debt: debtAsset } = await detectCollateralAndDebt(chain, user);
      
      if (!collateral?.asset || !debtAsset?.asset) {
        console.log(`   ❌ Could not detect assets`);
        return { success: false, reason: 'detection_failed' };
      }
      
      console.log(`   📦 Collateral: ${collateral.symbol} | Debt: ${debtAsset.symbol}`);
      
      console.log(`   📊 Simulating profit...`);
      const simulation = await simulateProfit(chain, pos, collateral, debtAsset);
      
      console.log(`   💵 Gross: $${simulation.grossProfitUsd?.toFixed(2)} | Gas: $${simulation.gasCostUsd?.toFixed(2)} | Net: $${simulation.netProfitUsd?.toFixed(2)}`);
      
      if (!simulation.profitable) {
        console.log(`   ⏭️ SKIPPED: Below $${MIN_PROFIT_USD} minimum`);
        stats.skipped++;
        return { success: false, reason: 'unprofitable' };
      }
      
      await sendDiscord(`💀 EXECUTING ${hasFlashbots ? '(MEV Protected)' : ''}\n${chain} | ${collateral.symbol}/${debtAsset.symbol}\nDebt: $${debt.toFixed(0)}\nExpected: $${simulation.netProfitUsd?.toFixed(2)}`, true);
      
      const debtAmount = Number(debtAsset.balance) / (10 ** debtAsset.decimals);
      const debtToCover = ethers.parseUnits(String(Math.floor(debtAmount * 0.5)), debtAsset.decimals);
      
      if (!flashLiquidators[chain]) {
        console.log(`   ⚠️ No flash liquidator`);
        return { success: false, reason: 'no_liquidator' };
      }
      
      console.log(`   ⚡ Sending TX via ${hasFlashbots ? 'Flashbots (private)' : 'standard RPC'}...`);
      
      // Get the right wallet (Flashbots or standard)
      const executionWallet = flashbotsWallets[chain] || wallets[chain];
      const liquidator = new ethers.Contract(
        await flashLiquidators[chain].getAddress(),
        FLASH_LIQUIDATOR_ABI,
        executionWallet
      );
      
      const feeData = await providers[chain].getFeeData();
      const priorityFee = feeData.maxPriorityFeePerGas * 5n;
      
      const tx = await liquidator.executeLiquidation(
        collateral.asset,
        debtAsset.asset,
        user,
        debtToCover,
        {
          gasLimit: 1500000n,
          maxPriorityFeePerGas: priorityFee,
          maxFeePerGas: feeData.maxFeePerGas + priorityFee,
        }
      );
      
      console.log(`   📤 TX: ${tx.hash}`);
      
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        stats.liquidations++;
        const profit = simulation.netProfitUsd;
        stats.earnings += profit;
        console.log(`   ✅ SUCCESS! Profit: ~$${profit.toFixed(2)}`);
        await sendDiscord(`✅ LIQUIDATION SUCCESS!\n${chain} | ${collateral.symbol}/${debtAsset.symbol}\nProfit: ~$${profit.toFixed(2)}\nTX: ${tx.hash}`, true);
        
        await withdrawProfits(chain);
        return { success: true, profit, hash: tx.hash };
      } else {
        console.log(`   ❌ Reverted`);
        return { success: false, reason: 'reverted' };
      }
    }
    
    return { success: false };
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 100)}`);
    await sendDiscord(`❌ FAILED: ${e.message.slice(0, 100)}`, false);
    return { success: false, error: e.message };
  }
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
// PRICE EVENTS
// ============================================================

async function onPriceUpdate(chain, asset, newPrice, oldPrice) {
  stats.events++;
  currentPrices[`${chain}-${asset}`] = Number(newPrice) / 1e8;
  
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

async function processResults(results) {
  const liquidatable = results.filter(pos => pos.liquidatable);
  const critical = results.filter(pos => !pos.liquidatable && pos.hf < 1.01 && pos.hf > 0 && pos.debt > 1000);
  const close = results.filter(pos => !pos.liquidatable && pos.hf >= 1.01 && pos.hf < 1.02 && pos.debt > 500);

  if (liquidatable.length > 0) {
    console.log(`\n🔥🔥🔥 ${liquidatable.length} LIQUIDATABLE 🔥🔥🔥`);
    for (const pos of liquidatable) {
      await executeLiquidation(pos);
    }
  }

  for (const pos of critical) {
    const distance = ((pos.hf - 1) * 100).toFixed(2);
    console.log(`   🚨 CRITICAL: ${pos.chain} ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)} | ${distance}% away`);
  }

  for (const pos of close) {
    console.log(`   🔥 CLOSE: ${pos.chain} ${pos.user.slice(0, 10)}... | $${pos.debt.toFixed(0)} | HF: ${pos.hf.toFixed(4)}`);
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
        currentPrices[`${chain}-${asset}`] = Number(currentPrice) / 1e8;

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
      body: JSON.stringify({ content: urgent ? '@here ' + message : message, username: '⚡ Liquidator V5' }),
    });
  } catch {}
}

async function sendStartupMessage() {
  const totalPositions = Object.values(borrowers.aave).reduce((s, a) => s + (a?.length || 0), 0) +
    Object.values(borrowers.compound).reduce((s, c) => s + Object.values(c).reduce((x, y) => x + y.length, 0), 0);
  const flashbotsChains = Object.keys(FLASHBOTS_RPC).filter(c => providers[c]);
  
  await sendDiscord(
    `🚀 LIQUIDATOR V5 STARTED\n` +
    `📊 ${totalPositions} positions\n` +
    `🛡️ MEV Protection: ${flashbotsChains.join(', ') || 'None'}\n` +
    `💰 Min profit: $${MIN_PROFIT_USD}`, 
    true
  );
}

// ============================================================
// MAIN
// ============================================================

async function backgroundScan() {
  for (const chain of Object.keys(providers)) {
    await checkAllProtocols(chain);
  }
}

async function main() {
  await init();
  await subscribeToOracles();
  await sendStartupMessage();

  console.log('🚀 Listening for price events...\n');

  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Events: ${stats.events} | Checks: ${stats.checks} | Liquidations: ${stats.liquidations} | Skipped: ${stats.skipped} | Earned: $${stats.earnings.toFixed(2)}`);
  }, 60000);

  setInterval(backgroundScan, 30000);
  process.stdin.resume();
}

main().catch(console.error);
