# DeFi Full-Stack Infrastructure
## Multi-Chain Liquidation, Monitoring, and Execution System

**Versions: V7.5 (JS) → V25 (Rust)**

A production-grade multi-chain liquidation and monitoring system operating across Aave V3, Compound V3, and Venus, with real-time price streaming, MEV protection, flash-loan execution, and cross-chain automation.

---

## System Overview

Monitors **542,000+ borrower positions** across **7 chains** and executes profitable liquidations via flash loans and MEV-protected transactions.

### Supported Chains

| Chain | Status | Borrowers |
|-------|--------|-----------|
| Ethereum Mainnet | ✅ Live | Discovering |
| Base | ✅ Live | 197,507 |
| Optimism | ✅ Live | Discovering |
| Arbitrum | ✅ Live | 177,764 |
| Polygon | ✅ Live | 103,576 |
| Avalanche | ✅ Live | 63,266 |
| BNB Chain | ✅ Live | Discovering |

### Supported Protocols

- Aave V1 / V2 / V3
- Compound V3
- Venus

---

## Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                      ORACLE LAYER                                │
│  Chainlink WS Feeds → Price Cache → Cross-Validation            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    MONITORING LAYER                              │
│  542k+ Positions │ Multicall3 Batching │ HF Simulation          │
│  Borrower Discovery │ Bad Debt Detection │ Discord Alerts       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    EXECUTION LAYER                               │
│  Flash Loans │ Flashbots MEV │ Multi-DEX Routing                │
│  Priority Queue │ Profit Simulation │ Competitor Detection      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    TREASURY LAYER                                │
│  Auto-Withdraw (30 min) │ Multi-Token │ Threshold Sweeps        │
└─────────────────────────────────────────────────────────────────┘
```

---

## V25 (Rust) - Current Production

High-performance Rust engine with 7-chain support.

### Performance vs JS

| Metric | V7.5 (JS) | V25 (Rust) |
|--------|-----------|------------|
| Execution Speed | 1x | ~10x |
| Memory Usage | ~150MB | ~35MB |
| RPC Failover | ❌ | ✅ 2-3/chain |
| Multicall Batching | ❌ | ✅ 100/call |
| Priority Queue | ❌ | ✅ Profit-sorted |
| DEX Routing | Uniswap only | 1inch+Paraswap+Uni |

### Features

| Feature | Description |
|---------|-------------|
| Multi-RPC Failover | 2-3 providers per chain with health checks |
| Multicall3 | Batch 100 positions per RPC call |
| MEV Protection | Flashbots bundle submission |
| DEX Routing | 1inch → Paraswap → Uniswap fallback |
| Priority Queue | Profit-first liquidation ordering |
| Auto-Withdraw | Sweep profits every 30 minutes |
| Circuit Breaker | Auto-pause on consecutive failures |

### Contract Deployments

| Chain | Address |
|-------|---------|
| Ethereum | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Base | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Optimism | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Arbitrum | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Polygon | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Avalanche | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| BNB Chain | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |

---

## Quick Start

### Rust V25
```bash
cd liquidator-rs
cp .env.example .env  # Configure your keys
cargo build --release
./target/release/liquidator
```

### Environment Variables
```env
PRIVATE_KEY=0x...
DISCORD_WEBHOOK=https://discord.com/api/webhooks/...
DRY_RUN=false

# RPCs (comma-separated for failover)
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/KEY
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/KEY
OPTIMISM_RPC_URL=https://opt-mainnet.g.alchemy.com/v2/KEY
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/KEY
POLYGON_RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/KEY
AVALANCHE_RPC_URL=https://avax-mainnet.g.alchemy.com/v2/KEY
BNB_RPC_URL=https://bsc-dataseed.binance.org

# Liquidator Contracts
ETHEREUM_LIQUIDATOR=0x163A862679E73329eA835aC302E54aCBee7A58B1
BASE_LIQUIDATOR=0x163A862679E73329eA835aC302E54aCBee7A58B1
# ... etc for each chain
```

---

## Production Infrastructure

### Services

| Component | Manager | Purpose |
|-----------|---------|---------|
| liquidator-rust | systemd | Rust 7-chain liquidator |
| botDashboard | PM2 | Web monitoring dashboard |
| multi-keeper | PM2 | GMX/Gains/SNX automation |
| snx-settler | PM2 | Synthetix settlement |

### Commands
```bash
# Rust bot
systemctl status liquidator-rust
systemctl restart liquidator-rust
journalctl -u liquidator-rust -f

# Dashboard  
pm2 logs botDashboard

# Health
curl http://localhost:3847/health
```

### Dashboard

Live monitoring showing:
- Bot status & uptime
- 7 chain balances
- RPC health per chain
- Liquidation statistics
- Critical positions (HF < 1)
- Circuit breaker status

---

## Project Structure
```
├── liquidator-rs/          # Rust V25 engine
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── chains.rs       # Multi-RPC management
│   │   ├── scanner.rs      # Position monitoring
│   │   ├── executor.rs     # Liquidation + auto-withdraw
│   │   ├── oracle.rs       # Chainlink WS feeds
│   │   ├── swap.rs         # Multi-DEX routing
│   │   └── protocols/      # Aave, Compound, Venus
│   └── Cargo.toml
├── contracts/              # Solidity contracts
│   ├── FlashLiquidatorV2.sol
│   └── BNBFlashLiquidator.sol
├── scripts/                # JS utilities & legacy
└── data/                   # Borrower cache
```

---

## Technical Skills Demonstrated

- **Smart Contracts**: Flash loans, liquidation logic, multi-DEX swaps, MEV mitigation
- **Rust**: High-performance async systems, error handling, type safety
- **DeFi Protocols**: Aave V3, Compound V3, Venus, Uniswap, Chainlink
- **Infrastructure**: Multi-chain coordination, RPC failover, systemd services
- **Production Ops**: Circuit breakers, health monitoring, 24/7 uptime

---

## Changelog

### 2024-12-24 - V25 Expansion
- Added Ethereum mainnet support
- Added Optimism support  
- Deployed FlashLiquidatorV2 to Ethereum
- 7 chains now active
- 542k+ borrowers monitored

### 2024-12-23 - V25 Release
- Migrated from JS to Rust engine
- Added auto-withdraw profits
- Deployed to VPS with systemd
- ~10x performance improvement

---

## Contact

- Email: insightforge@tuta.io
- GitHub: [github.com/in8forge](https://github.com/in8forge)
