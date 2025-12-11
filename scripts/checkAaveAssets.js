import { JsonRpcProvider, Contract } from "ethers";

const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
const AAVE_DATA_PROVIDER = "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3";

const DATA_PROVIDER_ABI = [
  "function getAllReservesTokens() external view returns (tuple(string symbol, address tokenAddress)[])",
  "function getReserveConfigurationData(address asset) external view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)"
];

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  const dataProvider = new Contract(AAVE_DATA_PROVIDER, DATA_PROVIDER_ABI, provider);
  
  console.log("\n🔍 Checking Aave V3 available assets on fork...\n");
  
  try {
    const reserves = await dataProvider.getAllReservesTokens();
    
    console.log(`Found ${reserves.length} assets:\n`);
    
    for (const reserve of reserves) {
      const config = await dataProvider.getReserveConfigurationData(reserve.tokenAddress);
      console.log(`${reserve.symbol.padEnd(10)} ${reserve.tokenAddress}`);
      console.log(`  Borrow enabled: ${config.borrowingEnabled}`);
      console.log(`  Collateral enabled: ${config.usageAsCollateralEnabled}`);
      console.log(`  Active: ${config.isActive}\n`);
    }
  } catch (error) {
    console.log("❌ Could not fetch Aave data");
    console.log("   Aave V3 might not be fully functional on this fork\n");
    
    console.log("💡 ALTERNATIVE APPROACH:");
    console.log("   Instead of creating a real position on the fork,");
    console.log("   let's build the liquidation bot using MOCK data");
    console.log("   Then test on a live testnet or mainnet when ready.\n");
  }
}

main().catch(console.error);
