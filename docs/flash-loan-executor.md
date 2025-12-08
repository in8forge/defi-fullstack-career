# Flash Loan Executor Architecture

## Overview
FlashLoanExecutor implements Aave V3 flash loan integration with automated arbitrage execution across Uniswap V2 and Sushiswap.

## Contract Design

### Key Functions

**executeOperation()** - Aave callback that executes after loan transfer
**_executeArbitrage()** - Performs dual-swap arbitrage (USDC→WETH→USDC)
**requestFlashLoan()** - Owner-only entry point with path validation

### Execution Flow
1. Owner calls requestFlashLoan()
2. Aave transfers USDC to contract
3. Contract swaps USDC→WETH on Router1
4. Contract swaps WETH→USDC on Router2
5. Contract repays loan + fee to Aave
6. Net profit remains in contract

## Security Features
- Owner-only access control
- Amount caps (1M USDC default)
- Path validation
- Balance checks before repayment
- Atomic transaction (reverts if unprofitable)

## Gas Costs
- Total: ~440k gas
- Flash loan overhead: ~150k
- Swap 1: ~120k
- Swap 2: ~120k
- Approvals: ~50k

## Fee Structure
- Aave flash loan: 0.05% (0.5 USDC per 1000)
- DEX swap fees: 0.3% each
- Total fees: ~0.65% of principal
