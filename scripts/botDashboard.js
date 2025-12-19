import 'dotenv/config';
import { ethers } from 'ethers';
import http from 'http';

const PORT = 3000;

const CHAINS = {
  base: { rpc: process.env.BASE_RPC_URL, native: 'ETH', explorer: 'https://basescan.org' },
  polygon: { rpc: process.env.POLYGON_RPC_URL, native: 'MATIC', explorer: 'https://polygonscan.com' },
  arbitrum: { rpc: process.env.ARBITRUM_RPC_URL, native: 'ETH', explorer: 'https://arbiscan.io' },
  avalanche: { rpc: process.env.AVALANCHE_RPC_URL, native: 'AVAX', explorer: 'https://snowtrace.io' },
  bnb: { rpc: process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org', native: 'BNB', explorer: 'https://bscscan.com' },
};

const LIQUIDATORS = {
  base: '0xDB3F939A10F098FaF5766aCF856fEda287c2ce22',
  polygon: '0x163A862679E73329eA835aC302E54aCBee7A58B1',
  arbitrum: '0x163A862679E73329eA835aC302E54aCBee7A58B1',
  avalanche: '0x163A862679E73329eA835aC302E54aCBee7A58B1',
  bnb: '0x163A862679E73329eA835aC302E54aCBee7A58B1',
};

async function getChainData(chain, config) {
  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    const block = await provider.getBlockNumber();
    
    let contractStatus = '❌ Not deployed';
    if (LIQUIDATORS[chain]) {
      const code = await provider.getCode(LIQUIDATORS[chain]);
      contractStatus = code.length > 10 ? '✅ Ready' : '❌ Not deployed';
    }
    
    return {
      chain,
      balance: Number(ethers.formatEther(balance)).toFixed(4),
      native: config.native,
      block,
      contract: LIQUIDATORS[chain] || 'N/A',
      contractStatus,
      explorer: config.explorer,
    };
  } catch (e) {
    return { chain, error: e.message.slice(0, 30) };
  }
}

