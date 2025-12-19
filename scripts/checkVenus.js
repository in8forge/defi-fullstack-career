import 'dotenv/config';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
const comptroller = new ethers.Contract(
  '0xfD36E2c2a6789Db23113685031d7F16329158384',
  ['function getAccountLiquidity(address) view returns (uint256, uint256, uint256)'],
  provider
);

const address = '0x489A8756C18C0b8B24EC2a2b9FF3D4d447F79BEc';

async function check() {
  const [error, liquidity, shortfall] = await comptroller.getAccountLiquidity(address);
  console.log('Error:', error.toString());
  console.log('Liquidity:', ethers.formatEther(liquidity), 'USD');
  console.log('Shortfall:', ethers.formatEther(shortfall), 'USD');
  console.log('Liquidatable:', shortfall > 0n);
}

check();
