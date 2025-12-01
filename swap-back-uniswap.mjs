import { ethers } from "ethers";

// Local Hardhat mainnet fork
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// Same Account #0 as before
const FORK_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const wallet = new ethers.Wallet(FORK_PRIVATE_KEY, provider);

// Addresses (lowercase)
const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const UNISWAP_V2_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";

// ABIs
const routerAbi = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts)",
  "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)"
];

const erc20Abi = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

async function main() {
  const addr = await wallet.getAddress();
  console.log("Trader address:", addr);

  const ethBefore = await provider.getBalance(addr);
  console.log("ETH before:", ethers.formatEther(ethBefore));

  const usdc = new ethers.Contract(USDC_ADDRESS, erc20Abi, wallet);
  const usdcDecimals = await usdc.decimals();
  const usdcBefore = await usdc.balanceOf(addr);
  console.log("USDC before:", ethers.formatUnits(usdcBefore, usdcDecimals));

  if (usdcBefore === 0n) {
    console.log("No USDC to swap back. Run swap-uniswap.mjs first.");
    return;
  }

  // Use 2000 USDC for the round-trip
  const amountIn = ethers.parseUnits("2000", usdcDecimals);
  if (usdcBefore < amountIn) {
    console.log("Not enough USDC, using full balance instead.");
  }

  const actualIn = usdcBefore < amountIn ? usdcBefore : amountIn;

  // Approve router to spend USDC
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, routerAbi, wallet);

  console.log("Approving router to spend USDC...");
  const approveTx = await usdc.approve(UNISWAP_V2_ROUTER, actualIn);
  console.log("Approve tx:", approveTx.hash);
  await approveTx.wait();
  console.log("Approve confirmed.");

  // Quote expected ETH out
  const path = [USDC_ADDRESS, WETH_ADDRESS];
  const amountsOut = await router.getAmountsOut(actualIn, path);
  console.log("Expected ETH out:", ethers.formatEther(amountsOut[1]));

  // Swap USDC -> ETH
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;

  console.log(
    `Swapping ${ethers.formatUnits(actualIn, usdcDecimals)} USDC back to ETH...`
  );
  const tx = await router.swapExactTokensForETH(
    actualIn,
    0n, // amountOutMin = 0 (unsafe in prod)
    path,
    addr,
    deadline
  );
  console.log("Swap back tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("Swap back confirmed in block:", receipt.blockNumber);

  const ethAfter = await provider.getBalance(addr);
  const usdcAfter = await usdc.balanceOf(addr);

  console.log("ETH after:", ethers.formatEther(ethAfter));
  console.log("USDC after:", ethers.formatUnits(usdcAfter, usdcDecimals));

  const ethDelta = ethAfter - ethBefore;
  console.log("Net ETH change (wei):", ethDelta.toString());
  console.log("Net ETH change (ETH):", ethers.formatEther(ethDelta));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


