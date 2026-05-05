const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

// 🔐 TOKENS
if (!process.env.TOKENS) {
  console.log("❌ TOKENS missing");
  process.exit(1);
}

const TOKENS = process.env.TOKENS.split(",").filter(t => t.trim());

// ⚙️ إعدادات
const CONCURRENT = 4;
const DELAY = 1000;

// 🤖 تشغيل البوتات
const bots = TOKENS.map(token => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers
    ]
  });

  client.login(token.trim());

  client.once("ready", () => {
    console.log(`🤖 ${client.user.tag} جاهز`);
  });

  return client;
});

const mainBot = bots[0];

// 📦 Slash
const command = new SlashCommandBuilder()
  .setName("broadcast")
  .setDescription("ارسال برودكاست")
  .addStringOption(opt =>
    opt.setName("message").setDescription("الرسالة").setRequired(true)
  );

const rest = new REST({ version: "10" }).setToken(TOKENS[0]);

mainBot.once("ready", async () => {
  await rest.put(
    Routes.applicationCommands(mainBot.user.id),
    { body: [command.toJSON()] }
  );
  console.log("✅ Slash جاهز");
});

// ⏳ ETA
function calcETA(total) {
  const rate = CONCURRENT / (DELAY / 1000);
  return Math.ceil(total / rate);
}

// 📤 إرسال
async function sendAll(channel, members, message) {
  let sent = 0;
  let fail = 0;

  for (let i = 0; i < members.length; i += CONCURRENT) {
    const batch = members.slice(i, i + CONCURRENT);

    await Promise.all(
      batch.map(async m => {
        try {
          // 📩 DM مع منشن وهمي
          await m.send(`<@${m.id}> 📢 ${message}`);

          // 🔔 منشن حقيقي في السيرفر
          await channel.send(`<@${m.id}> 📩 شيك الخاص`);

          sent++;
        } catch {
          fail++;
        }
      })
    );

    await new Promise(r => setTimeout(r, DELAY));
  }

  return { sent, fail };
}

// 🎮 الأمر
mainBot.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "broadcast") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    const message = interaction.options.getString("message");

    await interaction.deferReply();

    const members = Array.from(
      (await interaction.guild.members.fetch()).values()
    );

    const eta = calcETA(members.length);

    const embed = new EmbedBuilder()
      .setTitle("📢 جاري الإرسال")
      .setDescription(message)
      .addFields(
        { name: "👥 العدد", value: `${members.length}` },
        { name: "⏳ الوقت المتوقع", value: `${eta} ثانية` }
      )
      .setColor("Blue");

    await interaction.editReply({ embeds: [embed] });

    const result = await sendAll(interaction.channel, members, message);

    const done = new EmbedBuilder()
      .setTitle("✅ انتهى")
      .addFields(
        { name: "📨 تم", value: `${result.sent}` },
        { name: "❌ فشل", value: `${result.fail}` }
      )
      .setColor("Green");

    await interaction.followUp({ embeds: [done] });
  }
});