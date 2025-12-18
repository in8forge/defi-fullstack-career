# DeFi Liquidation Infrastructure

A production-grade liquidation system for decentralized lending protocols, featuring real-time monitoring, MEV protection, and automated execution across multiple EVM chains.

## Overview

This project implements a comprehensive liquidation bot infrastructure capable of monitoring thousands of borrowing positions across major DeFi lending protocols. The system identifies undercollateralized positions and executes profitable liquidations using flash loans, requiring zero upfront capital.

## Key Features

- **Multi-Protocol Support** - Aave V3, Compound V3, and extensible architecture for additional protocols
- **Multi-Chain Deployment** - Base, Polygon, Arbitrum, Avalanche with chain-specific optimizations
- **Flash Loan Integration** - Capital-efficient liquidations using Aave V3 flash loans
- **MEV Protection** - Flashbots integration for private transaction submission
- **Smart Routing** - Multi-DEX aggregation (Uniswap V3, Sushiswap) with automatic path optimization
- **Profit Simulation** - Pre-execution profitability analysis to avoid unprofitable transactions
- **Real-Time Monitoring** - WebSocket-based price feeds with sub-second reaction times

## Architecture
```
├── Monitoring Layer
│   ├── Chainlink WebSocket price feeds
│   ├── Multicall3 batch position queries
│   └── Configurable health factor thresholds
│
├── Analysis Layer
│   ├── Dynamic collateral/debt detection
│   ├── Profitability simulation
│   └── Gas cost estimation
│
├── Execution Layer
│   ├── Flash loan orchestration
│   ├── Multi-DEX swap routing
│   └── MEV-protected transaction submission
│
└── Settlement Layer
    ├── Automated profit withdrawal
    └── Event logging and notifications
```

## Technical Stack

- **Runtime**: Node.js with ethers.js v6
- **Smart Contracts**: Solidity 0.8.20+
- **Infrastructure**: PM2 process management, VPS deployment
- **Protocols**: Aave V3, Compound V3, Uniswap V3, Sushiswap
- **MEV Protection**: Flashbots Protect RPC

## Smart Contracts

Custom flash liquidator contracts deployed across supported chains with features including:

- Uniswap V3 swap integration with multiple fee tier support
- Multi-hop routing through WETH for exotic pairs
- Configurable slippage protection
- ETH derivative handling (weETH, wstETH, cbETH)
- Owner-controlled profit withdrawal

## Development Roadmap

### Phase 1: Foundation ✅
- Core liquidation logic
- Flash loan integration
- Multi-protocol monitoring

### Phase 2: Production ✅
- VPS deployment
- MEV protection
- Profit simulation
- Auto-withdrawal

### Phase 3: Optimization (Current)
- DEX aggregator integration
- Gas optimization
- Performance monitoring

### Phase 4: Scale
- Additional protocols
- Cross-chain strategies
- Advanced MEV techniques

## Performance Metrics

| Metric | Value |
|--------|-------|
| Positions Monitored | 3,000+ |
| Supported Chains | 4 |
| Reaction Time | <100ms |
| Minimum Profit Threshold | Configurable |

## Usage
```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Run locally
node scripts/eventLiquidatorV5.js

# Deploy contracts
node scripts/deployFlashLiquidatorV2.js <chain>
```

## Configuration

The system requires RPC endpoints and WebSocket URLs for each supported chain. See `.env.example` for required environment variables.

## Disclaimer

This software is provided for educational and research purposes. DeFi liquidation involves financial risk. Users are responsible for understanding the protocols and risks involved.

## License

MIT
