# Gas Cost Modeling

## Gas Estimation

### Component Breakdown
- Aave callback: ~150k gas
- Uniswap swap: ~120k gas
- Sushiswap swap: ~120k gas
- Approvals: ~50k gas
- Total: ~440k gas
- Conservative estimate: 350k gas

## USDC Conversion
```javascript
gasCostWei = gasPrice * gasEstimate
gasCostETH = gasCostWei / 1e18
gasCostUSDC = gasCostETH * ethPriceUSDC
```

## Break-even Analysis

At 350k gas and ETH = $3,500:

| Gas Price | ETH Cost  | USDC Cost | Break-even Spread |
|-----------|-----------|-----------|-------------------|
| 10 gwei   | 0.0035 E  | $12.25    | 1.23%            |
| 30 gwei   | 0.0105 E  | $36.75    | 3.68%            |
| 50 gwei   | 0.0175 E  | $61.25    | 6.13%            |

## Optimization Strategies
1. Wait for low gas periods
2. Batch approvals
3. Contract optimization (short variable names)
