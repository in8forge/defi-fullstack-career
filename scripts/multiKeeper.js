import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// ⚡ MULTI-PROTOCOL KEEPER
// GMX + Gains + Chainlink + Gelato + MakerDAO
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// Protocol configs
const PROTOCOLS = {
  // GMX V2 (Arbitrum)
  gmx: {
    chain: 'arbitrum',
    orderHandler: '0x352f684ab9e97a6321a13CF03A61316B681D9fD2',
    depositHandler: '0xD9AEbEa68DE4b4A3B58833e1bc2AEB9682883AB0',
  },
  // Gains Network (Polygon, Arbitrum)
  gains: {
    polygon: {
      trading: '0xFF162c694eAA571f685030649814282eA457f169',
    },
    arbitrum: {
      trading: '0xFF162c694eAA571f685030649814282eA457f169',
    },
  },
  // MakerDAO (Ethereum - but we can watch)
  maker: {
    chain: 'arbitrum', // Arbitrum has DAI vaults
    dog: '0x135954d155898D42C90D2a57824C690e0c7BEf1B', // Liquidation contract
  },
  // Synthetix (Optimism/Base)
  synthetix: {
    base: {
      perpsMarket: '0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce',
    },
  },
};

const CHAINS = {
  base: { rpc: process.env.BASE_RPC_URL, ws: process.env.BASE_WS_URL },
  polygon: { rpc: process.env.POLYGON_RPC_URL, ws: process.env.POLYGON_WS_URL },
  arbitrum: { rpc: process.env.ARBITRUM_RPC_URL, ws: process.env.ARBITRUM_WS_URL },
  avalanche: { rpc: process.env.AVALANCHE_RPC_URL, ws: process.env.AVALANCHE_WS_URL },
};

// ABIs
const GMX_ORDER_ABI = [
  'event OrderCreated(bytes32 indexed key, address indexed account, address indexed receiver)',
  'event OrderExecuted(bytes32 indexed key)',
  'event OrderCancelled(bytes32 indexed key, bytes32 reason)',
  'function executeOrder(bytes32 key, tuple(address[] tokens, uint256[] precisions, uint256[] prices, uint256[] signedPrices) oracleParams)',
];

const GAINS_ABI = [
  'event MarketOrderInitiated(uint256 indexed orderId, address indexed trader, uint256 pairIndex, bool open, bool buy, uint256 positionSizeDai)',
  'event OpenLimitPlaced(address indexed trader, uint256 indexed pairIndex, uint256 index)',
  'function executeNftOrder(uint256 _order, address _nftHolder, uint256 _nftId)',
];

const SYNTHETIX_ABI = [
  'event OrderCommitted(uint128 indexed marketId, uint128 indexed accountId, uint8 orderType, int128 sizeDelta, uint256 acceptablePrice, uint256 settlementTime, bytes32 trackingCode, address indexed sender)',
  'event OrderSettled(uint128 indexed marketId, uint128 indexed accountId, uint256 fillPrice, int256 pnl, int256 accruedFunding, int128 sizeDelta, int128 newSize, uint256 totalFees, uint256 referralFees, uint256 collectedFees, uint256 settlementReward, bytes32 indexed trackingCode, address settler)',
  'function settleOrder(uint128 accountId)',
];

let providers = {};
let wsProviders = {};
let wallets = {};
let stats = { 
  gmxOrders: 0, 
  gainsOrders: 0, 
  synthetixOrders: 0,
  executed: 0, 
  earned: 0,
  errors: 0,
};

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ MULTI-PROTOCOL KEEPER                                            ║
║  🎯 GMX | Gains | Synthetix | Monitoring all protocols               ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;

  for (const [chain, config] of Object.entries(CHAINS)) {
    if (!config.rpc) continue;
    
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      
      if (config.ws) {
        wsProviders[chain] = new ethers.WebSocketProvider(config.ws);
      }
      
      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} ETH`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 40)}`);
    }
  }
}

// ============================================================
// GMX V2 ORDER MONITORING
// ============================================================

