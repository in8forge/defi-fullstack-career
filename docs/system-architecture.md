# System Architecture

## Component Overview

### Off-Chain (Node.js)
- Arbitrage Decision Engine
- Price Scanner
- Gas Calculator
- Safety Validator
- Execution Trigger

### On-Chain (Solidity)
- FlashLoanExecutor contract
- Aave V3 integration
- Uniswap V2 router interaction
- Sushiswap router interaction

## Data Flow

1. **Price Discovery**: Engine queries DEX routers
2. **PnL Calculation**: Accounts for gas + fees
3. **Safety Validation**: Checks all thresholds
4. **Execution**: If profitable, calls contract
5. **Flash Loan**: Aave lends, swaps execute, loan repaid
6. **Profit**: Retained in contract

## Security
- Owner-only execution
- Atomic transactions
- No fund loss on failure
- Emergency withdrawals

## Performance
- Evaluation: ~1 second
- Execution: 12-15 seconds
- Resource: <50 MB RAM
