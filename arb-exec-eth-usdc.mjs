// arb-exec-eth-usdc.mjs
// Execute a full round-trip on the fork:
// 1) Uni:   ETH -> USDC (swapExactETHForTokens)
// 2) Sushi: USDC -> ETH (swapExactTokensForETH)
// Measures real gasUsed for each tx, and net ETH PnL.

import { ethers } from "ethers";

// ====== CONFIG ======
const RPC_URL = "http://127.0.0.1:8545";
const GAS_PRICE_GWEI_FOR_ECON = 30n; // used for economic cost calc only
const ETH_PRICE_USD_FOR_ECON = 2000; // for USD display only

// ====== PROVIDER & SIGNER ======
const provider = new ethers.JsonRpcProvider(RPC_URL);

// signer[0] from Hardhat node (10,000 ETH)
const signer = await provider.getSigner(0);
const trader = await signer.getAddress();

// ====== MAINNET ADDRESSES (lowercase) ======
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const UNISWAP_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const SUSHI_ROUTER   = "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f";

// ====== ABIS ======
const routerAbi = [
  // getAmountsOut (not strictly needed here, but handy)
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
  // swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline) payable
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
  // swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
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
const uni = new ethers.Contract(UNISWAP_ROUTER, routerAbi, signer);
const sushi = new ethers.Contract(SUSHI_ROUTER, routerAbi, signer);
const usdc = new ethers.Contract(USDC, erc20Abi, signer);

// ====== ECON HELPERS ======
const WEI_PER_GWEI = 10n ** 9n;
const WEI_PER_ETH  = 10n ** 18n;

// CLI arg: trade size in ETH, default 1.0
const sizeEthStr = process.argv[2] || "1.0";

async function main() {
  console.log("=== EXECUTED UNI→SUSHI ROUND TRIP (ETH↔USDC) ON FORK ===");
  console.log(`Trader: ${trader}`);
  console.log(`Trade size: ${sizeEthStr} ETH`);
  console.log(`RPC: ${RPC_URL}\n`);

  const amountInWei = ethers.parseEther(sizeEthStr);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // +10 min

  const pathEthToUsdc = [WETH, USDC];
  const pathUsdcToEth = [USDC, WETH];

  const ethBefore = await provider.getBalance(trader);
  const usdcBefore = await usdc.balanceOf(trader);

  console.log(`ETH before:  ${ethers.formatEther(ethBefore)} ETH`);
  console.log(`USDC before: ${ethers.formatUnits(usdcBefore, 6)}\n`);

  // 1) Uni: ETH -> USDC
  console.log("Step 1: Uni swapExactETHForTokens (ETH -> USDC)...");
  const tx1 = await uni.swapExactETHForTokens(
    0n,                 // amountOutMin (no slippage protection in sim)
    pathEthToUsdc,
    trader,
    deadline,
    { value: amountInWei }
  );
  const receipt1 = await tx1.wait();
  console.log(`  tx hash: ${tx1.hash}`);
  console.log(`  gasUsed: ${receipt1.gasUsed.toString()}`);

  const usdcAfterUni = await usdc.balanceOf(trader);
  console.log(`USDC after Uni: ${ethers.formatUnits(usdcAfterUni, 6)}\n`);

  // 2) Approve Sushi to spend USDC
  console.log("Step 2: Approve Sushi router to spend USDC...");
  const txApprove = await usdc.approve(SUSHI_ROUTER, usdcAfterUni);
  const receiptApprove = await txApprove.wait();
  console.log(`  tx hash: ${txApprove.hash}`);
  console.log(`  gasUsed: ${receiptApprove.gasUsed.toString()}\n`);

  // 3) Sushi: USDC -> ETH
  console.log("Step 3: Sushi swapExactTokensForETH (USDC -> ETH)...");
  const tx2 = await sushi.swapExactTokensForETH(
    usdcAfterUni,
    0n,               // amountOutMin
    pathUsdcToEth,
    trader,
    deadline
  );
  const receipt2 = await tx2.wait();
  console.log(`  tx hash: ${tx2.hash}`);
  console.log(`  gasUsed: ${receipt2.gasUsed.toString()}\n`);

  const ethAfter = await provider.getBalance(trader);
  const usdcAfter = await usdc.balanceOf(trader);

  const diffWei = ethAfter - ethBefore;
  const diffEth = Number(ethers.formatEther(diffWei));

  // Aggregate gasUsed
  const totalGasUsed =
    receipt1.gasUsed + receiptApprove.gasUsed + receipt2.gasUsed;

  // Economic gas cost with assumed gas price
  const gasCostWei =
    totalGasUsed * GAS_PRICE_GWEI_FOR_ECON * WEI_PER_GWEI;
  const gasCostEth = Number(ethers.formatEther(gasCostWei));
  const gasCostUsd = gasCostEth * ETH_PRICE_USD_FOR_ECON;

  const grossEth = diffEth + gasCostEth; // what PnL would be ignoring gas
  const grossUsd = grossEth * ETH_PRICE_USD_FOR_ECON;
  const netUsd   = diffEth * ETH_PRICE_USD_FOR_ECON;

  console.log("=== SUMMARY ===");
  console.log(`ETH before:       ${ethers.formatEther(ethBefore)} ETH`);
  console.log(`ETH after:        ${ethers.formatEther(ethAfter)} ETH`);
  console.log(`USDC final:       ${ethers.formatUnits(usdcAfter, 6)}\n`);

  console.log(`Total gasUsed (3 txs): ${totalGasUsed.toString()} units`);
  console.log(
    `Gas cost @ ${GAS_PRICE_GWEI_FOR_ECON} gwei: ${gasCostEth.toFixed(
      6
    )} ETH ≈ $${gasCostUsd.toFixed(2)}`
  );

  console.log(`Gross PnL (ignoring gas): ${grossEth.toFixed(6)} ETH ≈ $${grossUsd.toFixed(2)}`);
  console.log(`Net PnL (after gas):     ${diffEth.toFixed(6)} ETH ≈ $${netUsd.toFixed(2)}`);
}

main().catch((err) => {
  console.error("Execution sim failed:", err);
  process.exit(1);
});

