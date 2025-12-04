import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// Routers
const UNI_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHI_V2_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

async function quote(router, amountIn, path) {
  const amounts = await router.getAmountsOut(amountIn, path);
  return amounts[amounts.length - 1];
}

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const [usdcDecimals] = await Promise.all([usdc.decimals()]);

  const uni = new ethers.Contract(UNI_V2_ROUTER, routerAbi, provider);
  const sushi = new ethers.Contract(SUSHI_V2_ROUTER, routerAbi, provider);

  const sizes = ["100", "1000", "10000"]; // USDC sizes

  console.log("RPC:", rpcUrl);
  console.log("USDC:", USDC);
  console.log("WETH:", WETH);
  console.log("Uniswap V2 router:", UNI_V2_ROUTER);
  console.log("Sushi V2 router:  ", SUSHI_V2_ROUTER);

  for (const sz of sizes) {
    const amountIn = ethers.parseUnits(sz, usdcDecimals);

    console.log(`\n=== Size: ${sz} USDC ===`);

    // Path USDC -> WETH
    const path = [USDC, WETH];

    // Uni: USDC -> WETH
    const uniOut = await quote(uni, amountIn, path);
    const uniOutFloat = Number(uniOut) / 1e18;

    // Sushi: USDC -> WETH
    const sushiOut = await quote(sushi, amountIn, path);
    const sushiOutFloat = Number(sushiOut) / 1e18;

    // Uni better or Sushi better?
    const diffWeth = uniOutFloat - sushiOutFloat;
    const betterDex = diffWeth > 0 ? "Uniswap" : "Sushi";

    // Now simulate full round-trip on each venue: USDC -> WETH -> USDC
    const pathBack = [USDC, WETH, USDC];

    const uniRound = await uni.getAmountsOut(amountIn, pathBack);
    const sushiRound = await sushi.getAmountsOut(amountIn, pathBack);

    const uniOutUsdc = Number(uniRound[uniRound.length - 1]) / 10 ** Number(usdcDecimals);
    const sushiOutUsdc = Number(sushiRound[sushiRound.length - 1]) / 10 ** Number(usdcDecimals);
    const inFloat = Number(amountIn) / 10 ** Number(usdcDecimals);

    const uniPnl = uniOutUsdc - inFloat;
    const sushiPnl = sushiOutUsdc - inFloat;
    const uniPnlPct = (uniPnl / inFloat) * 100;
    const sushiPnlPct = (sushiPnl / inFloat) * 100;

    console.log("Uni WETH out:          ", uniOutFloat);
    console.log("Sushi WETH out:        ", sushiOutFloat);
    console.log("Better dex (USDC->WETH):", betterDex);
    console.log("Uni round-trip (USDC): ", uniOutUsdc, "PnL:", uniPnl, "PnL%:", uniPnlPct);
    console.log("Sushi round-trip (USDC):", sushiOutUsdc, "PnL:", sushiPnl, "PnL%:", sushiPnlPct);

    // Potential cross-venue arb idea (rough, no gas):
    // Buy on better WETH side, sell back on other side.
    const rawEdgeWeth = Math.abs(diffWeth);
    const rawEdgePct = (rawEdgeWeth / Math.max(uniOutFloat, sushiOutFloat)) * 100 || 0;

    console.log("Cross-venue WETH price edge (%):", rawEdgePct);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
