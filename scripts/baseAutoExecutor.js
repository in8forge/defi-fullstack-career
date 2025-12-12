import { formatUnits, parseUnits, JsonRpcProvider, Contract, Wallet } from "ethers";
import { BASE_CONFIG } from "../config/base.config.js";
import dotenv from "dotenv";

dotenv.config();

const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const UNISWAP_V2_FACTORY = BASE_CONFIG.dexes.UNISWAP_V2.factory;
const UNISWAP_V2_ROUTER = BASE_CONFIG.dexes.UNISWAP_V2.router;
const SUSHISWAP_ROUTER = BASE_CONFIG.dexes.SUSHISWAP.router;
const WETH = BASE_CONFIG.tokens.WETH;
const USDC = BASE_CONFIG.tokens.USDC;

const TRADE_AMOUNT_USDC = "10";
const MIN_PROFIT_USD = 0.50; // $0.50 minimum profit
const SLIPPAGE_PERCENT = 2;
const EXECUTION_ENABLED = process.env.ENABLE_EXECUTION === "true";

async function getTokenInfo(address, provider) {
  try {
    const token = new Contract(address, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals()
    ]);
    return { address, name, symbol, decimals };
  } catch {
    return null;
  }
}

async function getQuote(router, amountIn, path, provider) {
  try {
    const routerContract = new Contract(router, ROUTER_ABI, provider);
    const amounts = await routerContract.getAmountsOut(amountIn, path);
    return amounts[amounts.length - 1];
  } catch {
    return null;
  }
}

async function findArbitrage(newPairAddress, newTokenAddress, provider) {
  const tradeAmount = parseUnits(TRADE_AMOUNT_USDC, 6);
  
  // Strategy: Find if we can buy cheap on one DEX, sell high on another
  // Path: USDC → WETH → NewToken → WETH → USDC
  
  // Get prices from different DEXs
  const uniRouter = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, provider);
  const sushiRouter = new Contract(SUSHISWAP_ROUTER, ROUTER_ABI, provider);
  
  // Check Uniswap roundtrip: USDC → WETH → USDC
  const uniWeth = await getQuote(UNISWAP_V2_ROUTER, tradeAmount, [USDC, WETH], provider);
  if (!uniWeth) return null;
  
  const uniBack = await getQuote(UNISWAP_V2_ROUTER, uniWeth, [WETH, USDC], provider);
  if (!uniBack) return null;
  
  // Check Sushi roundtrip: USDC → WETH → USDC  
  const sushiWeth = await getQuote(SUSHISWAP_ROUTER, tradeAmount, [USDC, WETH], provider);
  const sushiBack = sushiWeth ? await getQuote(SUSHISWAP_ROUTER, sushiWeth, [WETH, USDC], provider) : null;
  
  // Check cross-DEX: Buy on Uni, Sell on Sushi
  const crossProfit1 = sushiWeth ? await getQuote(SUSHISWAP_ROUTER, uniWeth, [WETH, USDC], provider) : null;
  
  // Check cross-DEX: Buy on Sushi, Sell on Uni
  const crossProfit2 = sushiWeth ? await getQuote(UNISWAP_V2_ROUTER, sushiWeth, [WETH, USDC], provider) : null;
  
  const opportunities = [];
  
  // Uni → Sushi
  if (crossProfit1) {
    const profit1 = Number(formatUnits(crossProfit1, 6)) - Number(TRADE_AMOUNT_USDC);
    opportunities.push({
      route: "Uniswap → Sushiswap",
      profit: profit1,
      buyDex: UNISWAP_V2_ROUTER,
      sellDex: SUSHISWAP_ROUTER,
      wethAmount: uniWeth,
      expectedOut: crossProfit1
    });
  }
  
  // Sushi → Uni
  if (crossProfit2) {
    const profit2 = Number(formatUnits(crossProfit2, 6)) - Number(TRADE_AMOUNT_USDC);
    opportunities.push({
      route: "Sushiswap → Uniswap",
      profit: profit2,
      buyDex: SUSHISWAP_ROUTER,
      sellDex: UNISWAP_V2_ROUTER,
      wethAmount: sushiWeth,
      expectedOut: crossProfit2
    });
  }
  
  // Find best opportunity
  const profitable = opportunities.filter(o => o.profit >= MIN_PROFIT_USD);
  if (profitable.length > 0) {
    profitable.sort((a, b) => b.profit - a.profit);
    return profitable[0];
  }
  
  // Return best even if not profitable (for logging)
  opportunities.sort((a, b) => b.profit - a.profit);
  return opportunities[0] || null;
}

