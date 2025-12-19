import 'dotenv/config';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');

const comptroller = new ethers.Contract(
  '0xfD36E2c2a6789Db23113685031d7F16329158384',
  ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)'],
  provider
);

// Our seed borrowers
const BORROWERS = [
  '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc',
  '0x1F6D66bA924EBf554883cF84d482394013eD294B',
  '0x7589dD3355DAE848FDbF75044A3495351655cB1A',
  '0x8249Ed6f7585C00e3A2d4a4C0a6c3aBf0D4d2a5a',
  '0x3DdfA8eC3052539b6C9549F12cEA2C295cfF5296',
  '0x2D407dDb06311396fE14D4b49da5F0471447d45C',
  '0x67A0693c53A2f84c831F9C6f65BB9A8D3e73282B',
  '0x6C68cECf7659b3E7bF76B3d6E3A9F1BC0aEa6F3A',
  '0x89C527764f03BCb7dC469707B23b79C1D7beb780',
  '0x70e36f6BF80a52b3B46b3aF8e106CC0ed743E8e4',
];

const VTOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function getAccountSnapshot(address) view returns (uint256, uint256, uint256, uint256)',
];

const VTOKENS = {
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vBUSD: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vDAI: '0x334b3eCB4DCa3593BCCC3c7EBD1A1C1d1780FBF1',
};

async function hasCollateral(address) {
  for (const [symbol, vAddr] of Object.entries(VTOKENS)) {
    try {
      const vToken = new ethers.Contract(vAddr, VTOKEN_ABI, provider);
      const balance = await vToken.balanceOf(address);
      if (balance > 0n) return true;
    } catch {}
  }
  return false;
}

async function scan() {
  console.log('🔍 Scanning Venus borrowers for REAL liquidation opportunities...\n');
  
  const opportunities = [];
  
  for (const borrower of BORROWERS) {
    try {
      const [error, liquidity, shortfall] = await comptroller.getAccountLiquidity(borrower);
      const shortfallUsd = Number(ethers.formatEther(shortfall));
      const liquidityUsd = Number(ethers.formatEther(liquidity));
      
      const hasCol = await hasCollateral(borrower);
      
      if (shortfall > 0n) {
        console.log(`🔥 ${borrower.slice(0, 12)}...`);
        console.log(`   Shortfall: $${shortfallUsd.toFixed(2)}`);
        console.log(`   Has Collateral: ${hasCol ? '✅ YES' : '❌ NO (bad debt)'}`);
        
        if (hasCol) {
          opportunities.push({ borrower, shortfall: shortfallUsd });
          console.log(`   ⚡ LIQUIDATABLE WITH PROFIT!\n`);
        } else {
          console.log(`   ❌ Bad debt - no profit\n`);
        }
      } else if (liquidityUsd > 0 && liquidityUsd < 1000) {
        console.log(`⚠️ ${borrower.slice(0, 12)}... | Liquidity: $${liquidityUsd.toFixed(2)} (close to liquidation)`);
      }
    } catch (e) {
      console.log(`❌ ${borrower.slice(0, 12)}...: ${e.message.slice(0, 30)}`);
    }
  }
  
  console.log('\n=== SUMMARY ===');
  console.log(`Profitable opportunities: ${opportunities.length}`);
  
  if (opportunities.length > 0) {
    console.log('\nReady to liquidate:');
    for (const opp of opportunities) {
      console.log(`   ${opp.borrower} | $${opp.shortfall.toFixed(0)} shortfall`);
    }
  }
}

scan().catch(console.error);
