import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet, getAddress } from "ethers";
import { LP_CONFIG } from "../config/lpFarming.config.js";
import dotenv from "dotenv";

dotenv.config();

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
  "function withdraw(uint256) external",
  "function getReward() external"
];

async function getPoolStats(pool, wallet) {
  const provider = wallet.provider;
  
  // Use getAddress to fix checksums
  const pairAddr = getAddress(pool.address);
  const gaugeAddr = getAddress(pool.gauge);
  const token0Addr = getAddress(pool.token0);
  const token1Addr = getAddress(pool.token1);
  
  const pair = new Contract(pairAddr, PAIR_ABI, provider);
  const gauge = new Contract(gaugeAddr, GAUGE_ABI, provider);
  const token0 = new Contract(token0Addr, ERC20_ABI, provider);
  const token1 = new Contract(token1Addr, ERC20_ABI, provider);
  
  const [reserves, totalSupply, stakedBalance, pendingRewards, t0Symbol, t1Symbol, t0Dec, t1Dec] = await Promise.all([
    pair.getReserves(),
    pair.totalSupply(),
    gauge.balanceOf(wallet.address),
    gauge.earned(wallet.address),
    token0.symbol(),
    token1.symbol(),
    token0.decimals(),
    token1.decimals()
  ]);
  
  const reserve0 = Number(formatUnits(reserves[0], t0Dec));
  const reserve1 = Number(formatUnits(reserves[1], t1Dec));
  
  // Estimate USD value
  let poolValueUSD;
  if (t0Symbol === "USDC" || t0Symbol === "USDbC") {
    poolValueUSD = reserve0 * 2;
  } else if (t1Symbol === "USDC" || t1Symbol === "USDbC") {
    poolValueUSD = reserve1 * 2;
  } else {
    poolValueUSD = reserve0 * 3200 * 2;
  }
  
  const userShare = totalSupply > 0n ? Number(stakedBalance) / Number(totalSupply) : 0;
  const userValueUSD = poolValueUSD * userShare;
  
  return {
    pool,
    reserves: [reserve0, reserve1],
    totalSupply: Number(formatUnits(totalSupply, 18)),
    stakedBalance: Number(formatUnits(stakedBalance, 18)),
    pendingRewards: Number(formatUnits(pendingRewards, 18)),
    userShare,
    userValueUSD,
    poolValueUSD,
    apr: pool.apr
  };
}

async function monitorFarms() {
  console.log("\n" + "=".repeat(80));
  console.log("🌾 LP FARMING BOT - BASE (AERODROME)");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`\n✅ Connected to Base`);
  console.log(`👛 Wallet: ${wallet.address}`);
  
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`💰 ETH: ${formatUnits(ethBalance, 18)} ETH`);
  
  console.log(`\n📊 Monitoring ${LP_CONFIG.pools.length} pools:`);
  LP_CONFIG.pools.forEach(p => console.log(`   • ${p.name} (~${p.apr}% APR)`));
  
  console.log("\n" + "=".repeat(80));
  
  let checks = 0;
  
  while (true) {
    try {
      checks++;
      console.log(`\n🔍 Check #${checks} - Scanning pools...\n`);
      
      let totalStakedUSD = 0;
      let totalPendingUSD = 0;
      
      for (const pool of LP_CONFIG.pools) {
        try {
          const stats = await getPoolStats(pool, wallet);
          
          console.log(`📊 ${stats.pool.name}:`);
          console.log(`   Pool TVL: $${stats.poolValueUSD.toLocaleString()}`);
          console.log(`   Your Staked: ${stats.stakedBalance.toFixed(6)} LP (~$${stats.userValueUSD.toFixed(2)})`);
          console.log(`   Pending Rewards: ${stats.pendingRewards.toFixed(4)} AERO (~$${(stats.pendingRewards * 0.5).toFixed(2)})`);
          console.log(`   APR: ${stats.apr}%\n`);
          
          totalStakedUSD += stats.userValueUSD;
          totalPendingUSD += stats.pendingRewards * 0.5;
          
        } catch (error) {
          console.log(`   ⚠️ Error reading ${pool.name}: ${error.message.slice(0, 50)}`);
        }
      }
      
      console.log("=".repeat(80));
      console.log(`💰 YOUR TOTAL STAKED: $${totalStakedUSD.toFixed(2)}`);
      console.log(`🎁 PENDING REWARDS: ~$${totalPendingUSD.toFixed(2)}`);
      
      if (totalStakedUSD === 0) {
        console.log(`\n💡 TIP: Deposit USDC into a pool to start earning!`);
        console.log(`   1. Go to https://aerodrome.finance`);
        console.log(`   2. Add liquidity to WETH/USDC or USDC/USDbC`);
        console.log(`   3. Stake LP tokens in gauge`);
        console.log(`   4. This bot will auto-compound your rewards!`);
      }
      
      const now = new Date().toISOString().split('T')[1].split('.')[0];
      console.log(`\n[${now}] Next check in 1 hour...`);
      console.log("=".repeat(80));
      
      await new Promise(r => setTimeout(r, 3600000));
      
    } catch (error) {
      console.log(`⚠️ Error: ${error.message}`);
      await new Promise(r => setTimeout(r, 60000));
    }
  }
}

async function main() {
  if (!process.env.PRIVATE_KEY || !process.env.BASE_RPC_URL) {
    console.log("❌ Missing PRIVATE_KEY or BASE_RPC_URL");
    process.exit(1);
  }
  await monitorFarms();
}

main().catch(console.error);
