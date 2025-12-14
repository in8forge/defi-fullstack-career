import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// AVALANCHE ARBITRAGE - Blackhole + Trader Joe + Pangolin
// Less competition than major chains!
// ============================================================

const RPC = process.env.AVALANCHE_RPC_URL;
const SCAN_INTERVAL = 3000;
const MIN_PROFIT_PCT = 0.3; // 0.3% minimum spread

// Avalanche tokens
const TOKENS = {
  WAVAX: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
  USDC: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  USDCe: '0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664',
  USDT: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
  WETHe: '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB',
  BTCb: '0x152b9d0FdC40C096757F570A51E494bd4b943E50',
};

// Avalanche DEXs - including smaller ones with less competition
const DEXES = [
  { name: 'TraderJoe', factory: '0x9Ad6C38BE94206cA50bb0d90783181c0ea4DA213', fee: 0.003 },
  { name: 'Pangolin', factory: '0xefa94DE7a4656D787667C749f7E1223D71E9FD88', fee: 0.003 },
  { name: 'SushiSwap', factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4', fee: 0.003 },
  // Blackhole uses Solidly-style - need different interface
];

const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'];

let provider;
let scanCount = 0;
let oppCount = 0;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, r) => setTimeout(() => r('timeout'), ms))]);
}

async function getPrice(factory, tokenA, tokenB) {
  try {
    const f = new ethers.Contract(factory, FACTORY_ABI, provider);
    const pair = await withTimeout(f.getPair(tokenA, tokenB), 3000);
    if (pair === ethers.ZeroAddress) return null;
    
    const p = new ethers.Contract(pair, PAIR_ABI, provider);
    const [r0, r1] = await withTimeout(p.getReserves(), 3000);
    const t0 = await withTimeout(p.token0(), 3000);
    
    if (r0 === 0n || r1 === 0n) return null;
    
    return t0.toLowerCase() === tokenA.toLowerCase()
      ? Number(r1) / Number(r0)
      : Number(r0) / Number(r1);
  } catch { return null; }
}

async function scanPair(tokenAName, tokenBName, tokenA, tokenB) {
  const prices = [];
  
  for (const dex of DEXES) {
    const price = await getPrice(dex.factory, tokenA, tokenB);
    if (price && price > 0) {
      prices.push({ dex: dex.name, price, fee: dex.fee });
    }
  }
  
  if (prices.length < 2) return null;
  
  prices.sort((a, b) => a.price - b.price);
  const buy = prices[0];
  const sell = prices[prices.length - 1];
  const spread = ((sell.price - buy.price) / buy.price) * 100;
  const netSpread = spread - (buy.fee * 100) - (sell.fee * 100); // Account for fees
  
  if (netSpread >= MIN_PROFIT_PCT) {
    return {
      pair: `${tokenAName}/${tokenBName}`,
      buyDex: buy.dex,
      sellDex: sell.dex,
      spread: spread.toFixed(2),
      netSpread: netSpread.toFixed(2),
      buyPrice: buy.price,
      sellPrice: sell.price,
    };
  }
  return null;
}

async function scan() {
  scanCount++;
  
  const pairs = [
    ['WAVAX', 'USDC', TOKENS.WAVAX, TOKENS.USDC],
    ['WAVAX', 'USDCe', TOKENS.WAVAX, TOKENS.USDCe],
    ['WAVAX', 'USDT', TOKENS.WAVAX, TOKENS.USDT],
    ['WETHe', 'USDC', TOKENS.WETHe, TOKENS.USDC],
    ['WETHe', 'WAVAX', TOKENS.WETHe, TOKENS.WAVAX],
    ['BTCb', 'WAVAX', TOKENS.BTCb, TOKENS.WAVAX],
    ['BTCb', 'USDC', TOKENS.BTCb, TOKENS.USDC],
    ['USDC', 'USDCe', TOKENS.USDC, TOKENS.USDCe],
    ['USDC', 'USDT', TOKENS.USDC, TOKENS.USDT],
  ];
  
  for (const [nameA, nameB, addrA, addrB] of pairs) {
    const opp = await scanPair(nameA, nameB, addrA, addrB);
    if (opp) {
      oppCount++;
      console.log(`
🎯 OPPORTUNITY #${oppCount}
   Pair: ${opp.pair}
   Buy: ${opp.buyDex} @ ${opp.buyPrice.toFixed(6)}
   Sell: ${opp.sellDex} @ ${opp.sellPrice.toFixed(6)}
   Spread: ${opp.spread}% (Net: ${opp.netSpread}% after fees)
`);
    }
  }
  
  if (scanCount % 20 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | Opps: ${oppCount}`);
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  🏔️  AVALANCHE ARBITRAGE BOT                                         ║
║  DEXs: TraderJoe, Pangolin, SushiSwap                                ║
║  Min Spread: ${MIN_PROFIT_PCT}% | Scan: ${SCAN_INTERVAL}ms                                   ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  provider = new ethers.JsonRpcProvider(RPC);
  const block = await provider.getBlockNumber();
  console.log(`✅ Connected to Avalanche (Block: ${block})\n`);
  console.log('🚀 Scanning...\n');
  
  setInterval(async () => {
    try { await scan(); } catch {}
  }, SCAN_INTERVAL);
}

main().catch(console.error);
