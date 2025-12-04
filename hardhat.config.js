require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

const { SEPOLIA_RPC, PRIVATE_KEY, ALCHEMY_MAINNET_RPC } = process.env;

/** @type import("hardhat/config").HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  networks: {
    sepolia: {
      url: SEPOLIA_RPC || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 11155111,
    },
    fork: {
      url: ALCHEMY_MAINNET_RPC || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 1,
    },
  },
};
