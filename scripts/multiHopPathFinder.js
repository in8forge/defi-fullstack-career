import { formatUnits, parseUnits, JsonRpcProvider, Interface } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Token addresses
const TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfEDbC6b525Ea9450"
};

const DECIMALS = {
  USDC: 6,
  WETH: 18,
  DAI: 18,
  USDT: 6,
  WBTC: 8
};

const ROUTERS = {
  UNISWAP: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  SUSHISWAP: "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F"
};

const START_TOKEN = "USDC";
const START_AMOUNT = "1000";

let pathId = 0;

async function getQuote(routerAddress, amountIn, path, provider) {
  try {
    const iface = new Interface([
      "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
    ]);
    
    const data = iface.encodeFunctionData("getAmountsOut", [amountIn, path]);
    const result = await provider.call({ to: routerAddress, data });
    
    if (result === "0x") return null;
    
    const decoded = iface.decodeFunctionResult("getAmountsOut", result);
    return decoded[0][decoded[0].length - 1];
  } catch {
    return null;
  }
}

function generatePaths(startToken, maxHops) {
  const paths = [];
  const tokenNames = Object.keys(TOKENS).filter(t => t !== startToken);
  
  // 2-hop: USDC → X → USDC
  for (const token1 of tokenNames) {
    paths.push([startToken, token1, startToken]);
  }
  
  // 3-hop: USDC → X → Y → USDC
  if (maxHops >= 3) {
    for (const token1 of tokenNames) {
      for (const token2 of tokenNames) {
        if (token1 !== token2) {
          paths.push([startToken, token1, token2, startToken]);
        }
      }
    }
  }
  
  return paths;
}

function getRouterCombinations(pathLength) {
  const routers = Object.values(ROUTERS);
  const combinations = [];
  const numSwaps = pathLength - 1;
  
  function generate(current) {
    if (current.length === numSwaps) {
      combinations.push([...current]);
      return;
    }
    for (const router of routers) {
      current.push(router);
      generate(current);
      current.pop();
    }
  }
  
  generate([]);
  return combinations;
}

async function evaluatePath(tokenPath, routerCombination, startAmount, provider) {
  pathId++;
  const addresses = tokenPath.map(t => TOKENS[t]);
  let currentAmount = parseUnits(startAmount, DECIMALS[tokenPath[0]]);
  const swapResults = [];
  
  for (let i = 0; i < tokenPath.length - 1; i++) {
    const amountOut = await getQuote(
      routerCombination[i],
      currentAmount,
      [addresses[i], addresses[i + 1]],
      provider
    );
    
    if (!amountOut) return null;
    
    swapResults.push({
      from: tokenPath[i],
      to: tokenPath[i + 1],
      router: routerCombination[i] === ROUTERS.UNISWAP ? "UNI" : "SUSHI",
      amountIn: formatUnits(currentAmount, DECIMALS[tokenPath[i]]),
      amountOut: formatUnits(amountOut, DECIMALS[tokenPath[i + 1]])
    });
    
    currentAmount = amountOut;
  }
  
  const finalAmount = currentAmount;
  const startAmountParsed = parseUnits(startAmount, DECIMALS[START_TOKEN]);
  const profit = finalAmount > startAmountParsed ? finalAmount - startAmountParsed : 0n;
  
  return {
    pathId,
    tokenPath,
    routerPath: routerCombination.map(r => r === ROUTERS.UNISWAP ? "UNI" : "SUSHI"),
    startAmount,
    finalAmount: formatUnits(finalAmount, DECIMALS[START_TOKEN]),
    profit: formatUnits(profit, DECIMALS[START_TOKEN]),
    profitNum: parseFloat(formatUnits(profit, DECIMALS[START_TOKEN])),
    profitable: profit > 0n,
    swaps: swapResults,
    numHops: tokenPath.length - 1
  };
}

async function findBestPaths(maxHops, topN, provider) {
  console.log(`\n🔍 Starting multi-hop path finder`);
  console.log(`   Start: ${START_AMOUNT} ${START_TOKEN}`);
  console.log(`   Max hops: ${maxHops}`);
  console.log(`   Tokens: ${Object.keys(TOKENS).length}`);
  
  const tokenPaths = generatePaths(START_TOKEN, maxHops);
  console.log(`   Generated ${tokenPaths.length} unique token paths\n`);
  
  const allResults = [];
  let evaluated = 0;
  let totalPaths = 0;
  
  // Count total
  for (const tokenPath of tokenPaths) {
    totalPaths += getRouterCombinations(tokenPath.length).length;
  }
  
  console.log(`📊 Evaluating ${totalPaths} total path combinations...\n`);
  
  const startTime = Date.now();
  
  for (const tokenPath of tokenPaths) {
    const routerCombinations = getRouterCombinations(tokenPath.length);
    
    // Process in parallel batches
    const batchSize = 10;
    for (let i = 0; i < routerCombinations.length; i += batchSize) {
      const batch = routerCombinations.slice(i, i + batchSize);
      const promises = batch.map(rc => evaluatePath(tokenPath, rc, START_AMOUNT, provider));
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        if (result) {
          allResults.push(result);
          if (result.profitable) {
            console.log(`💰 Profitable: ${result.tokenPath.join("→")} via ${result.routerPath.join("→")} = +${result.profit} USDC`);
          }
        }
      });
      
      evaluated += batch.length;
      const progress = ((evaluated / totalPaths) * 100).toFixed(1);
      process.stdout.write(`\r⏳ Progress: ${evaluated}/${totalPaths} (${progress}%)`);
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ Complete in ${elapsed}s`);
  
  allResults.sort((a, b) => b.profitNum - a.profitNum);
  
  const profitable = allResults.filter(p => p.profitable).length;
  console.log(`   Total evaluated: ${allResults.length}`);
  console.log(`   Profitable paths: ${profitable}`);
  console.log(`   Best profit: ${allResults[0]?.profit || "0"} USDC\n`);
  
  return allResults.slice(0, topN);
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  const maxHops = 3;
  const topN = 10;
  
  const bestPaths = await findBestPaths(maxHops, topN, provider);
  
  console.log("=".repeat(80));
  console.log("TOP 10 ARBITRAGE PATHS");
  console.log("=".repeat(80));
  
  bestPaths.forEach((path, index) => {
    const status = path.profitable ? "✅ PROFITABLE" : "❌ LOSS";
    console.log(`\n#${index + 1} - ${path.numHops}-hop ${status}`);
    console.log(`Route: ${path.tokenPath.join(" → ")}`);
    console.log(`DEXs:  ${path.routerPath.join(" → ")}`);
    console.log(`Profit: ${parseFloat(path.profit) >= 0 ? "+" : ""}${path.profit} ${START_TOKEN}`);
    
    if (index < 3) { // Show details for top 3
      console.log("\nSwap breakdown:");
      path.swaps.forEach((swap, i) => {
        console.log(`  ${i + 1}. ${swap.amountIn} ${swap.from} → ${swap.amountOut} ${swap.to} (${swap.router})`);
      });
    }
  });
  
  console.log("\n" + "=".repeat(80) + "\n");
}

main().catch(console.error);
