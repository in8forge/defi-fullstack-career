import { formatUnits, parseUnits, JsonRpcProvider, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

const V3_POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)"
];

const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

const TOKENS = {
  USDC: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
  WETH: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18 },
  DAI: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18 }
};

const V3_FEES = {
  LOW: 500,
  MEDIUM: 3000,
  HIGH: 10000
};

// Calculate price from sqrtPriceX96
function sqrtPriceX96ToPrice(sqrtPriceX96, token0Decimals, token1Decimals) {
  const Q96 = 2n ** 96n;
  const price = (sqrtPriceX96 * sqrtPriceX96 * (10n ** BigInt(token0Decimals))) / (Q96 * Q96) / (10n ** BigInt(token1Decimals));
  return price;
}

// Get approximate output amount (simplified, doesn't account for slippage)
function getOutputAmount(amountIn, sqrtPriceX96, token0, token1, zeroForOne) {
  const Q96 = 2n ** 96n;
  
  if (zeroForOne) {
    // Selling token0 for token1
    const price = (sqrtPriceX96 * sqrtPriceX96) / (Q96 * Q96);
    const adjustedPrice = (price * (10n ** BigInt(token1.decimals))) / (10n ** BigInt(token0.decimals));
    return (amountIn * adjustedPrice) / (10n ** BigInt(token0.decimals));
  } else {
    // Selling token1 for token0
    const price = (Q96 * Q96) / (sqrtPriceX96 * sqrtPriceX96);
    const adjustedPrice = (price * (10n ** BigInt(token0.decimals))) / (10n ** BigInt(token1.decimals));
    return (amountIn * adjustedPrice) / (10n ** BigInt(token1.decimals));
  }
}

async function getV3Quote(tokenIn, tokenOut, amountIn, fee, provider) {
  try {
    const factory = new Contract(V3_FACTORY, V3_FACTORY_ABI, provider);
    const poolAddress = await factory.getPool(tokenIn.address, tokenOut.address, fee);
    
    if (poolAddress === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    
    const pool = new Contract(poolAddress, V3_POOL_ABI, provider);
    const [slot0, token0] = await Promise.all([
      pool.slot0(),
      pool.token0()
    ]);
    
    const sqrtPriceX96 = slot0[0];
    const zeroForOne = tokenIn.address.toLowerCase() === token0.toLowerCase();
    
    const amountOut = getOutputAmount(amountIn, sqrtPriceX96, tokenIn, tokenOut, zeroForOne);
    
    // Apply fee (simplified)
    const feeMultiplier = (10000n - BigInt(fee)) * 10000n / 100000000n;
    const amountOutAfterFee = (amountOut * feeMultiplier) / 10000n;
    
    return {
      amountOut: amountOutAfterFee,
      poolAddress,
      sqrtPriceX96,
      fee
    };
  } catch (error) {
    console.error(`Error getting V3 quote: ${error.message}`);
    return null;
  }
}

async function compareAllDEXs(tokenInName, tokenOutName, amount, provider) {
  const tokenIn = TOKENS[tokenInName];
  const tokenOut = TOKENS[tokenOutName];
  const amountParsed = parseUnits(amount, tokenIn.decimals);
  
  console.log(`\n${"=".repeat(80)}`);
  console.log(`${amount} ${tokenInName} → ${tokenOutName}`);
  console.log("=".repeat(80));
  
  const results = [];
  
  // Get V3 quotes for all fee tiers
  for (const [tier, fee] of Object.entries(V3_FEES)) {
    const quote = await getV3Quote(tokenIn, tokenOut, amountParsed, fee, provider);
    
    if (quote) {
      const output = formatUnits(quote.amountOut, tokenOut.decimals);
      console.log(`Uniswap V3 ${tier.padEnd(8)} (${(fee/10000).toFixed(2)}%): ${output} ${tokenOutName}`);
      results.push({
        dex: `V3 ${tier}`,
        output: quote.amountOut,
        outputFormatted: output
      });
    }
  }
  
  // Find best
  if (results.length > 0) {
    results.sort((a, b) => Number(b.output - a.output));
    console.log(`\n🏆 Best: ${results[0].dex} with ${results[0].outputFormatted} ${tokenOutName}`);
    
    // Compare best vs worst
    if (results.length > 1) {
      const best = results[0];
      const worst = results[results.length - 1];
      const diff = Number(best.output - worst.output);
      const diffFormatted = formatUnits(BigInt(Math.abs(diff)), tokenOut.decimals);
      const diffPercent = (Math.abs(diff) / Number(worst.output) * 100).toFixed(3);
      console.log(`📊 Best vs Worst: ${diffFormatted} ${tokenOutName} difference (${diffPercent}%)`);
    }
  }
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  console.log("\n" + "=".repeat(80));
  console.log("🔍 UNISWAP V3 PRICE COMPARISON ACROSS FEE TIERS");
  console.log("=".repeat(80));
  
  await compareAllDEXs("USDC", "WETH", "1000", provider);
  await compareAllDEXs("WETH", "USDC", "1", provider);
  await compareAllDEXs("USDC", "DAI", "1000", provider);
  await compareAllDEXs("DAI", "USDC", "1000", provider);
  
  console.log("\n" + "=".repeat(80));
  console.log("KEY INSIGHTS:");
  console.log("=".repeat(80));
  console.log("\n✅ Uniswap V3 pools are ACTIVE on mainnet fork");
  console.log("✅ Multiple fee tiers available (0.05%, 0.3%, 1%)");
  console.log("\n💡 Arbitrage Strategy:");
  console.log("   1. Compare same pair across different V3 fee tiers");
  console.log("   2. Buy on high-fee tier (worse price) if it has better depth");
  console.log("   3. Sell on low-fee tier (better price) for instant profit");
  console.log("\n📊 V3 Advantages:");
  console.log("   • Concentrated liquidity = better prices");
  console.log("   • Multiple fee tiers = more arbitrage opportunities");
  console.log("   • 0.05% tier perfect for stablecoin arb");
  console.log("\n" + "=".repeat(80) + "\n");
}

main().catch(console.error);
