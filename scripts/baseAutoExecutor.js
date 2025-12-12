import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { BASE_CONFIG } from "../config/base.config.js";
import dotenv from "dotenv";

dotenv.config();

const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const ERC20_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const WETH = BASE_CONFIG.tokens.WETH;
const USDC = BASE_CONFIG.tokens.USDC;

// 🔥 ALL BASE DEXs
const DEXS = [
  { 
    name: "Uniswap V2", 
    router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
    factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"
  },
  { 
    name: "SushiSwap", 
    router: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891",
    factory: "0x71524B4f93c58fcbF659783284E38825f0622859"
  },
  { 
    name: "BaseSwap", 
    router: "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86",
    factory: "0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB"
  },
  { 
    name: "SwapBased", 
    router: "0xaaa3b1F1bd7BCc97fD1917c18ADE665C5D31F066",
    factory: "0x04C9f118d21e8B767D2e50C946f0cC9F6C367300"
  },
  { 
    name: "RocketSwap", 
    router: "0x4cf76043B3f97ba06917cBd90F9e3A2AAC1B306e",
    factory: "0x1B8128c3A1B7D20053D10763ff02466ca7FF99FC"
  },
  { 
    name: "Synthswap",
    router: "0x8734B3264Dbd22F899BCeF4E92D442d951199a7F",
    factory: "0x4bd16d59A5E1E0DB903F724aa9d721a31d7D720D"
  }
];

const TRADE_AMOUNT_USDC = "10";
const MIN_PROFIT_USD = 0.30; // Lowered to $0.30 with more DEXs
const SLIPPAGE_PERCENT = 2;
const EXECUTION_ENABLED = process.env.ENABLE_EXECUTION === "true";

