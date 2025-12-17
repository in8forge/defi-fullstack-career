import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

const CHAINS = {
  base: {
    rpc: process.env.BASE_RPC_URL,
    poolProvider: '0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D',
    uniswapV3: '0x2626664c2603336E57B271c5C0b26F421741e481',
    sushiswap: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
    weth: '0x4200000000000000000000000000000000000006',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    poolProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    uniswapV3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    sushiswap: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  },
  arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL,
    poolProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    uniswapV3: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    sushiswap: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    weth: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  },
  avalanche: {
    rpc: process.env.AVALANCHE_RPC_URL,
    poolProvider: '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
    uniswapV3: '0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE',
    sushiswap: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    weth: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  },
};

async function main() {
  const chainName = process.argv[2] || 'base';
  const chain = CHAINS[chainName];
  
  if (!chain) {
    console.log('Usage: node scripts/deployFlashLiquidatorV2.js <chain>');
    console.log('Chains:', Object.keys(CHAINS).join(', '));
    process.exit(1);
  }
  
  console.log(`\n🚀 Deploying FlashLiquidatorV2 to ${chainName}...\n`);
  
  const provider = new ethers.JsonRpcProvider(chain.rpc);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);
  
  const artifact = JSON.parse(fs.readFileSync('artifacts/contracts/FlashLiquidatorV2.sol/FlashLiquidatorV2.json', 'utf8'));
  
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  console.log('Deploying...');
  const contract = await factory.deploy(
    chain.poolProvider,
    chain.uniswapV3,
    chain.weth,
    chain.usdc
  );
  
  console.log(`TX: ${contract.deploymentTransaction().hash}`);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log(`\n✅ FlashLiquidatorV2 deployed: ${address}\n`);
  
  // Configure Sushiswap router
  console.log('Configuring DEX routers...');
  const tx1 = await contract.setDexRouters(
    ethers.ZeroAddress, // Keep UniswapV3 from constructor
    chain.sushiswap,
    ethers.ZeroAddress  // No Curve for now
  );
  await tx1.wait();
  console.log('  ✅ Sushiswap configured');
  
  // Set slippage to 1%
  const tx2 = await contract.setSlippage(100);
  await tx2.wait();
  console.log('  ✅ Slippage set to 1%');
  
  // Configure ETH derivatives on Base
  if (chainName === 'base') {
    console.log('Configuring ETH derivatives...');
    
    const weETH = '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A';
    const wstETH = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';
    const cbETH = '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22';
    
    const tx3 = await contract.setEthDerivative(weETH, true, chain.weth);
    await tx3.wait();
    console.log('  ✅ weETH configured');
    
    const tx4 = await contract.setEthDerivative(wstETH, true, chain.weth);
    await tx4.wait();
    console.log('  ✅ wstETH configured');
    
    const tx5 = await contract.setEthDerivative(cbETH, true, chain.weth);
    await tx5.wait();
    console.log('  ✅ cbETH configured');
  }
  
  // Update liquidators.json
  const liquidatorsFile = 'data/liquidators.json';
  let liquidators = {};
  try { liquidators = JSON.parse(fs.readFileSync(liquidatorsFile, 'utf8')); } catch {}
  
  liquidators[chainName] = address;
  fs.writeFileSync(liquidatorsFile, JSON.stringify(liquidators, null, 2));
  console.log(`\nUpdated ${liquidatorsFile}`);
  
  console.log('\n🎉 Done!\n');
}

main().catch(console.error);
