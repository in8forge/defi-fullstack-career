# 📜 Trading Scripts

Automated trading bots and utilities for DeFi operations on Base L2.

## 🤖 Main Bots

### `baseAutoExecutor.js` - Arbitrage Bot
Multi-DEX arbitrage scanner and executor.

**Features:**
- Monitors 6 DEXs simultaneously
- Calculates cross-DEX arbitrage opportunities
- Auto-executes when profit > $0.30
- Gas-aware profitability calculations

**Run:**
```bash
node scripts/baseAutoExecutor.js
```

**Sample Output:**
```
📊 DEX Quotes for $10 USDC → WETH:
   Uniswap V2  : 0.0030743163 WETH
   SushiSwap   : 0.0030583232 WETH
```

---

### `baseLiquidationBot.js` - Liquidation Bot
Aave V3 liquidation scanner with flash loan execution.

**Features:**
- Discovers Aave V3 borrowers from on-chain events
- Monitors health factors in real-time
- Calculates liquidation profitability
- Executes via FlashLiquidator contract (zero capital)

**Run:**
```bash
node scripts/baseLiquidationBot.js
```

**Sample Output:**
```
⚠️  AT RISK: 0xA741cdDf... | HF: 1.1772 | Debt: $126875
💰 Expected Profit: $3,171 if liquidated
```

---

### `baseLPFarmingBot.js` - LP Farming Bot
Automated liquidity provision with auto-compounding.

**Features:**
- Monitors Aerodrome LP positions
- Claims AERO rewards automatically
- Swaps rewards to pool tokens
- Re-stakes for compound effect

**Run:**
```bash
node scripts/baseLPFarmingBot.js
```

---

## 🔧 Utilities

| Script | Purpose |
|--------|---------|
| `checkAllBalances.js` | View all token balances |
| `checkFarmingStatus.js` | Detailed LP position info |
| `swapUsdcToUsdbC.js` | Swap tokens for LP deposit |
| `stakeLPTokens.js` | Stake LP tokens in gauge |
| `findAerodromePools.js` | Discover pool addresses |
| `deployFlashLiquidator.js` | Deploy liquidator contract |

---

## ⚙️ Configuration

All scripts read from `.env`:
```
BASE_RPC_URL=your_alchemy_url
PRIVATE_KEY=your_private_key
ENABLE_EXECUTION=true
ENABLE_LIQUIDATION=true
ENABLE_LP_DEPOSIT=true
```

---

## 🔐 Security Notes

- Never commit `.env` to git
- Use separate wallets for testing vs production
- Start with small amounts to verify execution
- Monitor gas prices before large transactions
