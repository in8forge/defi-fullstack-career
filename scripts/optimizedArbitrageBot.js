import 'dotenv/config';
import { ethers } from 'ethers';

// ============================================================
// OPTIMIZED ARBITRAGE BOT - WITH DEBUG
// ============================================================

const RPC = {
  base: process.env.BASE_RPC_URL,
  arbitrum: process.env.ARBITRUM_RPC_URL,
  polygon: process.env.POLYGON_RPC_URL,
};

const TOKENS = {
  base: {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
  },
  arbitrum: {
    WETH: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
  },
  polygon: {
    WETH: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    USDC: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    WMATIC: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  }
};

const DEXES = {
  base: [
    { name: 'Uniswap V2', factory: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6' },
    { name: 'BaseSwap', factory: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB' },
    { name: 'Aerodrome', factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' },
  ],
  arbitrum: [
    { name: 'SushiSwap', factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4' },
    { name: 'Camelot', factory: '0x6EcCab422D763aC031210895C81787E87B43A652' },
  ],
  polygon: [
    { name: 'QuickSwap', factory: '0x5757371414417b8C6CAad45bAeF941aBc7d3Ab32' },
    { name: 'SushiSwap', factory: '0xc35DADB65012eC5796536bD9864eD8773aBc74C4' },
  ]
};

const FACTORY_ABI = ['function getPair(address,address) view returns (address)'];
const PAIR_ABI = ['function getReserves() view returns (uint112,uint112,uint32)', 'function token0() view returns (address)'];

const MIN_PROFIT_USD = 0.10;
const TRADE_SIZE_USD = 10;
const MAX_SPREAD = 0.03;
const SCAN_INTERVAL = 3000;

let providers = {};
let scanCount = 0;
let oppCount = 0;

async function init() {
  console.log(`
======================================================================
🔄 OPTIMIZED ARBITRAGE BOT
======================================================================
⚡ Scan interval: ${SCAN_INTERVAL}ms | 💰 Min: $${MIN_PROFIT_USD} | 🔒 Max spread: ${MAX_SPREAD * 100}%
`);

  for (const [chain, rpc] of Object.entries(RPC)) {
    if (rpc) {
      try {
        providers[chain] = new ethers.JsonRpcProvider(rpc);
        await providers[chain].getBlockNumber();
        console.log(`✅ ${chain}: Connected`);
      } catch (e) {
        console.log(`❌ ${chain}: Failed - ${e.message}`);
      }
    }
  }
  console.log('');
}

async function getPrice(provider, factory, tokenA, tokenB) {
  try {
    const f = new ethers.Contract(factory, FACTORY_ABI, provider);
    const pair = await f.getPair(tokenA, tokenB);
    if (pair === ethers.ZeroAddress) return null;
    
    const p = new ethers.Contract(pair, PAIR_ABI, provider);
    const [r0, r1] = await p.getReserves();
    const t0 = await p.token0();
    
    if (r0 === 0n || r1 === 0n) return null;
    
    // Price of tokenA in terms of tokenB
    return t0.toLowerCase() === tokenA.toLowerCase()
      ? Number(r1) / Number(r0)
      : Number(r0) / Number(r1);
  } catch {
    return null;
  }
}

async function scanChain(chain) {
  const provider = providers[chain];
  const tokens = TOKENS[chain];
  const dexes = DEXES[chain];
  if (!provider || !tokens || !dexes) return [];

  const opps = [];
  const tokenArr = Object.entries(tokens);

  for (let i = 0; i < tokenArr.length; i++) {
    for (let j = i + 1; j < tokenArr.length; j++) {
      const [nameA, addrA] = tokenArr[i];
      const [nameB, addrB] = tokenArr[j];

      const prices = [];
      for (const dex of dexes) {
        const price = await getPrice(provider, dex.factory, addrA, addrB);
        if (price && price > 0) prices.push({ dex: dex.name, price });
      }

      if (prices.length < 2) continue;

      prices.sort((a, b) => a.price - b.price);
      const buy = prices[0];
      const sell = prices[prices.length - 1];
      const spread = (sell.price - buy.price) / buy.price;

      if (spread > 0.001 && spread < MAX_SPREAD) {
        const profit = spread * TRADE_SIZE_USD;
        if (profit >= MIN_PROFIT_USD) {
          opps.push({ chain, pair: `${nameA}/${nameB}`, buy: buy.dex, sell: sell.dex, spread: (spread * 100).toFixed(2), profit: profit.toFixed(2) });
        }
      }
    }
  }
  return opps;
}

async function scan() {
  scanCount++;
  let foundAny = false;

  for (const chain of Object.keys(providers)) {
    try {
      const opps = await scanChain(chain);
      if (opps.length > 0) {
        foundAny = true;
        for (const o of opps) {
          oppCount++;
          console.log(`🎯 #${oppCount} | ${o.chain} ${o.pair} | Buy: ${o.buy} → Sell: ${o.sell} | ${o.spread}% | $${o.profit}`);
        }
      }
    } catch (e) {
      // Silent fail
    }
  }

  if (scanCount % 20 === 0) {
    console.log(`[${new Date().toLocaleTimeString()}] Scans: ${scanCount} | Opps: ${oppCount}`);
  }
}

async function main() {
  await init();
  console.log('🚀 Scanning...\n');
  
  while (true) {
    await scan();
    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

main().catch(console.error);
