import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import { readFileSync } from "fs";
import dotenv from "dotenv";

dotenv.config();

// Base Aave V3 addresses
const POOL_ADDRESSES_PROVIDER = "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D";
const UNISWAP_V2_ROUTER = "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24";

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🚀 DEPLOYING FLASH LIQUIDATOR TO BASE");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`\n👛 Deployer: ${wallet.address}`);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${balance / 10n**18n} ETH`);
  
  // Read compiled contract
  const artifact = JSON.parse(
    readFileSync("./artifacts/contracts/FlashLiquidator.sol/FlashLiquidator.json", "utf8")
  );
  
  console.log("\n⏳ Deploying FlashLiquidator...");
  
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(
    POOL_ADDRESSES_PROVIDER,
    UNISWAP_V2_ROUTER
  );
  
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  
  console.log(`\n✅ FlashLiquidator deployed!`);
  console.log(`📍 Address: ${address}`);
  console.log(`🔗 https://basescan.org/address/${address}`);
  
  // Save address
  console.log(`\n💾 Add to .env:`);
  console.log(`FLASH_LIQUIDATOR_BASE=${address}`);
  
  return address;
}

main().catch(console.error);
