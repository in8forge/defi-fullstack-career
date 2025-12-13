import { JsonRpcProvider } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const rpcs = [
  { name: "Base", url: process.env.BASE_RPC_URL },
  { name: "Arbitrum", url: process.env.ARBITRUM_RPC_URL },
  { name: "Optimism", url: process.env.OPTIMISM_RPC_URL },
  { name: "Polygon", url: process.env.POLYGON_RPC_URL },
  { name: "Avalanche", url: process.env.AVALANCHE_RPC_URL }
];

async function test() {
  console.log("\n🔍 Testing RPC Connections...\n");
  
  for (const rpc of rpcs) {
    process.stdout.write(`${rpc.name}: `);
    
    if (!rpc.url) {
      console.log("❌ URL not set");
      continue;
    }
    
    try {
      const provider = new JsonRpcProvider(rpc.url);
      const block = await provider.getBlockNumber();
      console.log(`✅ Block ${block}`);
    } catch (e) {
      console.log(`❌ ${e.message.slice(0, 50)}`);
    }
  }
}

test();
