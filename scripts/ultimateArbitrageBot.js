import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertArbitrage } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

const SCAN_INTERVAL = 5000;
const MIN_PROFIT_USD = 0.30;
const MAX_SPREAD_PERCENT = 5;  // Ignore spreads > 5% (likely errors)
const TRADE_AMOUNT_USD = 10;
const AUTO_EXECUTE = process.env.ENABLE_EXECUTION === "true";

const CHAINS = {
  Base: {
    rpc: process.env.BASE_RPC_URL,
    gasPrice: 0.01,
    dexs: [
      { name: "Uniswap V2", router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", type: "v2" },
      { name: "SushiSwap", router: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891", type: "v2" },
      { name: "BaseSwap", router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86", type: "v2" },
      { name: "SwapBased", router: "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066", type: "v2" },
    ],
    tokens: {
      WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
    },
    pairs: [
      { from: "USDC", to: "WETH" },
      { from: "USDC", to: "USDbC" },
    ]
  },
  Arbitrum: {
    rpc: process.env.ARBITRUM_RPC_URL,
    gasPrice: 0.02,
    dexs: [
      { name: "SushiSwap", router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", type: "v2" },
      { name: "Camelot", router: "0xc873fEcbd354f5A56E00E710B90EF4201db2448d", type: "v2" },
    ],
    tokens: {
      WETH: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18 },
      USDC: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
      USDT: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
    },
    pairs: [
      { from: "USDC", to: "WETH" },
      { from: "USDC", to: "USDT" },
    ]
  },
  Polygon: {
    rpc: process.env.POLYGON_RPC_URL,
    gasPrice: 0.02,
    dexs: [
      { name: "QuickSwap", router: "0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", type: "v2" },
      { name: "SushiSwap", router: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", type: "v2" },
    ],
    tokens: {
      WETH: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18 },
      USDC: { address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", decimals: 6 },
      USDT: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
    },
    pairs: [
      { from: "USDC", to: "WETH" },
      { from: "USDC", to: "USDT" },
    ]
  },
  Avalanche: {
    rpc: process.env.AVALANCHE_RPC_URL,
    gasPrice: 0.05,
    dexs: [
      { name: "TraderJoe", router: "0x60aE616a2155Ee3d9A68541Ba4544862310933d4", type: "v2" },
      { name: "Pangolin", router: "0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106", type: "v2" },
    ],
    tokens: {
      WAVAX: { address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18 },
      USDC: { address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
      USDT: { address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
    },
    pairs: [
      { from: "USDC", to: "WAVAX" },
      { from: "USDC", to: "USDT" },
    ]
  }
};

const V2_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
];

async function getQuote(provider, router, amountIn, tokenIn, tokenOut) {
  try {
    const contract = new Contract(router, V2_ROUTER_ABI, provider);
    const amounts = await contract.getAmountsOut(amountIn, [tokenIn, tokenOut]);
    return amounts[1];
  } catch {
    return null;
  }
}

async function findArbitrage(chain, config) {
  const provider = new JsonRpcProvider(config.rpc);
  const opportunities = [];
  
  for (const pair of config.pairs) {
    const tokenFrom = config.tokens[pair.from];
    const tokenTo = config.tokens[pair.to];
    if (!tokenFrom || !tokenTo) continue;
    
    const amountIn = parseUnits(TRADE_AMOUNT_USD.toString(), tokenFrom.decimals);
    const quotes = [];
    
    for (const dex of config.dexs) {
      const quote = await getQuote(provider, dex.router, amountIn, tokenFrom.address, tokenTo.address);
      
      if (quote && quote > 0n) {
        const quoteFormatted = Number(formatUnits(quote, tokenTo.decimals));
        
        // Sanity check - reject obviously wrong quotes
        if (pair.from === "USDC" && pair.to === "WETH") {
          // $10 USDC should get ~0.003 WETH (at ~$3000/ETH)
          if (quoteFormatted > 0.0001 && quoteFormatted < 1) {
            quotes.push({ dex: dex.name, router: dex.router, quote, quoteFormatted });
          }
        } else if (pair.from === "USDC" && (pair.to === "USDbC" || pair.to === "USDT")) {
          // Stablecoin swap - should be ~$10
          if (quoteFormatted > 5 && quoteFormatted < 15) {
            quotes.push({ dex: dex.name, router: dex.router, quote, quoteFormatted });
          }
        } else if (pair.from === "USDC" && pair.to === "WAVAX") {
          // $10 USDC should get ~0.25 AVAX (at ~$40/AVAX)
          if (quoteFormatted > 0.1 && quoteFormatted < 10) {
            quotes.push({ dex: dex.name, router: dex.router, quote, quoteFormatted });
          }
        } else {
          quotes.push({ dex: dex.name, router: dex.router, quote, quoteFormatted });
        }
      }
    }
    
    if (quotes.length < 2) continue;
    
    quotes.sort((a, b) => b.quoteFormatted - a.quoteFormatted);
    const best = quotes[0];
    const worst = quotes[quotes.length - 1];
    
    const spreadPercent = ((best.quoteFormatted - worst.quoteFormatted) / worst.quoteFormatted) * 100;
    
    // Only consider realistic spreads
    if (spreadPercent > 0.01 && spreadPercent < MAX_SPREAD_PERCENT) {
      const spreadUSD = (spreadPercent / 100) * TRADE_AMOUNT_USD;
      const profit = spreadUSD - (config.gasPrice * 2);
      
      if (profit > MIN_PROFIT_USD) {
        opportunities.push({
          chain,
          pair: `${pair.from}→${pair.to}`,
          buyDex: worst.dex,
          sellDex: best.dex,
          buyQuote: worst.quoteFormatted,
          sellQuote: best.quoteFormatted,
          spreadPercent,
          profit
        });
      }
    }
  }
  
  return opportunities;
}

async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🔄 ULTIMATE ARBITRAGE BOT - MULTI-CHAIN");
  console.log("=".repeat(70));
  console.log(`\n⚡ Scan interval: ${SCAN_INTERVAL}ms`);
  console.log(`💰 Min profit: $${MIN_PROFIT_USD}`);
  console.log(`📊 Trade size: $${TRADE_AMOUNT_USD}`);
  console.log(`🔒 Max spread: ${MAX_SPREAD_PERCENT}% (filters bad data)`);
  console.log(`🤖 Auto-execute: ${AUTO_EXECUTE ? "ON 🟢" : "OFF 🔴"}`);
  
  console.log(`\n🌐 Chains:`);
  for (const [chain, config] of Object.entries(CHAINS)) {
    console.log(`   ${chain}: ${config.dexs.map(d => d.name).join(", ")}`);
  }
  
  await alertArbitrage(`🔄 **Arbitrage Bot Started!**\n\n5 chains | ${Object.values(CHAINS).reduce((s, c) => s + c.dexs.length, 0)} DEXs`);
  
  let scans = 0;
  let found = 0;
  
  while (true) {
    scans++;
    
    for (const [chain, config] of Object.entries(CHAINS)) {
      try {
        const opps = await findArbitrage(chain, config);
        
        for (const opp of opps) {
          found++;
          
          console.log(`\n🎯 OPPORTUNITY #${found}`);
          console.log(`   ${opp.chain} | ${opp.pair}`);
          console.log(`   Buy: ${opp.buyDex} → Sell: ${opp.sellDex}`);
          console.log(`   Spread: ${opp.spreadPercent.toFixed(3)}%`);
          console.log(`   💰 Profit: $${opp.profit.toFixed(4)}`);
          
          await alertArbitrage(
            `🎯 **Arbitrage #${found}**\n\n` +
            `${opp.chain} | ${opp.pair}\n` +
            `Buy: ${opp.buyDex}\n` +
            `Sell: ${opp.sellDex}\n` +
            `Spread: ${opp.spreadPercent.toFixed(3)}%\n` +
            `💰 Profit: $${opp.profit.toFixed(4)}`
          );
        }
      } catch {}
    }
    
    if (scans % 12 === 0) {
      const time = new Date().toLocaleTimeString();
      console.log(`\n[${time}] Scans: ${scans} | Opportunities: ${found}`);
    }
    
    await new Promise(r => setTimeout(r, SCAN_INTERVAL));
  }
}

main();
