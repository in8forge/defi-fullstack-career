import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// ⚡ SYNTHETIX ORDER SETTLER
// Settle pending orders and earn settlement rewards
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// Synthetix Perps V3 on Base
const CONFIG = {
  chain: 'base',
  rpc: process.env.BASE_RPC_URL,
  ws: process.env.BASE_WS_URL,
  perpsMarket: '0x0A2AF931eFFd34b81ebcc57E3d3c9B1E1dE1C9Ce',
  // Settlement window is typically 2-60 seconds after commitment
  settlementDelay: 2, // seconds minimum
};

const PERPS_ABI = [
  // Events
  'event OrderCommitted(uint128 indexed marketId, uint128 indexed accountId, uint8 orderType, int128 sizeDelta, uint256 acceptablePrice, uint256 commitmentTime, uint256 expectedPriceTime, uint256 settlementTime, uint256 expirationTime, bytes32 indexed trackingCode, address sender)',
  'event OrderSettled(uint128 indexed marketId, uint128 indexed accountId, uint256 fillPrice, int256 pnl, int256 accruedFunding, int128 sizeDelta, int128 newSize, uint256 totalFees, uint256 referralFees, uint256 collectedFees, uint256 settlementReward, bytes32 indexed trackingCode, address settler)',
  'event OrderCancelled(uint128 indexed marketId, uint128 indexed accountId, uint256 desiredPrice, uint256 fillPrice, int128 sizeDelta, uint256 settlementReward, bytes32 indexed trackingCode, address settler)',
  
  // Functions
  'function settle(uint128 accountId)',
  'function settlePythOrder(bytes calldata result, bytes calldata extraData) payable',
  'function getOrder(uint128 accountId) view returns (tuple(uint256 commitmentTime, tuple(uint128 marketId, uint128 accountId, int128 sizeDelta, uint256 settlementStrategyId, uint256 acceptablePrice, bytes32 trackingCode, address referrer) request))',
];

let provider;
let wsProvider;
let wallet;
let perpsMarket;
let pendingOrders = new Map(); // accountId -> orderDetails
let stats = { seen: 0, settled: 0, earned: 0, failed: 0 };

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ SYNTHETIX ORDER SETTLER                                          ║
║  💰 Settle orders on Base → Earn rewards                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  provider = new ethers.JsonRpcProvider(CONFIG.rpc);
  wsProvider = new ethers.WebSocketProvider(CONFIG.ws);
  wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  perpsMarket = new ethers.Contract(CONFIG.perpsMarket, PERPS_ABI, wallet);
  const perpsMarketWs = new ethers.Contract(CONFIG.perpsMarket, PERPS_ABI, wsProvider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`✅ Base: ${Number(ethers.formatEther(balance)).toFixed(4)} ETH`);
  console.log(`📍 Wallet: ${wallet.address}`);
  console.log(`📍 Perps Market: ${CONFIG.perpsMarket}\n`);
  
  // Listen for new orders
  perpsMarketWs.on('OrderCommitted', onOrderCommitted);
  
  // Listen for settlements (to track competition)
  perpsMarketWs.on('OrderSettled', onOrderSettled);
  
  console.log('📡 Listening for Synthetix orders...\n');
}

async function onOrderCommitted(marketId, accountId, orderType, sizeDelta, acceptablePrice, commitmentTime, expectedPriceTime, settlementTime, expirationTime, trackingCode, sender) {
  stats.seen++;
  
  const settleAt = Number(settlementTime);
  const expiresAt = Number(expirationTime);
  const now = Math.floor(Date.now() / 1000);
  const waitTime = settleAt - now;
  
  console.log(`\n🔵 ORDER COMMITTED`);
  console.log(`   Market: ${marketId} | Account: ${accountId}`);
  console.log(`   Size: ${Number(sizeDelta) / 1e18} | Type: ${orderType}`);
  console.log(`   Settle in: ${waitTime}s | Expires: ${expiresAt - now}s`);
  
  if (waitTime < 0) {
    console.log(`   ⚠️ Already settleable!`);
  }
  
  // Store order details
  pendingOrders.set(accountId.toString(), {
    marketId,
    accountId,
    sizeDelta,
    settlementTime: settleAt,
    expirationTime: expiresAt,
    attempts: 0,
  });
  
  // Schedule settlement
  if (waitTime > 0) {
    console.log(`   ⏰ Scheduling settlement in ${waitTime}s...`);
    setTimeout(() => settleOrder(accountId), waitTime * 1000);
  } else {
    // Try immediately
    await settleOrder(accountId);
  }
}

