import 'dotenv/config';
import { ethers } from 'ethers';
import http from 'http';
import fs from 'fs';

// ============================================================
// BOT DASHBOARD V3 - Liquidator V7.5 Status
// ============================================================

const PORT = 3000;

const CHAINS = {
  base: { rpc: process.env.BASE_RPC_URL, explorer: 'https://basescan.org', symbol: 'ETH', color: '#0052FF' },
  polygon: { rpc: process.env.POLYGON_RPC_URL, explorer: 'https://polygonscan.com', symbol: 'POL', color: '#8247E5' },
  arbitrum: { rpc: process.env.ARBITRUM_RPC_URL, explorer: 'https://arbiscan.io', symbol: 'ETH', color: '#28A0F0' },
  avalanche: { rpc: process.env.AVALANCHE_RPC_URL, explorer: 'https://snowtrace.io', symbol: 'AVAX', color: '#E84142' },
  bnb: { rpc: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org', explorer: 'https://bscscan.com', symbol: 'BNB', color: '#F0B90B' },
};

const WALLET = process.env.PRIVATE_KEY ? 
  new ethers.Wallet(process.env.PRIVATE_KEY).address : 
  '0x55F5F2186f907057EB40a9EFEa99A0A41BcbB885';

// Load liquidator addresses
let liquidatorAddresses = {};
try { liquidatorAddresses = JSON.parse(fs.readFileSync('data/liquidators.json', 'utf8')); } catch {}

// Stats tracking
let stats = {
  startTime: Date.now(),
  liquidations: 0,
  attempted: 0,
  failed: 0,
  totalEarned: 0,
  positionsMonitored: 0,
  criticalPositions: [],
  lastCheck: Date.now(),
  version: 'V7.5',
};

// Try to read stats from liquidator log
function updateStatsFromLog() {
  try {
    const logPath = '/home/botuser/.pm2/logs/liquidator-v75-out.log';
    const log = fs.readFileSync(logPath, 'utf8');
    const lines = log.split('\n').slice(-200);
    
    // Parse latest stats
    for (const line of lines.reverse()) {
      if (line.includes('Checks:')) {
        const match = line.match(/Attempted: (\d+).*Success: (\d+).*Failed: (\d+)/);
        if (match) {
          stats.attempted = parseInt(match[1]);
          stats.liquidations = parseInt(match[2]);
          stats.failed = parseInt(match[3]);
          break;
        }
      }
    }
    
    // Parse critical positions
    stats.criticalPositions = [];
    for (const line of lines) {
      if (line.includes('CRITICAL:')) {
        const match = line.match(/CRITICAL: (\w+) (\w+) (0x[a-fA-F0-9]+).*\$([0-9,]+).*HF: ([0-9.]+)/);
        if (match) {
          const existing = stats.criticalPositions.find(p => p.user === match[3]);
          if (!existing) {
            stats.criticalPositions.push({
              chain: match[1],
              protocol: match[2],
              user: match[3],
              debt: match[4].replace(',', ''),
              hf: match[5],
            });
          }
        }
      }
    }
    stats.criticalPositions = stats.criticalPositions.slice(0, 10);
    
    // Parse positions count
    for (const line of lines) {
      if (line.includes('POSITIONS:')) {
        const match = line.match(/POSITIONS: (\d+) Aave \+ (\d+) Compound \+ (\d+) Venus/);
        if (match) {
          stats.positionsMonitored = parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3]);
          break;
        }
      }
    }
    
    stats.lastCheck = Date.now();
  } catch {}
}

async function getBalances() {
  const balances = {};
  
  for (const [chain, config] of Object.entries(CHAINS)) {
    if (!config.rpc) continue;
    try {
      const provider = new ethers.JsonRpcProvider(config.rpc);
      const balance = await provider.getBalance(WALLET);
      const block = await provider.getBlockNumber();
      balances[chain] = {
        native: Number(ethers.formatEther(balance)).toFixed(4),
        symbol: config.symbol,
        explorer: config.explorer,
        color: config.color,
        block,
        liquidator: liquidatorAddresses[chain] || liquidatorAddresses.compound?.[chain] || null,
      };
    } catch (e) {
      balances[chain] = { 
        native: 'Error', 
        symbol: config.symbol, 
        explorer: config.explorer,
        color: config.color,
        error: e.message.slice(0, 30),
      };
    }
  }
  
  return balances;
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m ${seconds % 60}s`;
}

function formatNumber(num) {
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(0)}K`;
  return `$${num}`;
}

