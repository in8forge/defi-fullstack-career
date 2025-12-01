import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// === UPDATE THIS ===
// Replace with your real token address from deploy
const TOKEN_ADDRESS = "0x48007C5962f8581732B842c729cBE7111A849821";

// Bot address
const BOT_ADDRESS = "0xAFD366d5A106F0e0fE26A6544F58d85e673d60e7";

const rpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Load token ABI
const artifactPath = path.join(
  __dirname,
  "artifacts",
  "contracts",
  "MyToken.sol",
  "MyToken.json"
);

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const { abi } = artifact;

async function main() {
  const sender = await wallet.getAddress();
  console.log("Sender:", sender);
  console.log("Token:", TOKEN_ADDRESS);
  console.log("Bot:", BOT_ADDRESS);

  const token = new ethers.Contract(TOKEN_ADDRESS, abi, wallet);

  const amount = ethers.parseUnits("100", 18);
  console.log("Sending 100 MTKN...");

  const tx = await token.transfer(BOT_ADDRESS, amount);
  console.log("Transfer tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("Confirmed in block:", receipt.blockNumber);

  const botBal = await token.balanceOf(BOT_ADDRESS);
  console.log("Bot token balance:", botBal.toString());
}

main().catch(console.error);

