import "@nomicfoundation/hardhat-ethers";
import dotenv from "dotenv";

dotenv.config();

export default {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      type: "http",
      url: `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};

