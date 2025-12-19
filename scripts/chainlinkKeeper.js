import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// ⚡ CHAINLINK AUTOMATION KEEPER
// Earns LINK for executing upkeeps
// ============================================================

const CHAINS = {
  base: {
    rpc: process.env.BASE_RPC_URL,
    registry: '0xE226D5aCae908252CcA3F6CEFa577527650a9e1e', // Automation Registry 2.1
    linkToken: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
  },
  arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL,
    registry: '0x37D9dC70bfcd8BC77Ec2858836B923c560E891D1',
    linkToken: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
  },
  polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    registry: '0x08a8eea76D2395807Ce7D1FC942382515469cCA1',
    linkToken: '0xb0897686c545045aFc77CF20eC7A532E3120E0F1',
  },
  avalanche: {
    rpc: process.env.AVALANCHE_RPC_URL,
    registry: '0x7f00a3Cd4590009C349192510D51F8e6312E08CB',
    linkToken: '0x5947BB275c521040051D82396192181b413227A3',
  },
};

const REGISTRY_ABI = [
  'function getState() view returns (tuple(uint32 nonce, uint96 ownerLinkBalance, uint256 expectedLinkBalance, uint96 totalPremium, uint256 numUpkeeps, uint32 configCount, uint32 latestConfigBlockNumber, bytes32 latestConfigDigest, uint32 latestEpoch, bool paused) state, tuple(uint32 paymentPremiumPPB, uint32 flatFeeMicroLink, uint32 checkGasLimit, uint24 stalenessSeconds, uint16 gasCeilingMultiplier, uint96 minUpkeepSpend, uint32 maxPerformGas, uint32 maxCheckDataSize, uint32 maxPerformDataSize, uint32 maxRevertDataSize, uint256 fallbackGasPrice, uint256 fallbackLinkPrice, address transcoder, address[] registrars, address upkeepPrivilegeManager) config, address[] signers, address[] transmitters, uint8 f)',
  'function getActiveUpkeepIDs(uint256 startIndex, uint256 maxCount) view returns (uint256[] memory)',
  'function getUpkeep(uint256 id) view returns (tuple(address target, uint32 performGas, bytes checkData, uint96 balance, address admin, uint64 maxValidBlocknumber, uint32 lastPerformedBlockNumber, uint96 amountSpent, bool paused, bytes offchainConfig) upkeepInfo)',
  'function checkUpkeep(uint256 id) view returns (bool upkeepNeeded, bytes memory performData, uint8 upkeepFailureReason, uint256 gasUsed, uint256 gasLimit, uint256 fastGasWei, uint256 linkNative)',
  'event UpkeepPerformed(uint256 indexed id, bool indexed success, uint96 totalPayment, uint256 gasUsed, uint256 gasOverhead, bytes trigger)',
];

let providers = {};
let registries = {};
let stats = { checked: 0, needsUpkeep: 0, executed: 0, earned: 0 };

async function init() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚡ CHAINLINK AUTOMATION KEEPER                                      ║
║  🔗 Earns LINK for executing upkeeps                                 ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  for (const [chain, config] of Object.entries(CHAINS)) {
    if (!config.rpc) continue;
    
    try {
      providers[chain] = new ethers.JsonRpcProvider(config.rpc);
      registries[chain] = new ethers.Contract(config.registry, REGISTRY_ABI, providers[chain]);
      
      // Get registry state
      const state = await registries[chain].getState();
      console.log(`✅ ${chain}: ${state[0].numUpkeeps} upkeeps registered`);
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 50)}`);
    }
  }
}

async function checkUpkeeps(chain) {
  if (!registries[chain]) return;
  
  try {
    // Get active upkeep IDs
    const upkeepIds = await registries[chain].getActiveUpkeepIDs(0, 100);
    
    for (const id of upkeepIds) {
      stats.checked++;
      
      try {
        const result = await registries[chain].checkUpkeep(id);
        
        if (result.upkeepNeeded) {
          stats.needsUpkeep++;
          console.log(`\n🎯 ${chain} Upkeep ${id} NEEDS EXECUTION`);
          console.log(`   Gas: ${result.gasUsed} | Limit: ${result.gasLimit}`);
          
          // Note: Actually executing requires being a registered keeper
          // This monitors for opportunities
        }
      } catch {}
    }
  } catch (e) {
    // Silent fail for individual checks
  }
}

async function scanAll() {
  for (const chain of Object.keys(registries)) {
    await checkUpkeeps(chain);
  }
}

async function main() {
  await init();
  
  console.log('\n🔍 Scanning for upkeep opportunities...\n');
  
  // Initial scan
  await scanAll();
  
  // Scan every 30 seconds
  setInterval(scanAll, 30000);
  
  // Stats every 5 minutes
  setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] Checked: ${stats.checked} | Needs: ${stats.needsUpkeep} | Executed: ${stats.executed}`);
  }, 300000);
  
  process.stdin.resume();
}

main().catch(console.error);
