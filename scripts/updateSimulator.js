import fs from 'fs';

const paraswapCode = `
// ============================================================
// PARASWAP QUOTE (No KYC)
// ============================================================

const PARASWAP_API = 'https://apiv5.paraswap.io';
const PARASWAP_CHAIN_IDS = { base: 8453, polygon: 137, arbitrum: 42161, avalanche: 43114 };

async function getParaswapQuote(chain, tokenIn, tokenOut, amount, srcDecimals, destDecimals) {
  const chainId = PARASWAP_CHAIN_IDS[chain];
  if (!chainId) return null;
  
  try {
    const url = \`\${PARASWAP_API}/prices?srcToken=\${tokenIn}&destToken=\${tokenOut}&amount=\${amount}&srcDecimals=\${srcDecimals}&destDecimals=\${destDecimals}&network=\${chainId}\`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.priceRoute) {
      return {
        destAmount: data.priceRoute.destAmount,
        destUSD: data.priceRoute.destUSD,
        srcUSD: data.priceRoute.srcUSD,
      };
    }
    return null;
  } catch { return null; }
}
`;

let content = fs.readFileSync('scripts/eventLiquidatorV4.js', 'utf8');

// Add Paraswap code after imports
if (!content.includes('PARASWAP_API')) {
  content = content.replace(
    "const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;",
    "const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;" + paraswapCode
  );
}

// Update simulateProfit to use Paraswap
const newSimulateProfit = `
async function simulateProfit(chain, pos, collateral, debt) {
  const config = AAVE_POOLS[chain];
  
  const collateralAsset = CHAIN_ASSETS[chain]?.find(a => a.token.toLowerCase() === collateral.asset?.toLowerCase());
  const debtAsset = CHAIN_ASSETS[chain]?.find(a => a.token.toLowerCase() === debt.asset?.toLowerCase());
  
  if (!collateralAsset || !debtAsset) {
    return { profitable: false, reason: 'unknown_assets' };
  }
  
  // Calculate values
  const debtAmountRaw = Number(debt.balance) / (10 ** debtAsset.decimals);
  const debtToCover = debtAmountRaw * 0.5;
  
  // Liquidation bonus (5%)
  const liquidationBonus = collateralAsset.bonus / 10000;
  const collateralReceived = debtToCover * (1 + liquidationBonus);
  const collateralReceivedWei = BigInt(Math.floor(collateralReceived * (10 ** collateralAsset.decimals)));
  
  // Get Paraswap quote for accurate pricing
  let swapOutput;
  let swapSource = 'estimate';
  
  if (collateral.asset !== debt.asset) {
    const quote = await getParaswapQuote(
      chain,
      collateral.asset,
      debt.asset,
      collateralReceivedWei.toString(),
      collateralAsset.decimals,
      debtAsset.decimals
    );
    
    if (quote?.destAmount) {
      swapOutput = Number(quote.destAmount) / (10 ** debtAsset.decimals);
      swapSource = 'paraswap';
      console.log(\`   📊 Paraswap: \${swapOutput.toFixed(4)} \${debtAsset.symbol} | \$\${quote.destUSD || 'N/A'}\`);
    }
  }
  
  // Fallback estimate
  if (!swapOutput) {
    const slippage = 0.005;
    swapOutput = collateralReceived * (1 - slippage);
  }
  
  // Costs
  const flashLoanFee = debtToCover * 0.0009;
  const gasUnits = 550000;
  const gasPrice = await getGasPrice(chain);
  const gasCostNative = gasUnits * gasPrice / 1e9;
  const gasCostUsd = gasCostNative * (config.nativePrice || 2900);
  
  // Profit
  const grossProfit = swapOutput - debtToCover;
  const grossProfitUsd = grossProfit * (pos.debt / debtAmountRaw);
  const netProfitUsd = grossProfitUsd - flashLoanFee - gasCostUsd;
  
  return {
    profitable: netProfitUsd > MIN_PROFIT_USD,
    netProfitUsd,
    grossProfitUsd,
    flashLoanFee,
    gasCostUsd,
    gasPrice,
    debtToCover,
    collateralReceived,
    swapOutput,
    swapSource,
    liquidationBonus: collateralAsset.bonus,
    reason: netProfitUsd > MIN_PROFIT_USD ? 'profitable' : 'below_threshold',
  };
}
`;

// Replace old simulateProfit
content = content.replace(
  /async function simulateProfit\(chain, pos, collateral, debt\) \{[\s\S]*?^\}/m,
  newSimulateProfit.trim()
);

fs.writeFileSync('scripts/eventLiquidatorV4.js', content);
console.log('✅ Updated with Paraswap quotes');
