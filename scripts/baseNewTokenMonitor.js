import { JsonRpcProvider, Contract } from "ethers";
import { BASE_CONFIG } from "../config/base.config.js";
import dotenv from "dotenv";

dotenv.config();

const UNISWAP_V2_FACTORY = BASE_CONFIG.dexes.UNISWAP_V2.factory;

const FACTORY_ABI = [
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)"
];

const ERC20_ABI = [
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

async function getTokenInfo(address, provider) {
  try {
    const token = new Contract(address, ERC20_ABI, provider);
    const [name, symbol, decimals] = await Promise.all([
      token.name(),
      token.symbol(),
      token.decimals()
    ]);
    return { name, symbol, decimals };
  } catch {
    return { name: "Unknown", symbol: "???", decimals: 18 };
  }
}

async function analyzePair(pairAddress, provider) {
  try {
    const pair = new Contract(pairAddress, PAIR_ABI, provider);
    const [token0, token1, reserves] = await Promise.all([
      pair.token0(),
      pair.token1(),
      pair.getReserves()
    ]);
    
    const [token0Info, token1Info] = await Promise.all([
      getTokenInfo(token0, provider),
      getTokenInfo(token1, provider)
    ]);
    
    const reserve0 = Number(reserves[0]) / (10 ** token0Info.decimals);
    const reserve1 = Number(reserves[1]) / (10 ** token1Info.decimals);
    
    // Rough liquidity estimate
    const liquidityUSD = reserve0 * 3130; // If paired with WETH
    
    const isWETHPair = token0.toLowerCase() === BASE_CONFIG.tokens.WETH.toLowerCase() || 
                       token1.toLowerCase() === BASE_CONFIG.tokens.WETH.toLowerCase();
    
    const isUSDCPair = token0.toLowerCase() === BASE_CONFIG.tokens.USDC.toLowerCase() || 
                       token1.toLowerCase() === BASE_CONFIG.tokens.USDC.toLowerCase();
    
    return {
      pairAddress,
      token0: { address: token0, ...token0Info, reserve: reserve0 },
      token1: { address: token1, ...token1Info, reserve: reserve1 },
      liquidityUSD,
      isWETHPair,
      isUSDCPair,
      isInteresting: isWETHPair || isUSDCPair
    };
  } catch (error) {
    return null;
  }
}

async function pollForNewPairs(provider) {
  console.log("\n" + "=".repeat(80));
  console.log("👀 MONITORING NEW TOKEN LAUNCHES (POLLING MODE)");
  console.log("=".repeat(80));
  console.log("\nChecking every 30 seconds for new pairs...");
  console.log("Press Ctrl+C to stop\n");
  
  const factory = new Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
  let lastCheckedBlock = await provider.getBlockNumber();
  let pairsFound = 0;
  
  while (true) {
    try {
      const currentBlock = await provider.getBlockNumber();
      
      if (currentBlock > lastCheckedBlock) {
        const filter = factory.filters.PairCreated();
        const events = await factory.queryFilter(filter, lastCheckedBlock + 1, currentBlock);
        
        for (const event of events) {
          pairsFound++;
          console.log("\n" + "=".repeat(80));
          console.log(`🚨 NEW PAIR #${pairsFound} DETECTED!`);
          console.log("=".repeat(80));
          console.log(`Block: ${event.blockNumber}`);
          console.log(`Pair: ${event.args.pair}`);
          console.log("\nAnalyzing...");
          
          const pairInfo = await analyzePair(event.args.pair, provider);
          
          if (pairInfo) {
            console.log("\n📊 DETAILS:");
            console.log(`   ${pairInfo.token0.symbol}/${pairInfo.token1.symbol}`);
            console.log(`   Liquidity: ~$${pairInfo.liquidityUSD.toFixed(0)}`);
            
            if (pairInfo.isInteresting) {
              console.log("\n💰 HIGH-VALUE PAIR!");
              if (pairInfo.isWETHPair) console.log("   ✅ WETH pair - check arbitrage NOW");
              if (pairInfo.isUSDCPair) console.log("   ✅ USDC pair - check arbitrage NOW");
              console.log(`\n   🎯 New Token: ${pairInfo.token0.address === BASE_CONFIG.tokens.WETH || pairInfo.token0.address === BASE_CONFIG.tokens.USDC ? pairInfo.token1.address : pairInfo.token0.address}`);
            }
          }
          console.log("=".repeat(80));
        }
        
        lastCheckedBlock = currentBlock;
      }
      
      // Wait 30 seconds
      await new Promise(resolve => setTimeout(resolve, 30000));
      
    } catch (error) {
      console.log(`\n⚠️  Error: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

async function checkRecentPairs(provider) {
  console.log("🔍 Checking recent pairs (last 5 hours)...\n");
  
  const factory = new Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
  const latestBlock = await provider.getBlockNumber();
  const fromBlock = latestBlock - 10000; // ~5 hours on Base (2 sec blocks)
  
  const filter = factory.filters.PairCreated();
  const events = await factory.queryFilter(filter, fromBlock, latestBlock);
  
  console.log(`Found ${events.length} new pairs\n`);
  
  const interesting = [];
  
  for (const event of events.slice(-20)) {
    const pairInfo = await analyzePair(event.args.pair, provider);
    if (pairInfo?.isInteresting) {
      interesting.push(pairInfo);
    }
  }
  
  if (interesting.length > 0) {
    console.log("💰 RECENT INTERESTING PAIRS:");
    interesting.forEach(p => {
      console.log(`   ${p.token0.symbol}/${p.token1.symbol} - $${p.liquidityUSD.toFixed(0)} liquidity`);
      console.log(`   Pair: ${p.pairAddress}\n`);
    });
  } else {
    console.log("   No interesting pairs found recently\n");
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔵 BASE NEW TOKEN LAUNCH MONITOR");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  
  console.log("\n✅ Connected to Base\n");
  
  // Check recent pairs first
  await checkRecentPairs(provider);
  
  // Then start polling for new ones
  await pollForNewPairs(provider);
}

main().catch(console.error);
