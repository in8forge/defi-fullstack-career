import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const { ALCHEMY_MAINNET_RPC_URL } = process.env;

if (!ALCHEMY_MAINNET_RPC_URL) {
  console.error("Missing ALCHEMY_MAINNET_RPC_URL in .env");
  process.exit(1);
}

const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)"
];

async function main() {
  console.log("Running direct mainnet Uniswap V2 quote via Alchemy...");

  const provider = new ethers.JsonRpcProvider(ALCHEMY_MAINNET_RPC_URL);

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, provider);

  const amountIn = ethers.parseUnits("1000", 6); // 1000 USDC

  const amountsOut = await router.getAmountsOut(amountIn, [USDC, WETH]);

  console.log("Input: 1000 USDC");
  console.log("Output WETH:", ethers.formatUnits(amountsOut[1], 18));

  const blockNumber = await provider.getBlockNumber();
  console.log("\nBlock:", blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
