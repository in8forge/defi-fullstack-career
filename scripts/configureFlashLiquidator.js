import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

async function main() {
  const chain = process.argv[2] || 'base';
  
  const rpcs = {
    base: process.env.BASE_RPC_URL,
    polygon: process.env.POLYGON_RPC_URL,
    arbitrum: process.env.ARBITRUM_RPC_URL,
    avalanche: process.env.AVALANCHE_RPC_URL,
  };
  
  const sushiRouters = {
    base: '0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891',
    polygon: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    arbitrum: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
    avalanche: '0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506',
  };
  
  const liquidators = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8'));
  const address = liquidators[chain];
  
  console.log(`\nConfiguring FlashLiquidatorV2 on ${chain}: ${address}\n`);
  
  const provider = new ethers.JsonRpcProvider(rpcs[chain]);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  
  const abi = [
    'function setDexRouters(address _uniswapV3, address _sushiswap, address _curve) external',
    'function setSlippage(uint256 _maxSlippageBps) external',
    'function setEthDerivative(address token, bool isDerivative, address underlying) external',
    'function owner() view returns (address)',
    'function getSlippage() view returns (uint256)',
  ];
  
  const contract = new ethers.Contract(address, abi, wallet);
  
  // Check owner
  const owner = await contract.owner();
  console.log('Owner:', owner);
  console.log('Your wallet:', wallet.address);
  
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.log('❌ You are not the owner!');
    return;
  }
  
  // Set Sushiswap router
  console.log('\nSetting Sushiswap router...');
  const tx1 = await contract.setDexRouters(
    ethers.ZeroAddress,
    sushiRouters[chain],
    ethers.ZeroAddress,
    { gasLimit: 100000 }
  );
  await tx1.wait();
  console.log('✅ Sushiswap configured');
  
  // Set slippage
  console.log('Setting slippage to 1%...');
  const tx2 = await contract.setSlippage(100, { gasLimit: 50000 });
  await tx2.wait();
  console.log('✅ Slippage set');
  
  // Verify
  const slippage = await contract.getSlippage();
  console.log(`\nSlippage: ${slippage} bps (${Number(slippage)/100}%)`);
  
  // ETH derivatives for Base
  if (chain === 'base') {
    console.log('\nConfiguring ETH derivatives...');
    const weth = '0x4200000000000000000000000000000000000006';
    
    const tx3 = await contract.setEthDerivative('0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A', true, weth, { gasLimit: 80000 });
    await tx3.wait();
    console.log('✅ weETH');
    
    const tx4 = await contract.setEthDerivative('0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', true, weth, { gasLimit: 80000 });
    await tx4.wait();
    console.log('✅ wstETH');
    
    const tx5 = await contract.setEthDerivative('0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', true, weth, { gasLimit: 80000 });
    await tx5.wait();
    console.log('✅ cbETH');
  }
  
  console.log('\n🎉 Configuration complete!\n');
}

main().catch(console.error);
