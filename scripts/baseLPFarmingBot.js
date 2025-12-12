import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet, getAddress, MaxUint256 } from "ethers";
import { LP_CONFIG } from "../config/lpFarming.config.js";
import dotenv from "dotenv";

dotenv.config();

const AUTO_DEPOSIT_ENABLED = process.env.ENABLE_LP_DEPOSIT === "true";
const AERO_TOKEN = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDbC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const PAIR_ABI = [
  "function getReserves() view returns (uint256, uint256, uint256)",
  "function totalSupply() view returns (uint256)"
];

const GAUGE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)",
  "function deposit(uint256) external",
  "function getReward() external"
];

const ROUTER_ABI = [
  "function addLiquidity(address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable)[] calldata routes, address to, uint256 deadline) external returns (uint256[] memory amounts)"
];

async function getPoolStats(pool, wallet) {
  const provider = wallet.provider;
  
  const pair = new Contract(getAddress(pool.address), PAIR_ABI, provider);
  const gauge = new Contract(getAddress(pool.gauge), GAUGE_ABI, provider);
  
  const [reserves, totalSupply, stakedBalance, pendingRewards] = await Promise.all([
    pair.getReserves(),
    pair.totalSupply(),
    gauge.balanceOf(wallet.address),
    gauge.earned(wallet.address)
  ]);
  
  const reserve0 = Number(formatUnits(reserves[0], 6));
  const poolValueUSD = reserve0 * 2;
  const userShare = totalSupply > 0n ? Number(stakedBalance) / Number(totalSupply) : 0;
  
  return {
    pool,
    stakedBalance,
    stakedBalanceFormatted: Number(formatUnits(stakedBalance, 18)),
    pendingRewards,
    pendingRewardsFormatted: Number(formatUnits(pendingRewards, 18)),
    userShare,
    userValueUSD: poolValueUSD * userShare,
    poolValueUSD,
    apr: pool.apr
  };
}

