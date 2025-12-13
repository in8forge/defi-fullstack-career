import { formatUnits, JsonRpcProvider, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const CHAINS = [
  { name: "Base", rpc: process.env.BASE_RPC_URL, symbol: "ETH", minGas: 0.001 },
  { name: "Polygon", rpc: process.env.POLYGON_RPC_URL, symbol: "MATIC", minGas: 0.5 },
  { name: "Avalanche", rpc: process.env.AVALANCHE_RPC_URL, symbol: "AVAX", minGas: 0.05 },
  { name: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, symbol: "ETH", minGas: 0.001 },
  { name: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, symbol: "ETH", minGas: 0.001 }
];

async function main() {
  console.log("\n💰 BALANCES ACROSS ALL CHAINS\n");
  
  const wallet = new Wallet(process.env.PRIVATE_KEY);
  console.log(`Wallet: ${wallet.address}\n`);
  console.log("─".repeat(60));
  
  for (const chain of CHAINS) {
    try {
      const provider = new JsonRpcProvider(chain.rpc);
      const balance = await provider.getBalance(wallet.address);
      const formatted = Number(formatUnits(balance, 18));
      
      const status = formatted >= chain.minGas ? "✅ Ready to deploy" : "❌ Need gas";
      console.log(`${chain.name.padEnd(12)} ${formatted.toFixed(6).padStart(12)} ${chain.symbol.padEnd(6)} ${status}`);
    } catch (e) {
      console.log(`${chain.name.padEnd(12)} Error`);
    }
  }
  
  console.log("─".repeat(60));
}

main();
