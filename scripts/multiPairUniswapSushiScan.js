import { ethers } from "ethers";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

// Routers
const UNI_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHI_V2_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

// Tokens (mainnet)
const TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
};

// Pairs to scan: tokenIn -> tokenOut
const PAIRS = [
  { base: "USDC", quote: "WETH", sizes: ["100", "1000", "10000"] },
  { base: "DAI",  quote: "WETH", sizes: ["100", "1000", "10000"] },
  { base: "WBTC", quote: "WETH", sizes: ["0.01", "0.1", "1"] },
];

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const routerAbi = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
];

async function getTokenMeta(provider, addr) {
  const c = new ethers.Contract(addr, erc20Abi, provider);
  const [decimals, symbol] = await Promise.all([c.decimals(), c.symbol()]);
  return { decimals: Number(decimals), symbol, contract: c };
}

async function main() {
  const rpcUrl = process.env.ALCHEMY_MAINNET_RPC;
  if (!rpcUrl) throw new Error("ALCHEMY_MAINNET_RPC is not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  console.log("RPC:", rpcUrl);
  console.log("Uniswap V2 router:", UNI_V2_ROUTER);
  console.log("Sushi V2 router:  ", SUSHI_V2_ROUTER);

  const uni = new ethers.Contract(UNI_V2_ROUTER, routerAbi, provider);
  const sushi = new ethers.Contract(SUSHI_V2_ROUTER, routerAbi, provider);

  for (const pair of PAIRS) {
    const baseAddr = TOKENS[pair.base];
    const quoteAddr = TOKENS[pair.quote];

    if (!baseAddr || !quoteAddr) {
      console.log(`\nSkipping unknown pair ${pair.base}/${pair.quote}`);
      continue;
    }

    const baseMeta = await getTokenMeta(provider, baseAddr);
    const quoteMeta = await getTokenMeta(provider, quoteAddr);

    console.log(`\n===============================`);
    console.log(`Pair: ${pair.base}/${pair.quote}`);
    console.log(`Base:  ${pair.base} -> ${baseAddr} (decimals: ${baseMeta.decimals})`);
    console.log(`Quote: ${pair.quote} -> ${quoteAddr} (decimals: ${quoteMeta.decimals})`);

    for (const sz of pair.sizes) {
      const amountIn = ethers.parseUnits(sz, baseMeta.decimals);
      const inFloat = Number(amountIn) / 10 ** baseMeta.decimals;

      console.log(`\n--- Size: ${sz} ${baseMeta.symbol} ---`);

      // USDC/DAI/WBTC -> WETH
      const pathToWeth = [baseAddr, quoteAddr];

      let uniToWeth, sushiToWeth;
      try {
        uniToWeth = await uni.getAmountsOut(amountIn, pathToWeth);
        sushiToWeth = await sushi.getAmountsOut(amountIn, pathToWeth);
      } catch (e) {
        console.log("Routing failed for this pair/size (no liquidity or bad path).");
        continue;
      }

      const uniWethOut = uniToWeth[uniToWeth.length - 1];
      const sushiWethOut = sushiToWeth[sushiToWeth.length - 1];

      const uniWethFloat = Number(uniWethOut) / 10 ** quoteMeta.decimals;
      const sushiWethFloat = Number(sushiWethOut) / 10 ** quoteMeta.decimals;

      console.log("Uni WETH out:   ", uniWethFloat);
      console.log("Sushi WETH out: ", sushiWethFloat);

      // Determine where WETH is cheaper (higher out)
      const buyOnUni = uniWethFloat > sushiWethFloat;
      const buyDex = buyOnUni ? "Uniswap" : "Sushi";
      const sellDex = buyOnUni ? "Sushi" : "Uniswap";
      const wethBought = buyOnUni ? uniWethOut : sushiWethOut;

      console.log("Buy WETH on:    ", buyDex);
      console.log("Sell WETH on:   ", sellDex);

      // WETH -> base on the other dex
      const pathBack = [quoteAddr, baseAddr];
      let outBaseOnSellDex;

      try {
        if (buyOnUni) {
          const sellOnSushi = await sushi.getAmountsOut(wethBought, pathBack);
          outBaseOnSellDex = sellOnSushi[sellOnSushi.length - 1];
        } else {
          const sellOnUni = await uni.getAmountsOut(wethBought, pathBack);
          outBaseOnSellDex = sellOnUni[sellOnUni.length - 1];
        }
      } catch (e) {
        console.log("Back leg failed (no liquidity or bad path).");
        continue;
      }

      const outFloat =
        Number(outBaseOnSellDex) / 10 ** baseMeta.decimals;

      const pnl = outFloat - inFloat;
      const pnlPct = (pnl / inFloat) * 100;

      console.log("Base in:        ", inFloat, baseMeta.symbol);
      console.log("Base out:       ", outFloat, baseMeta.symbol);
      console.log("PnL (base):     ", pnl);
      console.log("PnL (%):        ", pnlPct);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
