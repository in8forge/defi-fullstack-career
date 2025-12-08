import { JsonRpcProvider, ContractFactory, Wallet } from "ethers";
import { readFileSync } from "fs";

const AAVE_POOL_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545");
  
  // Use Hardhat's default account #0 (has 10000 ETH)
  const privateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const wallet = new Wallet(privateKey, provider);

  console.log("Deploying from:", wallet.address);
  
  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", balance.toString(), "wei");

  const artifact = JSON.parse(
    readFileSync("./artifacts/contracts/FlashLoanExecutor.sol/FlashLoanExecutor.json", "utf8")
  );

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  
  console.log("Deploying FlashLoanExecutor...");
  const executor = await factory.deploy(AAVE_POOL_PROVIDER);
  
  await executor.waitForDeployment();
  
  const address = await executor.getAddress();
  console.log("\n✅ FlashLoanExecutor deployed to:", address);
  console.log("Owner:", await executor.owner());
  console.log("Max flash amount:", (await executor.maxFlashAmount()).toString());
  
  console.log("\n📝 Update your scripts to use this address:");
  console.log(`const FLASH_LOAN_EXECUTOR = "${address}";`);
}

main().catch(console.error);
