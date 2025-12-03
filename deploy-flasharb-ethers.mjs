// deploy-flasharb-ethers.mjs
// Deploy FlashArb to a local Hardhat mainnet fork

import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Hardhat node RPC
const RPC_URL = "http://127.0.0.1:8545";

// Hardhat default account #0 (printed when you start npx hardhat node)
const HARDHAT_DEPLOYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Aave V3 mainnet pool (canonical)
const AAVE_POOL = "0x87870Bca3F3fD6335C3F4ce8392D69350b4fA4E8";

// Uniswap & Sushi routers
const UNI_ROUTER   = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHI_ROUTER = "0xd9e1cE17f2641F24aE83637ab66a2cca9C378B9F";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(HARDHAT_DEPLOYER_KEY, provider);

  console.log("Deployer:", await wallet.getAddress());

  const artifactPath = path.join(
    __dirname,
    "artifacts",
    "contracts",
    "FlashArb.sol",
    "FlashArb.json"
  );
  const artifactJson = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const factory = new ethers.ContractFactory(
    artifactJson.abi,
    artifactJson.bytecode,
    wallet
  );

  console.log("Deploying FlashArb to local fork...");
  const contract = await factory.deploy(AAVE_POOL, UNI_ROUTER, SUSHI_ROUTER);
  const receipt = await contract.deploymentTransaction().wait();

  const addr = await contract.getAddress();
  console.log("FlashArb deployed at:", addr);
  console.log("Deployment tx:", receipt.hash);
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});

