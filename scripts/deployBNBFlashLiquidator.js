import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

const BNB_RPC = process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org';

async function main() {
  console.log('\n🚀 Deploying BNB Flash Liquidator to BNB Chain...\n');

  const provider = new ethers.JsonRpcProvider(BNB_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB\n`);

  if (balance < ethers.parseEther('0.01')) {
    console.log('❌ Need at least 0.01 BNB for deployment');
    return;
  }

  // Load compiled artifact
  const artifact = JSON.parse(fs.readFileSync('artifacts/contracts/BNBFlashLiquidator.sol/BNBFlashLiquidator.json', 'utf8'));
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  console.log('⏳ Deploying...');
  const liquidator = await factory.deploy();
  await liquidator.waitForDeployment();

  const address = await liquidator.getAddress();
  console.log(`\n✅ BNBFlashLiquidator deployed to: ${address}`);
  console.log(`🔗 https://bscscan.com/address/${address}\n`);

  // Update liquidators.json
  let liquidators = {};
  try { liquidators = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}
  liquidators.bnb = address;
  fs.writeFileSync('data/liquidators.json', JSON.stringify(liquidators, null, 2));
  console.log('📄 Updated data/liquidators.json');
}

main().catch(console.error);
