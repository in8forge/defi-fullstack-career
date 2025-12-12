import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { alertArbitrage } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const DEXS = [
  { name: "Uniswap V2", router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24" },
  { name: "SushiSwap", router: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891" },
  { name: "BaseSwap", router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86" },
  { name: "SwapBased", router: "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066" },
];

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, address[] calldata path) view returns (uint256[] memory)"
];

const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

async function getQuote(router, amountIn, path) {
  try {
    const contract = new Contract(router, ROUTER_ABI, provider);
    const amounts = await contract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

async function scanArbitrage() {
  const amountIn = parseUnits("10", 6); // $10 USDC
  const path = [USDC, WETH];
  
  const quotes = [];
  for (const dex of DEXS) {
    const quote = await getQuote(dex.router, amountIn, path);
    if (quote) quotes.push({ name: dex.name, quote, router: dex.router });
  }
  
  if (quotes.length < 2) return null;
  
  quotes.sort((a, b) => Number(b.quote - a.quote));
  const best = quotes[0];
  const worst = quotes[quotes.length - 1];
  
  const diff = Number(best.quote - worst.quote);
  const diffPercent = (diff / Number(worst.quote)) * 100;
  
  return { best, worst, diffPercent };
}

async function main() {
  console.log("\n🔄 ARBITRAGE BOT WITH DISCORD ALERTS");
  console.log("=====================================\n");
  
  await alertArbitrage("Bot started! Scanning 4 DEXs every 15 seconds...");
  
  let scans = 0;
  
  while (true) {
    try {
      scans++;
      const result = await scanArbitrage();
      
      if (result && result.diffPercent > 0.5) {
        const msg = `**Opportunity Found!**\n\nBuy: ${result.worst.name}\nSell: ${result.best.name}\nSpread: ${result.diffPercent.toFixed(2)}%`;
        console.log(`\n🎯 ${msg}`);
        await alertArbitrage(msg);
      }
      
      if (scans % 20 === 0) {
        console.log(`[${new Date().toISOString().split('T')[1].split('.')[0]}] Scans: ${scans}`);
      }
      
      await new Promise(r => setTimeout(r, 15000));
      
    } catch (error) {
      console.log(`Error: ${error.message}`);
      await new Promise(r => setTimeout(r, 30000));
    }
  }
}

main().catch(console.error);
