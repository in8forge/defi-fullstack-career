#!/usr/bin/env bash
set -e

echo "== Week 3 Smoke Test =="

echo
echo "[1/6] Check MockUSDC balances (Sepolia)..."
npx hardhat run scripts/checkMockUsdcBalances.js --network sepolia

echo
echo "[2/6] Run mock cycle with balances (Sepolia)..."
npx hardhat run scripts/runMockCycleWithBalances.js --network sepolia

echo
echo "[3/6] Mainnet Uniswap USDC->WETH->USDC quote (fork)..."
npx hardhat run scripts/mainnetUniswapQuote.js --network fork

echo
echo "[4/6] Mainnet Uniswap round-trip PnL (fork)..."
npx hardhat run scripts/mainnetUniswapRoundtripPnL.js --network fork

echo
echo "[5/6] Uni vs Sushi multi-pair scan (fork)..."
npx hardhat run scripts/multiPairUniswapSushiScan.js --network fork

echo
echo "[6/6] Gas-aware arb planner for USDC (fork)..."
npx hardhat run scripts/arbGasAwarePlannerUSDC.js --network fork

echo
echo "== Week 3 Smoke Test Completed =="