async function onOrderSettled(marketId, accountId, fillPrice, pnl, accruedFunding, sizeDelta, newSize, totalFees, referralFees, collectedFees, settlementReward, trackingCode, settler) {
  const reward = Number(settlementReward) / 1e18;
  const isUs = settler.toLowerCase() === wallet.address.toLowerCase();
  
  if (isUs) {
    stats.settled++;
    stats.earned += reward;
    console.log(`\n💰 WE SETTLED! Reward: ${reward.toFixed(6)} ETH`);
    await sendDiscord(`💰 SYNTHETIX SETTLED!\nAccount: ${accountId}\nReward: ${reward.toFixed(6)} ETH\nTotal earned: ${stats.earned.toFixed(6)} ETH`, true);
  } else {
    console.log(`\n👀 Order settled by ${settler.slice(0, 10)}... (reward: ${reward.toFixed(6)} ETH)`);
  }
  
  // Remove from pending
  pendingOrders.delete(accountId.toString());
}

async function settleOrder(accountId) {
  const order = pendingOrders.get(accountId.toString());
  if (!order) {
    console.log(`   ⚠️ Order ${accountId} no longer pending`);
    return;
  }
  
  const now = Math.floor(Date.now() / 1000);
  
  // Check if expired
  if (now > order.expirationTime) {
    console.log(`   ❌ Order ${accountId} expired`);
    pendingOrders.delete(accountId.toString());
    return;
  }
  
  // Check if too early
  if (now < order.settlementTime) {
    const wait = order.settlementTime - now;
    console.log(`   ⏰ Too early, waiting ${wait}s more...`);
    setTimeout(() => settleOrder(accountId), wait * 1000);
    return;
  }
  
  order.attempts++;
  
  try {
    console.log(`\n⚡ SETTLING Order ${accountId} (attempt ${order.attempts})...`);
    
    // Get gas estimate
    const gasPrice = await provider.getFeeData();
    const priorityFee = gasPrice.maxPriorityFeePerGas * 3n; // 3x priority
    
    const tx = await perpsMarket.settle(accountId, {
      gasLimit: 500000n,
      maxPriorityFeePerGas: priorityFee,
      maxFeePerGas: gasPrice.maxFeePerGas + priorityFee,
    });
    
    console.log(`   📤 TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log(`   ✅ Settlement TX confirmed!`);
      // Reward will be logged in onOrderSettled event
    } else {
      console.log(`   ❌ TX reverted`);
      stats.failed++;
    }
    
  } catch (e) {
    const msg = e.message.slice(0, 80);
    console.log(`   ❌ Error: ${msg}`);
    
    // Retry if not already settled
    if (!msg.includes('AcceptablePrice') && !msg.includes('OrderNotValid') && order.attempts < 3) {
      console.log(`   🔄 Retrying in 1s...`);
      setTimeout(() => settleOrder(accountId), 1000);
    } else {
      stats.failed++;
      pendingOrders.delete(accountId.toString());
    }
  }
}

async function sendDiscord(message, urgent = false) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: urgent ? '@here ' + message : message,
        username: '🔵 Synthetix Settler',
      }),
    });
  } catch {}
}

async function main() {
  await init();
  
  await sendDiscord('🚀 Synthetix Settler Started\nMonitoring Base for settlement opportunities', true);
  
  // Stats every 5 minutes
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Seen: ${stats.seen} | Settled: ${stats.settled} | Earned: ${stats.earned.toFixed(6)} ETH | Failed: ${stats.failed} | Pending: ${pendingOrders.size}`);
  }, 300000);
  
  process.stdin.resume();
}

main().catch(console.error);
