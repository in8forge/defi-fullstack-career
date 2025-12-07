import hre from "hardhat";
import { formatUnits, parseUnits } from "ethers";

const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A63e5C6F27eAD9083C756Cc2";
const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
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
  console.log(JSON.stringify(entry));
}

async function getQuote(routerAddress, amountIn, path) {
  const router = await hre.ethers.getContractAt(
    ["function getAmountsOut(uint amountIn, address[] memory path) external view returns (uint[] memory amounts)"],
    routerAddress
  );
  const amounts = await router.getAmountsOut(amountIn, path);
  return amounts[amounts.length - 1];
}

function calculateGasCost(gasPrice, gasLimit) {
  return gasPrice * gasLimit;
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

async function evaluateArbitrage() {
  tradeId++;
  
  const provider = hre.ethers.provider;
  const gasPrice = (await provider.getFeeData()).gasPrice;
  const amountIn = parseUnits("1000", USDC_DECIMALS);
  
  try {
    const uniPath = [USDC_ADDRESS, WETH_ADDRESS];
    const sushiPath = [WETH_ADDRESS, USDC_ADDRESS];
    
    const wethFromUni = await getQuote(UNISWAP_ROUTER, amountIn, uniPath);
    const usdcFromSushi = await getQuote(SUSHISWAP_ROUTER, wethFromUni, sushiPath);
    
    const wethPriceInUsdc = (amountIn * parseUnits("1", WETH_DECIMALS)) / wethFromUni;
    const flashLoanFee = calculateFlashLoanFee(amountIn);
    const estimatedGas = 350000n;
    const gasCostWei = calculateGasCost(gasPrice, estimatedGas);
    
    const netPnL = calculatePnL(usdcFromSushi, amountIn, gasCostWei, flashLoanFee, wethPriceInUsdc);
    const slippagePercent = ((Number(formatUnits(amountIn, USDC_DECIMALS)) - Number(formatUnits(usdcFromSushi, USDC_DECIMALS))) / Number(formatUnits(amountIn, USDC_DECIMALS))) * 100;
    
    const safety = checkExecutionSafety(netPnL, amountIn, gasPrice, Math.abs(slippagePercent));
    
    const tradeData = {
      amountIn: formatUnits(amountIn, USDC_DECIMALS),
      wethFromUni: formatUnits(wethFromUni, WETH_DECIMALS),
      usdcFromSushi: formatUnits(usdcFromSushi, USDC_DECIMALS),
      flashLoanFee: formatUnits(flashLoanFee, USDC_DECIMALS),
      gasCostUsdc: formatUnits((gasCostWei * wethPriceInUsdc) / parseUnits("1", WETH_DECIMALS), USDC_DECIMALS),
      netPnL: formatUnits(netPnL, USDC_DECIMALS),
      gasPrice: formatUnits(gasPrice, "gwei"),
      slippagePercent: slippagePercent.toFixed(2),
      executable: safety.safe,
      roi: safety.roi?.toFixed(2),
      reason: safety.reason
    };
    
    log(safety.safe ? "info" : "warn", safety.safe ? "PROFITABLE OPPORTUNITY" : "Opportunity rejected", tradeData);
    
  } catch (error) {
    log("error", "Arbitrage evaluation failed", { error: error.message });
  }
}

async function main() {
  log("info", "Arbitrage Decision Engine started", {
    minProfit: MIN_PROFIT_USDC,
    minRoi: MIN_ROI_PERCENT,
    maxGas: MAX_GAS_PRICE_GWEI,
    maxSlippage: MAX_SLIPPAGE_PERCENT,
    pollInterval: POLL_INTERVAL_MS
  });
  
  while (true) {
    await evaluateArbitrage();
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch(error => {
  log("error", "Fatal error", { error: error.message });
  process.exit(1);
});
