const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField
} = require("discord.js");

const express = require("express");
const app = express();

// ===== BOT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

client.login(process.env.TOKEN);

// ===== READY =====
client.once("ready", async () => {
  console.log(`✅ ${client.user.tag}`);

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  const command = new SlashCommandBuilder()
    .setName("broadcast")
    .setDescription("ارسال رسالة للكل")
    .addStringOption(opt =>
      opt.setName("message")
        .setDescription("الرسالة")
        .setRequired(true)
    );

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: [command.toJSON()] }
  );

  console.log("✅ Slash command ready");
});

// ===== ETA =====
function calcETA(total) {
  return Math.ceil(total / 1.2);
}

// ===== COMMAND =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "broadcast") {

    // صلاحيات
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });
    }

    const message = interaction.options.getString("message");

    await interaction.reply("🚀 جاري الإرسال...");

    const members = Array.from(
      (await interaction.guild.members.fetch()).values()
    );

    const eta = calcETA(members.length);

    await interaction.followUp(`⏳ ETA: ${eta}s | 👥 ${members.length}`);

    let sent = 0;
    let fail = 0;

    for (const m of members) {
      try {
        await m.send(`${message}\n<@${m.id}>`);
        sent++;
      } catch {
        fail++;
      }

      // delay بسيط
      await new Promise(r => setTimeout(r, 800));
    }

    await interaction.followUp(`✅ انتهى | تم: ${sent} | فشل: ${fail}`);
  }
});

// ===== WEB =====
app.get("/", (req, res) => {
  res.send("🚀 Bot running");
});

app.listen(process.env.PORT || 3000);