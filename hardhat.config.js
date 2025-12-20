import "@nomicfoundation/hardhat-toolbox";
import 'dotenv/config';

export default {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    hardhat: {
      forking: { url: process.env.ALCHEMY_MAINNET_RPC_URL || "https://eth-mainnet.g.alchemy.com/v2/demo" }
    },
    localhost: { url: "http://127.0.0.1:8545" },
    base: { url: process.env.BASE_RPC_URL, accounts: [process.env.PRIVATE_KEY] },
    polygon: { url: process.env.POLYGON_RPC_URL, accounts: [process.env.PRIVATE_KEY] },
    arbitrum: { url: process.env.ARBITRUM_RPC_URL, accounts: [process.env.PRIVATE_KEY] },
    avalanche: { url: process.env.AVALANCHE_RPC_URL, accounts: [process.env.PRIVATE_KEY] },
    bnb: { url: process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org", accounts: [process.env.PRIVATE_KEY] }
  }
};
