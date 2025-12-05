import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const { ALCHEMY_MAINNET_RPC } = process.env;

if (!ALCHEMY_MAINNET_RPC) {
  throw new Error("Set ALCHEMY_MAINNET_RPC in .env (e.g. https://eth-mainnet.g.alchemy.com/v2/...)");
}

async function main() {
  const provider = new ethers.JsonRpcProvider(ALCHEMY_MAINNET_RPC);

  console.log("RPC:", ALCHEMY_MAINNET_RPC);

  const blockNumber = await provider.getBlockNumber();
  console.log("Connected to mainnet. Latest block:", blockNumber.toString());

  // USDC / WETH / Uniswap V2 router on mainnet
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNI_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  const routerAbi = [
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
  ];

  const router = new ethers.Contract(UNI_ROUTER, routerAbi, provider);

  const amountIn = ethers.parseUnits("1000", 6); // 1000 USDC (6 decimals)
  const path = [USDC, WETH];

  const amounts = await router.getAmountsOut(amountIn, path);
  const wethOut = ethers.formatUnits(amounts[1], 18);

  console.log("USDC -> WETH via Uniswap V2");
  console.log("Amount in (USDC):   1000");
  console.log("Amount out (WETH):  ", wethOut);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