async function generateHTML() {
  updateStatsFromLog();
  const balances = await getBalances();
  const uptime = formatUptime(Date.now() - stats.startTime);
  
  return `<!DOCTYPE html>
<html>
<head>
  <title>Liquidator Dashboard V7.4.1</title>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%);
      color: #e6e6e6;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 1px solid #333;
    }
    h1 { 
      font-size: 28px;
      background: linear-gradient(90deg, #00d4ff, #7b2cbf);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .version {
      background: #7b2cbf;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: rgba(255,255,255,0.05);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .stat-label { 
      font-size: 13px; 
      color: #888; 
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .stat-value { 
      font-size: 32px; 
      font-weight: 700;
    }
    .stat-value.success { color: #00ff88; }
    .stat-value.warning { color: #ffaa00; }
    .stat-value.danger { color: #ff4466; }
    .stat-value.info { color: #00d4ff; }
    
    .section-title {
      font-size: 20px;
      margin: 30px 0 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .chains-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 30px;
    }
    .chain-card {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
      border-left: 4px solid var(--chain-color);
    }
    .chain-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .chain-name {
      font-size: 18px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .chain-balance {
      font-size: 24px;
      font-weight: 700;
      color: #00ff88;
    }
    .chain-symbol {
      font-size: 14px;
      color: #888;
      margin-left: 4px;
    }
    .chain-info {
      font-size: 13px;
      color: #666;
      margin-top: 12px;
    }
    .chain-info a {
      color: #00d4ff;
      text-decoration: none;
    }
    
    .critical-table {
      width: 100%;
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 30px;
    }
    .critical-table th {
      background: rgba(255,68,102,0.2);
      padding: 14px 16px;
      text-align: left;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #ff4466;
    }
    .critical-table td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .critical-table tr:last-child td { border-bottom: none; }
    .hf-critical { 
      color: #ff4466;
      font-weight: 700;
    }
    .hf-warning {
      color: #ffaa00;
      font-weight: 700;
    }
    
    .bots-list {
      background: rgba(255,255,255,0.05);
      border-radius: 12px;
      padding: 20px;
    }
    .bot-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .bot-item:last-child { border-bottom: none; }
    .bot-name { font-weight: 500; }
    .bot-status {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #00ff88;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: #00ff88;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    footer {
      text-align: center;
      padding: 30px;
      color: #666;
      font-size: 13px;
    }
    
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Liquidator Dashboard</h1>
      <span class="version">${stats.version}</span>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Uptime</div>
        <div class="stat-value info">${uptime}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Positions Monitored</div>
        <div class="stat-value">${stats.positionsMonitored.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Liquidations</div>
        <div class="stat-value success">${stats.liquidations}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Attempted</div>
        <div class="stat-value warning">${stats.attempted}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Failed</div>
        <div class="stat-value danger">${stats.failed}</div>
      </div>
    </div>
    
    <h2 class="section-title">Critical Positions (HF &lt; 1.02)</h2>
    ${stats.criticalPositions.length > 0 ? `
    <table class="critical-table">
      <thead>
        <tr>
          <th>Chain</th>
          <th>Protocol</th>
          <th>User</th>
          <th>Debt</th>
          <th>Health Factor</th>
        </tr>
      </thead>
      <tbody>
        ${stats.criticalPositions.map(p => `
          <tr>
            <td>${p.chain.toUpperCase()}</td>
            <td>${p.protocol.toUpperCase()}</td>
            <td><a href="${CHAINS[p.chain]?.explorer || '#'}/address/${p.user}" target="_blank" style="color: #00d4ff">${p.user.slice(0, 10)}...</a></td>
            <td>${formatNumber(parseFloat(p.debt))}</td>
            <td class="${parseFloat(p.hf) < 1.01 ? 'hf-critical' : 'hf-warning'}">${p.hf}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    ` : '<div class="empty-state">No critical positions currently</div>'}
    
    <h2 class="section-title">Chain Balances</h2>
    <div class="chains-grid">
      ${Object.entries(balances).map(([chain, data]) => `
        <div class="chain-card" style="--chain-color: ${data.color}">
          <div class="chain-header">
            <span class="chain-name">${chain}</span>
          </div>
          <div class="chain-balance">
            ${data.native}<span class="chain-symbol">${data.symbol}</span>
          </div>
          ${data.block ? `<div class="chain-info">Block #${data.block.toLocaleString()}</div>` : ''}
          ${data.liquidator ? `<div class="chain-info">Liquidator: <a href="${data.explorer}/address/${data.liquidator}" target="_blank">${data.liquidator.slice(0,10)}...</a></div>` : ''}
        </div>
      `).join('')}
    </div>
    
    <h2 class="section-title">Active Bots</h2>
    <div class="bots-list">
      <div class="bot-item">
        <span class="bot-name">Liquidator V7.5</span>
        <span class="bot-status"><span class="status-dot"></span> Running</span>
      </div>
      <div class="bot-item">
        <span class="bot-name">Multi-Protocol Keeper</span>
        <span class="bot-status"><span class="status-dot"></span> Running</span>
      </div>
      <div class="bot-item">
        <span class="bot-name">Synthetix Settler</span>
        <span class="bot-status"><span class="status-dot"></span> Running</span>
      </div>
    </div>
    
    <footer>
      Last updated: ${new Date().toLocaleString()} | Auto-refresh: 30s | Week 5 DeFi Engineering
    </footer>
  </div>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/dashboard') {
    const html = await generateHTML();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.url === '/api/stats') {
    updateStatsFromLog();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Dashboard V3 - Liquidator V7.5 Status                               ║
║  http://localhost:${PORT}                                                ║
║  http://104.238.135.135:${PORT}                                          ║
╚══════════════════════════════════════════════════════════════════════╝
`);
});

