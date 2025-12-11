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
    
    const liquidityUSD = reserve0 * 3130;
    
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

async function monitorLaunches(provider) {
  console.log("\n" + "=".repeat(80));
  console.log("👀 24/7 NEW TOKEN LAUNCH MONITOR - RUNNING");
  console.log("=".repeat(80));
  console.log("\n✅ Checking every 30 seconds");
  console.log("🎯 Will alert on WETH/USDC pairs");
  console.log("💡 Press Ctrl+C to stop\n");
  
  const factory = new Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
  let lastCheckedBlock = await provider.getBlockNumber();
  let checksPerformed = 0;
  let pairsFound = 0;
  
  while (true) {
    try {
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      const currentBlock = await provider.getBlockNumber();
      checksPerformed++;
      
      // Check exactly last 5 blocks (well within free tier limit)
      const fromBlock = currentBlock - 5;
      const toBlock = currentBlock;
      
      if (toBlock > lastCheckedBlock) {
        const filter = factory.filters.PairCreated();
        const events = await factory.queryFilter(filter, fromBlock, toBlock);
        
        if (events.length > 0) {
          for (const event of events) {
            // Skip if we've already seen this event
            if (event.blockNumber <= lastCheckedBlock) continue;
            
            pairsFound++;
            console.log("\n" + "=".repeat(80));
            console.log(`🚨 NEW PAIR #${pairsFound} DETECTED!`);
            console.log("=".repeat(80));
            console.log(`Block: ${event.blockNumber}`);
            console.log(`Pair: ${event.args.pair}`);
            
            const pairInfo = await analyzePair(event.args.pair, provider);
            
            if (pairInfo) {
              console.log(`\n📊 ${pairInfo.token0.symbol}/${pairInfo.token1.symbol}`);
              console.log(`   Liquidity: ~$${pairInfo.liquidityUSD.toFixed(0)}`);
              
              if (pairInfo.isInteresting) {
                console.log("\n💰💰💰 HIGH-VALUE PAIR! 💰💰💰");
                if (pairInfo.isWETHPair) console.log("   ✅ WETH pair - CHECK ARBITRAGE NOW!");
                if (pairInfo.isUSDCPair) console.log("   ✅ USDC pair - CHECK ARBITRAGE NOW!");
                
                const newToken = pairInfo.token0.address.toLowerCase() === BASE_CONFIG.tokens.WETH.toLowerCase() || 
                                pairInfo.token0.address.toLowerCase() === BASE_CONFIG.tokens.USDC.toLowerCase()
                  ? pairInfo.token1 : pairInfo.token0;
                
                console.log(`\n   🎯 New Token: ${newToken.address}`);
                console.log(`   📝 ${newToken.symbol}`);
              }
            }
            console.log("=".repeat(80));
          }
        }
        
        lastCheckedBlock = toBlock;
      }
      
      // Status update every 10 checks
      if (checksPerformed % 10 === 0) {
        const now = new Date().toISOString().split('T')[1].split('.')[0];
        console.log(`[${now}] ✓ Check #${checksPerformed} - Block ${currentBlock} - ${pairsFound} pairs found total`);
      }
      
    } catch (error) {
      console.log(`\n⚠️  Error: ${error.message}`);
    }
  }
}

async function main() {
  console.log("\n" + "=".repeat(80));
  console.log("🔵 BASE NEW TOKEN LAUNCH MONITOR");
  console.log("=".repeat(80));
  
  const provider = new JsonRpcProvider(process.env.BASE_RPC_URL);
  const network = await provider.getNetwork();
  const currentBlock = await provider.getBlockNumber();
  
  console.log(`\n✅ Connected to Base (Chain ${network.chainId})`);
  console.log(`📊 Current block: ${currentBlock}`);
  
  await monitorLaunches(provider);
}

main().catch(console.error);
