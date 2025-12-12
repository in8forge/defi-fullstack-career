import { formatUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

const AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const POOL_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);

const USERS_TO_MONITOR = [
  "0x17135a65E3AA26e3b2DCa2eef3bB55E41CC1E515",
  "0xA741cdDf6C6475465D52054585dB518D9cE4EEF9",
  "0x93E5a39c3F882B6F5e2760cF7A5DA35e1D7d2dc3",
  "0x28Fe2bC19033BE2E97E926b3c4E8d10e3f85fD73",
  "0x26e6e5E6d3FFD91f79f4a72e0a4F6C697e9057D3"
];

async function checkPositions() {
  const pool = new Contract(AAVE_POOL, POOL_ABI, provider);
  const atRisk = [];
  
  for (const user of USERS_TO_MONITOR) {
    try {
      const data = await pool.getUserAccountData(user);
      const totalDebt = Number(formatUnits(data[1], 8));
      const healthFactor = Number(formatUnits(data[5], 18));
      
      if (totalDebt > 0 && healthFactor < 1.5) {
        atRisk.push({ user, debt: totalDebt, hf: healthFactor });
      }
      
      // LIQUIDATABLE!
      if (healthFactor > 0 && healthFactor < 1.0) {
        const msg = `**🚨 LIQUIDATABLE POSITION!**\n\nUser: \`${user.slice(0,10)}...\`\nDebt: $${totalDebt.toFixed(2)}\nHealth Factor: ${healthFactor.toFixed(4)}`;
        await alertLiquidation(msg);
      }
    } catch {}
  }
  
  return atRisk;
}

async function main() {
  console.log("\n💀 LIQUIDATION BOT WITH DISCORD ALERTS");
  console.log("=======================================\n");
  
  await alertLiquidation("Bot started! Monitoring 5 at-risk positions...");
  
  let checks = 0;
  
  while (true) {
    try {
      checks++;
      const atRisk = await checkPositions();
      
      if (checks % 10 === 0) {
        console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] Checks: ${checks} | At Risk: ${atRisk.length}`);
      }
      
      await new Promise(r => setTimeout(r, 60000));
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

main().catch(console.error);
