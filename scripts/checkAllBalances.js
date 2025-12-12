import { formatUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const TOKENS = [
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  { symbol: "USDbC", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
  { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 }
];

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

async function main() {
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log("\n📊 WALLET BALANCES\n");
  console.log(`👛 ${wallet.address}\n`);
  
  // ETH
  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`💰 ETH: ${formatUnits(ethBalance, 18)}`);
  
  // Tokens
  for (const token of TOKENS) {
    const contract = new Contract(token.address, ERC20_ABI, provider);
    const balance = await contract.balanceOf(wallet.address);
    console.log(`💵 ${token.symbol}: ${formatUnits(balance, token.decimals)}`);
  }
  
  console.log(`\n🔗 Check on BaseScan:`);
  console.log(`   https://basescan.org/address/${wallet.address}`);
}

main().catch(console.error);
