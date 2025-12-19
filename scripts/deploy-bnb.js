import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// Read compiled contract
const artifact = JSON.parse(fs.readFileSync('./artifacts/contracts/BNBFlashLiquidator.sol/BNBFlashLiquidator.json', 'utf8'));

async function main() {
  console.log("\n🚀 Deploying BNB Flash Liquidator to BNB Chain...\n");

  const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log("Deployer:", wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "BNB\n");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  console.log("📤 Deploying...");
  const liquidator = await factory.deploy();
  
  console.log("TX:", liquidator.deploymentTransaction().hash);
  console.log("⏳ Waiting for confirmation...");
  
  await liquidator.waitForDeployment();

  const address = await liquidator.getAddress();
  console.log("\n✅ BNB Flash Liquidator deployed to:", address);

  // Save address
  let liquidators = {};
  try {
    liquidators = JSON.parse(fs.readFileSync("data/liquidators.json", "utf8"));
  } catch {}
  
  liquidators.bnb = address;
  fs.writeFileSync("data/liquidators.json", JSON.stringify(liquidators, null, 2));
  
  console.log("📄 Address saved to data/liquidators.json");
  console.log("\n🔗 View on BscScan: https://bscscan.com/address/" + address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
