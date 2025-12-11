import { JsonRpcProvider, Contract } from "ethers";
import dotenv from "dotenv";

dotenv.config();

// Uniswap V3 Factory
const V3_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984";

// V3 Pool ABI (minimal)
const V3_POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)"
];

// V3 Factory ABI
const V3_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

const TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F"
};

const V3_FEES = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

async function checkV3Pool(tokenA, tokenB, fee, provider) {
  try {
    const factory = new Contract(V3_FACTORY, V3_FACTORY_ABI, provider);
    const poolAddress = await factory.getPool(tokenA, tokenB, fee);
    
    if (poolAddress === "0x0000000000000000000000000000000000000000") {
      return null;
    }
    
    const pool = new Contract(poolAddress, V3_POOL_ABI, provider);
    const [slot0, liquidity, token0, token1, poolFee] = await Promise.all([
      pool.slot0(),
      pool.liquidity(),
      pool.token0(),
      pool.token1(),
      pool.fee()
    ]);
    
    return {
      address: poolAddress,
      token0,
      token1,
      fee: poolFee,
      sqrtPriceX96: slot0[0],
      tick: slot0[1],
      liquidity,
      hasLiquidity: liquidity > 0n
    };
  } catch (error) {
    return null;
  }
}

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  console.log("\n" + "=".repeat(80));
  console.log("🔍 CHECKING UNISWAP V3 POOL AVAILABILITY");
  console.log("=".repeat(80) + "\n");
  
  const pairs = [
    { name: "USDC/WETH", tokenA: TOKENS.USDC, tokenB: TOKENS.WETH },
    { name: "USDC/DAI", tokenA: TOKENS.USDC, tokenB: TOKENS.DAI },
    { name: "WETH/DAI", tokenA: TOKENS.WETH, tokenB: TOKENS.DAI }
  ];
  
  for (const pair of pairs) {
    console.log(`\n${pair.name}:`);
    console.log("-".repeat(40));
    
    for (const fee of V3_FEES) {
      const pool = await checkV3Pool(pair.tokenA, pair.tokenB, fee, provider);
      
      const feePercent = (fee / 10000).toFixed(2);
      
      if (!pool) {
        console.log(`  ${feePercent}% fee: Pool doesn't exist`);
      } else if (!pool.hasLiquidity) {
        console.log(`  ${feePercent}% fee: Pool exists but no liquidity`);
        console.log(`     Address: ${pool.address}`);
      } else {
        console.log(`  ${feePercent}% fee: ✅ ACTIVE`);
        console.log(`     Address: ${pool.address}`);
        console.log(`     Liquidity: ${pool.liquidity.toString()}`);
        console.log(`     Current tick: ${pool.tick}`);
      }
    }
  }
  
  console.log("\n" + "=".repeat(80));
  console.log("ANALYSIS:");
  console.log("=".repeat(80));
  console.log("\n⚠️  Issue: Uniswap V3 pools show no liquidity on the fork");
  console.log("\nPossible reasons:");
  console.log("1. Fork doesn't capture V3 pool state correctly");
  console.log("2. V3 uses complex tick-based storage that doesn't fork well");
  console.log("3. Need to fork at a specific block with V3 liquidity");
  console.log("\n✅ Solution: Use V3 SDK for price quotes (off-chain calculation)");
  console.log("   Or: Test V3 on live testnet/mainnet with actual liquidity");
  console.log("\n" + "=".repeat(80) + "\n");
}

main().catch(console.error);
