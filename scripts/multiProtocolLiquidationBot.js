import { formatUnits, JsonRpcProvider, Contract } from "ethers";
import { alertLiquidation } from "./discordAlert.js";
import dotenv from "dotenv";

dotenv.config();

// ============ ALL LENDING PROTOCOLS (VERIFIED ADDRESSES) ============
const PROTOCOLS = [
  // ========== AAVE V3 ==========
  { name: "Aave V3", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", type: "aave", emoji: "👻" },
  { name: "Aave V3", chain: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", type: "aave", emoji: "👻" },
  { name: "Aave V3", chain: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", type: "aave", emoji: "👻" },
  { name: "Aave V3", chain: "Polygon", rpc: process.env.POLYGON_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", type: "aave", emoji: "👻" },
  { name: "Aave V3", chain: "Avalanche", rpc: process.env.AVALANCHE_RPC_URL, pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", type: "aave", emoji: "👻" },
  
  // ========== COMPOUND V3 ==========
  { name: "Compound V3", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0x46e6b214b524310239732D51387075E0e70970bf", type: "compound", emoji: "🏦" },
  { name: "Compound V3", chain: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", type: "compound", emoji: "🏦" },
  { name: "Compound V3", chain: "Polygon", rpc: process.env.POLYGON_RPC_URL, pool: "0xF25212E676D1F7F89Cd72fFEe66158f541246445", type: "compound", emoji: "🏦" },
  
  // ========== MORPHO ==========
  { name: "Morpho Blue", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb", type: "morpho", emoji: "🦋" },
  
  // ========== RADIANT ==========
  { name: "Radiant V2", chain: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0xF4B1486DD74D07706052A33d31d7c0AAFD0659E1", type: "aave", emoji: "☀️" },
  { name: "Radiant V2", chain: "BSC", rpc: "https://bsc-dataseed.binance.org", pool: "0xd50Cf00b6e600Dd036Ba8eF475677d816d6c4281", type: "aave", emoji: "☀️" },
  
  // ========== SPARK ==========
  { name: "Spark", chain: "Ethereum", rpc: "https://eth.llamarpc.com", pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987", type: "aave", emoji: "⚡" },
  
  // ========== SILO ==========
  { name: "Silo V1", chain: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0x8658047e48CC09161f4152c79155Dac1d710Ff0a", type: "silo", emoji: "🌾" },
  
  // ========== BENQI ==========
  { name: "Benqi", chain: "Avalanche", rpc: process.env.AVALANCHE_RPC_URL, pool: "0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4", type: "comptroller", emoji: "🐧" },
  
  // ========== VENUS ==========
  { name: "Venus", chain: "BSC", rpc: "https://bsc-dataseed.binance.org", pool: "0xfD36E2c2a6789Db23113685031d7F16329158384", type: "comptroller", emoji: "🪐" },
  
  // ========== SEAMLESS ==========
  { name: "Seamless", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0x8F44Fd754285aa6A2b8B9B97739B79746e0475a7", type: "aave", emoji: "🌊" },
  
  // ========== MOONWELL ==========
  { name: "Moonwell", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0xfBb21d0380beE3312B33c4353c8936a0F13EF26C", type: "comptroller", emoji: "🌙" },
  { name: "Moonwell", chain: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0xCa889f40aae37FFf165BccF69aeF1E82b5C511B9", type: "comptroller", emoji: "🌙" },
  
  // ========== GRANARY ==========
  { name: "Granary", chain: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0x102442A3BA1e441043154Bc0B8A2e2FB5E0F94A7", type: "aave", emoji: "🌽" },
  { name: "Granary", chain: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0x8FD4aF47E4E63d1D2D45582c3286b4BD9Bb95DfE", type: "aave", emoji: "🌽" },
  
  // ========== DFORCE ==========
  { name: "dForce", chain: "Arbitrum", rpc: process.env.ARBITRUM_RPC_URL, pool: "0x8E7e9eA9023B81457Ae7E6D2a51b003D421E5408", type: "comptroller", emoji: "💪" },
  { name: "dForce", chain: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0xA300A84D8970718Dac32f54F61Bd568142d8BCF4", type: "comptroller", emoji: "💪" },
  { name: "dForce", chain: "Polygon", rpc: process.env.POLYGON_RPC_URL, pool: "0x52eaCd19E38D501D006D2023C813d7E37F025f37", type: "comptroller", emoji: "💪" },
  
  // ========== SONNE ==========
  { name: "Sonne", chain: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0x60CF091cD3f50420d50fD7f707414d0DF4751C58", type: "comptroller", emoji: "🌞" },
  { name: "Sonne", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0x1DB2466d9F5e10D7090E7152B68d62703a2245F0", type: "comptroller", emoji: "🌞" },
  
  // ========== EXTRA FINANCE ==========
  { name: "Extra Finance", chain: "Optimism", rpc: process.env.OPTIMISM_RPC_URL, pool: "0xBB505c54D71E9e599cB8435b4F0cEEc05fC71cbD", type: "aave", emoji: "➕" },
  { name: "Extra Finance", chain: "Base", rpc: process.env.BASE_RPC_URL, pool: "0xBB505c54D71E9e599cB8435b4F0cEEc05fC71cbD", type: "aave", emoji: "➕" },
];

// ============ ABIs ============
const AAVE_ABI = [
  "function getUserAccountData(address) view returns (uint256,uint256,uint256,uint256,uint256,uint256)"
];

const COMPOUND_ABI = [
  "function borrowBalanceOf(address) view returns (uint256)",
  "function isLiquidatable(address) view returns (bool)"
];

const COMPTROLLER_ABI = [
  "function getAccountLiquidity(address) view returns (uint256,uint256,uint256)"
];

// ============ POSITION CHECKERS ============
async function checkPosition(protocol, user) {
  try {
    const provider = new JsonRpcProvider(protocol.rpc);
    
    if (protocol.type === "aave" || protocol.type === "morpho" || protocol.type === "silo") {
      const pool = new Contract(protocol.pool, AAVE_ABI, provider);
      const data = await pool.getUserAccountData(user);
      return {
        debt: Number(formatUnits(data[1], 8)),
        collateral: Number(formatUnits(data[0], 8)),
        hf: Number(formatUnits(data[5], 18))
      };
    }
    
    if (protocol.type === "compound") {
      const comet = new Contract(protocol.pool, COMPOUND_ABI, provider);
      const [borrowBalance, isLiquidatable] = await Promise.all([
        comet.borrowBalanceOf(user),
        comet.isLiquidatable(user)
      ]);
      return {
        debt: Number(formatUnits(borrowBalance, 6)),
        hf: isLiquidatable ? 0.9 : 1.5,
        liquidatable: isLiquidatable
      };
    }
    
    if (protocol.type === "comptroller") {
      const comptroller = new Contract(protocol.pool, COMPTROLLER_ABI, provider);
      const [err, liquidity, shortfall] = await comptroller.getAccountLiquidity(user);
      return {
        debt: Number(formatUnits(shortfall, 18)),
        hf: Number(shortfall) > 0 ? 0.9 : 1.5,
        liquidatable: Number(shortfall) > 0
      };
    }
    
    return null;
  } catch { return null; }
}

// ============ TEST CONNECTIONS ============
async function testConnections() {
  console.log("🔌 Testing connections...\n");
  
  let working = 0, failed = 0;
  
  for (const p of PROTOCOLS) {
    process.stdout.write(`${p.emoji} ${p.name.padEnd(15)} (${p.chain.padEnd(10)}) `);
    try {
      const provider = new JsonRpcProvider(p.rpc);
      const code = await provider.getCode(p.pool);
      if (code !== "0x") { console.log("✅"); working++; }
      else { console.log("❌ No contract"); failed++; }
    } catch (e) {
      console.log(`❌`);
      failed++;
    }
  }
  
  console.log(`\n📊 ${working} working | ${failed} failed\n`);
  return working;
}

// ============ MAIN ============
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("💀 ULTIMATE MULTI-PROTOCOL LIQUIDATION BOT");
  console.log("=".repeat(70));
  console.log(`\n📡 Monitoring ${PROTOCOLS.length} protocol deployments\n`);
  
  const grouped = {};
  for (const p of PROTOCOLS) {
    if (!grouped[p.name]) grouped[p.name] = [];
    grouped[p.name].push(p.chain);
  }
  for (const [name, chains] of Object.entries(grouped)) {
    const emoji = PROTOCOLS.find(p => p.name === name)?.emoji || "📦";
    console.log(`   ${emoji} ${name.padEnd(15)} - ${chains.join(", ")}`);
  }
  console.log("");
  
  const workingCount = await testConnections();
  
  await alertLiquidation(
    `🌐 **Ultimate Liquidation Bot Started!**\n\n` +
    `Monitoring **${workingCount} protocols**:\n\n` +
    Object.keys(grouped).map(n => {
      const emoji = PROTOCOLS.find(p => p.name === n)?.emoji;
      return `${emoji} ${n}`;
    }).join("\n")
  );
  
  let scans = 0;
  
  while (true) {
    scans++;
    const time = new Date().toLocaleTimeString();
    console.log(`\n${"=".repeat(70)}`);
    console.log(`🔍 SCAN #${scans} | ${time}`);
    console.log("=".repeat(70));
    console.log(`\n✅ ${workingCount} protocols online and ready`);
    console.log(`📋 Next step: Upgrade Alchemy to discover borrowers\n`);
    console.log(`[${time}] Next scan in 60 seconds...`);
    
    await new Promise(r => setTimeout(r, 60000));
  }
}

main().catch(console.error);
