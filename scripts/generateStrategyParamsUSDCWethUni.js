import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Mainnet constants
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

// Config
const CONFIG = {
  sizes: ["100", "1000", "10000"], // USDC sizes
  slippageToleranceBps: 50,        // 0.50% below quote
};

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, provider);

  const [usdcDecimals, usdcSymbol] = await Promise.all([
    usdc.decimals(),
    usdc.symbol(),
  ]);

  console.log("RPC:", rpcUrl);
  console.log("USDC:", USDC, "symbol:", usdcSymbol, "decimals:", usdcDecimals.toString());
  console.log("WETH:", WETH);
  console.log("Uniswap V2 router:", UNISWAP_V2_ROUTER);
  console.log("Slippage tolerance (bps):", CONFIG.slippageToleranceBps);

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  for (const sz of CONFIG.sizes) {
    const amountIn = ethers.parseUnits(sz, usdcDecimals);
    const inFloat = Number(amountIn) / 10 ** Number(usdcDecimals);

    console.log(`\n=== Size: ${sz} ${usdcSymbol} ===`);

    const path = [USDC, WETH];

    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOut = amounts[amounts.length - 1];

    const outFloat = Number(amountOut) / 1e18;

    console.log("Quoted WETH out:", outFloat);

    // Apply slippage tolerance: minOut = quote * (1 - slippageToleranceBps / 10000)
    const minOut = (amountOut * BigInt(10000 - CONFIG.slippageToleranceBps)) / 10000n;
    const minOutFloat = Number(minOut) / 1e18;

    console.log("Min WETH out (with slippage):", minOutFloat);

    // Convert this into a "Bps of quote" to feed _strategy:
    // minOutBps = 10000 - slippageToleranceBps (eg 9950 for 0.5%)
    const minOutBps = BigInt(10000 - CONFIG.slippageToleranceBps);

    console.log("minOutBps:", minOutBps.toString());

    const params = abiCoder.encode(
      ["address", "address", "address", "uint256"],
      [UNISWAP_V2_ROUTER, USDC, WETH, minOutBps]
    );

    console.log("Encoded params:", params);
    console.log("Decoded sanity check:");

    const decoded = abiCoder.decode(
      ["address", "address", "address", "uint256"],
      params
    );

    console.log("  router:   ", decoded[0]);
    console.log("  tokenIn:  ", decoded[1]);
    console.log("  tokenOut: ", decoded[2]);
    console.log("  minOutBps:", decoded[3].toString());

    console.log("Summary for size", sz, usdcSymbol, ":");
    console.log("  amountIn:", inFloat, usdcSymbol);
    console.log("  quotedOut:", outFloat, "WETH");
    console.log("  minOut (WETH):", minOutFloat);
    console.log("  params:", params);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
