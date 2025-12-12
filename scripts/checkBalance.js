import { formatUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("\n👛 Wallet Address:", wallet.address);
  
  const ethBalance = await provider.getBalance(wallet.address);
  const usdc = new Contract(USDC, ERC20_ABI, provider);
  const usdcBalance = await usdc.balanceOf(wallet.address);
  
  console.log("💰 ETH:", formatUnits(ethBalance, 18));
  console.log("💵 USDC:", formatUnits(usdcBalance, 6));
  
  console.log("\n🔗 Fund this address on Base to start trading!");
}

main().catch(console.error);