async function claimAndCompound(stats, wallet) {
  const pendingAero = stats.pendingRewardsFormatted;
  const pendingUSD = pendingAero * 0.5; // AERO ~$0.50
  
  if (pendingUSD < 0.10) {
    console.log(`   ⏭️  Pending $${pendingUSD.toFixed(4)} - too small to compound`);
    return false;
  }
  
  console.log(`\n⚡ AUTO-COMPOUNDING ${stats.pool.name}...`);
  console.log(`   💰 Claiming ${pendingAero.toFixed(6)} AERO (~$${pendingUSD.toFixed(2)})`);
  
  const gauge = new Contract(getAddress(stats.pool.gauge), GAUGE_ABI, wallet);
  const router = new Contract(LP_CONFIG.aerodrome.router, ROUTER_ABI, wallet);
  const aero = new Contract(AERO_TOKEN, ERC20_ABI, wallet);
  const usdc = new Contract(USDC, ERC20_ABI, wallet);
  const usdbc = new Contract(USDbC, ERC20_ABI, wallet);
  const lpToken = new Contract(getAddress(stats.pool.address), ERC20_ABI, wallet);
  
  try {
    // 1. Claim AERO rewards
    console.log("   1. Claiming AERO...");
    await (await gauge.getReward()).wait();
    console.log("   ✅ Claimed");
    
    // 2. Check AERO balance
    const aeroBalance = await aero.balanceOf(wallet.address);
    if (aeroBalance === 0n) {
      console.log("   ⚠️ No AERO received");
      return false;
    }
    console.log(`   💰 AERO balance: ${formatUnits(aeroBalance, 18)}`);
    
    // 3. Swap AERO → USDC (50%) and AERO → USDbC (50%)
    console.log("   2. Swapping AERO to pool tokens...");
    const halfAero = aeroBalance / 2n;
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    await (await aero.approve(LP_CONFIG.aerodrome.router, aeroBalance)).wait();
    
    // AERO → USDC
    const routeUsdc = [{ from: AERO_TOKEN, to: USDC, stable: false }];
    await (await router.swapExactTokensForTokens(halfAero, 0, routeUsdc, wallet.address, deadline)).wait();
    
    // AERO → USDbC
    const routeUsdbc = [{ from: AERO_TOKEN, to: USDbC, stable: false }];
    await (await router.swapExactTokensForTokens(halfAero, 0, routeUsdbc, wallet.address, deadline)).wait();
    console.log("   ✅ Swapped");
    
    // 4. Add liquidity
    console.log("   3. Adding liquidity...");
    const usdcBal = await usdc.balanceOf(wallet.address);
    const usdbcBal = await usdbc.balanceOf(wallet.address);
    
    // Use smaller balance for balanced deposit
    const depositAmount = usdcBal < usdbcBal ? usdcBal : usdbcBal;
    
    if (depositAmount < parseUnits("0.01", 6)) {
      console.log("   ⚠️ Amount too small to add liquidity");
      return false;
    }
    
    await (await usdc.approve(LP_CONFIG.aerodrome.router, depositAmount)).wait();
    await (await usdbc.approve(LP_CONFIG.aerodrome.router, depositAmount)).wait();
    
    await (await router.addLiquidity(
      USDC,
      USDbC,
      true, // stable
      depositAmount,
      depositAmount,
      0,
      0,
      wallet.address,
      deadline
    )).wait();
    console.log("   ✅ Liquidity added");
    
    // 5. Stake LP tokens
    console.log("   4. Staking LP tokens...");
    const lpBalance = await lpToken.balanceOf(wallet.address);
    
    if (lpBalance > 0n) {
      await (await lpToken.approve(stats.pool.gauge, MaxUint256)).wait();
      await (await gauge.deposit(lpBalance)).wait();
      console.log(`   ✅ Staked ${formatUnits(lpBalance, 18)} LP`);
    }
    
    console.log("\n   🎉 COMPOUND COMPLETE!");
    return true;
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message.slice(0, 80)}`);
    return false;
  }
}

async function monitorFarms() {
  console.log("\n" + "=".repeat(80));
  console.log("🌾 LP FARMING BOT - BASE (AUTO-COMPOUND)");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`\n✅ Connected to Base`);
  console.log(`👛 Wallet: ${wallet.address}`);
  
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`💰 ETH: ${formatUnits(ethBalance, 18)}`);
  
  console.log(`\n📊 Features:`);
  console.log(`   ✅ Auto-compound rewards when > $0.10`);
  console.log(`   ✅ Swaps AERO → USDC/USDbC`);
  console.log(`   ✅ Re-stakes LP tokens`);
  console.log(`   ⏱️  Checks every hour`);
  
  console.log("\n" + "=".repeat(80));
  
  let checks = 0;
  let compounds = 0;
  
  while (true) {
    try {
      checks++;
      console.log(`\n🔍 Check #${checks}\n`);
      
      for (const pool of LP_CONFIG.pools) {
        try {
          const stats = await getPoolStats(pool, wallet);
          
          const pendingUSD = stats.pendingRewardsFormatted * 0.5;
          
          console.log(`📊 ${pool.name}:`);
          console.log(`   Staked: $${stats.userValueUSD.toFixed(4)}`);
          console.log(`   Pending: ${stats.pendingRewardsFormatted.toFixed(6)} AERO (~$${pendingUSD.toFixed(4)})`);
          console.log(`   APR: ${stats.apr}%`);
          
          // Auto-compound if rewards > $0.10
          if (pendingUSD >= 0.10) {
            if (await claimAndCompound(stats, wallet)) {
              compounds++;
            }
          }
          
        } catch (error) {
          console.log(`   ⚠️ Error: ${error.message.slice(0, 50)}`);
        }
      }
      
      console.log(`\n📈 Total Compounds: ${compounds}`);
      
      const now = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(`[${now}] Next check in 1 hour...`);
      console.log("=".repeat(80));
      
      // Check every hour
      await new Promise(r => setTimeout(r, 3600000));
      
    } catch (error) {
      console.log(`⚠️ ${error.message}`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

async function main() {
  await monitorFarms();
}

main().catch(console.error);
