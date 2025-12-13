import { JsonRpcProvider, Wallet, ContractFactory, formatUnits } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// Aave V3 Pool addresses per chain
const CHAINS = {
  polygon: {
    name: "Polygon",
    rpc: process.env.POLYGON_RPC_URL,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    minGas: 0.5 // MATIC needed
  },
  avalanche: {
    name: "Avalanche", 
    rpc: process.env.AVALANCHE_RPC_URL,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    minGas: 0.1 // AVAX needed
  },
  arbitrum: {
    name: "Arbitrum",
    rpc: process.env.ARBITRUM_RPC_URL,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    minGas: 0.001 // ETH needed
  },
  optimism: {
    name: "Optimism",
    rpc: process.env.OPTIMISM_RPC_URL,
    aavePool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
    aaveProvider: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
    minGas: 0.001 // ETH needed
  }
};

// FlashLiquidator contract source
const CONTRACT_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256);
}

contract FlashLiquidator is FlashLoanSimpleReceiverBase {
    address public owner;
    
    struct LiquidationParams {
        address collateralAsset;
        address debtAsset;
        address user;
        uint256 debtToCover;
    }
    
    LiquidationParams private liquidationParams;
    
    constructor(address _addressProvider) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider)) {
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    function executeLiquidation(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover
    ) external onlyOwner {
        liquidationParams = LiquidationParams({
            collateralAsset: collateralAsset,
            debtAsset: debtAsset,
            user: user,
            debtToCover: debtToCover
        });
        
        POOL.flashLoanSimple(address(this), debtAsset, debtToCover, "", 0);
    }
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Invalid caller");
        require(initiator == address(this), "Invalid initiator");
        
        // Approve and liquidate
        IERC20(asset).approve(address(POOL), amount);
        
        POOL.liquidationCall(
            liquidationParams.collateralAsset,
            liquidationParams.debtAsset,
            liquidationParams.user,
            liquidationParams.debtToCover,
            false
        );
        
        // Approve repayment
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwed);
        
        return true;
    }
    
    function withdraw(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).transfer(owner, balance);
        }
    }
    
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
    
    receive() external payable {}
}
`;

async function checkBalance(chain, config) {
  const provider = new JsonRpcProvider(config.rpc);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  const balance = await provider.getBalance(wallet.address);
  const balanceFormatted = Number(formatUnits(balance, 18));
  
  console.log(`   ${config.name}: ${balanceFormatted.toFixed(4)} native token`);
  
  return balanceFormatted >= config.minGas;
}

async function deployToChain(chainKey, config) {
  console.log(`\n🚀 Deploying to ${config.name}...`);
  
  try {
    const provider = new JsonRpcProvider(config.rpc);
    const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    const balanceFormatted = Number(formatUnits(balance, 18));
    console.log(`   Balance: ${balanceFormatted.toFixed(4)}`);
    
    if (balanceFormatted < config.minGas) {
      console.log(`   ❌ Insufficient gas. Need ${config.minGas} native token`);
      return null;
    }
    
    // Load compiled contract
    const artifact = JSON.parse(fs.readFileSync('./artifacts/contracts/FlashLiquidator.sol/FlashLiquidator.json', 'utf8'));
    
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    
    console.log(`   Deploying...`);
    const contract = await factory.deploy(config.aaveProvider);
    await contract.waitForDeployment();
    
    const address = await contract.getAddress();
    console.log(`   ✅ Deployed: ${address}`);
    
    return address;
    
  } catch (e) {
    console.log(`   ❌ Error: ${e.message.slice(0, 60)}`);
    return null;
  }
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("🚀 MULTI-CHAIN LIQUIDATOR DEPLOYMENT");
  console.log("=".repeat(60));
  
  const wallet = new Wallet(process.env.PRIVATE_KEY);
  console.log(`\n👛 Deploying from: ${wallet.address}\n`);
  
  // Check balances first
  console.log("💰 Checking balances:");
  const canDeploy = {};
  for (const [chain, config] of Object.entries(CHAINS)) {
    canDeploy[chain] = await checkBalance(chain, config);
  }
  
  // Deploy to chains with sufficient balance
  const deployedAddresses = {
    base: process.env.FLASH_LIQUIDATOR_BASE // Already deployed
  };
  
  console.log("\n📋 Deployment status:");
  console.log(`   Base: ${process.env.FLASH_LIQUIDATOR_BASE} (already deployed)`);
  
  for (const [chain, config] of Object.entries(CHAINS)) {
    if (canDeploy[chain]) {
      const address = await deployToChain(chain, config);
      if (address) {
        deployedAddresses[chain] = address;
      }
    } else {
      console.log(`\n⏭️ Skipping ${config.name} - insufficient balance`);
    }
  }
  
  // Save addresses
  console.log("\n" + "=".repeat(60));
  console.log("📋 DEPLOYED LIQUIDATORS:");
  console.log("=".repeat(60));
  
  for (const [chain, address] of Object.entries(deployedAddresses)) {
    if (address) {
      console.log(`   ${chain.toUpperCase()}: ${address}`);
    }
  }
  
  // Generate .env additions
  console.log("\n📝 Add to your .env file:");
  console.log("─".repeat(60));
  for (const [chain, address] of Object.entries(deployedAddresses)) {
    if (address && chain !== 'base') {
      console.log(`FLASH_LIQUIDATOR_${chain.toUpperCase()}=${address}`);
    }
  }
  
  // Save to file
  fs.writeFileSync('./data/liquidators.json', JSON.stringify(deployedAddresses, null, 2));
  console.log("\n✅ Saved to ./data/liquidators.json");
}

main().catch(console.error);
