import { ethers } from "ethers";

async function main() {
  // Example param schema for future use:
  // (address router, address tokenIn, address tokenOut, uint256 minOutBps)
  const router = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2 mainnet router (for fork use)
  const tokenIn = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";  // USDC
  const tokenOut = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH
  const minOutBps = 9950n; // 99.50% of quoted amount, example

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  const encoded = abiCoder.encode(
    ["address", "address", "address", "uint256"],
    [router, tokenIn, tokenOut, minOutBps]
  );

  console.log("Encoded params:", encoded);

  const decoded = abiCoder.decode(
    ["address", "address", "address", "uint256"],
    encoded
  );

  console.log("Decoded:");
  console.log("  router:", decoded[0]);
  console.log("  tokenIn:", decoded[1]);
  console.log("  tokenOut:", decoded[2]);
  console.log("  minOutBps:", decoded[3].toString());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
