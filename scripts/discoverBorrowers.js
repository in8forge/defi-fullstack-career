import { formatUnits, JsonRpcProvider, Contract } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Aave V3 Pool Data Provider - gets all users with positions
const CHAINS = [
  { 
    name: "Base", 
    rpc: process.env.BASE_RPC_URL, 
    pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    dataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac"
  },
  { 
    name: "Arbitrum", 
    rpc: process.env.ARBITRUM_RPC_URL, 
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    dataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654"
  },
  { 
    name: "Optimism", 
    rpc: process.env.OPTIMISM_RPC_URL, 
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    dataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654"
  },
  { 
    name: "Polygon", 
    rpc: process.env.POLYGON_RPC_URL, 
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    dataProvider: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654"
  }
];

const POOL_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

// Generate random addresses to scan (brute force approach)
function generateAddresses(count) {
  const addresses = [];
  // Known DeFi power users / whales
  const knownWhales = [
    "0x0000000000000000000000000000000000000001",
    "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", // vitalik.eth
    "0x28C6c06298d514Db089934071355E5743bf21d60", // Binance
    "0xDef1C0ded9bec7F1a1670819833240f027b25EfF", // 0x
    "0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503", // Binance 8
  ];
  return knownWhales;
}

async function scanForBorrowers(chain) {
  console.log(`\n${chain.name}:`);
  
  try {
    const provider = new JsonRpcProvider(chain.rpc);
    const pool = new Contract(chain.pool, POOL_ABI, provider);
    
    // First, let's check current block to confirm connection
    const block = await provider.getBlockNumber();
    console.log(`   Connected at block ${block}`);
    
    // Try to get transfer events from aTokens (people who received debt tokens)
    const aTokenABI = [
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ];
    
    // USDC debt token addresses
    const debtTokens = {
      Base: "0x0000000000000000000000000000000000000000", 
      Arbitrum: "0x92b42c66840C7AD907b4BF74879FF3eF7c529473",
      Optimism: "0x307ffe186F84a3bc2613D1eA417A5737D69A7007",
      Polygon: "0x307ffe186F84a3bc2613D1eA417A5737D69A7007"
    };
    
    // Alternative: Check random addresses for debt
    console.log(`   Scanning for users with debt...`);
    
    const foundUsers = [];
    const testAddresses = generateAddresses(5);
    
    for (const addr of testAddresses) {
      try {
        const data = await pool.getUserAccountData(addr);
        const debt = Number(formatUnits(data[1], 8));
        
        if (debt > 100) {
          const hf = Number(formatUnits(data[5], 18));
          foundUsers.push({ user: addr, debt, hf });
          console.log(`   ✅ ${addr.slice(0,10)}... | $${debt.toFixed(0)} debt | HF: ${hf.toFixed(2)}`);
        }
      } catch {}
    }
    
    console.log(`   Found ${foundUsers.length} borrowers`);
    return foundUsers;
    
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 50)}`);
    return [];
  }
}

async function main() {
  console.log("🔍 SCANNING FOR AAVE BORROWERS\n");
  console.log("Note: Finding borrowers requires event indexing or known addresses.");
  console.log("For production, use Aave's subgraph or a paid indexer.\n");
  
  const results = {};
  
  for (const chain of CHAINS) {
    const users = await scanForBorrowers(chain);
    results[chain.name] = users.map(u => u.user);
  }
  
  // Save results
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync("./data/borrowers.json", JSON.stringify(results, null, 2));
  
  console.log("\n" + "=".repeat(50));
  console.log("\n💡 RECOMMENDATION:");
  console.log("   To get real borrowers, you need either:");
  console.log("   1. Paid Alchemy plan (event queries)");
  console.log("   2. The Graph API key (subgraph queries)");
  console.log("   3. Run your own node");
  console.log("\n   For now, your bot will alert you during market crashes");
  console.log("   when liquidations spike and become visible on-chain.");
}

main();
