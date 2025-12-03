// arb-controller-eth-usdc.mjs
// 1) For each size, simulate BOTH directions (UNI↔SUSHI) with gas.
// 2) If bestNetETH >= threshold, execute that direction on the fork.
// Uses Hardhat mainnet fork at http://127.0.0.1:8545.

import { ethers } from "ethers";

// ====== CONFIG ======
const RPC_URL = "http://127.0.0.1:8545";
const ETH_PRICE_USD = 2000;

// Profit threshold in ETH (CLI arg #2, default 0.01 ETH)
const thresholdEth = process.argv[2] ? Number(process.argv[2]) : 0.01;

// ====== PROVIDER & SIGNER ======
const provider = new ethers.JsonRpcProvider(RPC_URL);
const signer = await provider.getSigner(0);
const trader = await signer.getAddress();

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
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountOutMin", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" }
    ],
    name: "swapExactETHForTokens",
    outputs: [
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" }
    ],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "amountIn", type: "uint256" },
      { internalType: "uint256", name: "amountOutMin", type: "uint256" },
      { internalType: "address[]", name: "path", type: "address[]" },
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "deadline", type: "uint256" }
    ],
    name: "swapExactTokensForETH",
    outputs: [
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" }
    ],
    stateMutability: "nonpayable",
    type: "function"
  }
];

