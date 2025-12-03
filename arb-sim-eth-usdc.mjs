// arb-sim-eth-usdc.mjs
// Simulate Uni(ETH->USDC) + Sushi(USDC->ETH) round trips with a fixed gas model.

import { ethers } from "ethers";

// ====== PROVIDER (local Hardhat mainnet fork) ======
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// ====== MAINNET ADDRESSES (lowercase to avoid checksum issues) ======
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

const uni = new ethers.Contract(UNISWAP_ROUTER, routerAbi, provider);
const sushi = new ethers.Contract(SUSHI_ROUTER, routerAbi, provider);

// ====== GAS MODEL (adjust these for different scenarios) ======
const GAS_PER_ROUND_TRIP = 300_000n;   // approx 2 swaps
const GAS_PRICE_GWEI     = 30n;        // assumed gas price (30 gwei)
const ETH_PRICE_USD      = 2000;       // assumed ETH price in USD (for display only)

// Convert gwei + gas to wei and ETH
const WEI_PER_GWEI = 10n ** 9n;
const WEI_PER_ETH  = 10n ** 18n;

const gasCostWei  = GAS_PER_ROUND_TRIP * GAS_PRICE_GWEI * WEI_PER_GWEI;
const gasCostEth  = Number(ethers.formatEther(gasCostWei));
const gasCostUsd  = gasCostEth * ETH_PRICE_USD;

// ====== CORE SIMULATION ======
async function simulateSize(sizeEthStr) {
  const amountInWei = ethers.parseEther(sizeEthStr);

  // 1) Uni: ETH -> USDC
  const uniOut = await uni.getAmountsOut(amountInWei, [WETH, USDC]);
  const usdcOut = uniOut[1]; // amount of USDC (6 decimals)

  // 2) Sushi: USDC -> ETH using all USDC from step 1
  const sushiOut = await sushi.getAmountsOut(usdcOut, [USDC, WETH]);
  const ethBackWei = sushiOut[1];

  // Gross profit in wei (before gas)
  const grossProfitWei = ethBackWei - amountInWei;

  // Net profit after fixed gas cost
  const netProfitWei = grossProfitWei - gasCostWei;

  // Format for printing
  const sizeEth        = Number(sizeEthStr);
  const usdcOutNum     = Number(ethers.formatUnits(usdcOut, 6));
  const ethBack        = Number(ethers.formatEther(ethBackWei));
  const grossProfitEth = Number(ethers.formatEther(grossProfitWei));
  const netProfitEth   = Number(ethers.formatEther(netProfitWei));
  const netProfitUsd   = netProfitEth * ETH_PRICE_USD;

  return {
    sizeEth,
    usdcOutNum,
    ethBack,
    grossProfitEth,
    netProfitEth,
    netProfitUsd
  };
}

async function main() {
  console.log("=== UNI→SUSHI ETH/USDC ARB SIM (MAINNET FORK, GAS-ADJUSTED) ===");
  console.log(`Gas model: ${GAS_PER_ROUND_TRIP} gas @ ${GAS_PRICE_GWEI} gwei ≈ ${gasCostEth.toFixed(6)} ETH ≈ $${gasCostUsd.toFixed(2)}\n`);

  console.log("sizeETH, usdcOut, ethBack, grossProfitETH, netProfitETH, netProfitUSD");

  const sizes = ["0.1", "0.5", "1", "2", "5"];

  for (const s of sizes) {
    const r = await simulateSize(s);

    console.log(
      [
        r.sizeEth.toFixed(2),
        r.usdcOutNum.toFixed(4),
        r.ethBack.toFixed(6),
        r.grossProfitEth.toFixed(6),
        r.netProfitEth.toFixed(6),
        r.netProfitUsd.toFixed(2)
      ].join(", ")
    );
  }

  console.log("\n===============================================================");
}

main().catch((err) => {
  console.error("Simulation failed:", err);
  process.exit(1);
});

