import { ethers } from "ethers";
import dotenv from "dotenv";
dotenv.config();

// MAINNET FORK
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

// Routers
const UNI = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";     // Uniswap V2
const SUSHI = "0xd9e1cE17f2641F24aE83637ab66a2cca9C378B9F";   // SushiSwap V2

// Common ERC-20 tokens (stablecoins + majors)
const TOKENS = [
  { symbol: "USDC",  addr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606EB48" },
  { symbol: "DAI",   addr: "0x6B175474E89094C44Da98b954EedeAC495271d0F" },
  { symbol: "WBTC",  addr: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599" },
  { symbol: "LINK",  addr: "0x514910771AF9Ca656af840dff83E8264EcF986CA" },
  { symbol: "UNI",   addr: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" },
  { symbol: "MKR",   addr: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2" },
  { symbol: "AAVE",  addr: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9" },
  { symbol: "CRV",   addr: "0xD533a949740bb3306d119CC777fa900bA034cd52" },
  { symbol: "PEPE",  addr: "0x6982508145454Ce325dDbE47a25d4ec3d2311933" },
];

const routerABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[])"
];

const amountETH = ethers.parseEther("1");

async function scanToken(token) {
  try {
    const uniRouter = new ethers.Contract(UNI, routerABI, provider);
    const sushiRouter = new ethers.Contract(SUSHI, routerABI, provider);

    const path = ["0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", token.addr]; // WETH → TOKEN

    const uni = await uniRouter.getAmountsOut(amountETH, path);
    const sushi = await sushiRouter.getAmountsOut(amountETH, path);

    const uniOut = Number(uni[1]);
    const sushiOut = Number(sushi[1]);

    const diff = ((uniOut - sushiOut) / ((uniOut + sushiOut) / 2)) * 100;

    return {
      symbol: token.symbol,
      uniOut,
      sushiOut,
      diff
    };

  } catch (err) {
    return {
      symbol: token.symbol,
      uniOut: 0,
      sushiOut: 0,
      diff: -999,
    };
  }
}

(async () => {
  console.log("=== MULTI-TOKEN SCAN (UNI vs SUSHI) ===");

  let results = [];

  for (const t of TOKENS) {
    const r = await scanToken(t);
    results.push(r);
  }

  results.sort((a, b) => b.diff - a.diff);

  console.table(results.map(r => ({
    token: r.symbol,
    uniOut: r.uniOut,
    sushiOut: r.sushiOut,
    spreadPct: r.diff.toFixed(4),
  })));
})();

