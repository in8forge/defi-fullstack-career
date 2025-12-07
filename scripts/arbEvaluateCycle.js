import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const RPC = process.env.ALCHEMY_MAINNET_RPC;

if (!RPC) {
  throw new Error(
    "Set ALCHEMY_MAINNET_RPC in .env (e.g. https://eth-mainnet.g.alchemy.com/v2/...)"
  );
}

async function main() {
  console.log("Arbitrage evaluation cycle...");

  // Use direct JsonRpcProvider – no ethers.provider
  const provider = new ethers.JsonRpcProvider(RPC);

  const latestBlock = await provider.getBlockNumber();
  console.log("Connected to mainnet. Latest block:", latestBlock);

  // --- Placeholder example numbers; structure is what matters here ---
  const inputUSDC = 1000;          // 1000 USDC
  const outputWETH = 0.32829;      // e.g. from your swap script
  const wethPriceUSDC = 3000;      // dummy 1 WETH = 3000 USDC for illustration

  const grossUSDC = outputWETH * wethPriceUSDC;

  // Fee and gas placeholders – you can tune these later
  const flashLoanFeeBps = 5;       // 0.05%
  const flashLoanFeeUSDC = (inputUSDC * flashLoanFeeBps) / 10000;

  const estimatedGasEth = 0.01;    // example gas usage
  const gasPriceUSDCPerEth = wethPriceUSDC;
  const gasCostUSDC = estimatedGasEth * gasPriceUSDCPerEth;

  const netPnLUSDC = grossUSDC - inputUSDC - flashLoanFeeUSDC - gasCostUSDC;

  const summary = {
    inputUSDC,
    outputWETH,
    grossUSDC,
    flashLoanFeeUSDC,
    gasCostUSDC,
    netPnLUSDC,
    profitable: netPnLUSDC > 0,
  };

  console.log("Arb evaluation result:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
