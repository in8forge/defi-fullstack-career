const hre = require("hardhat");

async function evaluate() {
  const provider = hre.ethers.provider;
  
  // Your existing code...
  const wethReserve = 100;
  const usdcReserve = 300000;
  
  const wethIn = 5;
  const wethOut = (wethIn * 997 * wethReserve) / (usdcReserve * 1000 + wethIn * 997);
  
  const flashFee = 0.5;
  const gasCost = 30;

  const grossUSDC = (wethOut * 3000) - 15;
  const net = grossUSDC - flashFee - gasCost;

  return {
    block: await provider.getBlockNumber(),
    wethOut,
    net,
    profitable: net > 0
  };
}

async function main() {
  console.log("Starting arbitrage evaluation loop...");

  while (true) {
    const result = await evaluate();
    console.log(result);

    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
