import { ethers } from "ethers";
import "dotenv/config";
import fs from "fs";

// ---- CONFIG ----

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  throw new Error("Missing ALCHEMY_API_KEY in .env");
}

const provider = new ethers.JsonRpcProvider(
  `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
);

// Your deployed bot + token on Sepolia
const BOT_ADDRESS = "0xAFD366d5A106F0e0fE26A6544F58d85e673d60e7";
const TOKEN_ADDRESS = "0x48007C5962f8581732B842c729cBE7111A849821";

// Load ABIs from Hardhat artifacts
const botJson = JSON.parse(
  fs.readFileSync("./artifacts/contracts/ArbitrageBot.sol/ArbitrageBot.json", "utf8")
);
const tokenJson = JSON.parse(
  fs.readFileSync("./artifacts/contracts/MyToken.sol/MyToken.json", "utf8")
);

const bot = new ethers.Contract(BOT_ADDRESS, botJson.abi, provider);
const token = new ethers.Contract(TOKEN_ADDRESS, tokenJson.abi, provider);

// ---- MAIN ----

async function main() {
  console.log("=== ARBITRAGE BOT STATUS (SEPOLIA) ===");
  console.log("Bot address:   ", BOT_ADDRESS);
  console.log("Token address: ", TOKEN_ADDRESS);
  console.log("--------------------------------------");

  // ETH balance
  const ethBal = await provider.getBalance(BOT_ADDRESS);
  console.log("Bot ETH balance:", ethers.formatEther(ethBal), "ETH");

  // Token balance
  const decimals = await token.decimals();
  const tokenBal = await token.balanceOf(BOT_ADDRESS);
  console.log(
    "Bot MTKN balance:",
    ethers.formatUnits(tokenBal, decimals),
    "MTKN"
  );

  // Owner (if your ArbitrageBot has owner() – if not, this will throw)
  if (bot.owner) {
    const owner = await bot.owner();
    console.log("Bot owner:     ", owner);
  } else {
    console.log("Bot owner:     (owner() not implemented in ABI)");
  }

  console.log("======================================");
}

main().catch((err) => {
  console.error("Status check failed:", err);
  process.exit(1);
});

