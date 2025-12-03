// arb-sim-eth-usdc-bidir.mjs
// Simulate BOTH directions:
//  A) Uni:   ETH -> USDC, Sushi: USDC -> ETH
//  B) Sushi: ETH -> USDC, Uni:   USDC -> ETH
// Gas-adjusted, using a mainnet fork via Hardhat.

import { ethers } from "ethers";

// ====== PROVIDER (local Hardhat mainnet fork) ======
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// ====== MAINNET ADDRESSES (lowercase) ======
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const UNISWAP_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const SUSHI_ROUTER   = "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f";

// ====== ROUTER ABI (getAmountsOut only) ======
const routerAbi = [
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" }
    ],
    name: "getAmountsOut",
    outputs: [
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" }
    ],
    stateMutability: "view",
    type: "function"
  }
];

const uni   = new ethers.Contract(UNISWAP_ROUTER, routerAbi, provider);
const sushi = new ethers.Contract(SUSHI_ROUTER,   routerAbi, provider);

// ====== GAS MODEL ======
const GAS_PER_ROUND_TRIP = 300_000n; // ~2 swaps
const GAS_PRICE_GWEI     = 30n;      // assumed gas price
const ETH_PRICE_USD      = 2000;     // for display only

const WEI_PER_GWEI = 10n ** 9n;
const WEI_PER_ETH  = 10n ** 18n;

const gasCostWei = GAS_PER_ROUND_TRIP * GAS_PRICE_GWEI * WEI_PER_GWEI;
const gasCostEth = Number(ethers.formatEther(gasCostWei));
const gasCostUsd = gasCostEth * ETH_PRICE_USD;

// ====== HELPERS ======
async function getOut(router, amountIn, path) {
  const amounts = await router.getAmountsOut(amountIn, path);
  return amounts[amounts.length - 1];
}

// Simulate one direction given routers and labels
async function simulateDirection(sizeEthStr, entryRouter, exitRouter, label) {
  const amountInWei = ethers.parseEther(sizeEthStr);

  // Step 1: ETH -> USDC on entryRouter
  const usdcOut = await getOut(entryRouter, amountInWei, [WETH, USDC]);

  // Step 2: USDC -> ETH on exitRouter
  const ethBackWei = await getOut(exitRouter, usdcOut, [USDC, WETH]);

  const grossProfitWei = ethBackWei - amountInWei;
  const netProfitWei   = grossProfitWei - gasCostWei;

  return {
    label,
    sizeEth: Number(sizeEthStr),
    usdcOut: Number(ethers.formatUnits(usdcOut, 6)),
    ethBack: Number(ethers.formatEther(ethBackWei)),
    grossEth: Number(ethers.formatEther(grossProfitWei)),
    netEth: Number(ethers.formatEther(netProfitWei)),
    netUsd: Number(ethers.formatEther(netProfitWei)) * ETH_PRICE_USD
  };
}

async function simulateSizeBothDirections(sizeEthStr) {
  // A) Uni -> Sushi
  const uniToSushi = await simulateDirection(sizeEthStr, uni, sushi, "UNI→SUSHI");
  // B) Sushi -> Uni
  const sushiToUni = await simulateDirection(sizeEthStr, sushi, uni, "SUSHI→UNI");

  // Decide best direction by netEth
  let best = uniToSushi;
  let other = sushiToUni;
  if (sushiToUni.netEth > uniToSushi.netEth) {
    best = sushiToUni;
    other = uniToSushi;
  }

  return { best, other };
}

async function main() {
  console.log("=== BIDIRECTIONAL ETH/USDC ARB SIM (UNI ↔ SUSHI, GAS-ADJUSTED) ===");
  console.log(`Gas model: ${GAS_PER_ROUND_TRIP} gas @ ${GAS_PRICE_GWEI} gwei ≈ ${gasCostEth.toFixed(6)} ETH ≈ $${gasCostUsd.toFixed(2)}\n`);

  console.log("sizeETH, bestDir, bestGrossETH, bestNetETH, bestNetUSD, otherDir, otherNetETH");

  const sizes = ["0.1", "0.5", "1", "2", "5"];

  for (const s of sizes) {
    const { best, other } = await simulateSizeBothDirections(s);

    console.log(
      [
        best.sizeEth.toFixed(2),
        best.label,
        best.grossEth.toFixed(6),
        best.netEth.toFixed(6),
        best.netUsd.toFixed(2),
        other.label,
        other.netEth.toFixed(6)
      ].join(", ")
    );
  }

  console.log("\n================================================================");
}

main().catch((err) => {
  console.error("Bidirectional simulation failed:", err);
  process.exit(1);
});

