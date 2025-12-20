# DeFi Full-Stack Infrastructure

**Multi-Chain Liquidation, Monitoring, and Execution System**

**Version: v7.5 (Production Hardened)**

This repository contains a complete multi-chain, multi-protocol liquidation and monitoring system, built to operate in real-time across Aave V3, Compound V3, and Venus, with price oracle streaming, MEV protection, and Flash Loan execution.

It demonstrates end-to-end DeFi engineering capabilities including:

- Solidity smart contracts
- Flash loan liquidation design
- Cross-chain monitoring architecture
- MEV-aware execution
- Price oracle integration
- Backend infrastructure
- Production reliability engineering

This is the same class of system used by professional liquidators, MEV searchers, risk engines, and protocol automation teams.

---

## Overview

The system continuously monitors 3,000+ borrower positions across five chains, simulating profit, detecting liquidations, and executing via flash loans when profitable.

### Supported Chains

- Base
- Polygon
- Arbitrum
- Avalanche
- BNB Chain

### Supported Protocols

- Aave V1 / V2 / V3
- Compound V3
- Venus

### Execution Layer

- Flash loan liquidators deployed on all supported networks
- Flashbots MEV bundle submission
- Auto-withdraw to owner
- Competitor detection
- Gas optimisation & nonce tracking

### Monitoring Layer

- Chainlink WebSocket price feeds
- Multicall3 batched HF/position checks
- Bad debt detection
- Borrower discovery (Aave, Compound, Venus)
- Discord alerting

---

## Core Components

### 1. Liquidation Smart Contracts

Located in `contracts/`:

- `FlashLiquidator.sol` (multi-chain)
- `BNBFlashLiquidator.sol` (Venus integration)

Supports:
- Flash loans
- Collateral swaps
- Repay logic
- Profit extraction
- Exec safety checks

Contracts are deployed on all chains and addresses are stored in:
```
data/liquidators.json
```

### 2. EventLiquidator V7.5

Main execution engine: `scripts/eventLiquidatorV7_5.js`

Features:
- Monitors Aave, Compound, Venus across chains
- Real-time price streaming (Chainlink WS)
- Health factor calculation
- Liquidatable position detection
- Profit simulation
- Execution with MEV protection
- Competitor detection
- Auto-withdraw profits to owner
- Bad debt auto-tracking
- Discord notifications
- Graceful shutdown + restart

### 3. Utilities & Tooling

- `deploy-*.js`: automated contract deployments
- `scripts/` includes:
  - protocol checkers
  - borrower scanners
  - liquidation simulators
  - swap helpers
  - execution utilities

---

## Architecture
```
┌────────────────────────────────────────────────────────────────────┐
│                         ORACLE LAYER                               │
│   Chainlink WS Feeds → ETH/USD, BTC/USD, AVAX/USD, MATIC/USD       │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│                    MONITORING LAYER (V7.5)                         │
│   • Aave V3 (4 chains) → 2,238 positions                           │
│   • Compound V3 (3 chains) → 880 positions                         │
│   • Venus (BNB) → 10 positions                                     │
│   • Multicall3 batching                                            │
│   • Price cache + HF cache                                         │
│   • Discord Alerts                                                 │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│                     EXECUTION LAYER                                │
│   • Flash Loan Liquidators (5 chains)                              │
│   • Flashbots MEV protection                                       │
│   • Competitor detection                                           │
│   • Profit simulation                                              │
│   • Auto-withdraw profits                                          │
└────────────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY & OPS                             │
│   • /health endpoint                                               │
│   • /debug endpoint                                                │
│   • Circuit breaker                                                │
│   • Graceful shutdown                                              │
│   • Debug logs → data/debug.json                                   │
└────────────────────────────────────────────────────────────────────┘
```

---

## v7.5 Release Notes (Production Hardened)

This release brings major reliability upgrades:

### Critical Fixes
- Environment variable validation
- Execution lock timeouts
- Nonce management overhaul
- Circuit breaker (auto-pause after repeated failures)
- Event handler crash protection

### High Priority Fixes
- Price cache reduced from 60s → 10s
- Protocol bonus validation
- Competitor detection before execution

### Medium Priority Fixes
- Empty catch blocks replaced with structured logs
- Memory leak fixed in opportunity log
- Graceful shutdown and interval tracking

### New Features
- `/health` endpoint
- `/debug` endpoint
- Dry run mode (`DRY_RUN=true`)
- Competitor liquidation tracking
- Circuit breaker status reporting

---

## Deployment Summary

### Smart Contracts (per chain)

| Chain | Contract | Address |
|-------|----------|---------|
| Base | FlashLiquidator | `0xDB3F939A10F098FaF5766aCF856fEda287c2ce22` |
| Polygon | FlashLiquidator | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Arbitrum | FlashLiquidator | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| Avalanche | FlashLiquidator | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |
| BNB Chain | BNBFlashLiquidator | `0x163A862679E73329eA835aC302E54aCBee7A58B1` |

---

## Running the Monitoring System

Requires Node 22+ and a funded wallet with gas on monitored chains.
```bash
npm install
npm run monitor
```

Environment variables:
```
PRIVATE_KEY=...
ALCHEMY_KEY=...
DISCORD_WEBHOOK=...
DRY_RUN=false
```

Health check:
```bash
curl http://localhost:3847/health
curl http://localhost:3847/debug
```

---

## VPS Infrastructure

The system is actively running on a production VPS:

| Component | Status | Purpose |
|-----------|--------|---------|
| liquidator-v75 | Online | Multi-protocol liquidation monitor |
| multi-keeper | Online | GMX / Gains / SNX automation |
| snx-settler | Online | Synthetix perpetual order settlement |
| dashboard | Online | Monitoring dashboard |

---

## Technical Skills Demonstrated

This repo demonstrates expertise across:

### Smart Contracts
- Flash loans
- Liquidation logic
- Collateral swap routing
- MEV mitigation

### Backend & Infrastructure
- Multi-chain RPC management
- WebSocket oracles
- Multicall batching
- Rate limiting
- Nonce management
- Circuit breaker design

### DeFi Protocol Knowledge
- Aave V3 liquidation engine
- Compound V3 base-collateral model
- Venus liquidation logic
- Swap routers (Uni/Pancake)
- Price oracle manipulation safety

### Production Engineering
- Process crash resistance
- Graceful shutdown
- Observability endpoints
- Real-time alerting
- Configurable execution engine

---

## Contact & Hiring

This repository represents a complete, production-scale DeFi engineering codebase, demonstrating both:

- Smart contract expertise
- Backend execution engine design
- Multi-chain liquidation knowledge

I am available for:
- Smart contract development
- Risk / liquidation systems
- MEV/keeper infrastructure
- Protocol automation
- DeFi backend engineering

**Email:** insightforge@tuta.io

**GitHub:** [github.com/in8forge](https://github.com/in8forge)
