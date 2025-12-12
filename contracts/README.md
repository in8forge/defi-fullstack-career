# 📋 Smart Contracts

Solidity contracts for DeFi trading operations.

## FlashLiquidator.sol

Zero-capital liquidation executor using Aave V3 flash loans.

### Architecture
```
┌─────────────────┐
│  Your Wallet    │
│  (trigger tx)   │
└────────┬────────┘
         │ executeLiquidation()
         ▼
┌─────────────────┐
│ FlashLiquidator │
│    Contract     │
└────────┬────────┘
         │ flashLoanSimple()
         ▼
┌─────────────────┐
│   Aave V3 Pool  │
│  (lends funds)  │
└────────┬────────┘
         │ executeOperation() callback
         ▼
┌─────────────────┐
│ FlashLiquidator │
│ 1. Liquidate    │
│ 2. Swap collat  │
│ 3. Repay loan   │
│ 4. Keep profit  │
└─────────────────┘
```

### Key Functions
```solidity
function executeLiquidation(
    address collateralAsset,
    address debtAsset,
    address user,
    uint256 debtToCover
) external onlyOwner
```

Initiates flash loan and liquidation sequence.

### Deployment
```bash
npx hardhat compile
node scripts/deployFlashLiquidator.js
```

### Deployed Addresses

| Network | Address |
|---------|---------|
| Base | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |

### Security Considerations

- `onlyOwner` modifier prevents unauthorized calls
- Flash loan callback validates initiator
- Swap slippage protection via `amountOutMin`
