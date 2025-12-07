# DeFi Fullstack Career - Professional Arbitrage & MEV Engineering

A production-grade DeFi engineering workspace featuring flash loan executors, multi-DEX arbitrage evaluation, gas-optimized trading strategies, and mainnet fork testing infrastructure.

## 🎯 Project Overview

This repository demonstrates end-to-end DeFi engineering capabilities including:
- Aave V3 flash loan integration
- Multi-protocol arbitrage detection (Uniswap V2, Sushiswap)
- Gas-aware profit calculation with safety guards
- Mainnet fork testing and simulation
- Event-driven decision engines

**Current Status:** Week 4 complete - Arbitrage Decision Engine v1 operational
**Job Readiness:** 70% (targeting senior DeFi/MEV engineer roles)

## 🏗️ Architecture
```
┌─────────────────────────────────────────────────────────┐
│                  Arbitrage Decision Engine              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Price Scanner│  │ Gas Estimator│  │ Safety Guard │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
│         │                  │                  │         │
│         └──────────────────┴──────────────────┘         │
│                            │                            │
│                  ┌─────────▼─────────┐                  │
│                  │  PnL Calculator   │                  │
│                  └─────────┬─────────┘                  │
│                            │                            │
│         ┌──────────────────┴──────────────────┐         │
│         │                                     │         │
│  ┌──────▼──────┐                    ┌────────▼──────┐  │
│  │ Uniswap V2  │                    │  Sushiswap V2 │  │
│  └──────┬──────┘                    └────────┬──────┘  │
│         │                                     │         │
│         └──────────────────┬──────────────────┘         │
│                            │                            │
│                  ┌─────────▼─────────┐                  │
│                  │ Flash Loan Executor│                 │
│                  │   (Aave V3 Pool)  │                  │
│                  └───────────────────┘                  │
└─────────────────────────────────────────────────────────┘
```

## ⚡ Quick Start

### Prerequisites
- Node.js v22.10.0+ (LTS)
- npm v10+
- Alchemy API key (for mainnet forking)

### Installation
```bash
# Clone repository
git clone https://github.com/in8forge/defi-fullstack-career.git
cd defi-fullstack-career

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Add your ALCHEMY_MAINNET_RPC_URL to .env
```

### Running the Arbitrage Engine

**Terminal 1: Start mainnet fork**
```bash
npx hardhat node --fork $ALCHEMY_MAINNET_RPC_URL
```

**Terminal 2: Run arbitrage evaluator**
```bash
node scripts/arbGasAwarePlannerUSDC.js
```

### Running Tests
```bash
npx hardhat test
```

## 🚀 Features

### ✅ Implemented
- **Flash Loan Executor** - Aave V3 integration with custom arbitrage logic
- **Multi-Path Scanner** - Evaluates Uniswap → Sushiswap and reverse paths
- **Gas-Aware Modeling** - Real-time gas price feeds with cost calculations
- **Profitability Thresholds** - Configurable min profit ($5) and ROI (0.5%)
- **Safety Guards** - Gas price caps (50 gwei), slippage limits (2%)
- **Structured Logging** - JSON output with trade IDs and timestamps
- **Mainnet Fork Testing** - Real contract interaction without deployment costs

### 🔄 In Progress
- Flash loan execution integration
- Dynamic gas estimation from contract calls
- Multi-hop routing optimization

### 📋 Roadmap
- Uniswap V3 concentrated liquidity integration
- Curve stableswap support
- MEV protection via Flashbots relay
- Multi-chain arbitrage (Arbitrum, Base)
- Real-time mempool monitoring
- Web dashboard for strategy monitoring

## 📁 Project Structure
```
defi-fullstack-career/
├── contracts/
│   ├── FlashLoanExecutor.sol    # Aave V3 flash loan receiver
│   └── MockUSDC.sol              # Test token for local development
├── scripts/
│   ├── arbGasAwarePlannerUSDC.js # Main arbitrage decision engine
│   ├── forkTestOnchainQuote.js   # Price quote validation
│   └── forkTestOnchainSwap.js    # Swap execution testing
├── test/
│   └── FlashLoanExecutor.test.js # Contract unit tests
├── docs/
│   ├── flash-loan-executor.md    # Flash loan architecture
│   ├── arbitrage-engine.md       # Decision engine documentation
│   └── gas-model.md              # Gas calculation methodology
├── results/
│   └── sample-arb-evaluation.json # Real output examples
├── hardhat.config.js
├── package.json
└── README.md
```

## 🔧 Technologies

- **Smart Contracts:** Solidity 0.8.20, OpenZeppelin
- **Testing Framework:** Hardhat, Ethers.js v6
- **DeFi Protocols:** Aave V3, Uniswap V2, Sushiswap V2
- **Development:** Node.js, JavaScript (ES modules)
- **Infrastructure:** Alchemy RPC, Mainnet forking

## 📊 Sample Output

### Arbitrage Evaluation Result
```json
{
  "timestamp": "2025-12-07T08:51:53.345Z",
  "level": "warn",
  "message": "Opportunity rejected",
  "tradeId": 1,
  "profitable": false,
  "reason": "Below min profit threshold",
  "path": "UNI→SUSHI",
  "netPnL": "-8.54",
  "breakdown": {
    "amountIn": "1000.0",
    "amountOut": "993.14",
    "flashLoanFee": "0.5",
    "gasCostUsdc": "1.19",
    "gasEstimate": "350000",
    "gasPrice": "1.11",
    "slippagePercent": "0.69"
  }
}
```

## 🧪 Testing

The project includes comprehensive test coverage:

- **FlashLoanExecutor.test.js** - Contract behavior validation
- **Price quote accuracy** - Uniswap router integration
- **Gas estimation** - Cost modeling verification
- **Revert conditions** - Error handling for edge cases

Run full test suite:
```bash
npx hardhat test --network hardhat
```

## 📈 Performance Metrics

- **Evaluation Speed:** ~4 seconds per full multi-path scan
- **Gas Efficiency:** Flash loan execution <350k gas
- **Profit Threshold:** Minimum $5 net profit after all costs
- **Safety Margin:** 2% max slippage, 50 gwei gas cap

## 🎓 Learning Outcomes

This project demonstrates:
- Advanced Solidity patterns (flash loans, callbacks, access control)
- MEV extraction strategies and profitability analysis
- Gas optimization techniques for on-chain transactions
- DeFi protocol integration (Aave, Uniswap)
- Production-grade testing and CI/CD
- Real-world arbitrage bot architecture

## 🤝 Contributing

This is a personal learning and portfolio project. However, suggestions and feedback are welcome via issues.

## 📄 License

MIT License - See LICENSE file for details

## 👤 Author

**Jacob Doswell**
- GitHub: [@in8forge](https://github.com/in8forge)
- Repository: [defi-fullstack-career](https://github.com/in8forge/defi-fullstack-career)

## 🔗 Resources

- [Aave V3 Documentation](https://docs.aave.com/developers/)
- [Uniswap V2 Documentation](https://docs.uniswap.org/contracts/v2/overview)
- [Hardhat Documentation](https://hardhat.org/docs)
- [MEV Research](https://docs.flashbots.net/)

---

**Status:** Active development | Week 4 of 12-month roadmap
**Next Milestone:** Production flash loan execution with MEV protection
