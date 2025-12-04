import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const UNI_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHI_V2_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

// Config
const CONFIG = {
  sizes: ["100", "1000", "10000"],     // USDC sizes
  minEdgePct: 0.8,                    // minimum PnL % to consider trade
};

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const [usdcDecimals, usdcSymbol] = await Promise.all([
    usdc.decimals(),
    usdc.symbol(),
  ]);

  const uni = new ethers.Contract(UNI_V2_ROUTER, routerAbi, provider);
  const sushi = new ethers.Contract(SUSHI_V2_ROUTER, routerAbi, provider);

  console.log("RPC:", rpcUrl);
  console.log("USDC:", USDC, "symbol:", usdcSymbol);
  console.log("WETH:", WETH);
  console.log("Uniswap V2 router:", UNI_V2_ROUTER);
  console.log("Sushi V2 router:  ", SUSHI_V2_ROUTER);
  console.log("Min edge (%):     ", CONFIG.minEdgePct);

  for (const sz of CONFIG.sizes) {
    const amountIn = ethers.parseUnits(sz, usdcDecimals);
    const inFloat = Number(amountIn) / 10 ** Number(usdcDecimals);

    console.log(`\n=== Size: ${sz} ${usdcSymbol} ===`);

    // Leg 1: USDC -> WETH
    const pathUsdcToWeth = [USDC, WETH];

    const uniToWeth = await uni.getAmountsOut(amountIn, pathUsdcToWeth);
    const sushiToWeth = await sushi.getAmountsOut(amountIn, pathUsdcToWeth);

    const uniWethOut = uniToWeth[uniToWeth.length - 1];
    const sushiWethOut = sushiToWeth[sushiToWeth.length - 1];

    const uniWethFloat = Number(uniWethOut) / 1e18;
    const sushiWethFloat = Number(sushiWethOut) / 1e18;

    console.log("Uni WETH out:   ", uniWethFloat);
    console.log("Sushi WETH out: ", sushiWethFloat);

    // Determine where to buy/sell WETH
    const buyOnUni = uniWethFloat > sushiWethFloat ? true : false;
    const buyDex = buyOnUni ? "Uniswap" : "Sushi";
    const sellDex = buyOnUni ? "Sushi" : "Uniswap";

    const wethBought = buyOnUni ? uniWethOut : sushiWethOut;

    console.log("Buy WETH on:    ", buyDex);
    console.log("Sell WETH on:   ", sellDex);

    // Leg 2: WETH -> USDC on the *other* router
    const pathWethToUsdc = [WETH, USDC];
    let outUsdcOnSellDex;

    if (buyOnUni) {
      const sellOnSushi = await sushi.getAmountsOut(wethBought, pathWethToUsdc);
      outUsdcOnSellDex = sellOnSushi[sellOnSushi.length - 1];
    } else {
      const sellOnUni = await uni.getAmountsOut(wethBought, pathWethToUsdc);
      outUsdcOnSellDex = sellOnUni[sellOnUni.length - 1];
    }

    const outUsdcFloat =
      Number(outUsdcOnSellDex) / 10 ** Number(usdcDecimals);

    const pnl = outUsdcFloat - inFloat;
    const pnlPct = (pnl / inFloat) * 100;

    console.log("USDC in:        ", inFloat);
    console.log("USDC out:       ", outUsdcFloat);
    console.log("PnL (USDC):     ", pnl);
    console.log("PnL (%):        ", pnlPct);

    if (pnlPct > CONFIG.minEdgePct) {
      console.log("DECISION: TRADE (edge above threshold)");
    } else {
      console.log("DECISION: SKIP (edge too small)");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
