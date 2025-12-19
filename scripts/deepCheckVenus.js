import 'dotenv/config';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');

const BORROWER = '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc';

const VTOKENS = {
  vUSDT: { address: '0xfD5840Cd36d94D7229439859C0112a4185BC0255', decimals: 18, underlyingDecimals: 18 },
  vUSDC: { address: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8', decimals: 8, underlyingDecimals: 18 },
  vBNB: { address: '0xA07c5b74C9B40447a954e1466938b865b6BBea36', decimals: 8, underlyingDecimals: 18 },
  vBTC: { address: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B', decimals: 8, underlyingDecimals: 18 },
  vETH: { address: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8', decimals: 8, underlyingDecimals: 18 },
  vDAI: { address: '0x334b3eCB4DCa3593BCCC3c7EBD1A1C1d1780FBF1', decimals: 8, underlyingDecimals: 18 },
  vBUSD: { address: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D', decimals: 8, underlyingDecimals: 18 },
};

const VTOKEN_ABI = [
  'function borrowBalanceCurrent(address) view returns (uint256)',
  'function borrowBalanceStored(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function balanceOfUnderlying(address) view returns (uint256)',
  'function getAccountSnapshot(address) view returns (uint256, uint256, uint256, uint256)',
  'function exchangeRateStored() view returns (uint256)',
];

const COMPTROLLER_ABI = [
  'function getAccountLiquidity(address) view returns (uint256, uint256, uint256)',
  'function getAssetsIn(address) view returns (address[])',
  'function markets(address) view returns (bool, uint256, bool)',
];

const comptroller = new ethers.Contract('0xfD36E2c2a6789Db23113685031d7F16329158384', COMPTROLLER_ABI, provider);

async function check() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🔍 DEEP VENUS ACCOUNT ANALYSIS                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  console.log(`Borrower: ${BORROWER}\n`);
  
  // Get account liquidity
  const [error, liquidity, shortfall] = await comptroller.getAccountLiquidity(BORROWER);
  console.log('📊 ACCOUNT LIQUIDITY:');
  console.log(`   Error: ${error}`);
  console.log(`   Liquidity: $${Number(ethers.formatEther(liquidity)).toFixed(2)}`);
  console.log(`   Shortfall: $${Number(ethers.formatEther(shortfall)).toFixed(2)}`);
  console.log(`   Status: ${shortfall > 0n ? '🔥 LIQUIDATABLE' : '✅ Healthy'}\n`);
  
  // Get markets entered
  const assetsIn = await comptroller.getAssetsIn(BORROWER);
  console.log(`📋 MARKETS ENTERED: ${assetsIn.length}`);
  for (const asset of assetsIn) {
    const name = Object.entries(VTOKENS).find(([, v]) => v.address.toLowerCase() === asset.toLowerCase())?.[0] || asset;
    console.log(`   - ${name}`);
  }
  console.log();
  
  // Check each vToken
  console.log('💰 POSITION DETAILS:\n');
  
  let totalCollateralUSD = 0;
  let totalDebtUSD = 0;
  
  for (const [symbol, config] of Object.entries(VTOKENS)) {
    const vToken = new ethers.Contract(config.address, VTOKEN_ABI, provider);
    
    try {
      // getAccountSnapshot returns (error, vTokenBalance, borrowBalance, exchangeRate)
      const [err, vTokenBal, borrowBal, exchRate] = await vToken.getAccountSnapshot(BORROWER);
      
      if (vTokenBal > 0n || borrowBal > 0n) {
        console.log(`   ${symbol}:`);
        
        if (vTokenBal > 0n) {
          // Calculate underlying from vToken balance
          const underlyingBal = (vTokenBal * exchRate) / BigInt(1e18);
          console.log(`      Collateral (vToken): ${ethers.formatUnits(vTokenBal, 8)}`);
          console.log(`      Collateral (underlying): ${ethers.formatUnits(underlyingBal, config.underlyingDecimals)}`);
        }
        
        if (borrowBal > 0n) {
          console.log(`      Debt: ${ethers.formatUnits(borrowBal, config.underlyingDecimals)}`);
        }
        console.log();
      }
    } catch (e) {
      // Skip errors
    }
  }
  
  // Try to understand why shortfall exists
  console.log('\n🔬 ANALYSIS:');
  if (shortfall > 0n) {
    console.log('   This account shows shortfall but tiny debt amounts.');
    console.log('   Possible reasons:');
    console.log('   1. Oracle price manipulation or stale prices');
    console.log('   2. Account was already partially liquidated');
    console.log('   3. Collateral factor changes made position underwater');
    console.log('   4. The debt is in a token we did not check');
  }
}

check().catch(console.error);
