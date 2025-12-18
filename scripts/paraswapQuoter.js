// Paraswap API - No KYC required
const PARASWAP_API = 'https://apiv5.paraswap.io';

const CHAIN_IDS = {
  base: 8453,
  polygon: 137,
  arbitrum: 42161,
  avalanche: 43114,
};

export async function getParaswapQuote(chain, tokenIn, tokenOut, amount, decimals = 18) {
  const chainId = CHAIN_IDS[chain];
  if (!chainId) return null;
  
  try {
    const url = `${PARASWAP_API}/prices?srcToken=${tokenIn}&destToken=${tokenOut}&amount=${amount}&srcDecimals=${decimals}&destDecimals=${decimals}&network=${chainId}`;
    
    const response = await fetch(url);
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json();
    
    if (data.priceRoute) {
      return {
        destAmount: data.priceRoute.destAmount,
        gasCost: data.priceRoute.gasCost,
        bestRoute: data.priceRoute.bestRoute,
        srcUSD: data.priceRoute.srcUSD,
        destUSD: data.priceRoute.destUSD,
      };
    }
    
    return null;
  } catch (e) {
    console.log(`   ⚠️ Paraswap error: ${e.message.slice(0, 50)}`);
    return null;
  }
}

export async function getParaswapSwapData(chain, tokenIn, tokenOut, amount, userAddress, slippage = 1) {
  const chainId = CHAIN_IDS[chain];
  if (!chainId) return null;
  
  try {
    // First get the price route
    const priceUrl = `${PARASWAP_API}/prices?srcToken=${tokenIn}&destToken=${tokenOut}&amount=${amount}&network=${chainId}`;
    const priceRes = await fetch(priceUrl);
    const priceData = await priceRes.json();
    
    if (!priceData.priceRoute) return null;
    
    // Then build the transaction
    const txUrl = `${PARASWAP_API}/transactions/${chainId}`;
    const txRes = await fetch(txUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        srcToken: tokenIn,
        destToken: tokenOut,
        srcAmount: amount,
        destAmount: priceData.priceRoute.destAmount,
        priceRoute: priceData.priceRoute,
        userAddress: userAddress,
        partner: 'liquidator',
        slippage: slippage * 100, // basis points
      }),
    });
    
    const txData = await txRes.json();
    
    return {
      to: txData.to,
      data: txData.data,
      value: txData.value,
      destAmount: priceData.priceRoute.destAmount,
    };
  } catch (e) {
    return null;
  }
}

export default { getParaswapQuote, getParaswapSwapData };
