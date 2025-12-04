import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

async function quoteRoundTrip(provider, amountHuman) {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  // Mainnet addresses
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];

  const routerAbi = [
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  ];

  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, provider);

  const usdcDecimals = await usdc.decimals();
  const amountIn = ethers.parseUnits(amountHuman, usdcDecimals);

  const path = [USDC, WETH, USDC];
  const amounts = await router.getAmountsOut(amountIn, path);

  const amountOut = amounts[amounts.length - 1];

  const inFloat = Number(amountIn) / 10 ** Number(usdcDecimals);
  const outFloat = Number(amountOut) / 10 ** Number(usdcDecimals);
  const pnl = outFloat - inFloat;
  const pnlPct = (pnl / inFloat) * 100;

  return {
    amountInRaw: amountIn.toString(),
    amountOutRaw: amountOut.toString(),
    inFloat,
    outFloat,
    pnl,
    pnlPct,
  };
}

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  console.log("RPC:", rpcUrl);

  const sizes = ["100", "1000", "10000"]; // USDC sizes to test

  for (const sz of sizes) {
    console.log("\n=== Round-trip for", sz, "USDC ===");
    const res = await quoteRoundTrip(provider, sz);

    console.log("Amount in (raw):      ", res.amountInRaw);
    console.log("Amount out (raw):     ", res.amountOutRaw);
    console.log("Amount in (USDC):     ", res.inFloat);
    console.log("Amount out (USDC):    ", res.outFloat);
    console.log("PnL (USDC):           ", res.pnl);
    console.log("PnL (%):              ", res.pnlPct);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
