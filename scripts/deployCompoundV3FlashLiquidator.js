import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// ============================================================
// Deploy CompoundV3FlashLiquidator to Base, Arbitrum, Polygon
// ============================================================

// Chain configurations
const CHAINS = {
  base: {
    rpc: process.env.BASE_RPC_URL,
    addressesProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D', // Aave V3 Base
    swapRouter: '0x2626664c2603336E57B271c5C0b26F421741e481', // Uniswap V3 Router
    weth: '0x4200000000000000000000000000000000000006',
    comet: '0xb125E6687d4313864e53df431d5425969c15Eb2F', // Compound V3 USDC
  },
  arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL,
    addressesProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb', // Aave V3 Arbitrum
    swapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    comet: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA', // Compound V3 USDC
  },
  polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    addressesProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb', // Aave V3 Polygon
    swapRouter: '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', // WETH on Polygon
    comet: '0xF25212E676D1F7F89Cd72fFEe66158f541246445', // Compound V3 USDC
  },
};

async function deploy(chainName) {
  const config = CHAINS[chainName];
  if (!config || !config.rpc) {
    console.log(`❌ ${chainName}: No RPC configured`);
    return null;
  }

  console.log(`\n🚀 Deploying CompoundV3FlashLiquidator to ${chainName}...\n`);

  const provider = new ethers.JsonRpcProvider(config.rpc);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`   Deployer: ${wallet.address}`);
  console.log(`   Balance: ${ethers.formatEther(balance)} native\n`);

  // Load compiled artifact
  let artifact;
  try {
    artifact = JSON.parse(
      fs.readFileSync(
        'artifacts/contracts/CompoundV3FlashLiquidator.sol/CompoundV3FlashLiquidator.json',
        'utf8'
      )
    );
  } catch (e) {
    console.log(`❌ Contract not compiled. Run: npx hardhat compile`);
    return null;
  }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  console.log(`   ⏳ Deploying...`);
  
  const contract = await factory.deploy(
    config.addressesProvider,
    config.swapRouter,
    config.weth
  );

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`   ✅ Deployed to: ${address}`);

  // Add the Comet market
  console.log(`   ⏳ Adding Comet market...`);
  const tx = await contract.addComet(config.comet);
  await tx.wait();
  console.log(`   ✅ Added Comet: ${config.comet}`);

  return { chain: chainName, address, comet: config.comet };
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  COMPOUND V3 FLASH LIQUIDATOR DEPLOYMENT                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const results = [];

  // Deploy to each chain
  for (const chain of ['base', 'arbitrum', 'polygon']) {
    try {
      const result = await deploy(chain);
      if (result) {
        results.push(result);
      }
    } catch (e) {
      console.log(`❌ ${chain}: ${e.message.slice(0, 60)}`);
    }
  }

  // Update liquidators.json
  if (results.length > 0) {
    console.log(`\n📄 Updating liquidators.json...\n`);
    
    let liquidators = {};
    try {
      liquidators = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8'));
    } catch {}

    // Add compound liquidators
    if (!liquidators.compound) {
      liquidators.compound = {};
    }
    
    for (const r of results) {
      liquidators.compound[r.chain] = r.address;
      console.log(`   ${r.chain}: ${r.address}`);
    }

    fs.writeFileSync('data/liquidators.json', JSON.stringify(liquidators, null, 2));
    console.log(`\n✅ Saved to data/liquidators.json`);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log(`DEPLOYMENT SUMMARY`);
  console.log(`${'='.repeat(60)}`);
  
  for (const r of results) {
    console.log(`${r.chain}: ${r.address}`);
  }

  console.log(`\nNext steps:`);
  console.log(`1. Verify contracts on block explorers`);
  console.log(`2. Update eventLiquidatorV7.2.js to use these contracts`);
  console.log(`3. Test with small amounts first`);
}

main().catch(console.error);

