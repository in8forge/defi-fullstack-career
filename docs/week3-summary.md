# Week 3 Checkpoint – Flash Loans, Mock Pipeline, and Arb Research

## 1. Architecture Overview

- **Chain:** Sepolia (for executor + mock token) and Ethereum mainnet fork (for pricing).
- **Contracts:**
  - `FlashLoanExecutor.sol`
    - Aave V3 `FlashLoanSimpleReceiverBase` receiver.
    - `requestFlashLoan(asset, amount, params)` – owner-only.
    - `executeOperation(asset, amount, premium, initiator, params)` – core flash-loan callback with:
      - `maxFlashAmount` guard.
      - repayment safety (`require(balanceAfter >= totalOwed)`).
      - internal `_strategy(asset, amount)` hook returning `int256 pnl`.
    - `testMockCycle(asset, amount)` – owner-only mock "flash" cycle using arbitrary ERC20.
  - `MockUSDC.sol`
    - 6-decimal mintable ERC20.
    - `mint(address to, uint256 amount)` – unrestricted for testing.

- **Networks (Hardhat):**
  - `sepolia` – Aave V3 + FlashLoanExecutor + MockUSDC.
  - `fork` – mainnet via `ALCHEMY_MAINNET_RPC` for Uniswap/Sushi pricing and arb analytics.

## 2. On-chain Sepolia Setup

- `MockUSDC` deployed to: `0xc7F8efB74864f5AfB3525B053Db2227602df12fA`.
- `FlashLoanExecutor` deployed to current `FLASH_EXECUTOR_ADDRESS` in `.env`.
- Wallet: `0x61419Ca788292f87de4F971Bfed51e372C253Cc5`.

### Key scripts

- `scripts/deployMockUsdc.js`
  - Deploys `MockUSDC` and prints address.

- `scripts/mintMockUsdc.js`
  - Mints:
    - 10,000 mUSDC to wallet.
    - 5,000 mUSDC to `FLASH_EXECUTOR_ADDRESS`.

- `scripts/checkMockUsdcBalances.js`
  - Prints wallet + executor mUSDC balances (raw + human).

- `scripts/approveMockUsdcForExecutor.js`
  - Approves executor to spend mUSDC from the wallet (currently 1,000 mUSDC).

- `scripts/runMockCycle.js`
  - Calls `testMockCycle(MockUSDC, 100 mUSDC)` and logs tx hash and gas.

- `scripts/runMockCycleWithBalances.js`
  - Before/after balances for wallet + executor around `testMockCycle(100 mUSDC)`.
  - Confirms net deltas currently **0** (neutral mock strategy).

## 3. Mainnet Pricing and Arbitrage Analysis (via fork)

- RPC: `ALCHEMY_MAINNET_RPC=https://eth-mainnet.g.alchemy.com/v2/...`
- Core mainnet addresses:
  - USDC: `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`
  - WETH: `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`
  - DAI:  `0x6B175474E89094C44Da98b954EedeAC495271d0F`
  - WBTC: `0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599`
  - Uniswap V2 router: `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D`
  - Sushi V2 router:   `0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F`

### Pricing + PnL scripts

- `scripts/mainnetUniswapQuote.js`
  - Round-trip `USDC → WETH → USDC` via Uniswap V2.

- `scripts/mainnetUniswapRoundtripPnL.js`
  - Round-trip PnL for 100 / 1,000 / 10,000 USDC.
  - Observed approx:
    - 100 USDC → ~99.399148 (PnL ≈ -0.600852 USDC, -0.60%).
    - 1,000 USDC → ~993.833845 (PnL ≈ -6.166155 USDC, -0.62%).
    - 10,000 USDC → ~9922.602279 (PnL ≈ -77.397721 USDC, -0.77%).

- `scripts/uniswapSushiArbDecision.js`
  - Cross-venue arb check (USDC/WETH, Uni vs Sushi).
  - Algorithm:
    - Buy WETH on venue with **higher** WETH out.
    - Sell WETH for USDC on the other venue.
    - Compute PnL USDC and PnL%.
    - Compare against `minEdgePct` (currently 0.8%).
  - Result for all tested sizes: **SKIP** (PnL% < 0).

- `scripts/multiPairUniswapSushiScan.js`
  - Same cross-venue logic, extended to:
    - USDC/WETH
    - DAI/WETH
    - WBTC/WETH
  - Result: all tested routes are negative after DEX fees + slippage, which matches expectation for deep, heavily-arbitraged blue-chip pairs.

- `scripts/arbGasAwarePlannerUSDC.js`
  - Gas-aware round-trip planner for USDC on Uniswap.
  - Assumptions:
    - ETH_PRICE_USD = 3000
    - GAS_PRICE_GWEI = 10
    - GAS_USED = 350000
  - Gas cost per arb tx:
    - Gas price (ETH)  = 1e-8
    - Gas cost (ETH)   ≈ 0.0035
    - Gas cost (USD)   ≈ 10.5 (≈ 10.5 USDC)
  - For USDC sizes:
    - 100 USDC:
      - Dex-only PnL ≈ -0.600852 USDC (≈ -0.6009%).
      - After gas ≈ -11.100852 USDC (≈ -11.10%).
      - Break-even PnL% from gas ≈ 10.5%.
    - 1,000 USDC:
      - Dex-only PnL ≈ -6.166163 USDC (≈ -0.6166%).
      - After gas ≈ -16.666163 USDC (≈ -1.67%).
      - Break-even PnL% from gas ≈ 1.05%.
    - 10,000 USDC:
      - Dex-only PnL ≈ -77.398481 USDC (≈ -0.7740%).
      - After gas ≈ -87.898481 USDC (≈ -0.8790%).
      - Break-even PnL% from gas ≈ 0.105%.

## 4. Week 3 Learnings / Takeaways

- Simple 2-hop Uni/Sushi arb on deep pairs (USDC/WETH, DAI/WETH, WBTC/WETH) is **consistently unprofitable** once you include:
  - 2× DEX fees.
  - Price impact.
  - On-chain gas.
- Any realistic flash-loan arb strategy must:
  - Focus on less efficient markets and/or more complex multi-hop routes.
  - Use sufficient notional size to amortise gas, but not so large that slippage kills PnL.
  - Use an off-chain scanner to filter 99%+ of blocks where no trade is justified.
- The current codebase gives:
  - A secure flash-loan executor shell (with `_strategy()` hook and guards).
  - A working mock capital pipeline on Sepolia (MockUSDC + `testMockCycle`).
  - A mainnet fork-based analytics toolkit (pricing, PnL, cross-venue, gas-aware thresholds).

## 5. Next Steps (Week 4+ Preview)

- Extend `_strategy()` with actual on-chain Uniswap calls (on fork), using:
  - `swapExactTokensForTokens` for USDC/WETH.
- Add a richer off-chain scanner:
  - Multiple venues (Uni/Sushi/other DEXes).
  - Multiple pairs and multi-hop routes.
- Connect scanner decisions to on-chain execution:
  - Only call `requestFlashLoan` when off-chain edge > (gas + safety margin).
- Gradually move from mock to real assets (testnets / L2s) where liquidity is available.

