const { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

// ===== إعداد السيرفر =====
const app = express();

// ===== إنشاء البوت =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ===== تسجيل الدخول =====
client.login(process.env.TOKEN);

// ===== عند تشغيل البوت =====
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ===== صفحة ويب بسيطة =====
app.get("/", (req, res) => {
  res.send("🚀 Bot is running 24/7");
});

// ===== تشغيل السيرفر =====
app.listen(process.env.PORT || 3000, () => {
  console.log("🌐 Web server running");
});