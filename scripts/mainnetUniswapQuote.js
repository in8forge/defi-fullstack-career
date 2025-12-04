import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  // Mainnet addresses
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

  console.log("RPC:", rpcUrl);
  console.log("USDC:", USDC);
  console.log("WETH:", WETH);
  console.log("Router:", UNISWAP_V2_ROUTER);

  const erc20Abi = [
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
    "function balanceOf(address) view returns (uint256)",
  ];

  const routerAbi = [
    "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  ];

  const usdc = new ethers.Contract(USDC, erc20Abi, provider);
  const weth = new ethers.Contract(WETH, erc20Abi, provider);
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, provider);

  const [usdcDecimals, usdcSymbol, wethSymbol] = await Promise.all([
    usdc.decimals(),
    usdc.symbol(),
    weth.symbol(),
  ]);

  console.log("\nUSDC decimals:", usdcDecimals);
  console.log("USDC symbol: ", usdcSymbol);
  console.log("WETH symbol: ", wethSymbol);

  // Quote: 1,000 USDC -> WETH -> USDC
  const amountIn = ethers.parseUnits("1000", usdcDecimals);
  const path = [USDC, WETH, USDC];

  const amounts = await router.getAmountsOut(amountIn, path);

  console.log("\nSwap path:", path);
  console.log("Amount in (USDC, raw):", amountIn.toString());
  console.log("Amounts out (raw):", amounts.map(a => a.toString()));

  const amountOut = amounts[amounts.length - 1];
  console.log("Implied round-trip (USDC out):", amountOut.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
