import 'dotenv/config';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const BORROWER = '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc';
const LIQUIDATOR = '0x163A862679E73329eA835aC302E54aCBee7A58B1';

// Venus vTokens
const VTOKENS = {
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
};

const UNDERLYING = {
  vUSDT: '0x55d398326f99059fF775485246999027B3197955',
  vUSDC: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  vBNB: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
  vBTC: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c',
  vETH: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
};

const VTOKEN_ABI = [
  'function borrowBalanceStored(address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function underlying() view returns (address)',
];

async function findPositions() {
  console.log('\n🔍 Analyzing borrower position...\n');
  
  let maxDebt = { token: null, amount: 0n, symbol: '' };
  let maxCollateral = { token: null, amount: 0n, symbol: '' };
  
  for (const [symbol, address] of Object.entries(VTOKENS)) {
    const vToken = new ethers.Contract(address, VTOKEN_ABI, provider);
    
    try {
      const debt = await vToken.borrowBalanceStored(BORROWER);
      const collateral = await vToken.balanceOf(BORROWER);
      
      if (debt > 0n) {
        console.log(`   📉 Debt ${symbol}: ${ethers.formatUnits(debt, 18)}`);
        if (debt > maxDebt.amount) {
          maxDebt = { token: address, amount: debt, symbol, underlying: UNDERLYING[symbol] };
        }
      }
      
      if (collateral > 0n) {
        console.log(`   📈 Collateral ${symbol}: ${ethers.formatUnits(collateral, 8)} vTokens`);
        if (collateral > maxCollateral.amount) {
          maxCollateral = { token: address, amount: collateral, symbol };
        }
      }
    } catch (e) {
      console.log(`   ⚠️ ${symbol}: ${e.message.slice(0, 30)}`);
    }
  }
  
  return { maxDebt, maxCollateral };
}

async function execute() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🔥 VENUS LIQUIDATION EXECUTION                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`\nWallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB\n`);
  
  const { maxDebt, maxCollateral } = await findPositions();
  
  if (!maxDebt.token || !maxCollateral.token) {
    console.log('\n❌ Could not identify debt/collateral');
    return;
  }
  
  console.log(`\n📊 LIQUIDATION PLAN:`);
  console.log(`   Borrower: ${BORROWER}`);
  console.log(`   Debt Token: ${maxDebt.symbol} (${maxDebt.token})`);
  console.log(`   Collateral Token: ${maxCollateral.symbol} (${maxCollateral.token})`);
  
  // Calculate repay amount (50% of debt for Venus close factor)
  const repayAmount = maxDebt.amount / 2n;
  console.log(`   Repay Amount: ${ethers.formatUnits(repayAmount, 18)} ${maxDebt.symbol}`);
  
  // Execute via flash liquidator
  const liquidator = new ethers.Contract(LIQUIDATOR, [
    'function executeLiquidation(address debtAsset, uint256 debtAmount, address vTokenBorrowed, address vTokenCollateral, address borrower) external'
  ], wallet);
  
  console.log('\n⚡ Executing liquidation...');
  
  try {
    const gasPrice = await provider.getFeeData();
    
    const tx = await liquidator.executeLiquidation(
      maxDebt.underlying,
      repayAmount,
      maxDebt.token,
      maxCollateral.token,
      BORROWER,
      {
        gasLimit: 1500000n,
        gasPrice: gasPrice.gasPrice * 2n, // 2x gas for speed
      }
    );
    
    console.log(`   TX: ${tx.hash}`);
    console.log(`   🔗 https://bscscan.com/tx/${tx.hash}`);
    console.log('\n⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('\n✅ LIQUIDATION SUCCESS!');
      console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
    } else {
      console.log('\n❌ Transaction reverted');
    }
  } catch (e) {
    console.log(`\n❌ Error: ${e.message}`);
    
    if (e.message.includes('insufficient')) {
      console.log('\n💡 Need more BNB for gas');
    }
  }
}

execute().catch(console.error);
