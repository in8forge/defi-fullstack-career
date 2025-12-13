import { formatUnits, JsonRpcProvider, Contract } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const AAVE_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

const CHAINS = {
  Base: { rpc: process.env.BASE_RPC_URL, pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5" },
  Polygon: { rpc: process.env.POLYGON_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" },
  Avalanche: { rpc: process.env.AVALANCHE_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD" }
};

// Most critical positions from discovery
const CRITICAL = [
  { chain: "Polygon", user: "0x25b039B7" },
  { chain: "Polygon", user: "0x21CFe08c" },
  { chain: "Base", user: "0x6Fa5f575" },
  { chain: "Avalanche", user: "0xE21afe52" },
  { chain: "Base", user: "0xC4C00d8b" },
];

async function main() {
  console.log("\n🔍 CHECKING CRITICAL POSITIONS\n");
  
  const borrowers = JSON.parse(fs.readFileSync('./data/borrowers.json', 'utf8'));
  
  // Find all positions with HF < 1.1
  const critical = [];
  
  for (const [chain, users] of Object.entries(borrowers)) {
    const config = CHAINS[chain];
    if (!config) continue;
    
    const provider = new JsonRpcProvider(config.rpc);
    const pool = new Contract(config.pool, AAVE_ABI, provider);
    
    for (const userData of users) {
      try {
        const data = await pool.getUserAccountData(userData.user);
        const debt = Number(formatUnits(data[1], 8));
        const hf = Number(formatUnits(data[5], 18));
        
        if (hf > 0 && hf < 1.1 && debt > 100) {
          critical.push({ chain, user: userData.user, debt, hf });
        }
      } catch {}
    }
  }
  
  // Sort by health factor
  critical.sort((a, b) => a.hf - b.hf);
  
  console.log("🚨 POSITIONS CLOSEST TO LIQUIDATION (HF < 1.1):\n");
  console.log("─".repeat(70));
  
  for (const p of critical) {
    const status = p.hf < 1.0 ? "🔴 LIQUIDATABLE" : "🟡 CRITICAL";
    const profit = (p.debt * 0.05).toFixed(0);
    console.log(`${status} | ${p.chain.padEnd(10)} | ${p.user.slice(0,12)}... | $${p.debt.toLocaleString().padStart(12)} | HF: ${p.hf.toFixed(4)} | Profit: $${profit}`);
  }
  
  console.log("─".repeat(70));
  console.log(`\nTotal critical: ${critical.length}`);
  console.log(`Total potential profit: $${critical.reduce((sum, p) => sum + p.debt * 0.05, 0).toLocaleString()}`);
}

main();
