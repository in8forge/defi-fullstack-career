import dotenv from "dotenv";
dotenv.config();

// Base Network Configuration
export const BASE_CONFIG = {
  // Network - Use Alchemy instead of public RPC
  rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  chainId: 8453,
  name: "Base",
  
  // DEXs on Base
  dexes: {
    UNISWAP_V2: {
      router: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24",
      factory: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6"
    },
    UNISWAP_V3: {
      router: "0x2626664c2603336E57B271c5C0b26F421741e481",
      quoter: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
      factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD"
    },
    SUSHISWAP: {
      router: "0x6BDED42c6DA8FBf0d2bA55B2fa120C5e0c8D7891",
      factory: "0x71524B4f93c58fcbF659783284E38825f0622859"
    }
  },
  
  // Major tokens on Base
  tokens: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22"
  },
  
  // Gas settings
  gas: {
    maxPriorityFeePerGas: "0.001",
    maxFeePerGas: "0.01",
    gasLimit: 500000
  },
  
  // Profitability thresholds
  thresholds: {
    minProfitUSD: 2,
    minROI: 0.2,
    maxGasPriceGwei: 1,
    maxSlippage: 2
  }
};
