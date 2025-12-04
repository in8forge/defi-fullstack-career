import hre from "hardhat";
import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl) throw new Error("SEPOLIA_RPC is not set in .env");
  if (!privateKey) throw new Error("PRIVATE_KEY is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log("Deploying MockUSDC from:", wallet.address);

  const artifact = await hre.artifacts.readArtifact("MockUSDC");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  const mockUsdc = await factory.deploy();
  console.log("Deployment tx:", mockUsdc.deployTransaction?.hash ?? "(pending)");

  await mockUsdc.deploymentTransaction()?.wait();
  const address = await mockUsdc.getAddress();

  console.log("MockUSDC deployed to:", address);
  console.log("Use this address for local testing instead of real USDC.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
