import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Mainnet constants
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHI_V2_ROUTER   = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

// Config
const CONFIG = {
  sizes: ["100", "1000", "10000"],   // USDC sizes
  gasPriceGwei: 10n,
  gasUsed: 350000n,                  // estimated arb tx gas
  ethPriceUsd: 3000,                 // assumption
  minEdgeBps: 80n,                   // 0.80% minimum edge requirement
  slippageToleranceBps: 50n,         // 0.50% below quoted buy leg
};

function toFloat(amount, decimals) {
  return Number(amount) / 10 ** Number(decimals);
}

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const uniRouter = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, provider);
  const sushiRouter = new ethers.Contract(SUSHI_V2_ROUTER, routerAbi, provider);

  const [usdcDecimals, usdcSymbol] = await Promise.all([
    usdc.decimals(),
    usdc.symbol(),
  ]);

  console.log("RPC:", rpcUrl);
  console.log("USDC:", USDC, "symbol:", usdcSymbol, "decimals:", usdcDecimals.toString());
  console.log("WETH:", WETH);
  console.log("Uniswap V2 router:", UNISWAP_V2_ROUTER);
  console.log("Sushi V2 router:  ", SUSHI_V2_ROUTER);
  console.log("Gas price (gwei):", CONFIG.gasPriceGwei.toString());
  console.log("Gas used (est):  ", CONFIG.gasUsed.toString());
  console.log("ETH price (USD): ", CONFIG.ethPriceUsd);
  console.log("Min edge (bps):  ", CONFIG.minEdgeBps.toString());
  console.log("Slippage tol (bps):", CONFIG.slippageToleranceBps.toString());

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  // Gas cost in ETH
  const gasPriceWei = CONFIG.gasPriceGwei * 10n ** 9n;
  const gasCostEth = gasPriceWei * CONFIG.gasUsed / 10n ** 18n;
  const gasCostUsd = Number(gasCostEth) * CONFIG.ethPriceUsd;

  console.log("\nGas cost approximation:");
  console.log("  gasPriceWei:", gasPriceWei.toString());
  console.log("  gasCostEth: ", Number(gasCostEth));
  console.log("  gasCostUsd: ", gasCostUsd);

  for (const sz of CONFIG.sizes) {
    console.log("\n===============================");
    console.log(`Size: ${sz} ${usdcSymbol}`);

    const amountIn = ethers.parseUnits(sz, usdcDecimals);

    // Uni and Sushi USDC -> WETH quotes
    const path = [USDC, WETH];

    const [uniOutArr, sushiOutArr] = await Promise.all([
      uniRouter.getAmountsOut(amountIn, path),
      sushiRouter.getAmountsOut(amountIn, path),
    ]);

    const uniWethOut = uniOutArr[uniOutArr.length - 1];
    const sushiWethOut = sushiOutArr[sushiOutArr.length - 1];

    const uniWethOutF = Number(uniWethOut) / 1e18;
    const sushiWethOutF = Number(sushiWethOut) / 1e18;

    console.log("Uni WETH out:   ", uniWethOutF);
    console.log("Sushi WETH out: ", sushiWethOutF);

    // Decide buy venue (higher WETH out)
    let buyVenue = "Uni";
    let sellVenue = "Sushi";
    let buyRouter = UNISWAP_V2_ROUTER;
    let sellRouter = SUSHI_V2_ROUTER;
    let buyWethOut = uniWethOut;
    let sellWethOutFor1 = sushiWethOut; // WETH out for given USDC in

    if (sushiWethOut > uniWethOut) {
      buyVenue = "Sushi";
      sellVenue = "Uni";
      buyRouter = SUSHI_V2_ROUTER;
      sellRouter = UNISWAP_V2_ROUTER;
      buyWethOut = sushiWethOut;
      sellWethOutFor1 = uniWethOut;
    }

    console.log(`Buy WETH on:  ${buyVenue}`);
    console.log(`Sell WETH on: ${sellVenue}`);

    // Approximate WETH -> USDC rate on the sell venue:
    // For small edges, we approximate linearly:
    // rateBuy = buyWethOut / USDC_in
    // rateSell = sellWethOut / USDC_in
    // PnL% ≈ (rateSell - rateBuy) / rateBuy
    const usdcInFloat = Number(amountIn) / 10 ** Number(usdcDecimals);

    const rateBuy = Number(buyWethOut) / 1e18 / usdcInFloat;
    const rateSell = Number(sellWethOutFor1) / 1e18 / usdcInFloat;

    const edgeFrac = (rateSell - rateBuy) / rateBuy;
    const edgeBps = edgeFrac * 10000;

    console.log("rateBuy (WETH per USDC): ", rateBuy);
    console.log("rateSell (WETH per USDC):", rateSell);
    console.log("Edge (bps):              ", edgeBps);

    // Dex-only approximate PnL in USDC:
    const dexOnlyPnlPct = edgeFrac;
    const dexOnlyPnlUsd = dexOnlyPnlPct * usdcInFloat;

    console.log("Dex-only PnL (USDC):", dexOnlyPnlUsd);
    console.log("Dex-only PnL (%):   ", dexOnlyPnlPct * 100);

    // Include gas: negative cost in USD
    const pnlAfterGasUsd = dexOnlyPnlUsd - gasCostUsd;
    const pnlAfterGasPct = pnlAfterGasUsd / usdcInFloat;

    console.log("Gas cost (USDC):   ", gasCostUsd);
    console.log("PnL after gas (USDC):", pnlAfterGasUsd);
    console.log("PnL after gas (%):   ", pnlAfterGasPct * 100);

    // Decision
    const edgeBpsInt = Math.round(edgeBps);
    const minEdgeBpsNum = Number(CONFIG.minEdgeBps);

    if (edgeBpsInt < minEdgeBpsNum) {
      console.log("DECISION: SKIP (edge too small vs config).");
      continue;
    }

    if (pnlAfterGasUsd <= 0) {
      console.log("DECISION: SKIP (negative after gas).");
      continue;
    }

    console.log("DECISION: CANDIDATE ARB (positive after gas and edge >= minEdgeBps).");

    // Build params for buy leg: we will call router on buyVenue to do USDC -> WETH.
    // minOutBps = 10000 - slippageToleranceBps
    const minOutBps = 10_000n - CONFIG.slippageToleranceBps;

    const params = abiCoder.encode(
      ["address", "address", "address", "uint256"],
      [buyRouter, USDC, WETH, minOutBps]
    );

    console.log("\n=== EXECUTION PARAMS ===");
    console.log("router (buy):", buyRouter);
    console.log("tokenIn:     ", USDC);
    console.log("tokenOut:    ", WETH);
    console.log("minOutBps:   ", minOutBps.toString());
    console.log("params blob: ", params);
    console.log("This is what you would pass into requestFlashLoan/testMockCycle params.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
