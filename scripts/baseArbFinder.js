import { formatUnits, parseUnits, JsonRpcProvider, Contract } from "ethers";
import { BASE_CONFIG } from "../config/base.config.js";
import dotenv from "dotenv";

dotenv.config();

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

async function getQuote(router, amountIn, path, provider) {
  try {
    const routerContract = new Contract(router, V2_ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

async function checkArbitrage(tokenIn, tokenOut, amount, dex1, dex2, provider) {
  const tokenInAddr = BASE_CONFIG.tokens[tokenIn];
  const tokenOutAddr = BASE_CONFIG.tokens[tokenOut];
  const decimalsIn = tokenIn === "USDC" || tokenIn === "USDbC" ? 6 : 18;
  const decimalsOut = tokenOut === "USDC" || tokenOut === "USDbC" ? 6 : 18;
  
  const amountIn = parseUnits(amount.toString(), decimalsIn);
  
  // Route 1: DEX1 → DEX2
  const quote1_1 = await getQuote(dex1.router, amountIn, [tokenInAddr, tokenOutAddr], provider);
  if (!quote1_1) return null;
  
  const quote1_2 = await getQuote(dex2.router, quote1_1, [tokenOutAddr, tokenInAddr], provider);
  if (!quote1_2) return null;
  
  const profit1 = quote1_2 - amountIn;
  const profitUSD1 = Number(formatUnits(profit1, decimalsIn));
  
  // Route 2: DEX2 → DEX1
  const quote2_1 = await getQuote(dex2.router, amountIn, [tokenInAddr, tokenOutAddr], provider);
  if (!quote2_1) return null;
  
  const quote2_2 = await getQuote(dex1.router, quote2_1, [tokenOutAddr, tokenInAddr], provider);
  if (!quote2_2) return null;
  
  const profit2 = quote2_2 - amountIn;
  const profitUSD2 = Number(formatUnits(profit2, decimalsIn));
  
  // Return best route
  if (Math.abs(profitUSD1) > Math.abs(profitUSD2)) {
    return {
      pair: `${tokenIn}/${tokenOut}`,
      route: `${dex1.name} → ${dex2.name}`,
      profit: profitUSD1,
      profitable: profitUSD1 > BASE_CONFIG.thresholds.minProfitUSD
    };
  } else {
    return {
      pair: `${tokenIn}/${tokenOut}`,
      route: `${dex2.name} → ${dex1.name}`,
      profit: profitUSD2,
      profitable: profitUSD2 > BASE_CONFIG.thresholds.minProfitUSD
    };
  }
}

async function scanBase(provider) {
  console.log("\n" + "=".repeat(80));
  console.log("🔵 BASE ARBITRAGE OPPORTUNITY SCANNER");
  console.log("=".repeat(80));
  console.log(`Scanning with $${BASE_CONFIG.thresholds.minProfitUSD} min profit threshold\n`);
  
  const dexes = [
    { name: "Uniswap V2", router: BASE_CONFIG.dexes.UNISWAP_V2.router },
    { name: "SushiSwap", router: BASE_CONFIG.dexes.SUSHISWAP.router }
  ];
  
  const pairs = [
    { tokenIn: "USDC", tokenOut: "WETH", amount: 100 },
    { tokenIn: "USDC", tokenOut: "cbETH", amount: 100 },
    { tokenIn: "USDC", tokenOut: "DAI", amount: 100 },
    { tokenIn: "USDbC", tokenOut: "WETH", amount: 100 }, // Bridged USDC
    { tokenIn: "WETH", tokenOut: "cbETH", amount: 0.1 }
  ];
  
  const opportunities = [];
  let scanned = 0;
  
  for (const pair of pairs) {
    for (let i = 0; i < dexes.length; i++) {
      for (let j = i + 1; j < dexes.length; j++) {
        scanned++;
        console.log(`Checking ${pair.tokenIn}/${pair.tokenOut} (${dexes[i].name} ↔ ${dexes[j].name})...`);
        
        const result = await checkArbitrage(
          pair.tokenIn,
          pair.tokenOut,
          pair.amount,
          dexes[i],
          dexes[j],
          provider
        );
        
        if (result) {
          const status = result.profitable ? "💰 PROFITABLE" : "❌";
          console.log(`   ${status} ${result.route}: ${result.profit > 0 ? "+" : ""}${result.profit.toFixed(4)} ${pair.tokenIn}`);
          
          if (result.profitable) {
            opportunities.push(result);
          }
        } else {
          console.log(`   ❌ No liquidity`);
        }
      }
    }
    console.log();
  }
  
  console.log("=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));
  console.log(`Routes scanned: ${scanned}`);
  console.log(`Profitable opportunities: ${opportunities.length}`);
  
  if (opportunities.length > 0) {
    console.log("\n🎯 PROFITABLE OPPORTUNITIES:");
    opportunities.forEach(opp => {
      console.log(`   ${opp.pair} via ${opp.route}: +$${opp.profit.toFixed(2)}`);
    });
  } else {
    console.log("\n💡 No profitable opportunities found (this is normal)");
    console.log("   Opportunities appear during:");
    console.log("   • Market volatility");
    console.log("   • New token listings");
    console.log("   • Large trades causing temporary imbalances");
  }
  
  console.log("\n" + "=".repeat(80) + "\n");
  
  return opportunities;
}

async function main() {
  const provider = new JsonRpcProvider(BASE_CONFIG.rpcUrl);
  
  console.log("\n✅ Connected to Base");
  console.log(`RPC: ${BASE_CONFIG.rpcUrl}\n`);
  
  await scanBase(provider);
  
  console.log("💡 NEXT STEPS:");
  console.log("   1. Run this scanner continuously (every 15-30 seconds)");
  console.log("   2. When profitable opportunity found → execute");
  console.log("   3. Monitor new token launches on Base");
  console.log("   4. Consider adding more DEXs (BaseSwap, etc.)");
  console.log();
}

main().catch(console.error);
