import dotenv from "dotenv";
dotenv.config();

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

export async function sendDiscordAlert(title, message, color = 0x00ff00) {
  if (!DISCORD_WEBHOOK) return;
  
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: title,
          description: message,
          color: color,
          timestamp: new Date().toISOString(),
          footer: { text: "DeFi Bot System" }
        }]
      })
    });
  } catch (e) {
    console.log("Discord error:", e.message);
  }
}

export const alertArbitrage = (msg) => sendDiscordAlert("🔄 Arbitrage", msg, 0x00ff00);
export const alertLiquidation = (msg) => sendDiscordAlert("💀 Liquidation", msg, 0xff0000);
export const alertFarming = (msg) => sendDiscordAlert("🌾 LP Farming", msg, 0xffff00);
export const alertError = (msg) => sendDiscordAlert("⚠️ Error", msg, 0xff6600);
