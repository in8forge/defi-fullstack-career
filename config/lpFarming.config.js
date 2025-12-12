import dotenv from "dotenv";
dotenv.config();

export const LP_CONFIG = {
  rpcUrl: process.env.BASE_RPC_URL,
  chainId: 8453,
  
  aerodrome: {
    router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    voter: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"
  },
  
  // Correct pool addresses from Aerodrome
  pools: [
    {
      name: "WETH/USDC",
      address: "0xcDAC0d6c6C59727a65F871236188350531885C43",
      token0: "0x4200000000000000000000000000000000000006",
      token1: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      gauge: "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025",
      stable: false,
      apr: 25
    },
    {
      name: "USDC/USDbC",
      address: "0x27a8Afa3Bd49406e48a074350fB7b2020c43B2bD",
      token0: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      token1: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      gauge: "0x1Cfc45C5221A07DA0DE958098A319a29FbBD66fE",
      stable: true,
      apr: 15
    }
  ],
  
  settings: {
    minCompoundAmount: 1,
    compoundInterval: 86400,
    slippage: 1
  }
};
