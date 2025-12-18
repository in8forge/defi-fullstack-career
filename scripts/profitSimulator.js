import { getParaswapQuote } from './paraswapQuoter.js';

export async function simulateProfit(chain, pos, collateral, debt, chainConfig) {
  const debtDecimals = debt.decimals || 18;
  const collateralDecimals = collateral.decimals || 18;
  
  // Calculate debt to cover (50% of position)
  const debtAmountRaw = Number(debt.balance) / (10 ** debtDecimals);
  const debtToCover = debtAmountRaw * 0.5;
  
  // Get liquidation bonus (typically 5%)
  const liquidationBonus = 0.05;
  const collateralReceived = debtToCover * (1 + liquidationBonus);
  const collateralReceivedWei = BigInt(Math.floor(collateralReceived * (10 ** collateralDecimals)));
  
  // Get swap quote from Paraswap
  let swapOutput;
  let swapSource = 'estimate';
  
  if (collateral.asset && debt.asset && collateral.asset !== debt.asset) {
    try {
      const quote = await getParaswapQuote(
        chain,
        collateral.asset,
        debt.asset,
        collateralReceivedWei.toString(),
        collateralDecimals
      );
      
      if (quote?.destAmount) {
        swapOutput = Number(quote.destAmount) / (10 ** debtDecimals);
        swapSource = 'paraswap';
        console.log(`   📊 Paraswap quote: ${swapOutput.toFixed(4)} ${debt.symbol} ($${quote.destUSD || 'N/A'})`);
      }
    } catch (e) {
      // Fallback to estimate
    }
  }
  
  // Fallback: estimate with 0.5% slippage
  if (!swapOutput) {
    const slippage = 0.005;
    swapOutput = collateralReceived * (1 - slippage);
    swapSource = 'estimate';
  }
  
  // Calculate costs
  const flashLoanFee = debtToCover * 0.0009; // 0.09%
  
  // Gas estimation
  const gasUnits = 550000;
  const gasPrice = chainConfig?.gasPrice || 1;
  const nativePrice = chainConfig?.nativePrice || 2900;
  const gasCostNative = gasUnits * gasPrice / 1e9;
  const gasCostUsd = gasCostNative * nativePrice;
  
  // Calculate profit
  const grossProfit = swapOutput - debtToCover;
  const grossProfitUsd = grossProfit * (pos.debt / debtAmountRaw);
  const netProfitUsd = grossProfitUsd - flashLoanFee - gasCostUsd;
  
  return {
    profitable: netProfitUsd > 5, // $5 minimum
    netProfitUsd,
    grossProfitUsd,
    flashLoanFee,
    gasCostUsd,
    debtToCover,
    collateralReceived,
    swapOutput,
    swapSource,
    liquidationBonus: liquidationBonus * 10000,
  };
}

export default { simulateProfit };
