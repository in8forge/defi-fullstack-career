import { formatUnits, parseUnits, JsonRpcProvider, Interface, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Token addresses
const TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7"
};

const DECIMALS = {
  USDC: 6,
  WETH: 18,
  DAI: 18,
  USDT: 6
};

// Routers
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const UNISWAP_V3_QUOTER = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6"; // QuoterV2
const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

// Uniswap V3 fee tiers (in basis points)
const V3_FEES = {
  LOW: 500,      // 0.05%
  MEDIUM: 3000,  // 0.3%
  HIGH: 10000    // 1%
};

// ABI for Uniswap V3 QuoterV2
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle(tuple(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

// ABI for V2 routers
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

async function getV3Quote(amountIn, tokenIn, tokenOut, fee, provider) {
  try {
    const quoter = new Contract(UNISWAP_V3_QUOTER, QUOTER_V2_ABI, provider);
    
    const params = {
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0
    };
    
    const result = await quoter.quoteExactInputSingle.staticCall(params);
    return result[0]; // amountOut
  } catch (error) {
    return null;
  }
}

async function compareV2vsV3(tokenIn, tokenOut, amount, provider) {
  const tokenInName = Object.keys(TOKENS).find(k => TOKENS[k] === tokenIn);
  const tokenOutName = Object.keys(TOKENS).find(k => TOKENS[k] === tokenOut);
  const amountParsed = parseUnits(amount, DECIMALS[tokenInName]);
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`COMPARING: ${amount} ${tokenInName} → ${tokenOutName}`);
  console.log("=".repeat(80));
  
  // Get V2 quotes
  console.log("\n📊 Uniswap V2:");
  const v2UniQuote = await getV2Quote(UNISWAP_V2_ROUTER, amountParsed, [tokenIn, tokenOut], provider);
  if (v2UniQuote) {
    console.log(`   Output: ${formatUnits(v2UniQuote, DECIMALS[tokenOutName])} ${tokenOutName}`);
  } else {
    console.log(`   No liquidity`);
  }
  
  console.log("\n📊 Sushiswap V2:");
  const v2SushiQuote = await getV2Quote(SUSHISWAP_ROUTER, amountParsed, [tokenIn, tokenOut], provider);
  if (v2SushiQuote) {
    console.log(`   Output: ${formatUnits(v2SushiQuote, DECIMALS[tokenOutName])} ${tokenOutName}`);
  } else {
    console.log(`   No liquidity`);
  }
  
  // Get V3 quotes for all fee tiers
  console.log("\n📊 Uniswap V3:");
  const v3Quotes = {};
  
  for (const [tier, fee] of Object.entries(V3_FEES)) {
    const quote = await getV3Quote(amountParsed, tokenIn, tokenOut, fee, provider);
    v3Quotes[tier] = quote;
    
    if (quote) {
      const output = formatUnits(quote, DECIMALS[tokenOutName]);
      console.log(`   ${tier.padEnd(8)} (${(fee/10000).toFixed(2)}%): ${output} ${tokenOutName}`);
    } else {
      console.log(`   ${tier.padEnd(8)} (${(fee/10000).toFixed(2)}%): No liquidity`);
    }
  }
  
  // Find best option
  console.log("\n🏆 WINNER:");
  const allQuotes = [
    { name: "Uniswap V2", quote: v2UniQuote },
    { name: "Sushiswap V2", quote: v2SushiQuote },
    { name: "Uniswap V3 LOW", quote: v3Quotes.LOW },
    { name: "Uniswap V3 MEDIUM", quote: v3Quotes.MEDIUM },
    { name: "Uniswap V3 HIGH", quote: v3Quotes.HIGH }
  ].filter(q => q.quote !== null);
  
  if (allQuotes.length === 0) {
    console.log("   No liquidity on any DEX");
    return;
  }
  
  allQuotes.sort((a, b) => Number(b.quote - a.quote));
  const winner = allQuotes[0];
  const winnerOutput = formatUnits(winner.quote, DECIMALS[tokenOutName]);
  
  console.log(`   ${winner.name}: ${winnerOutput} ${tokenOutName}`);
  
  // Calculate improvement over V2
  const v2Best = v2UniQuote && v2SushiQuote 
    ? (v2UniQuote > v2SushiQuote ? v2UniQuote : v2SushiQuote)
    : (v2UniQuote || v2SushiQuote);
    
  if (v2Best && winner.quote > v2Best) {
    const improvement = ((Number(winner.quote - v2Best) / Number(v2Best)) * 100).toFixed(3);
    const improvementUSDC = formatUnits(winner.quote - v2Best, DECIMALS[tokenOutName]);
    console.log(`   Improvement over V2: +${improvement}% (+${improvementUSDC} ${tokenOutName})`);
  }
}

async function findV3Arbitrage(provider) {
  console.log("\n" + "=".repeat(80));
  console.log("🔍 SEARCHING FOR V2 vs V3 ARBITRAGE OPPORTUNITIES");
  console.log("=".repeat(80));
  
  const amount = "1000";
  const routes = [
    { from: TOKENS.USDC, to: TOKENS.WETH },
    { from: TOKENS.WETH, to: TOKENS.USDC },
    { from: TOKENS.USDC, to: TOKENS.DAI },
    { from: TOKENS.DAI, to: TOKENS.USDC },
    { from: TOKENS.WETH, to: TOKENS.DAI },
    { from: TOKENS.DAI, to: TOKENS.WETH }
  ];
  
  for (const route of routes) {
    await compareV2vsV3(route.from, route.to, amount, provider);
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("KEY INSIGHTS:");
  console.log("=".repeat(80));
  console.log("\n1. V3 typically has BETTER prices than V2 due to concentrated liquidity");
  console.log("2. V3 LOW fee tier (0.05%) best for stablecoin pairs (USDC/DAI)");
  console.log("3. V3 MEDIUM fee tier (0.3%) best for ETH pairs");
  console.log("4. V3 HIGH fee tier (1%) for exotic/volatile pairs");
  console.log("\n5. Arbitrage strategy: Buy on V2, sell on V3 (if V3 price is higher)");
  console.log("6. Or: Buy on V3 low-fee tier, sell on V2/V3 high-fee tier");
  console.log("\n" + "=".repeat(80) + "\n");
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  await findV3Arbitrage(provider);
}

main().catch(console.error);
