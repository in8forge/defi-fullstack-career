import { JsonRpcProvider, Wallet, ContractFactory, formatUnits } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Aave V3 Pool Provider + Swap Router per chain
const CHAINS = {
  polygon: {
    name: "Polygon",
    rpc: process.env.POLYGON_RPC_URL,
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564" // Uniswap V3
  },
  avalanche: {
    name: "Avalanche", 
    rpc: process.env.AVALANCHE_RPC_URL,
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    swapRouter: "0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE" // TraderJoe
  },
  arbitrum: {
    name: "Arbitrum",
    rpc: process.env.ARBITRUM_RPC_URL,
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564" // Uniswap V3
  },
  optimism: {
    name: "Optimism",
    rpc: process.env.OPTIMISM_RPC_URL,
    poolAddressesProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    swapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564" // Uniswap V3
  }
};

async function deployToChain(chainKey, config) {
  console.log(`\n🚀 Deploying to ${config.name}...`);
  
  try {
    const provider = new JsonRpcProvider(config.rpc);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`   Balance: ${formatUnits(balance, 18).slice(0, 10)}`);
    
    const artifact = JSON.parse(fs.readFileSync('./artifacts/contracts/FlashLiquidator.sol/FlashLiquidator.json', 'utf8'));
    
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    
    console.log(`   Pool Provider: ${config.poolAddressesProvider}`);
    console.log(`   Swap Router: ${config.swapRouter}`);
    console.log(`   Deploying...`);
    
    // Deploy with BOTH constructor arguments
    const contract = await factory.deploy(
      config.poolAddressesProvider,
      config.swapRouter
    );
    
    console.log(`   Waiting for confirmation...`);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log(`   ✅ Deployed: ${address}`);
    
    return address;
    
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 100)}`);
    return null;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 MULTI-CHAIN LIQUIDATOR DEPLOYMENT");
  console.log("=".repeat(60));
  
  const wallet = new Wallet(process.env.PRIVATE_KEY);
  console.log(`\n👛 Wallet: ${wallet.address}`);
  console.log(`📋 Base (existing): ${process.env.FLASH_LIQUIDATOR_BASE}\n`);
  
  const deployedAddresses = {
    base: process.env.FLASH_LIQUIDATOR_BASE
  };
  
  for (const [chain, config] of Object.entries(CHAINS)) {
    const address = await deployToChain(chain, config);
    if (address) {
      deployedAddresses[chain] = address;
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("📋 ALL LIQUIDATORS:");
  console.log("=".repeat(60));
  
  for (const [chain, address] of Object.entries(deployedAddresses)) {
    const status = address ? address : "❌ Not deployed";
    console.log(`   ${chain.toUpperCase().padEnd(12)} ${status}`);
  }
  
  // Generate .env additions
  console.log("\n📝 Add these to your .env file:");
  console.log("─".repeat(60));
  for (const [chain, address] of Object.entries(deployedAddresses)) {
    if (address) {
      console.log(`FLASH_LIQUIDATOR_${chain.toUpperCase()}=${address}`);
    }
  }
  
  fs.mkdirSync('./data', { recursive: true });
  fs.writeFileSync('./data/liquidators.json', JSON.stringify(deployedAddresses, null, 2));
  console.log("\n✅ Saved to ./data/liquidators.json");
}

main().catch(console.error);
