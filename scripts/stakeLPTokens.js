import { formatUnits, JsonRpcProvider, Contract, Wallet, MaxUint256 } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const LP_TOKEN = "0x27a8Afa3Bd49406e48a074350fB7b2020c43B2bD"; // USDC/USDbC pool
const GAUGE = "0x1Cfc45C5221A07DA0DE958098A319a29FbBD66fE";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function allowance(address, address) view returns (uint256)"
];

const GAUGE_ABI = [
  "function deposit(uint256) external",
  "function balanceOf(address) view returns (uint256)"
];

async function main() {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("\n🎯 STAKING LP TOKENS\n");
  
  const lpToken = new Contract(LP_TOKEN, ERC20_ABI, wallet);
  const gauge = new Contract(GAUGE, GAUGE_ABI, wallet);
  
  const lpBalance = await lpToken.balanceOf(wallet.address);
  console.log(`💰 LP Token Balance: ${formatUnits(lpBalance, 18)}`);
  
  if (lpBalance === 0n) {
    console.log("❌ No LP tokens to stake");
    return;
  }
  
  // Approve with max amount
  console.log("1. Approving LP tokens...");
  const tx1 = await lpToken.approve(GAUGE, MaxUint256);
  await tx1.wait();
  console.log("   ✅ Approved");
  
  // Stake
  console.log("2. Staking...");
  const tx2 = await gauge.deposit(lpBalance);
  await tx2.wait();
  console.log("   ✅ Staked!");
  
  // Check staked balance
  const stakedBalance = await gauge.balanceOf(wallet.address);
  console.log(`\n🎉 Staked: ${formatUnits(stakedBalance, 18)} LP tokens`);
  console.log("📈 Now earning 15% APR!");
}

main().catch(console.error);
