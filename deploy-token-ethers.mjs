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

// 3) Load compiled artifact for MyToken
const artifactPath = path.join(
  __dirname,
  "artifacts",
  "contracts",
  "MyToken.sol",
  "MyToken.json"
);

if (!fs.existsSync(artifactPath)) {
  console.error("Artifact not found. Run: npx hardhat compile");
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const { abi, bytecode } = artifact;

// 4) Main deploy + mint
async function main() {
  const deployer = await wallet.getAddress();
  console.log("Deployer wallet:", deployer);

  const factory = new ethers.ContractFactory(abi, bytecode, wallet);

  console.log("Deploying MyToken to Sepolia...");
  const token = await factory.deploy("MyToken", "MTKN");

  console.log("Deployment tx:", token.deploymentTransaction().hash);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log("MyToken deployed at:", tokenAddress);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${tokenAddress}`);

  // Mint 1000 tokens to deployer (18 decimals)
  const amount = ethers.parseUnits("1000", 18);

  console.log("Minting 1000 MTKN to deployer...");
  const mintTx = await token.mint(deployer, amount);
  console.log("Mint tx:", mintTx.hash);

  const mintReceipt = await mintTx.wait();
  console.log("Mint confirmed in block:", mintReceipt.blockNumber);

  const balance = await token.balanceOf(deployer);
  console.log("Deployer balance (raw units):", balance.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

