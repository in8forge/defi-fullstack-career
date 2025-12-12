import { formatUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const GAUGE = "0x1Cfc45C5221A07DA0DE958098A319a29FbBD66fE";
const POOL = "0x27a8Afa3Bd49406e48a074350fB7b2020c43B2bD";

const GAUGE_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function earned(address) view returns (uint256)"
];

const POOL_ABI = [
  "function totalSupply() view returns (uint256)",
  "function getReserves() view returns (uint256, uint256, uint256)"
];

async function main() {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("\n📊 YOUR LP FARMING POSITION\n");
  
  const gauge = new Contract(GAUGE, GAUGE_ABI, provider);
  const pool = new Contract(POOL, POOL_ABI, provider);
  
  const [stakedBalance, pendingRewards, totalSupply, reserves] = await Promise.all([
    gauge.balanceOf(wallet.address),
    gauge.earned(wallet.address),
    pool.totalSupply(),
    pool.getReserves()
  ]);
  
  // Calculate your share of the pool
  const poolTVL = Number(formatUnits(reserves[0], 6)) * 2; // USDC side * 2
  const yourShare = Number(stakedBalance) / Number(totalSupply);
  const yourValueUSD = poolTVL * yourShare;
  
  console.log(`🏊 Pool: USDC/USDbC (Stable)`);
  console.log(`📊 Pool TVL: $${poolTVL.toLocaleString()}`);
  console.log(`\n💰 Your Position:`);
  console.log(`   Staked LP: ${formatUnits(stakedBalance, 18)}`);
  console.log(`   Your Share: ${(yourShare * 100).toFixed(8)}%`);
  console.log(`   Value: $${yourValueUSD.toFixed(4)}`);
  console.log(`\n🎁 Pending Rewards:`);
  console.log(`   AERO: ${formatUnits(pendingRewards, 18)}`);
  console.log(`   Value: ~$${(Number(formatUnits(pendingRewards, 18)) * 0.5).toFixed(4)}`);
  console.log(`\n📈 APR: ~15%`);
  console.log(`💵 Expected Daily: $${(yourValueUSD * 0.15 / 365).toFixed(6)}`);
}

main().catch(console.error);
