import { JsonRpcProvider, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Aerodrome Factory
const FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da";
const VOTER = "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5";

const FACTORY_ABI = [
  "function allPools(uint256) view returns (address)",
  "function allPoolsLength() view returns (uint256)",
  "function getPool(address, address, bool) view returns (address)"
];

const VOTER_ABI = [
  "function gauges(address) view returns (address)"
];

const PAIR_ABI = [
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function stable() view returns (bool)",
  "function getReserves() view returns (uint256, uint256, uint256)"
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)"
];

async function main() {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  
  console.log("\n🔍 Finding Aerodrome pools on Base...\n");
  
  const factory = new Contract(FACTORY, FACTORY_ABI, provider);
  const voter = new Contract(VOTER, VOTER_ABI, provider);
  
  // Known token addresses
  const WETH = "0x4200000000000000000000000000000000000006";
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const USDbC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";
  
  // Find WETH/USDC pool
  console.log("Looking for WETH/USDC pool...");
  const wethUsdcPool = await factory.getPool(WETH, USDC, false);
  console.log(`   Pool: ${wethUsdcPool}`);
  
  if (wethUsdcPool !== "0x0000000000000000000000000000000000000000") {
    const gauge = await voter.gauges(wethUsdcPool);
    console.log(`   Gauge: ${gauge}`);
    
    const pair = new Contract(wethUsdcPool, PAIR_ABI, provider);
    const reserves = await pair.getReserves();
    console.log(`   Reserves: ${reserves[0]}, ${reserves[1]}`);
  }
  
  // Find USDC/USDbC pool
  console.log("\nLooking for USDC/USDbC pool...");
  const usdcUsdbc = await factory.getPool(USDC, USDbC, true); // stable pool
  console.log(`   Pool: ${usdcUsdbc}`);
  
  if (usdcUsdbc !== "0x0000000000000000000000000000000000000000") {
    const gauge = await voter.gauges(usdcUsdbc);
    console.log(`   Gauge: ${gauge}`);
  }
  
  // Also try volatile version
  const usdcUsdbcV = await factory.getPool(USDC, USDbC, false);
  console.log(`   Pool (volatile): ${usdcUsdbcV}`);
  
  console.log("\n✅ Use these addresses in your config!");
}

main().catch(console.error);
