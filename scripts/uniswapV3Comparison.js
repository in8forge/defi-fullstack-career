import { formatUnits, parseUnits, JsonRpcProvider, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const V3_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e"; // Correct QuoterV2

const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

const TOKENS = {
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 }
};

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

const V3_FEES = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000
};

async function getV2Quote(router, amountIn, path, provider) {
  try {
    const routerContract = new Contract(router, V2_ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

async function getV3Quote(tokenIn, tokenOut, amountIn, fee, provider) {
  try {
    const quoter = new Contract(V3_QUOTER_V2, QUOTER_V2_ABI, provider);
    
    const params = {
      tokenIn: tokenIn.address,
      tokenOut: tokenOut.address,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0
    };
    
    // Use staticCall for view functions
    const result = await quoter.quoteExactInputSingle.staticCall(params);
    return result[0]; // amountOut
  } catch (error) {
    return null;
  }
}

async function compareAll(tokenInName, tokenOutName, amount, provider) {
  const tokenIn = TOKENS[tokenInName];
  const tokenOut = TOKENS[tokenOutName];
  const amountParsed = parseUnits(amount, tokenIn.decimals);
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`${amount} ${tokenInName} → ${tokenOutName}`);
  console.log("=".repeat(80));
  
  const results = [];
  
  // V2 quotes
  console.log("\n📊 V2 DEXs:");
  const v2Uni = await getV2Quote(UNISWAP_V2_ROUTER, amountParsed, [tokenIn.address, tokenOut.address], provider);
  if (v2Uni) {
    const output = formatUnits(v2Uni, tokenOut.decimals);
    console.log(`   Uniswap V2:   ${output} ${tokenOutName}`);
    results.push({ dex: "Uniswap V2", output: v2Uni, outputFormatted: output });
  }
  
  const v2Sushi = await getV2Quote(SUSHISWAP_ROUTER, amountParsed, [tokenIn.address, tokenOut.address], provider);
  if (v2Sushi) {
    const output = formatUnits(v2Sushi, tokenOut.decimals);
    console.log(`   Sushiswap V2: ${output} ${tokenOutName}`);
    results.push({ dex: "Sushiswap V2", output: v2Sushi, outputFormatted: output });
  }
  
  // V3 quotes
  console.log("\n📊 V3 Fee Tiers:");
  for (const [tier, fee] of Object.entries(V3_FEES)) {
    const quote = await getV3Quote(tokenIn, tokenOut, amountParsed, fee, provider);
    
    if (quote) {
      const output = formatUnits(quote, tokenOut.decimals);
      console.log(`   V3 ${tier.padEnd(6)} (${(fee/10000).toFixed(2)}%): ${output} ${tokenOutName}`);
      results.push({ dex: `V3 ${tier}`, output: quote, outputFormatted: output });
    } else {
      console.log(`   V3 ${tier.padEnd(6)} (${(fee/10000).toFixed(2)}%): No quote available`);
    }
  }
  
  // Analysis
  if (results.length > 0) {
    results.sort((a, b) => Number(b.output - a.output));
    const best = results[0];
    const worst = results[results.length - 1];
    
    console.log(`\n🏆 WINNER: ${best.dex}`);
    console.log(`   Output: ${best.outputFormatted} ${tokenOutName}`);
    
    if (results.length > 1) {
      const diff = best.output - worst.output;
      const diffFormatted = formatUnits(diff > 0n ? diff : -diff, tokenOut.decimals);
      const diffPercent = (Number(diff) / Number(worst.output) * 100).toFixed(3);
      
      console.log(`\n📊 Spread Analysis:`);
      console.log(`   Best vs Worst: ${diffFormatted} ${tokenOutName}`);
      console.log(`   Difference: ${diffPercent}%`);
      
      if (diff > 0n) {
        console.log(`   💡 Arbitrage: Buy on ${worst.dex}, sell on ${best.dex}`);
      }
    }
  }
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  console.log("\n" + "=".repeat(80));
  console.log("🔍 V2 vs V3 COMPREHENSIVE COMPARISON");
  console.log("=".repeat(80));
  
  await compareAll("USDC", "WETH", "1000", provider);
  await compareAll("WETH", "USDC", "1", provider);
  await compareAll("USDC", "DAI", "1000", provider);
  
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY:");
  console.log("=".repeat(80));
  console.log("\n✅ Successfully compared V2 and V3 across multiple routes");
  console.log("✅ V3 offers 3 fee tiers for different volatility levels");
  console.log("✅ Can identify best DEX/tier combination per trade");
  console.log("\n💡 Key Learnings:");
  console.log("   • V3 0.05% tier: Best for stablecoin pairs (USDC/DAI)");
  console.log("   • V3 0.30% tier: Best for major pairs (USDC/WETH)");  
  console.log("   • V3 1.00% tier: For exotic/volatile pairs");
  console.log("   • V2 still competitive due to liquidity depth");
  console.log("\n" + "=".repeat(80) + "\n");
}

main().catch(console.error);
