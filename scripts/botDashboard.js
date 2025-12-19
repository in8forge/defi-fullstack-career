import 'dotenv/config';
import { ethers } from 'ethers';
import http from 'http';

// ============================================================
// BOT DASHBOARD - Public Stats Page
// ============================================================

const PORT = 3000;

const CHAINS = {
  base: { rpc: process.env.BASE_RPC_URL, explorer: 'https://basescan.org', symbol: 'ETH' },
  polygon: { rpc: process.env.POLYGON_RPC_URL, explorer: 'https://polygonscan.com', symbol: 'POL' },
  arbitrum: { rpc: process.env.ARBITRUM_RPC_URL, explorer: 'https://arbiscan.io', symbol: 'ETH' },
  avalanche: { rpc: process.env.AVALANCHE_RPC_URL, explorer: 'https://snowtrace.io', symbol: 'AVAX' },
  bnb: { rpc: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com', symbol: 'BNB' },
};

const WALLET = process.env.PRIVATE_KEY ? 
  new ethers.Wallet(process.env.PRIVATE_KEY).address : 
  '0x55F5F2186f907057EB40a9EFEa99A0A41BcbB885';

let stats = {
  startTime: Date.now(),
  liquidations: 0,
  settlements: 0,
  totalEarned: 0,
  positionsMonitored: 3118,
  lastUpdate: Date.now(),
};

async function getBalances() {
  const balances = {};
  
  for (const [chain, config] of Object.entries(CHAINS)) {
    if (!config.rpc) continue;
    try {
      const provider = new ethers.JsonRpcProvider(config.rpc);
      const balance = await provider.getBalance(WALLET);
      balances[chain] = {
        native: Number(ethers.formatEther(balance)).toFixed(4),
        symbol: config.symbol,
        explorer: `${config.explorer}/address/${WALLET}`,
      };
    } catch {
      balances[chain] = { native: 'Error', symbol: config.symbol, explorer: config.explorer };
    }
  }
  
  return balances;
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m ${seconds % 60}s`;
}

async function generateHTML() {
  const balances = await getBalances();
  const uptime = formatUptime(Date.now() - stats.startTime);
  
  return `
<!DOCTYPE html>
<html>
<head>
  <title>DeFi Bot Dashboard</title>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', sans-serif; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { 
      text-align: center; 
      margin-bottom: 30px;
      font-size: 2.5em;
      background: linear-gradient(90deg, #00d9ff, #00ff88);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .grid { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
      gap: 20px; 
      margin-bottom: 30px;
    }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 15px;
      padding: 25px;
      border: 1px solid rgba(255,255,255,0.1);
      backdrop-filter: blur(10px);
    }
    .card h2 { 
      font-size: 0.9em; 
      color: #888; 
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .card .value { 
      font-size: 2em; 
      font-weight: bold;
      color: #00ff88;
    }
    .card .value.warning { color: #ffaa00; }
    .card .value.danger { color: #ff4444; }
    .balances-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 15px;
    }
    .balance-item {
      background: rgba(0,217,255,0.1);
      padding: 15px;
      border-radius: 10px;
      text-align: center;
    }
    .balance-item .chain { 
      font-size: 0.85em; 
      color: #00d9ff;
      text-transform: uppercase;
      margin-bottom: 5px;
      font-weight: 600;
    }
    .balance-item .amount { 
      font-size: 1.4em; 
      font-weight: bold; 
    }
    .balance-item .symbol {
      font-size: 0.8em;
      color: #888;
      margin-left: 4px;
    }
    .balance-item a {
      display: block;
      margin-top: 8px;
      color: #666;
      font-size: 0.75em;
      text-decoration: none;
    }
    .balance-item a:hover { color: #00d9ff; }
    .status {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #00ff88;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .bots-list {
      list-style: none;
    }
    .bots-list li {
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .bots-list li:last-child { border: none; }
    .bot-name {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .bot-icon {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }
    .bot-status { 
      color: #00ff88;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.9em;
    }
    .bot-status::before {
      content: '';
      width: 8px;
      height: 8px;
      background: #00ff88;
      border-radius: 50%;
    }
    .wallet {
      font-family: monospace;
      font-size: 0.85em;
      color: #666;
      word-break: break-all;
      margin-top: 15px;
      padding: 10px;
      background: rgba(0,0,0,0.2);
      border-radius: 8px;
    }
    footer {
      text-align: center;
      color: #444;
      margin-top: 30px;
      font-size: 0.85em;
    }
    .protocols {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 15px;
    }
    .protocol-tag {
      background: rgba(0,217,255,0.15);
      color: #00d9ff;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 0.75em;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>DeFi Bot Dashboard</h1>
    
    <div class="grid">
      <div class="card">
        <h2>Status</h2>
        <div class="status">
          <div class="status-dot"></div>
          <span class="value">ONLINE</span>
        </div>
      </div>
      
      <div class="card">
        <h2>Uptime</h2>
        <div class="value">${uptime}</div>
      </div>
      
      <div class="card">
        <h2>Positions Monitored</h2>
        <div class="value">${stats.positionsMonitored.toLocaleString()}</div>
      </div>
      
      <div class="card">
        <h2>Total Earned</h2>
        <div class="value ${stats.totalEarned > 0 ? '' : 'warning'}">$${stats.totalEarned.toFixed(2)}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 20px;">
      <h2>Active Bots</h2>
      <ul class="bots-list">
        <li>
          <div class="bot-name">
            <span class="bot-icon">&#x1F480;</span>
            <span>Liquidation Bot V5</span>
          </div>
          <span class="bot-status">Running</span>
        </li>
        <li>
          <div class="bot-name">
            <span class="bot-icon">&#x1F916;</span>
            <span>Multi-Protocol Keeper</span>
          </div>
          <span class="bot-status">Running</span>
        </li>
        <li>
          <div class="bot-name">
            <span class="bot-icon">&#x1F535;</span>
            <span>Synthetix Settler</span>
          </div>
          <span class="bot-status">Running</span>
        </li>
      </ul>
      <div class="protocols">
        <span class="protocol-tag">Aave V3</span>
        <span class="protocol-tag">Compound V3</span>
        <span class="protocol-tag">Synthetix</span>
        <span class="protocol-tag">GMX</span>
        <span class="protocol-tag">Gains Network</span>
      </div>
    </div>

    <div class="card">
      <h2>Wallet Balances</h2>
      <div class="balances-grid">
        ${Object.entries(balances).map(([chain, data]) => `
          <div class="balance-item">
            <div class="chain">${chain}</div>
            <div class="amount">${data.native}<span class="symbol">${data.symbol}</span></div>
            <a href="${data.explorer}" target="_blank">View on Explorer</a>
          </div>
        `).join('')}
      </div>
      <div class="wallet">Wallet: ${WALLET}</div>
    </div>

    <footer>
      Last updated: ${new Date().toLocaleString()} | Auto-refresh: 30s
    </footer>
  </div>
</body>
</html>
  `;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/dashboard') {
    const html = await generateHTML();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
  console.log(`Public URL: http://104.238.135.135:${PORT}`);
});
