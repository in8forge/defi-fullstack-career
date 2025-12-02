import { ethers } from "ethers";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

// ---- CONFIG ----

// Use Alchemy Sepolia RPC (NOT localhost)
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
if (!ALCHEMY_API_KEY) {
  throw new Error("Missing ALCHEMY_API_KEY in .env");
}

const provider = new ethers.JsonRpcProvider(
  `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
);

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  throw new Error("Missing PRIVATE_KEY in .env");
}

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Your deployed bot
const BOT_ADDRESS = "0xAFD366d5A106F0e0fE26A6544F58d85e673d60e7";

// Minimal ABI – adjust to your real contract if needed
const BOT_ABI = [
  "event ArbitrageExecuted(uint256 profitEth, uint256 profitToken)"
  // add more function signatures here later if you want
];

const bot = new ethers.Contract(BOT_ADDRESS, BOT_ABI, wallet);

// ---- MAIN ----

console.log("Monitoring arbitrage bot at:", BOT_ADDRESS);
console.log("RPC:", `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`);

bot.on("ArbitrageExecuted", async (profitEth, profitToken, event) => {
  const logText = `
--- NEW ARBITRAGE ---
Block: ${event.blockNumber}
Profit ETH: ${ethers.formatEther(profitEth)}
Profit Token (raw): ${profitToken.toString()}
Tx: ${event.transactionHash}
Timestamp: ${new Date().toISOString()}
---------------------
`;
  fs.appendFileSync("monitor/trades.log", logText);
  console.log(logText);
});

console.log("Live monitor started. Waiting for events...");