async function getQuote(router, amountIn, path, provider) {
  try {
    const routerContract = new Contract(router, ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

async function findBestArbitrage(provider) {
  const tradeAmount = parseUnits(TRADE_AMOUNT_USDC, 6);
  const opportunities = [];
  
  // Get WETH quotes from all DEXs
  const quotes = [];
  for (const dex of DEXS) {
    const wethOut = await getQuote(dex.router, tradeAmount, [USDC, WETH], provider);
    if (wethOut) {
      quotes.push({ dex, wethOut });
    }
  }
  
  console.log(`\n📊 DEX Quotes for $${TRADE_AMOUNT_USDC} USDC → WETH:`);
  quotes.forEach(q => {
    console.log(`   ${q.dex.name.padEnd(12)}: ${formatUnits(q.wethOut, 18).slice(0, 12)} WETH`);
  });
  
  // Find all cross-DEX arbitrage opportunities
  for (let i = 0; i < quotes.length; i++) {
    for (let j = 0; j < quotes.length; j++) {
      if (i === j) continue;
      
      const buyDex = quotes[i];
      const sellDex = quotes[j];
      
      // Get USDC back from selling WETH on different DEX
      const usdcBack = await getQuote(sellDex.dex.router, buyDex.wethOut, [WETH, USDC], provider);
      
      if (usdcBack) {
        const profit = Number(formatUnits(usdcBack, 6)) - Number(TRADE_AMOUNT_USDC);
        opportunities.push({
          route: `${buyDex.dex.name} → ${sellDex.dex.name}`,
          profit,
          buyDex: buyDex.dex.router,
          sellDex: sellDex.dex.router,
          buyDexName: buyDex.dex.name,
          sellDexName: sellDex.dex.name,
          wethAmount: buyDex.wethOut,
          expectedOut: usdcBack
        });
      }
    }
  }
  
  // Sort by profit
  opportunities.sort((a, b) => b.profit - a.profit);
  
  // Show top 3
  console.log(`\n🎯 Top Arbitrage Routes:`);
  opportunities.slice(0, 3).forEach((opp, i) => {
    const status = opp.profit >= MIN_PROFIT_USD ? "✅" : "❌";
    console.log(`   ${i + 1}. ${opp.route}: $${opp.profit.toFixed(4)} ${status}`);
  });
  
  return opportunities[0] || null;
}

async function executeArbitrage(opp, wallet, provider) {
  if (!EXECUTION_ENABLED) {
    console.log("\n⚠️  EXECUTION DISABLED");
    return false;
  }
  
  console.log(`\n⚡ EXECUTING: ${opp.route}`);
  console.log(`   Expected profit: $${opp.profit.toFixed(4)}`);
  
  try {
    const usdc = new Contract(USDC, ERC20_ABI, wallet);
    const weth = new Contract(WETH, ERC20_ABI, wallet);
    const tradeAmount = parseUnits(TRADE_AMOUNT_USDC, 6);
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    // Approve USDC for buy DEX
    const allowance = await usdc.allowance(wallet.address, opp.buyDex);
    if (allowance < tradeAmount) {
      console.log(`   Approving USDC for ${opp.buyDexName}...`);
      await (await usdc.approve(opp.buyDex, parseUnits("1000000", 6))).wait();
    }
    
    // Swap 1: USDC → WETH on buy DEX
    console.log(`   Swap 1: USDC → WETH on ${opp.buyDexName}...`);
    const router1 = new Contract(opp.buyDex, ROUTER_ABI, wallet);
    const minWeth = opp.wethAmount * BigInt(100 - SLIPPAGE_PERCENT) / 100n;
    await (await router1.swapExactTokensForTokens(tradeAmount, minWeth, [USDC, WETH], wallet.address, deadline)).wait();
    console.log(`   ✅ Got WETH`);
    
    // Check WETH balance
    const wethBalance = await weth.balanceOf(wallet.address);
    
    // Approve WETH for sell DEX
    const wethAllowance = await weth.allowance(wallet.address, opp.sellDex);
    if (wethAllowance < wethBalance) {
      console.log(`   Approving WETH for ${opp.sellDexName}...`);
      await (await weth.approve(opp.sellDex, parseUnits("1000", 18))).wait();
    }
    
    // Swap 2: WETH → USDC on sell DEX
    console.log(`   Swap 2: WETH → USDC on ${opp.sellDexName}...`);
    const router2 = new Contract(opp.sellDex, ROUTER_ABI, wallet);
    const minUsdc = opp.expectedOut * BigInt(100 - SLIPPAGE_PERCENT) / 100n;
    await (await router2.swapExactTokensForTokens(wethBalance, minUsdc, [WETH, USDC], wallet.address, deadline)).wait();
    
    const finalUsdc = await usdc.balanceOf(wallet.address);
    console.log(`\n   💰 SUCCESS! Final USDC: $${formatUnits(finalUsdc, 6)}`);
    
    return true;
    
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔵 BASE MULTI-DEX ARBITRAGE BOT v4");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const wallet = new Wallet(process.env.PRIVATE_KEY, provider);
  
  console.log(`\n✅ Connected to Base`);
  console.log(`👛 Wallet: ${wallet.address}`);
  
  const ethBalance = await provider.getBalance(wallet.address);
  const usdcContract = new Contract(USDC, ERC20_ABI, provider);
  const usdcBalance = await usdcContract.balanceOf(wallet.address);
  
  console.log(`💰 ETH: ${formatUnits(ethBalance, 18)} ETH`);
  console.log(`💵 USDC: ${formatUnits(usdcBalance, 6)} USDC`);
  
  console.log(`\n📊 Settings:`);
  console.log(`   Trade: $${TRADE_AMOUNT_USDC} | Min Profit: $${MIN_PROFIT_USD} | Slippage: ${SLIPPAGE_PERCENT}%`);
  console.log(`   Execution: ${EXECUTION_ENABLED ? "✅ ENABLED" : "❌ DISABLED"}`);
  console.log(`   DEXs: ${DEXS.length} (${DEXS.map(d => d.name).join(", ")})`);
  
  console.log("\n" + "=".repeat(80));
  console.log("👀 SCANNING ALL DEXs EVERY 15 SECONDS...");
  console.log("=".repeat(80));
  
  let checks = 0;
  let trades = 0;
  
  while (true) {
    try {
      checks++;
      
      const arb = await findBestArbitrage(provider);
      
      if (arb && arb.profit >= MIN_PROFIT_USD) {
        console.log("\n💰💰💰 PROFITABLE OPPORTUNITY! 💰💰💰");
        const success = await executeArbitrage(arb, wallet, provider);
        if (success) trades++;
      }
      
      console.log(`\n[Check #${checks}] Trades: ${trades} | Waiting 15s...\n`);
      console.log("=".repeat(80));
      
      await new Promise(r => setTimeout(r, 15000));
      
    } catch (error) {
      console.log(`⚠️ ${error.message}`);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

main().catch(console.error);