async function executeArbitrage(opportunity, wallet, provider) {
  if (!EXECUTION_ENABLED) {
    console.log("\n⚠️  EXECUTION DISABLED");
    console.log(`   Would execute: ${opportunity.route}`);
    console.log(`   Expected profit: $${opportunity.profit.toFixed(4)}`);
    return false;
  }
  
  console.log("\n⚡ EXECUTING ARBITRAGE...");
  console.log(`   Route: ${opportunity.route}`);
  console.log(`   Expected profit: $${opportunity.profit.toFixed(4)}`);
  
  try {
    const usdc = new Contract(USDC, ERC20_ABI, wallet);
    const tradeAmount = parseUnits(TRADE_AMOUNT_USDC, 6);
    
    // Check allowance and approve if needed
    const allowance = await usdc.allowance(wallet.address, opportunity.buyDex);
    if (allowance < tradeAmount) {
      console.log("   Approving USDC...");
      const approveTx = await usdc.approve(opportunity.buyDex, parseUnits("1000000", 6));
      await approveTx.wait();
      console.log("   ✅ Approved");
    }
    
    // Execute swap 1: USDC → WETH
    const router1 = new Contract(opportunity.buyDex, ROUTER_ABI, wallet);
    const minWeth = opportunity.wethAmount * BigInt(100 - SLIPPAGE_PERCENT) / 100n;
    const deadline = Math.floor(Date.now() / 1000) + 300;
    
    console.log("   Swap 1: USDC → WETH...");
    const tx1 = await router1.swapExactTokensForTokens(
      tradeAmount,
      minWeth,
      [USDC, WETH],
      wallet.address,
      deadline
    );
    await tx1.wait();
    console.log("   ✅ Got WETH");
    
    // Check WETH balance
    const weth = new Contract(WETH, ERC20_ABI, wallet);
    const wethBalance = await weth.balanceOf(wallet.address);
    
    // Approve WETH for swap 2
    const wethAllowance = await weth.allowance(wallet.address, opportunity.sellDex);
    if (wethAllowance < wethBalance) {
      console.log("   Approving WETH...");
      const approveTx2 = await weth.approve(opportunity.sellDex, parseUnits("1000", 18));
      await approveTx2.wait();
    }
    
    // Execute swap 2: WETH → USDC
    const router2 = new Contract(opportunity.sellDex, ROUTER_ABI, wallet);
    const minUsdc = opportunity.expectedOut * BigInt(100 - SLIPPAGE_PERCENT) / 100n;
    
    console.log("   Swap 2: WETH → USDC...");
    const tx2 = await router2.swapExactTokensForTokens(
      wethBalance,
      minUsdc,
      [WETH, USDC],
      wallet.address,
      deadline
    );
    await tx2.wait();
    
    // Check final balance
    const finalUsdc = await usdc.balanceOf(wallet.address);
    console.log(`   ✅ Final USDC: ${formatUnits(finalUsdc, 6)}`);
    
    return true;
    
  } catch (error) {
    console.log(`   ❌ Execution failed: ${error.message}`);
    return false;
  }
}

async function monitorAndExecute() {
  console.log("\n" + "=".repeat(80));
  console.log("🤖 BASE AUTO-EXECUTOR - ARMED AND READY");
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
  
  // Check for existing arbitrage opportunities NOW
  console.log("\n🔍 Checking current DEX prices...");
  const currentArb = await findArbitrage(null, null, provider);
  if (currentArb) {
    console.log(`   Best route: ${currentArb.route}`);
    console.log(`   Profit: $${currentArb.profit.toFixed(4)} ${currentArb.profit >= MIN_PROFIT_USD ? "✅ PROFITABLE!" : "❌"}`);
    
    if (currentArb.profit >= MIN_PROFIT_USD) {
      await executeArbitrage(currentArb, wallet, provider);
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("👀 MONITORING FOR NEW PAIRS + CHECKING PRICES...");
  console.log("=".repeat(80) + "\n");
  
  const factory = new Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
  let lastCheckedBlock = await provider.getBlockNumber();
  let checks = 0;
  let trades = 0;
  
  while (true) {
    try {
      await new Promise(resolve => setTimeout(resolve, 15000));
      
      const currentBlock = await provider.getBlockNumber();
      checks++;
      
      // Check for arbitrage every cycle
      const arb = await findArbitrage(null, null, provider);
      
      if (arb && arb.profit >= MIN_PROFIT_USD) {
        console.log("\n💰💰💰 PROFITABLE ARBITRAGE FOUND! 💰💰💰");
        console.log(`   Route: ${arb.route}`);
        console.log(`   Profit: $${arb.profit.toFixed(4)}`);
        
        const success = await executeArbitrage(arb, wallet, provider);
        if (success) trades++;
      }
      
      // Also check for new pairs
      const fromBlock = currentBlock - 5;
      const filter = factory.filters.PairCreated();
      const events = await factory.queryFilter(filter, fromBlock, currentBlock);
      
      for (const event of events) {
        if (event.blockNumber <= lastCheckedBlock) continue;
        console.log(`\n🚨 New pair: ${event.args.pair}`);
      }
      
      lastCheckedBlock = currentBlock;
      
      if (checks % 20 === 0) {
        const now = new Date().toISOString().split('T')[1].split('.')[0];
        const bestProfit = arb ? arb.profit.toFixed(4) : "N/A";
        console.log(`[${now}] Check #${checks} | Block ${currentBlock} | Best: $${bestProfit} | Trades: ${trades}`);
      }
      
    } catch (error) {
      console.log(`⚠️ ${error.message}`);
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔵 BASE ARBITRAGE AUTO-EXECUTOR v2");
  console.log("=".repeat(80));
  
  if (!process.env.PRIVATE_KEY) {
    console.log("\n❌ PRIVATE_KEY not set");
    process.exit(1);
  }
  
  await monitorAndExecute();
}

main().catch(console.error);
