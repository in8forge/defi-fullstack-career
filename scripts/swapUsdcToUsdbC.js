import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDbC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";
const UNISWAP_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)"
];

const ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)",
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory amounts)"
];

async function main() {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("\n💱 SWAPPING USDC → USDbC on Uniswap V2\n");
  console.log(`👛 Wallet: ${wallet.address}`);
  
  const usdc = new Contract(USDC, ERC20_ABI, wallet);
  const usdbc = new Contract(USDbC, ERC20_ABI, provider);
  const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, wallet);
  
  const usdcBalance = await usdc.balanceOf(wallet.address);
  console.log(`💵 USDC Balance: ${formatUnits(usdcBalance, 6)}`);
  
  // Swap 25% of USDC to USDbC
  const swapAmount = usdcBalance / 4n;
  console.log(`🔄 Swapping: ${formatUnits(swapAmount, 6)} USDC → USDbC`);
  
  if (swapAmount < parseUnits("5", 6)) {
    console.log("❌ Not enough USDC (min $5)");
    return;
  }
  
  // Get quote
  const path = [USDC, USDbC];
  const amounts = await router.getAmountsOut(swapAmount, path);
  console.log(`📊 Expected: ${formatUnits(amounts[1], 6)} USDbC`);
  
  // Approve
  console.log("\n1. Approving USDC...");
  await (await usdc.approve(UNISWAP_V2_ROUTER, swapAmount)).wait();
  console.log("   ✅ Approved");
  
  // Swap
  console.log("2. Swapping...");
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const minOut = amounts[1] * 95n / 100n; // 5% slippage
  
  const tx = await router.swapExactTokensForTokens(
    swapAmount,
    minOut,
    path,
    wallet.address,
    deadline
  );
  
  console.log(`   TX: ${tx.hash}`);
  await tx.wait();
  console.log("   ✅ Swap complete!");
  
  // Check new balances
  const newUsdc = await usdc.balanceOf(wallet.address);
  const newUsdbc = await usdbc.balanceOf(wallet.address);
  
  console.log(`\n📊 New Balances:`);
  console.log(`   USDC: ${formatUnits(newUsdc, 6)}`);
  console.log(`   USDbC: ${formatUnits(newUsdbc, 6)}`);
  console.log(`\n✅ Ready to deposit into LP pool!`);
}

main().catch(console.error);
