import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log("\n" + "=".repeat(80));
console.log("🤖 STARTING ALL DEFI BOTS");
console.log("=".repeat(80));
console.log(`\n⏰ Started at: ${new Date().toISOString()}\n`);

const bots = [
  { name: "🔄 Arbitrage", script: "baseAutoExecutor.js" },
  { name: "💀 Liquidation", script: "baseLiquidationBot.js" },
  { name: "🌾 LP Farming", script: "baseLPFarmingBot.js" }
];

bots.forEach(bot => {
  console.log(`Starting ${bot.name}...`);
  
  const process = spawn("node", [join(__dirname, bot.script)], {
    stdio: "inherit",
    env: { ...process.env }
  });
  
  process.on("error", (err) => {
    console.log(`❌ ${bot.name} error: ${err.message}`);
  });
  
  process.on("exit", (code) => {
    console.log(`⚠️ ${bot.name} exited with code ${code}`);
  });
});

// Keep main process alive
setInterval(() => {
  console.log(`\n[${new Date().toISOString()}] 💓 All bots running...`);
}, 300000); // Log every 5 minutes