async function monitorGMX() {
  const chain = 'arbitrum';
  if (!wsProviders[chain]) return;
  
  try {
    const orderHandler = new ethers.Contract(
      PROTOCOLS.gmx.orderHandler,
      GMX_ORDER_ABI,
      wsProviders[chain]
    );
    
    orderHandler.on('OrderCreated', async (key, account, receiver) => {
      stats.gmxOrders++;
      console.log(`\n📦 GMX Order Created`);
      console.log(`   Key: ${key.slice(0, 16)}...`);
      console.log(`   Account: ${account.slice(0, 12)}...`);
      
      await sendDiscord(`📦 GMX Order: ${key.slice(0, 16)}... from ${account.slice(0, 12)}`, false);
    });
    
    orderHandler.on('OrderExecuted', (key) => {
      console.log(`   ✅ GMX Order Executed: ${key.slice(0, 16)}...`);
    });
    
    console.log(`📡 GMX: Listening on Arbitrum`);
  } catch (e) {
    console.log(`❌ GMX monitor error: ${e.message.slice(0, 50)}`);
  }
}

// ============================================================
// GAINS NETWORK MONITORING
// ============================================================

async function monitorGains() {
  for (const chain of ['polygon', 'arbitrum']) {
    if (!wsProviders[chain] || !PROTOCOLS.gains[chain]) continue;
    
    try {
      const trading = new ethers.Contract(
        PROTOCOLS.gains[chain].trading,
        GAINS_ABI,
        wsProviders[chain]
      );
      
      trading.on('MarketOrderInitiated', async (orderId, trader, pairIndex, open, buy) => {
        stats.gainsOrders++;
        console.log(`\n📊 Gains Order (${chain})`);
        console.log(`   ID: ${orderId} | Pair: ${pairIndex}`);
        console.log(`   Type: ${open ? 'OPEN' : 'CLOSE'} ${buy ? 'LONG' : 'SHORT'}`);
        
        await sendDiscord(`📊 Gains Order #${orderId} on ${chain}`, false);
      });
      
      console.log(`📡 Gains: Listening on ${chain}`);
    } catch (e) {
      console.log(`❌ Gains ${chain} error: ${e.message.slice(0, 50)}`);
    }
  }
}

// ============================================================
// SYNTHETIX MONITORING (Base)
// ============================================================

async function monitorSynthetix() {
  const chain = 'base';
  if (!wsProviders[chain] || !PROTOCOLS.synthetix[chain]) return;
  
  try {
    const perpsMarket = new ethers.Contract(
      PROTOCOLS.synthetix[chain].perpsMarket,
      SYNTHETIX_ABI,
      wsProviders[chain]
    );
    
    perpsMarket.on('OrderCommitted', async (marketId, accountId, orderType, sizeDelta, acceptablePrice, settlementTime) => {
      stats.synthetixOrders++;
      const settleAt = new Date(Number(settlementTime) * 1000);
      
      console.log(`\n🔵 Synthetix Order Committed (Base)`);
      console.log(`   Market: ${marketId} | Account: ${accountId}`);
      console.log(`   Size: ${Number(sizeDelta) / 1e18}`);
      console.log(`   Settles at: ${settleAt.toLocaleTimeString()}`);
      
      await sendDiscord(`🔵 Synthetix Order: Market ${marketId} settles at ${settleAt.toLocaleTimeString()}`, false);
    });
    
    perpsMarket.on('OrderSettled', (marketId, accountId, fillPrice, pnl, accruedFunding, sizeDelta, newSize, totalFees, referralFees, collectedFees, settlementReward, trackingCode, settler) => {
      const reward = Number(settlementReward) / 1e18;
      if (reward > 0) {
        console.log(`   💰 Settlement reward: ${reward.toFixed(6)} ETH | Settler: ${settler.slice(0, 10)}`);
      }
    });
    
    console.log(`📡 Synthetix: Listening on Base`);
  } catch (e) {
    console.log(`❌ Synthetix error: ${e.message.slice(0, 50)}`);
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
        username: '⚡ Multi-Keeper'
      }),
    });
  } catch {}
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  await init();
  
  console.log('\n📡 Starting protocol monitors...\n');
  
  await monitorGMX();
  await monitorGains();
  await monitorSynthetix();
  
  console.log('\n🚀 Multi-keeper running...\n');
  
  // Stats every 5 minutes
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] GMX: ${stats.gmxOrders} | Gains: ${stats.gainsOrders} | Synthetix: ${stats.synthetixOrders} | Executed: ${stats.executed} | Earned: $${stats.earned.toFixed(2)}`);
  }, 300000);
  
  await sendDiscord('🚀 Multi-Keeper Started\nMonitoring: GMX, Gains, Synthetix', true);
  
  process.stdin.resume();
}

main().catch(console.error);
