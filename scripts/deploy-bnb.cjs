const hre = require("hardhat");
const fs = require("fs");

async function main() {
  console.log("\n🚀 Deploying BNB Flash Liquidator to BNB Chain...\n");

  const [deployer] = await hre.ethers.getSigners();
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "BNB\n");

  const BNBFlashLiquidator = await hre.ethers.getContractFactory("BNBFlashLiquidator");
  const liquidator = await BNBFlashLiquidator.deploy();
  await liquidator.waitForDeployment();

  const address = await liquidator.getAddress();
  console.log("✅ BNB Flash Liquidator deployed to:", address);

  // Save address
  let liquidators = {};
  try {
    liquidators = JSON.parse(fs.readFileSync("data/liquidators.json", "utf8"));
  } catch {}
  
  liquidators.bnb = address;
  fs.writeFileSync("data/liquidators.json", JSON.stringify(liquidators, null, 2));
  
  console.log("\n📄 Address saved to data/liquidators.json");
  console.log("\n🔗 View on BscScan: https://bscscan.com/address/" + address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
