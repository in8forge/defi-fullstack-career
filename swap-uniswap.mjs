import { ethers } from "ethers";

// Local Hardhat mainnet fork
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// Use Account #0 from the hardhat node output
const FORK_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const wallet = new ethers.Wallet(FORK_PRIVATE_KEY, provider);

// Mainnet addresses (valid on the fork)
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const UNISWAP_V2_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";

// Minimal ABIs
const routerAbi = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable returns (uint256[] memory amounts)"
];

const erc20Abi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

async function main() {
  const addr = await wallet.getAddress();
  console.log("Trader address:", addr);

  const ethBalBefore = await provider.getBalance(addr);
  console.log("ETH before:", ethers.formatEther(ethBalBefore));

  const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, provider);
  const usdcBefore = await usdc.balanceOf(addr);
  const usdcDecimals = await usdc.decimals();
  console.log("USDC before:", ethers.formatUnits(usdcBefore, usdcDecimals));

  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, wallet);

  const amountIn = ethers.parseEther("1.0"); // swap 1 ETH
  const path = [WETH_ADDRESS, USDC_ADDRESS];

  // Quote expected output
  const amountsOut = await router.getAmountsOut(amountIn, path);
  console.log("Expected USDC out (raw):", amountsOut[1].toString());
  console.log(
    "Expected USDC out (formatted):",
    ethers.formatUnits(amountsOut[1], usdcDecimals)
  );

  // Perform swap: ETH -> USDC
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10 minutes
  console.log("Swapping 1 ETH for USDC on Uniswap V2...");

  const tx = await router.swapExactETHForTokens(
    0n,        // amountOutMin = 0 (unsafe in prod but fine on fork)
    path,
    addr,
    deadline,
    { value: amountIn }
  );

  console.log("Swap tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Swap confirmed in block:", receipt.blockNumber);

  const ethBalAfter = await provider.getBalance(addr);
  const usdcAfter = await usdc.balanceOf(addr);

  console.log("ETH after:", ethers.formatEther(ethBalAfter));
  console.log("USDC after:", ethers.formatUnits(usdcAfter, usdcDecimals));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


