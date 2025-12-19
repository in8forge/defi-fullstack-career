import 'dotenv/config';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
const BORROWER = '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc';

// ALL Venus vTokens
const ALL_VTOKENS = {
  vBNB: '0xA07c5b74C9B40447a954e1466938b865b6BBea36',
  vBUSD: '0x95c78222B3D6e262426483D42CfA53685A67Ab9D',
  vUSDT: '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
  vUSDC: '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
  vETH: '0xf508fCD89b8bd15579dc79A6827cB4686A3592c8',
  vBTC: '0x882C173bC7Ff3b7786CA16dfeD3DFFfb9Ee7847B',
  vDAI: '0x334b3eCB4DCa3593BCCC3c7EBD1A1C1d1780FBF1',
  vXVS: '0x151B1e2635A717bcDc836ECd6FbB62B674FE3E1D',
  vSXP: '0x2fF3d0F6990a40261c66E1ff2017aCBc282EB6d0',
  vLTC: '0x57A5297F2cB2c0AaC9D554660acd6D385Ab50c6B',
  vXRP: '0xB248a295732e0225acd3337607cc01068e3b9c10',
  vDOGE: '0xec3422Ef92B2fb59e84c8B02Ba73F1fE84Ed8D71',
  vDOT: '0x1610bc33319e9398de5f57B33a5b184c806aD217',
  vLINK: '0x650b940a1033B8A1b1873f78730FcFC73ec11f1f',
  vFIL: '0xf91d58b5aE142DAcC749f58A49FCBac340Cb0343',
  vBETH: '0x972207A639CC1B374B893cc33Fa251b55CEB7c07',
  vADA: '0x9A0AF7FDb2065Ce470D72664DE73cAE409dA28Ec',
  vCAKE: '0x86aC3974e2BD0d60825230fa6F355fF11409df5c',
  vAAVE: '0x26DA28954763B92139ED49283625ceCAf52C6f94',
  vTUSD: '0x08CEB3F4a7ed3500cA0982bcd0FC7816688084c3',
  vTRX: '0x61eDcFe8Dd6bA3c891CB9bEc2dc7657B3B422E93',
  vMATIC: '0x5c9476FcD6a4F9a3654139721c949c2233bBbBc8',
};

const VTOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function borrowBalanceStored(address) view returns (uint256)',
  'function getAccountSnapshot(address) view returns (uint256, uint256, uint256, uint256)',
];

async function check() {
  console.log('Checking ALL vTokens for collateral and debt...\n');
  
  for (const [symbol, address] of Object.entries(ALL_VTOKENS)) {
    try {
      const vToken = new ethers.Contract(address, VTOKEN_ABI, provider);
      const [err, vBal, borrowBal, exchRate] = await vToken.getAccountSnapshot(BORROWER);
      
      if (vBal > 0n || borrowBal > 0n) {
        console.log(`${symbol}:`);
        if (vBal > 0n) {
          const underlying = (vBal * exchRate) / BigInt(1e18);
          console.log(`   Collateral: ${ethers.formatUnits(vBal, 8)} vTokens (${ethers.formatEther(underlying)} underlying)`);
        }
        if (borrowBal > 0n) {
          console.log(`   Debt: ${ethers.formatEther(borrowBal)}`);
        }
      }
    } catch {}
  }
  
  // Re-check liquidity
  const comptroller = new ethers.Contract(
    '0xfD36E2c2a6789Db23113685031d7F16329158384',
    ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)'],
    provider
  );
  
  const [error, liquidity, shortfall] = await comptroller.getAccountLiquidity(BORROWER);
  console.log('\n--- CURRENT STATUS ---');
  console.log(`Shortfall: $${Number(ethers.formatEther(shortfall)).toFixed(2)}`);
  console.log(`Liquidatable: ${shortfall > 0n}`);
}

check().catch(console.error);
