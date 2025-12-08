# Arbitrage Decision Engine

## Overview
Event-driven system that scans DEXs for profitable USDC/WETH arbitrage with gas-aware profit calculations.

## Architecture
- **Price Scanner** - Queries Uniswap and Sushiswap routers
- **Cost Calculator** - Flash loan fees + gas costs in USDC
- **Safety Validator** - Min profit, ROI, gas price, slippage checks
- **Execution Trigger** - Optional automated execution

## Key Features

### Multi-Path Evaluation
Evaluates both directions:
- UNI→SUSHI: Buy WETH on Uniswap, sell on Sushiswap
- SUSHI→UNI: Buy WETH on Sushiswap, sell on Uniswap

### Gas-Aware Profitability
```
netPnL = amountOut - (amountIn + flashLoanFee + gasCostUSDC)
ROI = (netPnL / amountIn) * 100
```

### Safety Guards
- Min profit: $5 USDC
- Min ROI: 0.5%
- Max gas: 50 gwei
- Max slippage: 2%

## Configuration
```javascript
MIN_PROFIT_USDC = 5
MIN_ROI_PERCENT = 0.5
MAX_GAS_PRICE_GWEI = 50
MAX_SLIPPAGE_PERCENT = 2
POLL_INTERVAL_MS = 15000
```

## Usage

Monitoring mode (safe):
```bash
node scripts/arbExecutorWithTrigger.js
```

Execution mode (live):
```bash
ENABLE_EXECUTION=true node scripts/arbExecutorWithTrigger.js
```
