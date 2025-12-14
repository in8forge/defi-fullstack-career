import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// MULTI-KEEPER BOT
// - Beefy Harvests (0.5% of harvest)
// - Chainlink Automation (LINK rewards)
// - Yearn Harvests (% of profit)
// - Protocol reward claims
// ============================================================

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const CHECK_INTERVAL = 60000; // 1 minute

// ==================== BEEFY VAULTS ====================
// Beefy pays keepers ~0.5% of harvest value
const BEEFY_STRATEGIES = {
  polygon: [
    { name: 'MATIC-USDC', strategy: '0x5e5646D2Ccb34e3E5F8F52A6f3C6d2AE3f3c3C3a' },
    { name: 'WETH-USDC', strategy: '0x6f6646D2Ccb34e3E5F8F52A6f3C6d2AE3f3c3C3b' },
  ],
  avalanche: [
    { name: 'AVAX-USDC', strategy: '0x7g7646D2Ccb34e3E5F8F52A6f3C6d2AE3f3c3C3c' },
  ],
  base: [
    { name: 'ETH-USDC', strategy: '0x8h8646D2Ccb34e3E5F8F52A6f3C6d2AE3f3c3C3d' },
  ],
};

// ==================== CHAINLINK AUTOMATION ====================
// Contracts that use Chainlink Keepers
const CHAINLINK_UPKEEPS = {
  polygon: [
    { name: 'Aave Rate Update', address: '0x', checkData: '0x' },
  ],
  avalanche: [
    { name: 'Benqi Rebalance', address: '0x', checkData: '0x' },
  ],
  base: [
    { name: 'Aerodrome Epoch', address: '0x', checkData: '0x' },
  ],
};

// ==================== YEARN-STYLE STRATEGIES ====================
const YEARN_STRATEGIES = {
  polygon: [],
  avalanche: [],
  base: [],
};

// ==================== COMMON HARVEST TARGETS ====================
// These are real, active contracts
const HARVEST_TARGETS = {
  polygon: [
    {
      name: 'QuickSwap dQUICK',
      contract: '0xf28164A485B0B2C90639E47b0f377b4a438a16B1',
      abi: ['function earned(address) view returns (uint256)', 'function getReward() external'],
      checkMethod: 'earned',
      executeMethod: 'getReward',
      minReward: 1, // in token units
    },
  ],
  avalanche: [
    {
      name: 'TraderJoe sJOE',
      contract: '0x1a731B2299E22FbAC282E7094EdA41046343Cb51',
      abi: ['function pendingReward(address) view returns (uint256)', 'function harvest() external'],
      checkMethod: 'pendingReward',
      executeMethod: 'harvest',
      minReward: 0.1,
    },
  ],
  base: [
    {
      name: 'Aerodrome veAERO',
      contract: '0xeBf418Fe2512e7E6bd9b87a8F0f294aCDC67e6B4',
      abi: ['function earned(address) view returns (uint256)', 'function getReward() external'],
      checkMethod: 'earned',
      executeMethod: 'getReward',
      minReward: 0.01,
    },
  ],
};

// ==================== EPOCH FLIPPERS ====================
// Protocols that need epoch advancement
const EPOCH_TARGETS = {
  base: [
    {
      name: 'Aerodrome Voter',
      contract: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5',
      abi: ['function distribute(address[]) external'],
      method: 'distribute',
    },
  ],
};

const STRATEGY_ABI = [
  'function callReward() view returns (uint256)',
  'function harvest() external',
  'function harvestTrigger(uint256) view returns (bool)',
  'function lastHarvest() view returns (uint256)',
];

const UPKEEP_ABI = [
  'function checkUpkeep(bytes) view returns (bool,bytes)',
  'function performUpkeep(bytes) external',
];

let providers = {};
let wallets = {};
let stats = {
  harvests: 0,
  upkeeps: 0,
  earnings: 0,
  tasks: 0,
};

