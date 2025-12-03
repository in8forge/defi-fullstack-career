// arb-detector.mjs
// Multi-pair Uni vs Sushi spread detector on mainnet fork

import { ethers } from "ethers";

const RPC_URL = "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC_URL);

const WETH  = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNI_ROUTER   = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHI_ROUTER = "0xd9e1cE17f2641F24aE83637ab66a2cca9C378B9F";

const TOKENS = [
  { sym: "USDC", addr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48" },
  { sym: "DAI",  addr: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
  { sym: "WBTC", addr: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  { sym: "LINK", addr: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
  { sym: "UNI",  addr: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  { sym: "AAVE", addr: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" },
  { sym: "MKR",  addr: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2" },
];

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint256[] memory)"
];

const uni   = new ethers.Contract(UNI_ROUTER, routerAbi, provider);
const sushi = new ethers.Contract(SUSHI_ROUTER, routerAbi, provider);

const AMOUNT_IN = ethers.parseEther("1"); // 1 ETH trade

async function scanToken(t) {
  const path = [WETH, t.addr];

  try {
    const uniOut   = await uni.getAmountsOut(AMOUNT_IN, path);
    const sushiOut = await sushi.getAmountsOut(AMOUNT_IN, path);

    const u = Number(uniOut[1]);
    const s = Number(sushiOut[1]);

    const avg = (u + s) / 2;
    const spreadPct = ((u - s) / avg) * 100; // >0: Uni better, <0: Sushi better

    return {
      token: t.sym,
      uniOut: u,
      sushiOut: s,
      spreadPct,
    };
  } catch (err) {
    return {
      token: t.sym,
      uniOut: 0,
      sushiOut: 0,
      spreadPct: -999, // mark as error
    };
  }
}

async function main() {
  console.log("=== ARB OPPORTUNITY DETECTOR (UNI vs SUSHI, 1 ETH) ===");
  console.log("RPC:", RPC_URL);
  console.log("");

  const results = [];
  for (const t of TOKENS) {
    const r = await scanToken(t);
    results.push(r);
  }

  results.sort((a, b) => b.spreadPct - a.spreadPct);

  console.table(
    results.map((r) => ({
      token: r.token,
      uniOut: r.uniOut,
      sushiOut: r.sushiOut,
      spreadPct: r.spreadPct.toFixed(4),
    }))
  );
}

main().catch((err) => {
  console.error("Detector failed:", err);
  process.exit(1);
});

