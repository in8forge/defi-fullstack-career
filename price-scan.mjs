import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

// ====== MAINNET FORK RPC ======
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// ====== MAINNET TOKEN ADDRESSES (all lowercase) ======
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

// ====== UNISWAP V2 + SUSHISWAP V2 ROUTERS ======
const UNISWAP_ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const SUSHI_ROUTER   = "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f";

// ====== ROUTER ABI (getAmountsOut only) ======
const routerABI = [
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

const uni = new ethers.Contract(UNISWAP_ROUTER, routerABI, provider);
const sushi = new ethers.Contract(SUSHI_ROUTER, routerABI, provider);

// Quote helper: ETH -> USDC
async function quote(router, amountInWei) {
  const path = [WETH, USDC];
  const amounts = await router.getAmountsOut(amountInWei, path);
  return amounts[1]; // USDC out (6 decimals)
}

async function main() {
  console.log("=== ETH → USDC PRICE SCAN (UNISWAP vs SUSHI, MAINNET FORK) ===");
  console.log("sizeETH, uniUSDC, sushiUSDC, uniPrice, sushiPrice, diffPercent");

  // Trade sizes to test (ETH)
  const sizesEth = ["0.1", "0.5", "1", "2", "5"];

  for (const sizeStr of sizesEth) {
    const amountIn = ethers.parseEther(sizeStr);

    const uniOut = await quote(uni, amountIn);
    const sushiOut = await quote(sushi, amountIn);

    const uniUSDC = Number(ethers.formatUnits(uniOut, 6));   // USDC has 6 decimals
    const sushiUSDC = Number(ethers.formatUnits(sushiOut, 6));

    const size = Number(sizeStr);
    const uniPrice = uniUSDC / size;     // USDC per 1 ETH
    const sushiPrice = sushiUSDC / size; // USDC per 1 ETH

    const diffPercent = ((uniPrice - sushiPrice) / sushiPrice) * 100;

    console.log(
      [
        sizeStr,
        uniUSDC.toFixed(4),
        sushiUSDC.toFixed(4),
        uniPrice.toFixed(4),
        sushiPrice.toFixed(4),
        diffPercent.toFixed(4)
      ].join(", ")
    );
  }

  console.log("===============================================================");
}

main().catch((err) => {
  console.error("Scan failed:", err);
  process.exit(1);
});