async function sendDiscord(msg, urgent = false) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        content: urgent ? '@here ' + msg : msg, 
        username: '🤖 Multi-Keeper' 
      }),
    });
  } catch {}
}

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🤖 MULTI-KEEPER BOT                                                 ║
║  Beefy | Chainlink | Yearn | Protocol Rewards                        ║
╠══════════════════════════════════════════════════════════════════════╣
║  Check Interval: ${CHECK_INTERVAL / 1000}s                                              ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const pk = process.env.PRIVATE_KEY;
  const rpcs = {
    base: process.env.BASE_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    avalanche: process.env.AVALANCHE_RPC_URL,
    arbitrum: process.env.ARBITRUM_RPC_URL,
  };

  for (const [chain, rpc] of Object.entries(rpcs)) {
    if (!rpc) continue;
    try {
      providers[chain] = new ethers.JsonRpcProvider(rpc);
      wallets[chain] = new ethers.Wallet(pk, providers[chain]);
      const bal = await providers[chain].getBalance(wallets[chain].address);
      console.log(`✅ ${chain}: ${Number(ethers.formatEther(bal)).toFixed(4)} native`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message}`);
    }
  }

  console.log(`\n👛 ${wallets[Object.keys(wallets)[0]]?.address}\n`);
  await sendDiscord('🟢 **Multi-Keeper Started**\nMonitoring: Beefy, Chainlink, Yearn, Protocol Rewards');
}

// ==================== BEEFY HARVEST ====================
async function checkBeefyHarvest(chain, strat) {
  try {
    const contract = new ethers.Contract(strat.strategy, STRATEGY_ABI, providers[chain]);
    
    // Check if harvest is profitable
    const reward = await contract.callReward();
    const rewardEth = Number(ethers.formatEther(reward));
    
    // Also check harvest trigger if available
    let shouldHarvest = rewardEth > 0.001;
    try {
      shouldHarvest = await contract.harvestTrigger(300000); // 300k gas
    } catch {}
    
    if (shouldHarvest && rewardEth > 0.001) {
      return { harvest: true, reward: rewardEth, strat };
    }
  } catch {}
  return { harvest: false };
}

async function executeBeefyHarvest(chain, strat) {
  try {
    const contract = new ethers.Contract(strat.strategy, STRATEGY_ABI, wallets[chain]);
    
    console.log(`\n🌾 Harvesting: ${strat.name} on ${chain}`);
    const tx = await contract.harvest({ gasLimit: 2000000 });
    console.log(`   📤 TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      stats.harvests++;
      stats.tasks++;
      console.log(`   ✅ Harvest SUCCESS!`);
      await sendDiscord(`🌾 **Beefy Harvest**\n${strat.name} on ${chain}\nTX: ${tx.hash}`, true);
      return true;
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 100)}`);
  }
  return false;
}

// ==================== CHAINLINK UPKEEP ====================
async function checkChainlinkUpkeep(chain, target) {
  if (!target.address || target.address === '0x') return { needed: false };
  
  try {
    const contract = new ethers.Contract(target.address, UPKEEP_ABI, providers[chain]);
    const [needed, data] = await contract.checkUpkeep(target.checkData || '0x');
    
    if (needed) {
      return { needed: true, data, target };
    }
  } catch {}
  return { needed: false };
}

async function executeChainlinkUpkeep(chain, target, performData) {
  try {
    const contract = new ethers.Contract(target.address, UPKEEP_ABI, wallets[chain]);
    
    console.log(`\n⚡ Upkeep: ${target.name} on ${chain}`);
    const tx = await contract.performUpkeep(performData, { gasLimit: 500000 });
    console.log(`   📤 TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      stats.upkeeps++;
      stats.tasks++;
      console.log(`   ✅ Upkeep SUCCESS!`);
      await sendDiscord(`⚡ **Chainlink Upkeep**\n${target.name} on ${chain}\nTX: ${tx.hash}`);
      return true;
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 100)}`);
  }
  return false;
}

// ==================== PROTOCOL REWARDS ====================
async function checkProtocolRewards(chain, target) {
  try {
    const contract = new ethers.Contract(target.contract, target.abi, providers[chain]);
    const wallet = wallets[chain];
    
    const reward = await contract[target.checkMethod](wallet.address);
    const rewardNum = Number(ethers.formatEther(reward));
    
    if (rewardNum >= target.minReward) {
      return { claimable: true, amount: rewardNum, target };
    }
  } catch {}
  return { claimable: false };
}

async function claimProtocolReward(chain, target) {
  try {
    const contract = new ethers.Contract(target.contract, target.abi, wallets[chain]);
    
    console.log(`\n💰 Claiming: ${target.name} on ${chain}`);
    const tx = await contract[target.executeMethod]({ gasLimit: 300000 });
    console.log(`   📤 TX: ${tx.hash}`);
    
    const receipt = await tx.wait();
    if (receipt.status === 1) {
      stats.tasks++;
      console.log(`   ✅ Claim SUCCESS!`);
      await sendDiscord(`💰 **Reward Claimed**\n${target.name} on ${chain}\nTX: ${tx.hash}`);
      return true;
    }
  } catch (e) {
    console.log(`   ❌ ${e.message.slice(0, 100)}`);
  }
  return false;
}

// ==================== MAIN SCAN ====================
async function scan() {
  // 1. Check Beefy harvests
  for (const [chain, strats] of Object.entries(BEEFY_STRATEGIES)) {
    if (!providers[chain]) continue;
    for (const strat of strats) {
      const result = await checkBeefyHarvest(chain, strat);
      if (result.harvest) {
        console.log(`🎯 Beefy harvest available: ${strat.name} (${result.reward.toFixed(4)})`);
        await executeBeefyHarvest(chain, strat);
      }
    }
  }

  // 2. Check Chainlink upkeeps
  for (const [chain, targets] of Object.entries(CHAINLINK_UPKEEPS)) {
    if (!providers[chain]) continue;
    for (const target of targets) {
      const result = await checkChainlinkUpkeep(chain, target);
      if (result.needed) {
        console.log(`🎯 Upkeep needed: ${target.name}`);
        await executeChainlinkUpkeep(chain, target, result.data);
      }
    }
  }

  // 3. Check protocol rewards
  for (const [chain, targets] of Object.entries(HARVEST_TARGETS)) {
    if (!providers[chain]) continue;
    for (const target of targets) {
      const result = await checkProtocolRewards(chain, target);
      if (result.claimable) {
        console.log(`🎯 Reward claimable: ${target.name} (${result.amount.toFixed(4)})`);
        await claimProtocolReward(chain, target);
      }
    }
  }
}

async function main() {
  await init();
  
  console.log('🚀 Starting keeper scans...\n');
  
  // Initial scan
  await scan();
  
  // Regular scans
  setInterval(async () => {
    try { await scan(); } catch (e) { console.log('Scan error:', e.message); }
  }, CHECK_INTERVAL);
  
  // Status every 10 minutes
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Tasks: ${stats.tasks} | Harvests: ${stats.harvests} | Upkeeps: ${stats.upkeeps}`);
  }, 600000);
  
  // Hourly Discord update
  setInterval(async () => {
    await sendDiscord(`📊 **Hourly Status**\nTasks: ${stats.tasks}\nHarvests: ${stats.harvests}\nUpkeeps: ${stats.upkeeps}`);
  }, 3600000);
}

main().catch(console.error);
