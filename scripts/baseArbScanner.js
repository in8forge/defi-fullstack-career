import { formatUnits, parseUnits, JsonRpcProvider, Contract } from "ethers";
import { BASE_CONFIG } from "../config/base.config.js";
import dotenv from "dotenv";

dotenv.config();

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

async function getV2Quote(router, amountIn, path, provider) {
  try {
    const routerContract = new Contract(router, V2_ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

async function scanBasePairs(provider) {
  console.log("\n" + "=".repeat(80));
  console.log("🔵 BASE NETWORK ARBITRAGE SCANNER");
  console.log("=".repeat(80));
  console.log(`RPC: ${BASE_CONFIG.rpcUrl}`);
  console.log(`Chain ID: ${BASE_CONFIG.chainId}\n`);
  
  // Test with USDC → WETH → USDC
  const USDC = BASE_CONFIG.tokens.USDC;
  const WETH = BASE_CONFIG.tokens.WETH;
  const amount = parseUnits("100", 6); // 100 USDC
  
  console.log("Testing: 100 USDC → WETH → USDC\n");
  
  // Path 1: Uniswap V2
  console.log("1. Uniswap V2 on Base:");
  const uniV2Quote1 = await getV2Quote(
    BASE_CONFIG.dexes.UNISWAP_V2.router,
    amount,
    [USDC, WETH],
    provider
  );
  
  if (uniV2Quote1) {
    const uniV2Quote2 = await getV2Quote(
      BASE_CONFIG.dexes.UNISWAP_V2.router,
      uniV2Quote1,
      [WETH, USDC],
      provider
    );
    console.log(`   USDC → WETH: ${formatUnits(uniV2Quote1, 18)} WETH`);
    console.log(`   WETH → USDC: ${formatUnits(uniV2Quote2, 6)} USDC`);
    console.log(`   Net: ${formatUnits(uniV2Quote2 - amount, 6)} USDC`);
  } else {
    console.log("   No liquidity");
  }
  
  // Path 2: Aerodrome (Base's native DEX)
  console.log("\n2. Aerodrome on Base:");
  const aeroQuote1 = await getV2Quote(
    BASE_CONFIG.dexes.AERODROME.router,
    amount,
    [USDC, WETH],
    provider
  );
  
  if (aeroQuote1) {
    const aeroQuote2 = await getV2Quote(
      BASE_CONFIG.dexes.AERODROME.router,
      aeroQuote1,
      [WETH, USDC],
      provider
    );
    console.log(`   USDC → WETH: ${formatUnits(aeroQuote1, 18)} WETH`);
    console.log(`   WETH → USDC: ${formatUnits(aeroQuote2, 6)} USDC`);
    console.log(`   Net: ${formatUnits(aeroQuote2 - amount, 6)} USDC`);
  } else {
    console.log("   No liquidity");
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("💡 Next: Find arbitrage between Uniswap V2 ↔ Aerodrome");
  console.log("=".repeat(80) + "\n");
}

async function main() {
  const provider = new JsonRpcProvider(BASE_CONFIG.rpcUrl);
  
  // Test connection
  try {
    const network = await provider.getNetwork();
    console.log(`\n✅ Connected to Base (Chain ID: ${network.chainId})`);
  } catch (error) {
    console.log(`\n❌ Connection failed: ${error.message}`);
    console.log("\n💡 You need a Base RPC URL. Get one free from:");
    console.log("   • https://www.alchemy.com (create Base app)");
    console.log("   • https://www.quicknode.com");
    console.log("   • Public: https://mainnet.base.org (rate limited)\n");
    return;
  }
  
  await scanBasePairs(provider);
}

main().catch(console.error);
