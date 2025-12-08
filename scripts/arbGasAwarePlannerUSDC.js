import { formatUnits, parseUnits, JsonRpcProvider, Interface } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
const FLASH_LOAN_EXECUTOR = "0x12604a5B388a1E1834693bfe94dDdF81A60B56A2";

const AAVE_FLASH_LOAN_FEE_BPS = 5;
const USDC_DECIMALS = 6;
const WETH_DECIMALS = 18;

const POLL_INTERVAL_MS = 15000;
const MIN_PROFIT_USDC = 5;
const MIN_ROI_PERCENT = 0.5;
const MAX_GAS_PRICE_GWEI = 50;
const MAX_SLIPPAGE_PERCENT = 2;

let tradeId = 0;

function log(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    tradeId,
    ...data
  };
  console.log(JSON.stringify(entry, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

async function getQuote(routerAddress, amountIn, path, provider) {
  const iface = new Interface(["function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"]);
  const data = iface.encodeFunctionData("getAmountsOut", [amountIn, path]);
  
  const result = await provider.call({
    to: routerAddress,
    data: data
  });
  
  if (result === "0x") {
    throw new Error("No liquidity pool for this path");
  }
  
  const decoded = iface.decodeFunctionResult("getAmountsOut", result);
  return decoded[0][decoded[0].length - 1];
}

async function estimateExecutionGas() {
  return 350000n;
}

function calculateFlashLoanFee(principal) {
  return (principal * BigInt(AAVE_FLASH_LOAN_FEE_BPS)) / 10000n;
}

function calculatePnL(amountOut, amountIn, gasCostWei, flashLoanFee, wethPriceInUsdc) {
  const gasCostUsdc = (gasCostWei * wethPriceInUsdc) / parseUnits("1", WETH_DECIMALS);
  const totalCost = amountIn + gasCostUsdc + flashLoanFee;
  return amountOut - totalCost;
}

function checkExecutionSafety(netPnL, amountIn, gasPrice, slippagePercent) {
  const roi = (Number(formatUnits(netPnL, USDC_DECIMALS)) / Number(formatUnits(amountIn, USDC_DECIMALS))) * 100;
  
  if (netPnL < parseUnits(MIN_PROFIT_USDC.toString(), USDC_DECIMALS)) {
    return { safe: false, reason: "Below min profit threshold" };
  }
  
  if (roi < MIN_ROI_PERCENT) {
    return { safe: false, reason: `ROI ${roi.toFixed(2)}% below ${MIN_ROI_PERCENT}%` };
  }
  
  const gasPriceGwei = Number(formatUnits(gasPrice, "gwei"));
  if (gasPriceGwei > MAX_GAS_PRICE_GWEI) {
    return { safe: false, reason: `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds ${MAX_GAS_PRICE_GWEI}` };
  }
  
  if (slippagePercent > MAX_SLIPPAGE_PERCENT) {
    return { safe: false, reason: `Slippage ${slippagePercent.toFixed(2)}% exceeds ${MAX_SLIPPAGE_PERCENT}%` };
  }
  
  return { safe: true, reason: "All safety checks passed", roi };
}

async function evaluatePath(amountIn, router1, router2, path1, path2, direction, provider) {
  const quote1 = await getQuote(router1, amountIn, path1, provider);
  const quote2 = await getQuote(router2, quote1, path2, provider);
  
  const slippagePercent = ((Number(formatUnits(amountIn, USDC_DECIMALS)) - Number(formatUnits(quote2, USDC_DECIMALS))) / Number(formatUnits(amountIn, USDC_DECIMALS))) * 100;
  
  return {
    direction,
    amountIn: formatUnits(amountIn, USDC_DECIMALS),
    intermediateAmount: formatUnits(quote1, path1[1] === WETH_ADDRESS ? WETH_DECIMALS : USDC_DECIMALS),
    amountOut: formatUnits(quote2, USDC_DECIMALS),
    slippagePercent: slippagePercent.toFixed(2),
    quote1,
    quote2
  };
}

async function evaluateArbitrage(provider) {
  tradeId++;
  
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  const amountIn = parseUnits("1000", USDC_DECIMALS);
  
  try {
    const pathUniSushi = await evaluatePath(
      amountIn,
      UNISWAP_ROUTER,
      SUSHISWAP_ROUTER,
      [USDC_ADDRESS, WETH_ADDRESS],
      [WETH_ADDRESS, USDC_ADDRESS],
      "UNI→SUSHI",
      provider
    );
    
    const pathSushiUni = await evaluatePath(
      amountIn,
      SUSHISWAP_ROUTER,
      UNISWAP_ROUTER,
      [USDC_ADDRESS, WETH_ADDRESS],
      [WETH_ADDRESS, USDC_ADDRESS],
      "SUSHI→UNI",
      provider
    );
    
    const bestPath = parseUnits(pathUniSushi.amountOut, USDC_DECIMALS) > parseUnits(pathSushiUni.amountOut, USDC_DECIMALS) 
      ? { ...pathUniSushi, router1: UNISWAP_ROUTER, router2: SUSHISWAP_ROUTER }
      : { ...pathSushiUni, router1: SUSHISWAP_ROUTER, router2: UNISWAP_ROUTER };
    
    const estimatedGas = await estimateExecutionGas();
    const gasCostWei = gasPrice * estimatedGas;
    
    const wethPriceInUsdc = (amountIn * parseUnits("1", WETH_DECIMALS)) / bestPath.quote1;
    const flashLoanFee = calculateFlashLoanFee(amountIn);
    const netPnL = calculatePnL(
      parseUnits(bestPath.amountOut, USDC_DECIMALS),
      amountIn,
      gasCostWei,
      flashLoanFee,
      wethPriceInUsdc
    );
    
    const safety = checkExecutionSafety(netPnL, amountIn, gasPrice, Math.abs(parseFloat(bestPath.slippagePercent)));
    
    const result = {
      profitable: safety.safe,
      reason: safety.reason,
      roi: safety.roi?.toFixed(2) || "N/A",
      path: bestPath.direction,
      netPnL: formatUnits(netPnL, USDC_DECIMALS),
      breakdown: {
        amountIn: bestPath.amountIn,
        amountOut: bestPath.amountOut,
        flashLoanFee: formatUnits(flashLoanFee, USDC_DECIMALS),
        gasCostUsdc: formatUnits((gasCostWei * wethPriceInUsdc) / parseUnits("1", WETH_DECIMALS), USDC_DECIMALS),
        gasEstimate: estimatedGas.toString(),
        gasPrice: formatUnits(gasPrice, "gwei"),
        slippagePercent: bestPath.slippagePercent
      },
      execution: {
        router1: bestPath.router1,
        router2: bestPath.router2,
        path1: [USDC_ADDRESS, WETH_ADDRESS],
        path2: [WETH_ADDRESS, USDC_ADDRESS]
      },
      allPaths: [pathUniSushi, pathSushiUni]
    };
    
    log(safety.safe ? "info" : "warn", safety.safe ? "PROFITABLE OPPORTUNITY DETECTED" : "Opportunity rejected", result);
    
  } catch (error) {
    log("error", "Arbitrage evaluation failed", { error: error.message });
  }
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  log("info", "Arbitrage Decision Engine v1 started", {
    executor: FLASH_LOAN_EXECUTOR,
    minProfit: MIN_PROFIT_USDC,
    minRoi: MIN_ROI_PERCENT,
    maxGas: MAX_GAS_PRICE_GWEI,
    maxSlippage: MAX_SLIPPAGE_PERCENT,
    pollInterval: POLL_INTERVAL_MS,
    flashLoanFeeBps: AAVE_FLASH_LOAN_FEE_BPS
  });
  
  while (true) {
    await evaluateArbitrage(provider);
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(error => {
  log("error", "Fatal error", { error: error.message });
  process.exit(1);
});
