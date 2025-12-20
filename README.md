<div align="center">

# ⚡ DeFi Liquidation Bot

[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636?logo=solidity&logoColor=white)](https://soliditylang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.22-FFF100?logo=hardhat&logoColor=black)](https://hardhat.org/)
[![ethers.js](https://img.shields.io/badge/ethers.js-6.x-3C3C3D?logo=ethereum&logoColor=white)](https://docs.ethers.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Multi-chain liquidation bot monitoring 3,000+ positions across Aave V3, Compound V3, and Venus Protocol**

[Features](#-features) • [Architecture](#-architecture) • [Supported Chains](#-supported-chains) • [Quick Start](#-quick-start) • [Deployment](#-deployment)

</div>

---

## 🎯 Overview

Production-grade liquidation infrastructure for DeFi lending protocols. Monitors borrower health factors in real-time via WebSocket oracle subscriptions and executes flash loan liquidations when profitable opportunities arise.

### Key Metrics
- **3,121 positions** monitored across 5 chains
- **Sub-second** reaction time via WebSocket oracles
- **Flash loan** liquidations (zero capital required)
- **MEV protection** via Flashbots on Base
- **Bad debt filter** to avoid unprofitable positions

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔗 **Multi-Chain** | Base, Polygon, Arbitrum, Avalanche, BNB Chain |
| 📊 **Multi-Protocol** | Aave V3, Compound V3, Venus Protocol |
| ⚡ **Flash Loans** | Atomic liquidations with zero upfront capital |
| 🛡️ **MEV Protection** | Private transactions via Flashbots Protect |
| 💀 **Bad Debt Filter** | Skips uncollateralized positions automatically |
| 📡 **Real-time Oracles** | Chainlink price feed subscriptions |
| 🔔 **Discord Alerts** | Instant notifications for opportunities |
| 📈 **Dashboard** | Live web dashboard for monitoring |

---

## 🏗️ Architecture
```
┌─────────────────────────────────────────────────────────────────────┐
│                      EVENT LIQUIDATOR V6.1                          │
├─────────────────────────────────────────────────────────────────────┤
│  ORACLE FEEDS (WebSocket)                                           │
│  ├─ Base ETH/USD      ├─ Polygon ETH/USD                           │
│  ├─ Arbitrum ETH/USD  └─ Avalanche AVAX/USD                        │
├─────────────────────────────────────────────────────────────────────┤
│  PROTOCOLS MONITORED                                                │
│  ├─ Aave V3 (4 chains) ────────→ 2,238 positions                   │
│  ├─ Compound V3 (3 chains) ────→ 880 positions                     │
│  └─ Venus (BNB Chain) ─────────→ 3 positions                       │
├─────────────────────────────────────────────────────────────────────┤
│  EXECUTION                                                          │
│  ├─ Flash Loan Liquidators (5 chains)                              │
│  ├─ Flashbots MEV Protection (Base)                                │
│  └─ Auto profit withdrawal                                          │
├─────────────────────────────────────────────────────────────────────┤
│  ALERTS                                                             │
│  └─ Discord webhook notifications                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔗 Supported Chains

| Chain | Protocol | Liquidator Contract | Status |
|-------|----------|---------------------|--------|
| Base | Aave V3 | ✅ Live |
| Polygon | Aave V3 | ✅ Live |
| Arbitrum | Aave V3 | ✅ Live |
| Avalanche | Aave V3 | ✅ Live |
| BNB Chain | Venus | ✅ Live |

---

## 🚀 Quick Start

### Prerequisites

- Node.js 22+
- npm or yarn
- Private key with gas on target chains

### Installation
```bash
# Clone repository
git clone https://github.com/in8forge/defi-fullstack-career.git
cd defi-fullstack-career

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your RPC URLs and private key
```

### Configuration

Create a `.env` file:
```env
PRIVATE_KEY=your_private_key_here
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...

# RPC URLs
BASE_RPC_URL=https://mainnet.base.org
BASE_WS_URL=wss://base-mainnet.g.alchemy.com/v2/...
POLYGON_RPC_URL=https://polygon-rpc.com
POLYGON_WS_URL=wss://polygon-mainnet.g.alchemy.com/v2/...
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
ARBITRUM_WS_URL=wss://arb-mainnet.g.alchemy.com/v2/...
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc
AVALANCHE_WS_URL=wss://avalanche-mainnet.g.alchemy.com/v2/...
BNB_RPC_URL=https://bsc-dataseed.binance.org
```

### Running
```bash
# Start the liquidation bot
node scripts/eventLiquidatorV6.js

# Start the dashboard (optional)
node scripts/botDashboard.js

# Or use PM2 for production
pm2 start scripts/eventLiquidatorV6.js --name event-liq-v6
pm2 start scripts/botDashboard.js --name dashboard
```

---

## 📁 Project Structure
```
├── contracts/
│   ├── FlashLiquidator.sol       # Aave V3 flash loan liquidator
│   ├── FlashLiquidatorV2.sol     # Multi-DEX routing version
│   └── BNBFlashLiquidator.sol    # Venus Protocol liquidator
├── scripts/
│   ├── eventLiquidatorV6.js      # Main monitoring bot
│   ├── botDashboard.js           # Web dashboard
│   ├── deploy-*.js               # Deployment scripts
│   └── *Monitor.js               # Protocol-specific monitors
├── data/
│   ├── borrowers.json            # Aave borrower addresses
│   ├── compound_borrowers.json   # Compound borrower addresses
│   └── liquidators.json          # Deployed contract addresses
└── hardhat.config.cjs            # Hardhat configuration
```

---

## 🔧 Deployment

### Deploy Flash Liquidator
```bash
# Compile contracts
npx hardhat compile

# Deploy to specific chain
npx hardhat run scripts/deploy.js --network base
npx hardhat run scripts/deploy.js --network polygon
npx hardhat run scripts/deploy.js --network arbitrum
npx hardhat run scripts/deploy.js --network avalanche
npx hardhat run scripts/deploy-bnb.js --network bnb
```

### Verify Contract
```bash
npx hardhat verify --network base <CONTRACT_ADDRESS>
```

---

## 📊 Dashboard

Access the live dashboard at `http://your-server:3000`

Features:
- Real-time chain balances
- Contract deployment status
- Critical position monitoring
- Bot health status

---

## 🛡️ Security Considerations

- **Private Keys**: Never commit `.env` files. Use environment variables in production.
- **MEV Protection**: Uses Flashbots Protect on Base to prevent frontrunning.
- **Bad Debt Filter**: Automatically skips positions with no collateral.
- **Profit Simulation**: Calculates expected profit before executing liquidations.

---

## 📈 Bot Fleet

| Bot | Purpose | Status |
|-----|---------|--------|
| `event-liq-v6` | Aave/Compound/Venus monitoring | ✅ Running |
| `multi-keeper` | GMX/Gains keeper jobs | ✅ Running |
| `snx-settler` | Synthetix order settlements | ✅ Running |
| `dashboard` | Web status interface | ✅ Running |

---

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

This software is provided "as is" without warranty of any kind. Use at your own risk. The authors are not responsible for any financial losses incurred while using this software.

---

<div align="center">

**Built with ❤️ for DeFi**

[⬆ Back to Top](#-defi-liquidation-bot)

</div>
