import dotenv from "dotenv";
dotenv.config();

// Aave V3 on Base
export const AAVE_CONFIG = {
  // Network
  rpcUrl: process.env.BASE_RPC_URL,
  chainId: 8453,
  
  // Aave V3 Base Addresses
  poolAddress: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  poolDataProvider: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac",
  oracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
  
  // Flash Loan
  flashLoanPremium: 0.0005, // 0.05%
  
  // Supported Assets on Base Aave V3
  assets: {
    WETH: {
      address: "0x4200000000000000000000000000000000000006",
      decimals: 18,
      aToken: "0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7"
    },
    USDC: {
      address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      decimals: 6,
      aToken: "0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB"
    },
    USDbC: {
      address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      decimals: 6,
      aToken: "0x0a1d576f3eFeF75b330424287a95A366e8281D54"
    },
    cbETH: {
      address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
      decimals: 18,
      aToken: "0xcf3D55c10DB69f28fD1A75Bd73f3D8A2d9c595ad"
    }
  },
  
  // Liquidation Settings
  settings: {
    minHealthFactor: 1.0,        // Liquidatable below this
    minProfitUSD: 10,            // Minimum profit to execute
    maxGasPrice: 1,              // Max gas price in gwei
    liquidationBonus: 0.05       // 5% bonus (varies by asset)
  }
};