async function generateDashboard() {
  const timestamp = new Date().toISOString();
  const chainData = await Promise.all(
    Object.entries(CHAINS).map(([chain, config]) => getChainData(chain, config))
  );

  return `<!DOCTYPE html>
<html>
<head>
  <title>🤖 DeFi Bot Dashboard</title>
  <meta http-equiv="refresh" content="30">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #eee; min-height: 100vh; padding: 20px; }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { text-align: center; margin-bottom: 10px; font-size: 2.5em; }
    .subtitle { text-align: center; color: #888; margin-bottom: 30px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: rgba(255,255,255,0.05); border-radius: 15px; padding: 20px; border: 1px solid rgba(255,255,255,0.1); }
    .card h3 { color: #4ecdc4; margin-bottom: 15px; display: flex; align-items: center; gap: 10px; }
    .chain-icon { width: 24px; height: 24px; border-radius: 50%; background: #4ecdc4; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; }
    .stat { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .stat:last-child { border: none; }
    .stat-label { color: #888; }
    .stat-value { font-weight: 600; }
    .status-card { grid-column: span 2; }
    .bot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
    .bot { background: rgba(0,0,0,0.2); padding: 15px; border-radius: 10px; }
    .bot-name { font-weight: 600; margin-bottom: 5px; }
    .bot-status { font-size: 0.9em; }
    .online { color: #4ecdc4; }
    .critical { background: rgba(255,107,107,0.2); border: 1px solid #ff6b6b; }
    .critical h3 { color: #ff6b6b; }
    .protocols { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .protocol-badge { background: rgba(78,205,196,0.2); color: #4ecdc4; padding: 4px 12px; border-radius: 20px; font-size: 0.85em; }
    a { color: #4ecdc4; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer { text-align: center; color: #666; margin-top: 30px; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 DeFi Liquidation Bot</h1>
    <p class="subtitle">Event Liquidator V6.1 - Bad Debt Filter Enabled</p>
    
    <div class="grid">
      <div class="card status-card">
        <h3>📊 Bot Status</h3>
        <div class="bot-grid">
          <div class="bot">
            <div class="bot-name">⚡ event-liq-v6</div>
            <div class="bot-status online">● Online</div>
            <div class="protocols">
              <span class="protocol-badge">Aave V3</span>
              <span class="protocol-badge">Compound V3</span>
              <span class="protocol-badge">Venus</span>
            </div>
          </div>
          <div class="bot">
            <div class="bot-name">🔧 multi-keeper</div>
            <div class="bot-status online">● Online</div>
            <div class="protocols">
              <span class="protocol-badge">GMX</span>
              <span class="protocol-badge">Gains</span>
            </div>
          </div>
          <div class="bot">
            <div class="bot-name">💹 snx-settler</div>
            <div class="bot-status online">● Online</div>
            <div class="protocols">
              <span class="protocol-badge">Synthetix</span>
            </div>
          </div>
          <div class="bot">
            <div class="bot-name">📈 dashboard</div>
            <div class="bot-status online">● Online</div>
            <div class="protocols">
              <span class="protocol-badge">Monitoring</span>
            </div>
          </div>
        </div>
      </div>
      
      <div class="card critical">
        <h3>🔥 Critical Positions</h3>
        <div class="stat"><span class="stat-label">Base Aave Whale</span><span class="stat-value">$1.26M @ HF 1.006</span></div>
        <div class="stat"><span class="stat-label">Avalanche Aave</span><span class="stat-value">$593K @ HF 1.010</span></div>
        <div class="stat"><span class="stat-label">Bad Debt Filtered</span><span class="stat-value">Venus $57K ✓</span></div>
        <div class="stat"><span class="stat-label">Total Monitored</span><span class="stat-value">3,121 positions</span></div>
      </div>
    </div>
    
    <div class="grid">
      ${chainData.map(d => d.error ? `
        <div class="card">
          <h3><span class="chain-icon">❌</span> ${d.chain}</h3>
          <div class="stat"><span class="stat-label">Error</span><span class="stat-value">${d.error}</span></div>
        </div>
      ` : `
        <div class="card">
          <h3><span class="chain-icon">⛓</span> ${d.chain.toUpperCase()}</h3>
          <div class="stat"><span class="stat-label">Balance</span><span class="stat-value">${d.balance} ${d.native}</span></div>
          <div class="stat"><span class="stat-label">Block</span><span class="stat-value">#${d.block.toLocaleString()}</span></div>
          <div class="stat"><span class="stat-label">Liquidator</span><span class="stat-value">${d.contractStatus}</span></div>
          <div class="stat"><span class="stat-label">Contract</span><span class="stat-value"><a href="${d.explorer}/address/${d.contract}" target="_blank">${d.contract.slice(0,8)}...</a></span></div>
        </div>
      `).join('')}
    </div>
    
    <div class="card">
      <h3>📋 System Info</h3>
      <div class="stat"><span class="stat-label">Version</span><span class="stat-value">V6.1 - Bad Debt Filter</span></div>
      <div class="stat"><span class="stat-label">Chains</span><span class="stat-value">Base, Polygon, Arbitrum, Avalanche, BNB</span></div>
      <div class="stat"><span class="stat-label">Protocols</span><span class="stat-value">Aave V3, Compound V3, Venus</span></div>
      <div class="stat"><span class="stat-label">Features</span><span class="stat-value">Flash Loans, MEV Protection, Bad Debt Filter</span></div>
      <div class="stat"><span class="stat-label">Last Update</span><span class="stat-value">${timestamp}</span></div>
    </div>
    
    <p class="footer">Auto-refreshes every 30 seconds | Week 5 DeFi Engineering</p>
  </div>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url === '/dashboard') {
    const html = await generateDashboard();
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  } else if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  📊 BOT DASHBOARD V2                                                 ║
║  🌐 http://localhost:${PORT}                                            ║
╚══════════════════════════════════════════════════════════════════════╝
`);
});
