import { formatUnits, parseUnits, JsonRpcProvider, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const V3_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

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

const V3_FEES = [500, 3000, 10000];
const FEE_NAMES = { 500: "0.05%", 3000: "0.30%", 10000: "1.00%" };

async function getV2Quote(amountIn, path, provider) {
  try {
    const router = new Contract(UNISWAP_V2_ROUTER, V2_ROUTER_ABI, provider);
    const amounts = await router.getAmountsOut(amountIn, path);
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
    const result = await quoter.quoteExactInputSingle.staticCall(params);
    return result[0];
  } catch {
    return null;
  }
}

async function findCrossTierArbitrage(tokenA, tokenB, amount, provider) {
  const amountParsed = parseUnits(amount, tokenA.decimals);
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`CROSS-TIER ARBITRAGE: ${amount} ${Object.keys(TOKENS).find(k => TOKENS[k] === tokenA)} ⇄ ${Object.keys(TOKENS).find(k => TOKENS[k] === tokenB)}`);
  console.log("=".repeat(80));
  
  const opportunities = [];
  
  // Try all combinations
  for (const buyFee of V3_FEES) {
    for (const sellFee of V3_FEES) {
      if (buyFee === sellFee) continue; // Skip same tier
      
      // Buy tokenB with tokenA on buyFee tier
      const buyQuote = await getV3Quote(tokenA, tokenB, amountParsed, buyFee, provider);
      if (!buyQuote) continue;
      
      // Sell tokenB back for tokenA on sellFee tier
      const sellQuote = await getV3Quote(tokenB, tokenA, buyQuote, sellFee, provider);
      if (!sellQuote) continue;
      
      const profit = sellQuote - amountParsed;
      const profitFormatted = formatUnits(profit > 0n ? profit : -profit, tokenA.decimals);
      const roi = (Number(profit) / Number(amountParsed)) * 100;
      
      opportunities.push({
        buyFee,
        sellFee,
        buyQuote,
        sellQuote,
        profit,
        profitFormatted,
        roi,
        profitable: profit > 0n
      });
    }
  }
  
  // Sort by profit
  opportunities.sort((a, b) => Number(b.profit - a.profit));
  
  // Display results
  const tokenAName = Object.keys(TOKENS).find(k => TOKENS[k] === tokenA);
  const tokenBName = Object.keys(TOKENS).find(k => TOKENS[k] === tokenB);
  
  console.log("\n📊 ALL V3 CROSS-TIER COMBINATIONS:\n");
  opportunities.forEach((opp, i) => {
    const status = opp.profitable ? "✅ PROFIT" : "❌ LOSS";
    const sign = opp.profit >= 0n ? "+" : "";
    
    console.log(`${i + 1}. ${status}`);
    console.log(`   Buy ${tokenBName} on ${FEE_NAMES[opp.buyFee]} tier`);
    console.log(`   Sell ${tokenBName} on ${FEE_NAMES[opp.sellFee]} tier`);
    console.log(`   Net: ${sign}${opp.profitFormatted} ${tokenAName} (${opp.roi.toFixed(3)}% ROI)\n`);
  });
  
  // Show best opportunity
  const best = opportunities[0];
  if (best && best.profitable) {
    console.log("💰 BEST OPPORTUNITY:");
    console.log(`   Strategy: Buy on ${FEE_NAMES[best.buyFee]}, sell on ${FEE_NAMES[best.sellFee]}`);
    console.log(`   Profit: +${best.profitFormatted} ${tokenAName}`);
    console.log(`   ROI: ${best.roi.toFixed(3)}%`);
    console.log(`   \n   Why it works:`);
    console.log(`   • Lower fee tier has tighter spread (better execution)`);
    console.log(`   • Price difference between tiers > fee difference`);
  }
  
  return opportunities.filter(o => o.profitable);
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  console.log("\n" + "=".repeat(80));
  console.log("🔍 UNISWAP V3 CROSS-TIER ARBITRAGE FINDER");
  console.log("=".repeat(80));
  console.log("\nStrategy: Exploit price differences between V3 fee tiers");
  console.log("Example: Buy WETH on 1% tier (cheaper), sell on 0.05% tier (expensive)\n");
  
  const profitableOpps = [];
  
  // Check USDC/WETH
  const usdcWeth = await findCrossTierArbitrage(TOKENS.USDC, TOKENS.WETH, "1000", provider);
  profitableOpps.push(...usdcWeth);
  
  // Check WETH/USDC
  const wethUsdc = await findCrossTierArbitrage(TOKENS.WETH, TOKENS.USDC, "1", provider);
  profitableOpps.push(...wethUsdc);
  
  // Check USDC/DAI
  const usdcDai = await findCrossTierArbitrage(TOKENS.USDC, TOKENS.DAI, "1000", provider);
  profitableOpps.push(...usdcDai);
  
  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY:");
  console.log("=".repeat(80));
  console.log(`\nTotal profitable opportunities found: ${profitableOpps.length}`);
  
  if (profitableOpps.length > 0) {
    console.log("\n✅ Cross-tier arbitrage IS possible on V3!");
    console.log("\n💡 Why this works:");
    console.log("   • Different fee tiers attract different traders");
    console.log("   • Low-fee tiers: High-volume, tight spreads");
    console.log("   • High-fee tiers: Low liquidity, wider spreads");
    console.log("   • Price discrepancies create arbitrage windows");
  } else {
    console.log("\n⚠️  No profitable cross-tier arbitrage found");
    console.log("   Markets are efficiently arbitraged between tiers");
  }
  
  console.log("\n" + "=".repeat(80) + "\n");
}

main().catch(console.error);
