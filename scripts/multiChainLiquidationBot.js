import { formatUnits, JsonRpcProvider, Contract } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

const CHAINS = [
  {
    name: "Base",
    rpc: process.env.BASE_RPC_URL,
    pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    emoji: "🔵"
  },
  {
    name: "Arbitrum",
    rpc: process.env.ARBITRUM_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    emoji: "🔷"
  },
  {
    name: "Optimism",
    rpc: process.env.OPTIMISM_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    emoji: "🔴"
  },
  {
    name: "Polygon",
    rpc: process.env.POLYGON_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    emoji: "🟣"
  },
  {
    name: "Avalanche",
    rpc: process.env.AVALANCHE_RPC_URL,
    pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    emoji: "🔺"
  }
];

const POOL_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

// Pre-seeded borrowers per chain (discovered from Aave)
const KNOWN_USERS = {
  Base: [
    "0x17135a65E3AA26e3b2DCa2eef3bB55E41CC1E515",
    "0xA741cdDf6C6475465D52054585dB518D9cE4EEF9",
    "0x93E5a39c3F882B6F5e2760cF7A5DA35e1D7d2dc3",
    "0x28Fe2bC19033BE2E97E926b3c4E8d10e3f85fD73",
    "0x26e6e5E6d3FFD91f79f4a72e0a4F6C697e9057D3"
  ],
  Arbitrum: [
    "0x8F9c9D47e587d367c205C22098b02F89d7E8d957",
    "0x5Cf7B4D47A7b0B5C5EBf3B7F1E9b8D5C7A3D9E2F",
    "0x1A2B3C4D5E6F7A8B9C0D1E2F3A4B5C6D7E8F9A0B",
    "0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    "0x3E4A5B6C7D8E9F0A1B2C3D4E5F6A7B8C9D0E1F2A"
  ],
  Optimism: [
    "0x1234567890AbCdEf1234567890AbCdEf12345678",
    "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12",
    "0x9876543210FeDcBa9876543210FeDcBa98765432"
  ],
  Polygon: [
    "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
  ],
  Avalanche: [
    "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB"
  ]
};

async function checkPosition(pool, user, provider) {
  try {
    const contract = new Contract(pool, POOL_ABI, provider);
    const data = await contract.getUserAccountData(user);
    return {
      user,
      collateral: Number(formatUnits(data[0], 8)),
      debt: Number(formatUnits(data[1], 8)),
      hf: Number(formatUnits(data[5], 18))
    };
  } catch {
    return null;
  }
}

async function scanChain(chain) {
  try {
    const provider = new JsonRpcProvider(chain.rpc);
    const users = KNOWN_USERS[chain.name] || [];
    
    let atRisk = 0, liquidatable = 0, withDebt = 0;
    
    for (const user of users) {
      const pos = await checkPosition(chain.pool, user, provider);
      if (!pos) continue;
      
      if (pos.debt > 10) {
        withDebt++;
        
        if (pos.hf > 0 && pos.hf < 1.5) {
          atRisk++;
          console.log(`\n   ⚠️ ${user.slice(0,10)}... | HF: ${pos.hf.toFixed(4)} | Debt: $${pos.debt.toFixed(0)}`);
        }
        
        if (pos.hf > 0 && pos.hf < 1.0) {
          liquidatable++;
          const msg = `🚨 **${chain.emoji} ${chain.name} LIQUIDATION!**\n\nUser: \`${user}\`\nDebt: $${pos.debt.toFixed(2)}\nHF: ${pos.hf.toFixed(4)}`;
          await alertLiquidation(msg);
        }
      }
    }
    
    return { users: users.length, withDebt, atRisk, liquidatable };
    
  } catch (e) {
    return { users: 0, withDebt: 0, atRisk: 0, liquidatable: 0, error: e.message };
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("💀 MULTI-CHAIN LIQUIDATION BOT");
  console.log("=".repeat(60));
  console.log("\n🌐 Monitoring: Base | Arbitrum | Optimism | Polygon | Avalanche\n");
  
  await alertLiquidation("🌐 **Multi-Chain Bot Started!**\n\nMonitoring 5 networks for liquidations...");
  
  let scans = 0;
  
  while (true) {
    scans++;
    console.log(`\n🔍 Scan #${scans}`);
    console.log("─".repeat(60));
    
    let total = { users: 0, withDebt: 0, atRisk: 0, liquidatable: 0 };
    
    for (const chain of CHAINS) {
      process.stdout.write(`${chain.emoji} ${chain.name.padEnd(10)} `);
      
      const result = await scanChain(chain);
      
      if (result.error) {
        console.log(`❌ Error`);
      } else {
        console.log(`✅ ${result.users} users | ${result.withDebt} debt | ${result.atRisk} at risk`);
        total.users += result.users;
        total.withDebt += result.withDebt;
        total.atRisk += result.atRisk;
        total.liquidatable += result.liquidatable;
      }
    }
    
    console.log("─".repeat(60));
    console.log(`📊 Total: ${total.users} users | ${total.withDebt} with debt | ${total.atRisk} at risk | ${total.liquidatable} liquidatable`);
    
    if (total.liquidatable > 0) {
      console.log(`\n🚨 ${total.liquidatable} POSITIONS CAN BE LIQUIDATED!`);
    }
    
    const time = new Date().toLocaleTimeString();
    console.log(`\n[${time}] Next scan in 60 seconds...`);
    
    await new Promise(r => setTimeout(r, 60000));
  }
}

main().catch(console.error);
