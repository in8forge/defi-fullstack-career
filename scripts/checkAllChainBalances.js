import { formatUnits, JsonRpcProvider, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const CHAINS = [
  { name: "Base", rpc: process.env.BASE_RPC_URL, symbol: "ETH" },
  { name: "Polygon", rpc: process.env.POLYGON_RPC_URL, symbol: "MATIC" },
  { name: "Avalanche", rpc: process.env.AVALANCHE_RPC_URL, symbol: "AVAX" },
  { name: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, symbol: "ETH" },
  { name: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, symbol: "ETH" }
];

async function main() {
  console.log("\n💰 BALANCES ACROSS ALL CHAINS\n");
  
  const wallet = new Wallet(process.env.PRIVATE_KEY);
  console.log(`Wallet: ${wallet.address}\n`);
  console.log("─".repeat(50));
  
  for (const chain of CHAINS) {
    try {
      const provider = new JsonRpcProvider(chain.rpc);
      const balance = await provider.getBalance(wallet.address);
      const formatted = Number(formatUnits(balance, 18)).toFixed(6);
      
      const status = Number(formatted) > 0.01 ? "✅" : "❌ Need gas";
      console.log(`${chain.name.padEnd(12)} ${formatted.padStart(12)} ${chain.symbol}  ${status}`);
    } catch (e) {
      console.log(`${chain.name.padEnd(12)} Error: ${e.message.slice(0, 30)}`);
    }
  }
  
  console.log("─".repeat(50));
  console.log("\n💡 To deploy liquidators, you need gas on each chain.");
  console.log("   Bridge from Base or buy on exchange.\n");
}

main();
