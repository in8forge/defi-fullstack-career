import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// SIMPLE ARBITRAGE - WITH TIMEOUTS
// ============================================================

const SCAN_INTERVAL = 5000;
const RPC_TIMEOUT = 3000;

const TOKENS = {
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  }
};

const FACTORIES = {
  base: [
    { name: 'UniV2', addr: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6' },
    { name: 'BaseSwap', addr: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB' },
  ]
};

const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'];

let provider;
let scanCount = 0;
let oppCount = 0;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject('timeout'), ms))
  ]);
}

async function getPrice(factory, tokenA, tokenB) {
  try {
    const f = new ethers.Contract(factory, FACTORY_ABI, provider);
    const pair = await withTimeout(f.getPair(tokenA, tokenB), RPC_TIMEOUT);
    if (pair === ethers.ZeroAddress) return null;
    
    const p = new ethers.Contract(pair, PAIR_ABI, provider);
    const [r0, r1] = await withTimeout(p.getReserves(), RPC_TIMEOUT);
    const t0 = await withTimeout(p.token0(), RPC_TIMEOUT);
    
    if (r0 === 0n || r1 === 0n) return null;
    
    return t0.toLowerCase() === tokenA.toLowerCase()
      ? Number(r1) / Number(r0)
      : Number(r0) / Number(r1);
  } catch {
    return null;
  }
}

async function scan() {
  scanCount++;
  
  const prices = [];
  for (const dex of FACTORIES.base) {
    const price = await getPrice(dex.addr, TOKENS.base.WETH, TOKENS.base.USDC);
    if (price) prices.push({ dex: dex.name, price });
  }
  
  if (prices.length >= 2) {
    prices.sort((a, b) => a.price - b.price);
    const spread = (prices[1].price - prices[0].price) / prices[0].price;
    
    if (spread > 0.002) { // 0.2% spread
      oppCount++;
      console.log(`🎯 WETH/USDC | Buy: ${prices[0].dex} @ ${prices[0].price.toFixed(2)} | Sell: ${prices[1].dex} @ ${prices[1].price.toFixed(2)} | Spread: ${(spread*100).toFixed(2)}%`);
    }
  }
  
  if (scanCount % 12 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | Opps: ${oppCount}`);
  }
}

async function main() {
  console.log('\n🔄 SIMPLE ARBITRAGE BOT\n');
  
  provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
  console.log('✅ Base connected\n');
  console.log('Scanning WETH/USDC...\n');
  
  setInterval(async () => {
    try { await scan(); } catch {}
  }, SCAN_INTERVAL);
}

main().catch(console.error);
