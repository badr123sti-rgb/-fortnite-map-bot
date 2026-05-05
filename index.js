const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

// 🔐 TOKENS
if (!process.env.TOKENS) {
  console.log("❌ TOKENS missing");
  process.exit(1);
}

const TOKENS = process.env.TOKENS.split(",").filter(t => t.trim());

if (!TOKENS.length) {
  console.log("❌ No tokens");
  process.exit(1);
}

// ⚙️ إعدادات
const CONCURRENT = 4;
const DELAY = 1000;

// 🤖 تشغيل البوتات
const bots = TOKENS.map((token, i) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildPresences
    ]
  });

  client.login(token.trim());

  client.once("ready", () => {
    console.log(`🤖 Bot ${i + 1} ready: ${client.user.tag}`);
  });

  return client;
});

// 🎯 البوت الرئيسي للأوامر
const mainBot = bots[0];

// 📦 Slash Command
const command = new SlashCommandBuilder()
  .setName("broadcast")
  .setDescription("برودكاست احترافي")
  .addStringOption(opt =>
    opt.setName("message").setDescription("الرسالة").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("type")
      .setDescription("لمن ترسل")
      .setRequired(true)
      .addChoices(
        { name: "الكل", value: "all" },
        { name: "اونلاين", value: "online" },
        { name: "رول", value: "role" }
      )
  )
  .addRoleOption(opt =>
    opt.setName("role").setDescription("حدد رول")
  )
  .addBooleanOption(opt =>
    opt.setName("mention").setDescription("إظهار اسم العضو")
  );

// 📡 تسجيل الأمر
const rest = new REST({ version: "10" }).setToken(TOKENS[0]);

mainBot.once("ready", async () => {
  try {
    await rest.put(
      Routes.applicationCommands(mainBot.user.id),
      { body: [command.toJSON()] }
    );
    console.log("✅ Slash registered");
  } catch (e) {
    console.log(e);
  }
});

// ⏳ ETA
function calcETA(total) {
  const rate = CONCURRENT / (DELAY / 1000);
  return Math.ceil(total / rate);
}

// 📦 تقسيم
function chunk(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

// 🚀 إرسال من كل البوتات
async function sendWorker(botId, members, message, mention) {
  let sent = 0;
  let fail = 0;

  for (let i = 0; i < members.length; i += CONCURRENT) {
    const batch = members.slice(i, i + CONCURRENT);

    await Promise.all(
      batch.map(async m => {
        try {
          let msg = message;

          if (mention) {
            msg = `👋 ${m.user.username}\n${message}`;
          }

          await m.send(msg);
          sent++;
        } catch {
          fail++;
        }
      })
    );

    console.log(`Bot ${botId}: ${sent + fail}/${members.length}`);
    await new Promise(r => setTimeout(r, DELAY));
  }

  return { sent, fail };
}

// 🔥 Broadcast
async function broadcastAll(members, message, mention) {
  const parts = chunk(members, bots.length);

  const results = await Promise.all(
    parts.map((p, i) => sendWorker(i + 1, p, message, mention))
  );

  return {
    sent: results.reduce((a, b) => a + b.sent, 0),
    fail: results.reduce((a, b) => a + b.fail, 0)
  };
}

// 🎮 الأوامر
mainBot.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "broadcast") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: "❌ ما عندك صلاحية", ephemeral: true });

    const message = interaction.options.getString("message");
    const type = interaction.options.getString("type");
    const role = interaction.options.getRole("role");
    const mention = interaction.options.getBoolean("mention");

    let members = Array.from(
      (await interaction.guild.members.fetch()).values()
    );

    if (type === "online") {
      members = members.filter(m => m.presence?.status === "online");
    }

    if (type === "role") {
      if (!role)
        return interaction.reply({ content: "❌ حدد رول", ephemeral: true });

      members = members.filter(m => m.roles.cache.has(role.id));
    }

    const eta = calcETA(members.length);

    const embed = new EmbedBuilder()
      .setTitle("📢 تأكيد البرودكاست")
      .setDescription(message)
      .addFields(
        { name: "👥 العدد", value: `${members.length}` },
        { name: "⏳ الوقت المتوقع", value: `${eta} ثانية` },
        { name: "📌 النوع", value: type }
      )
      .setColor("Yellow");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("yes")
        .setLabel("✅ تأكيد")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("no")
        .setLabel("❌ إلغاء")
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });

    const filter = i => i.user.id === interaction.user.id;

    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 15000
    });

    collector.on("collect", async i => {
      if (i.customId === "no") {
        await i.update({ content: "❌ تم الإلغاء", components: [] });
        collector.stop();
      }

      if (i.customId === "yes") {
        await i.update({ content: "🚀 جاري الإرسال...", components: [] });

        const res = await broadcastAll(members, message, mention);

        const done = new EmbedBuilder()
          .setTitle("✅ انتهى")
          .addFields(
            { name: "📨 تم", value: `${res.sent}` },
            { name: "❌ فشل", value: `${res.fail}` }
          )
          .setColor("Green");

        await interaction.followUp({ embeds: [done] });
        collector.stop();
      }
    });
  }
});