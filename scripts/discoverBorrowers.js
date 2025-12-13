import { formatUnits, JsonRpcProvider, Contract } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const CHAINS = [
  { name: "Base", rpc: process.env.BASE_RPC_URL, pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" },
  { name: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  { name: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  { name: "Polygon", rpc: process.env.POLYGON_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  { name: "Avalanche", rpc: process.env.AVALANCHE_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" }
];

const POOL_ABI = [
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

async function discoverChain(chain) {
  console.log(`\n🔍 ${chain.name}:`);
  
  try {
    const provider = new JsonRpcProvider(chain.rpc);
    const pool = new Contract(chain.pool, POOL_ABI, provider);
    
    const currentBlock = await provider.getBlockNumber();
    console.log(`   Current block: ${currentBlock}`);
    
    // Query last 10,000 blocks in chunks of 2,000
    const allUsers = new Set();
    const chunkSize = 2000;
    const totalBlocks = 10000;
    
    for (let i = 0; i < totalBlocks; i += chunkSize) {
      const fromBlock = currentBlock - totalBlocks + i;
      const toBlock = fromBlock + chunkSize - 1;
      
      process.stdout.write(`   Scanning blocks ${fromBlock}-${toBlock}... `);
      
      try {
        const events = await pool.queryFilter(pool.filters.Borrow(), fromBlock, toBlock);
        
        for (const event of events) {
          if (event.args?.user) allUsers.add(event.args.user);
          if (event.args?.onBehalfOf) allUsers.add(event.args.onBehalfOf);
        }
        
        console.log(`${events.length} borrows`);
      } catch (e) {
        console.log(`error: ${e.message.slice(0, 30)}`);
      }
    }
    
    console.log(`   ✅ Found ${allUsers.size} unique borrowers`);
    
    // Check which ones have active debt
    const activeUsers = [];
    let checked = 0;
    
    for (const user of allUsers) {
      try {
        const data = await pool.getUserAccountData(user);
        const debt = Number(formatUnits(data[1], 8));
        const hf = Number(formatUnits(data[5], 18));
        
        if (debt > 100) {
          activeUsers.push({ user, debt, hf });
          console.log(`   💰 ${user.slice(0,10)}... | Debt: $${debt.toFixed(0)} | HF: ${hf.toFixed(2)}`);
        }
        
        checked++;
        if (checked % 10 === 0) process.stdout.write(`   Checked ${checked}/${allUsers.size}\r`);
      } catch {}
    }
    
    console.log(`   ✅ ${activeUsers.length} users with active debt > $100`);
    
    return activeUsers;
    
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 50)}`);
    return [];
  }
}

async function main() {
  console.log("🔍 DISCOVERING BORROWERS WITH PAID ALCHEMY PLAN\n");
  console.log("Scanning last 10,000 blocks on each chain...\n");
  
  const allBorrowers = {};
  
  for (const chain of CHAINS) {
    const users = await discoverChain(chain);
    allBorrowers[chain.name] = users;
  }
  
  // Save to file
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync("./data/borrowers.json", JSON.stringify(allBorrowers, null, 2));
  
  console.log("\n" + "=".repeat(60));
  console.log("📊 DISCOVERY COMPLETE:\n");
  
  let totalUsers = 0;
  let totalDebt = 0;
  let atRisk = 0;
  
  for (const [chain, users] of Object.entries(allBorrowers)) {
    const chainDebt = users.reduce((sum, u) => sum + u.debt, 0);
    const chainAtRisk = users.filter(u => u.hf < 1.5).length;
    
    console.log(`   ${chain}: ${users.length} borrowers | $${chainDebt.toFixed(0)} debt | ${chainAtRisk} at risk`);
    
    totalUsers += users.length;
    totalDebt += chainDebt;
    atRisk += chainAtRisk;
  }
  
  console.log("\n   ─────────────────────────────────────");
  console.log(`   TOTAL: ${totalUsers} borrowers | $${totalDebt.toFixed(0)} debt | ${atRisk} at risk`);
  console.log("\n✅ Saved to ./data/borrowers.json");
}

main();
