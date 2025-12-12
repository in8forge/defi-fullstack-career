import dotenv from "dotenv";
dotenv.config();

const webhook = process.env.DISCORD_WEBHOOK;

async function test() {
  console.log("📤 Sending test alert to Discord...");
  
  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        title: "🚀 DeFi Bots Online!",
        description: "Your 3 bots are now running:\n\n• 🔄 Arbitrage Bot\n• 💀 Liquidation Bot\n• 🌾 LP Farming Bot\n\nYou'll get alerts here when trades execute!",
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
        footer: { text: "DeFi Bot System" }
      }]
    })
  });
  
  console.log("✅ Check your Discord!");
}

test();
