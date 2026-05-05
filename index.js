lconst { Client, GatewayIntentBits } = require("discord.js");
const express = require("express");

const app = express();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.login(process.env.TOKEN);

client.once("ready", () => {
  console.log(`✅ ${client.user.tag}`);
});

app.get("/", (req, res) => {
  res.send("Bot is running 🚀");
});

app.listen(process.env.PORT || 3000);