const erc20Abi = [
  {
    inputs: [{ internalType: "address", name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function"
  }
];

// ====== CONTRACT INSTANCES ======
const uni   = new ethers.Contract(UNISWAP_ROUTER, routerAbi, signer);
const sushi = new ethers.Contract(SUSHI_ROUTER,   routerAbi, signer);
const usdc  = new ethers.Contract(USDC, erc20Abi, signer);

// ====== GAS MODEL (for simulation) ======
const GAS_PER_ROUND_TRIP = 300_000n;
const GAS_PRICE_GWEI     = 30n;

const WEI_PER_GWEI = 10n ** 9n;
const WEI_PER_ETH  = 10n ** 18n;

const gasCostWeiSim = GAS_PER_ROUND_TRIP * GAS_PRICE_GWEI * WEI_PER_GWEI;
const gasCostEthSim = Number(ethers.formatEther(gasCostWeiSim));
const gasCostUsdSim = gasCostEthSim * ETH_PRICE_USD;

// ====== SIM HELPERS ======
async function getOut(router, amountIn, path) {
  const amounts = await router.getAmountsOut(amountIn, path);
  return amounts[amounts.length - 1];
}

async function simulateDirection(sizeEthStr, entryRouter, exitRouter, label) {
  const amountInWei = ethers.parseEther(sizeEthStr);

  const usdcOut = await getOut(entryRouter, amountInWei, [WETH, USDC]);
  const ethBackWei = await getOut(exitRouter, usdcOut, [USDC, WETH]);

  const grossWei = ethBackWei - amountInWei;
  const netWei   = grossWei - gasCostWeiSim;

  return {
    label,
    sizeEth: Number(sizeEthStr),
    grossEth: Number(ethers.formatEther(grossWei)),
    netEth: Number(ethers.formatEther(netWei)),
    netUsd: Number(ethers.formatEther(netWei)) * ETH_PRICE_USD
  };
}

async function simulateBoth(sizeEthStr) {
  const uniToSushi   = await simulateDirection(sizeEthStr, uni, sushi, "UNI→SUSHI");
  const sushiToUni   = await simulateDirection(sizeEthStr, sushi, uni, "SUSHI→UNI");

  let best = uniToSushi;
  let other = sushiToUni;
  if (sushiToUni.netEth > uniToSushi.netEth) {
    best = sushiToUni;
    other = uniToSushi;
  }

  return { best, other };
}

// ====== EXECUTION ON FORK ======
async function execRoundTrip(sizeEthStr, directionLabel) {
  const amountInWei = ethers.parseEther(sizeEthStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  const ethBefore = await provider.getBalance(trader);
  const usdcBefore = await usdc.balanceOf(trader);

  let entryRouter, exitRouter;
  if (directionLabel === "UNI→SUSHI") {
    entryRouter = uni;
    exitRouter  = sushi;
  } else if (directionLabel === "SUSHI→UNI") {
    entryRouter = sushi;
    exitRouter  = uni;
  } else {
    throw new Error(`Unknown direction: ${directionLabel}`);
  }

  console.log(`\n>>> EXECUTING ${directionLabel} ROUND-TRIP for ${sizeEthStr} ETH`);

  // Step 1: ETH -> USDC
  const tx1 = await entryRouter.swapExactETHForTokens(
    0n,
    [WETH, USDC],
    trader,
    deadline,
    { value: amountInWei }
  );
  const receipt1 = await tx1.wait();

  const usdcAfterFirst = await usdc.balanceOf(trader);

  // Step 2: approve
  const txApprove = await usdc.approve(exitRouter.target, usdcAfterFirst);
  const receiptApprove = await txApprove.wait();

  // Step 3: USDC -> ETH
  const tx2 = await exitRouter.swapExactTokensForETH(
    usdcAfterFirst,
    0n,
    [USDC, WETH],
    trader,
    deadline
  );
  const receipt2 = await tx2.wait();

  const ethAfter = await provider.getBalance(trader);
  const usdcAfter = await usdc.balanceOf(trader);

  const diffWei = ethAfter - ethBefore;
  const diffEth = Number(ethers.formatEther(diffWei));

  const totalGasUsed =
    receipt1.gasUsed + receiptApprove.gasUsed + receipt2.gasUsed;

  const gasCostWei =
    totalGasUsed * GAS_PRICE_GWEI * WEI_PER_GWEI;
  const gasCostEth = Number(ethers.formatEther(gasCostWei));
  const gasCostUsd = gasCostEth * ETH_PRICE_USD;

  const netUsd = diffEth * ETH_PRICE_USD;

  console.log("=== EXECUTION SUMMARY ===");
  console.log(`ETH before:  ${ethers.formatEther(ethBefore)} ETH`);
  console.log(`ETH after:   ${ethers.formatEther(ethAfter)} ETH`);
  console.log(`USDC before: ${ethers.formatUnits(usdcBefore, 6)}`);
  console.log(`USDC after:  ${ethers.formatUnits(usdcAfter, 6)}\n`);

  console.log(`Total gasUsed (3 txs): ${totalGasUsed.toString()} units`);
  console.log(`Gas cost @ ${GAS_PRICE_GWEI} gwei: ${gasCostEth.toFixed(6)} ETH ≈ $${gasCostUsd.toFixed(2)}`);

  console.log(`Net PnL: ${diffEth.toFixed(6)} ETH ≈ $${netUsd.toFixed(2)}`);

  return { diffEth, netUsd, totalGasUsed: totalGasUsed.toString() };
}

// ====== MAIN CONTROLLER ======
async function main() {
  console.log("=== ARB CONTROLLER: ETH/USDC UNI↔SUSHI (MAINNET FORK) ===");
  console.log(`Trader:    ${trader}`);
  console.log(`RPC:       ${RPC_URL}`);
  console.log(`Threshold: ${thresholdEth} ETH (~$${(thresholdEth * ETH_PRICE_USD).toFixed(2)})`);
  console.log(`Gas model (sim): ${GAS_PER_ROUND_TRIP} gas @ ${GAS_PRICE_GWEI} gwei ≈ ${gasCostEthSim.toFixed(6)} ETH ≈ $${gasCostUsdSim.toFixed(2)}\n`);

  console.log("sizeETH, bestDir, bestNetETH, bestNetUSD, otherDir, otherNetETH, EXECUTE?");

  const sizes = ["0.1", "0.5", "1", "2", "5"];

  let executedAny = false;

  for (const s of sizes) {
    const { best, other } = await simulateBoth(s);

    const shouldExecute = best.netEth > 0 && best.netEth >= thresholdEth;

    console.log(
      [
        best.sizeEth.toFixed(2),
        best.label,
        best.netEth.toFixed(6),
        best.netUsd.toFixed(2),
        other.label,
        other.netEth.toFixed(6),
        shouldExecute ? "YES" : "NO"
      ].join(", ")
    );

    if (shouldExecute) {
      executedAny = true;
      await execRoundTrip(s, best.label);
    }
  }

  if (!executedAny) {
    console.log("\nNo opportunities met the threshold; no trades executed.");
  }

  console.log("\n=== CONTROLLER DONE ===");
}

main().catch((err) => {
  console.error("Controller failed:", err);
  process.exit(1);
});

