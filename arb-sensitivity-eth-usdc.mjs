// arb-sensitivity-eth-usdc.mjs
// Gas + size sensitivity for ETH/USDC arbitrage (UNI ↔ SUSHI) on mainnet fork.
// For each trade size and gas price, compute net PnL (ETH, USD).

import { ethers } from "ethers";

// ====== CONFIG ======
const RPC_URL = "http://127.0.0.1:8545";
const ETH_PRICE_USD = 2000;

// Gas model: approximate total gas per round trip (ETH->USDC->ETH + approve)
const GAS_PER_ROUND_TRIP = 300_000n;

// Trade sizes (ETH) and gas prices (gwei) to test
const SIZES_ETH = ["0.1", "0.5", "1", "2", "5"];
const GAS_PRICES_GWEI = [5n, 10n, 20n, 30n, 50n, 80n];

// ====== PROVIDER ======
const provider = new ethers.JsonRpcProvider(RPC_URL);

// ====== MAINNET ADDRESSES (lowercase) ======
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const UNISWAP_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const SUSHI_ROUTER   = "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f";

// ====== ABIS ======
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

// ====== CONTRACT INSTANCES (read-only) ======
const uni   = new ethers.Contract(UNISWAP_ROUTER, routerAbi, provider);
const sushi = new ethers.Contract(SUSHI_ROUTER,   routerAbi, provider);

const WEI_PER_GWEI = 10n ** 9n;
const WEI_PER_ETH  = 10n ** 18n;

// Helper to compute getAmountsOut
async function getOut(router, amountIn, path) {
  const amounts = await router.getAmountsOut(amountIn, path);
  return amounts[amounts.length - 1];
}

// Simulate one direction with parametric gas price
async function simulateDirection(sizeEthStr, entryRouter, exitRouter, gasPriceGwei, label) {
  const amountInWei = ethers.parseEther(sizeEthStr);

  const usdcOut = await getOut(entryRouter, amountInWei, [WETH, USDC]);
  const ethBackWei = await getOut(exitRouter, usdcOut, [USDC, WETH]);

  const grossWei = ethBackWei - amountInWei;

  // Gas cost for this gas price
  const gasCostWei =
    GAS_PER_ROUND_TRIP * gasPriceGwei * WEI_PER_GWEI;

  const netWei = grossWei - gasCostWei;

  const grossEth = Number(ethers.formatEther(grossWei));
  const netEth   = Number(ethers.formatEther(netWei));
  const netUsd   = netEth * ETH_PRICE_USD;

  return {
    sizeEth: Number(sizeEthStr),
    gasPriceGwei: Number(gasPriceGwei),
    label,
    grossEth,
    netEth,
    netUsd
  };
}

async function simulateBoth(sizeEthStr, gasPriceGwei) {
  const uniToSushi = await simulateDirection(
    sizeEthStr,
    uni,
    sushi,
    gasPriceGwei,
    "UNI→SUSHI"
  );
  const sushiToUni = await simulateDirection(
    sizeEthStr,
    sushi,
    uni,
    gasPriceGwei,
    "SUSHI→UNI"
  );

  let best = uniToSushi;
  let other = sushiToUni;
  if (sushiToUni.netEth > uniToSushi.netEth) {
    best = sushiToUni;
    other = uniToSushi;
  }

  return { best, other };
}

async function main() {
  console.log("=== GAS / SIZE SENSITIVITY: ETH/USDC ARB (UNI ↔ SUSHI, MAINNET FORK) ===");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Assumed ETH price: $${ETH_PRICE_USD}`);
  console.log(`Gas per round-trip (sim): ${GAS_PER_ROUND_TRIP.toString()} units\n`);

  console.log("sizeETH, gasGwei, bestDir, bestNetETH, bestNetUSD, otherDir, otherNetETH");

  for (const s of SIZES_ETH) {
    for (const g of GAS_PRICES_GWEI) {
      const { best, other } = await simulateBoth(s, g);

      console.log(
        [
          best.sizeEth.toFixed(2),
          best.gasPriceGwei.toString(),
          best.label,
          best.netEth.toFixed(6),
          best.netUsd.toFixed(2),
          other.label,
          other.netEth.toFixed(6)
        ].join(", ")
      );
    }
  }

  console.log("\n=== DONE ===");
}

main().catch((err) => {
  console.error("Sensitivity scan failed:", err);
  process.exit(1);
});

