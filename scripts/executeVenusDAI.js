import 'dotenv/config';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const BORROWER = '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc';
const LIQUIDATOR = '0x163A862679E73329eA835aC302E54aCBee7A58B1';

// The actual debt token
const vDAI = '0x334b3eCB4DCa3593BCCC3c7EBD1A1C1d1780FBF1';
const DAI = '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3'; // BSC DAI

// Collateral - need to find what they have
const VTOKENS = {
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vBUSD: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
};

const VTOKEN_ABI = [
  'function getAccountSnapshot(address) view returns (uint256, uint256, uint256, uint256)',
  'function balanceOf(address) view returns (uint256)',
];

async function findCollateral() {
  console.log('🔍 Finding collateral...\n');
  
  let maxCollateral = { token: null, balance: 0n, symbol: '' };
  
  for (const [symbol, address] of Object.entries(VTOKENS)) {
    const vToken = new ethers.Contract(address, VTOKEN_ABI, provider);
    const balance = await vToken.balanceOf(BORROWER);
    
    if (balance > 0n) {
      console.log(`   ${symbol}: ${ethers.formatUnits(balance, 8)} vTokens`);
      if (balance > maxCollateral.balance) {
        maxCollateral = { token: address, balance, symbol };
      }
    }
  }
  
  return maxCollateral;
}

async function execute() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🔥 VENUS DAI LIQUIDATION                                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  const balance = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} BNB\n`);
  
  const collateral = await findCollateral();
  
  if (!collateral.token) {
    console.log('❌ No collateral found - account may have been liquidated already');
    return;
  }
  
  // 50% of $57,100 DAI debt = ~$28,550
  const repayAmount = ethers.parseEther('28550'); // 28,550 DAI (18 decimals)
  
  console.log(`\n📊 LIQUIDATION PLAN:`);
  console.log(`   Borrower: ${BORROWER}`);
  console.log(`   Debt: vDAI ($57,100)`);
  console.log(`   Collateral: ${collateral.symbol}`);
  console.log(`   Repay Amount: 28,550 DAI (50%)`);
  console.log(`   Expected Bonus: ~8% = ~$2,284 profit`);
  
  const liquidator = new ethers.Contract(LIQUIDATOR, [
    'function executeLiquidation(address debtAsset, uint256 debtAmount, address vTokenBorrowed, address vTokenCollateral, address borrower) external'
  ], wallet);
  
  console.log('\n⚡ Executing liquidation...\n');
  
  try {
    const feeData = await provider.getFeeData();
    
    const tx = await liquidator.executeLiquidation(
      DAI,                    // debt asset (DAI)
      repayAmount,            // amount to repay
      vDAI,                   // vToken borrowed
      collateral.token,       // vToken collateral
      BORROWER,
      {
        gasLimit: 2000000n,
        gasPrice: feeData.gasPrice * 2n,
      }
    );
    
    console.log(`TX: ${tx.hash}`);
    console.log(`🔗 https://bscscan.com/tx/${tx.hash}\n`);
    console.log('⏳ Waiting for confirmation...\n');
    
    const receipt = await tx.wait();
    
    if (receipt.status === 1) {
      console.log('✅ LIQUIDATION SUCCESS!');
      console.log(`Gas used: ${receipt.gasUsed.toString()}`);
      console.log('\n💰 Check your wallet for profits!');
    } else {
      console.log('❌ Transaction reverted');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message.slice(0, 200)}`);
    
    if (e.message.includes('revert')) {
      console.log('\n💡 Possible issues:');
      console.log('   - Flash loan pool may not have enough DAI');
      console.log('   - Account may have been liquidated by someone else');
      console.log('   - Contract may need adjustments for DAI');
    }
  }
}

execute().catch(console.error);
