import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// ⚡ GELATO NETWORK KEEPER
// Execute automated tasks for rewards
// ============================================================

const CHAINS = {
  base: {
    rpc: process.env.BASE_RPC_URL,
    automate: '0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0',
  },
  arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL,
    automate: '0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0',
  },
  polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    automate: '0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0',
  },
  avalanche: {
    rpc: process.env.AVALANCHE_RPC_URL,
    automate: '0x2A6C106ae13B558BB9E2Ec64Bd2f1f7BEFF3A5E0',
  },
};

const AUTOMATE_ABI = [
  'function gelato() view returns (address)',
  'function taskModuleAddresses(uint8) view returns (address)',
  'event ExecSuccess(uint256 indexed txFee, address indexed feeToken, address indexed execAddress, bytes execData, bytes32 taskId, bool callSuccess)',
];

let providers = {};
let automators = {};
let stats = { tasks: 0, executed: 0, earned: 0 };

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ GELATO NETWORK KEEPER                                            ║
║  🤖 Execute automated tasks for rewards                              ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  for (const [chain, config] of Object.entries(CHAINS)) {
    if (!config.rpc) continue;
    
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      automators[chain] = new ethers.Contract(config.automate, AUTOMATE_ABI, providers[chain]);
      
      const gelato = await automators[chain].gelato();
      console.log(`✅ ${chain}: Gelato at ${gelato.slice(0, 10)}...`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 50)}`);
    }
  }
}

async function listenForTasks() {
  for (const [chain, automator] of Object.entries(automators)) {
    // Listen for successful executions to understand activity
    automator.on('ExecSuccess', (txFee, feeToken, execAddress, execData, taskId) => {
      stats.executed++;
      const fee = Number(txFee) / 1e18;
      console.log(`\n⚡ ${chain} Task Executed`);
      console.log(`   Task: ${taskId.slice(0, 16)}...`);
      console.log(`   Fee: ${fee.toFixed(6)} ${feeToken.slice(0, 10)}`);
    });
  }
}

async function main() {
  await init();
  await listenForTasks();
  
  console.log('\n👀 Monitoring Gelato task executions...\n');
  
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Tasks seen: ${stats.executed}`);
  }, 300000);
  
  process.stdin.resume();
}

main().catch(console.error);
