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

// 2) Build provider + wallet
const rpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// 3) Load compiled artifact
const artifactPath = path.join(
  __dirname,
  "artifacts",
  "contracts",
  "ArbitrageBot.sol",
  "ArbitrageBot.json"
);

if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found. Run: npx hardhat compile");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const { abi, bytecode } = artifact;

async function main() {
  console.log("Deployer:", await wallet.getAddress());
  console.log("Deploying ArbitrageBot to Sepolia via ethers...");

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  const bot = await factory.deploy(
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000"
  );

  console.log("Transaction hash:", bot.deploymentTransaction().hash);

  await bot.waitForDeployment();
  const address = await bot.getAddress();

  console.log("DEPLOYED!");
  console.log("Bot Address:", address);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

