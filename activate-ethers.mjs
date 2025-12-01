import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Load env
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!ALCHEMY_API_KEY || !PRIVATE_KEY) {
  console.error("Missing ALCHEMY_API_KEY or PRIVATE_KEY in .env");
  process.exit(1);
}

// 2) Provider + wallet
const rpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// 3) Load ABI only
const artifactPath = path.join(
  __dirname,
  "artifacts",
  "contracts",
  "ArbitrageBot.sol",
  "ArbitrageBot.json"
);

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const { abi } = artifact;

// 4) INSERT your deployed bot address here:
const BOT_ADDRESS = "0xAFD366d5A106F0e0fE26A6544F58d85e673d60e7";

async function main() {
  console.log("Using wallet:", await wallet.getAddress());
  console.log("Connecting to bot:", BOT_ADDRESS);

  const bot = new ethers.Contract(BOT_ADDRESS, abi, wallet);

  console.log("Calling activate()...");
  const tx = await bot.activate();
  console.log("Transaction sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("activate() confirmed in block:", receipt.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

