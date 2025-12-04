import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Mainnet constants
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

// Config (tune these)
const CONFIG = {
  sizes: ["100", "1000", "10000"], // in USDC
  ETH_PRICE_USD: 3000,            // assumed ETH/USD
  GAS_PRICE_GWEI: 10,             // assumed gas price
  GAS_USED: 350000,               // assumed gas used by arb tx
};

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const [usdcDecimals, usdcSymbol] = await Promise.all([
    usdc.decimals(),
    usdc.symbol(),
  ]);

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, provider);

  console.log("RPC:", rpcUrl);
  console.log("USDC:", USDC, "symbol:", usdcSymbol, "decimals:", usdcDecimals.toString());
  console.log("WETH:", WETH);
  console.log("Uniswap V2 router:", UNISWAP_V2_ROUTER);
  console.log("\nConfig:");
  console.log("  ETH_PRICE_USD:", CONFIG.ETH_PRICE_USD);
  console.log("  GAS_PRICE_GWEI:", CONFIG.GAS_PRICE_GWEI);
  console.log("  GAS_USED:", CONFIG.GAS_USED);

  // Gas cost in USD for a single tx
  const gasPriceEth = CONFIG.GAS_PRICE_GWEI * 1e-9; // gwei -> ETH
  const gasCostEth = CONFIG.GAS_USED * gasPriceEth;
  const gasCostUsd = gasCostEth * CONFIG.ETH_PRICE_USD;

  console.log("\nEstimated gas cost per arb tx:");
  console.log("  Gas price (ETH):", gasPriceEth);
  console.log("  Gas cost (ETH): ", gasCostEth);
  console.log("  Gas cost (USD): ", gasCostUsd);

  for (const sz of CONFIG.sizes) {
    const amountIn = ethers.parseUnits(sz, usdcDecimals);
    const inFloat = Number(amountIn) / 10 ** Number(usdcDecimals);

    console.log(`\n=== Size: ${sz} ${usdcSymbol} ===`);

    const pathRound = [USDC, WETH, USDC];

    const amounts = await router.getAmountsOut(amountIn, pathRound);
    const amountOut = amounts[amounts.length - 1];

    const outFloat = Number(amountOut) / 10 ** Number(usdcDecimals);
    const pnlExchangeOnly = outFloat - inFloat;
    const pnlPctExchangeOnly = (pnlExchangeOnly / inFloat) * 100;

    // Gas cost is in USD; USDC ~ 1 USD
    const pnlAfterGas = pnlExchangeOnly - gasCostUsd;
    const pnlPctAfterGas = (pnlAfterGas / inFloat) * 100;

    // Break-even PnL % required to cover gas
    const breakevenPnlPctFromGas = (gasCostUsd / inFloat) * 100;

    console.log("Dex-only round-trip out:", outFloat, usdcSymbol);
    console.log("Dex-only PnL (USDC):    ", pnlExchangeOnly);
    console.log("Dex-only PnL (%):       ", pnlPctExchangeOnly);
    console.log("Gas cost (USDC):        ", gasCostUsd);
    console.log("PnL after gas (USDC):   ", pnlAfterGas);
    console.log("PnL after gas (%):      ", pnlPctAfterGas);
    console.log("Break-even PnL %% (gas):", breakevenPnlPctFromGas);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
