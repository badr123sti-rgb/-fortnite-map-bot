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

// 🔐 ENV
if (!process.env.TOKEN) {
  console.log("❌ TOKEN missing");
  process.exit(1);
}

const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

// ⚙️ إعدادات ذكية
let CONCURRENT = 4;
let DELAY = 1000;

// 🤖 تشغيل البوت
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

client.login(TOKEN);

client.once("ready", () => {
  console.log(`🤖 ${client.user.tag} جاهز`);
});

// 📦 Slash
const command = new SlashCommandBuilder()
  .setName("broadcast")
  .setDescription("برودكاست متطور")

  .addStringOption(opt =>
    opt.setName("message")
      .setDescription("الرسالة")
      .setRequired(true)
  )

  .addStringOption(opt =>
    opt.setName("type")
      .setDescription("لمن")
      .setRequired(true)
      .addChoices(
        { name: "الكل", value: "all" },
        { name: "اونلاين", value: "online" },
        { name: "رول", value: "role" }
      )
  )

  .addRoleOption(opt =>
    opt.setName("role")
      .setDescription("الرول")
  )

  .addBooleanOption(opt =>
    opt.setName("mention")
      .setDescription("إظهار المنشن")
  );

// 🔥 تسجيل الأوامر
const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: [command.toJSON()] }
  );

  console.log("✅ Slash جاهز");
});

// 📊 ETA
function calcETA(total) {
  const rate = CONCURRENT / (DELAY / 1000);
  return Math.ceil(total / rate);
}

// 🔥 Worker
async function sendWorker(members, message, mention, progress) {

  let sent = 0;
  let fail = 0;

  for (let i = 0; i < members.length; i += CONCURRENT) {

    const batch = members.slice(i, i + CONCURRENT);

    await Promise.all(
      batch.map(async m => {
        try {

          let msg = message;

          if (mention)
            msg = `${message}\n<@${m.id}>`;

          await m.send(msg);

          sent++;

        } catch {
          fail++;
        }
      })
    );

    progress.done += batch.length;

    const percent = (
      (progress.done / progress.total) * 100
    ).toFixed(1);

    console.log(`📡 ${percent}%`);

    // 🧠 حماية ذكية
    if (fail > sent / 2)
      DELAY += 500;

    await new Promise(r =>
      setTimeout(r, DELAY)
    );
  }

  return { sent, fail };
}

// 🚀 Broadcast
async function broadcastAll(
  members,
  message,
  mention,
  interaction
) {

  const logChannel =
    interaction.guild.channels.cache.get(LOG_CHANNEL_ID);

  const progress = {
    done: 0,
    total: members.length
  };

  const startTime = Date.now();

  // 📡 بدء
  const startEmbed = new EmbedBuilder()
    .setTitle("📡 بدء البرودكاست")
    .addFields(
      {
        name: "👥 العدد",
        value: `${members.length}`
      },
      {
        name: "⏳ ETA",
        value: `${calcETA(members.length)} ثانية`
      }
    )
    .setColor("Blue");

  if (logChannel)
    await logChannel.send({
      embeds: [startEmbed]
    });

  // 🔥 إرسال
  const result = await sendWorker(
    members,
    message,
    mention,
    progress
  );

  const duration =
    ((Date.now() - startTime) / 1000).toFixed(1);

  // ✅ نهاية
  const doneEmbed = new EmbedBuilder()
    .setTitle("✅ انتهى البرودكاست")
    .addFields(
      {
        name: "📨 تم",
        value: `${result.sent}`
      },
      {
        name: "❌ فشل",
        value: `${result.fail}`
      },
      {
        name: "⏱️ الوقت",
        value: `${duration}s`
      }
    )
    .setColor("Green");

  if (logChannel)
    await logChannel.send({
      embeds: [doneEmbed]
    });

  return result;
}

// 🎮 الأوامر
client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "broadcast") {

    // 🔐 صلاحيات
    if (
      !interaction.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return interaction.reply({
        content: "❌ ما عندك صلاحية",
        ephemeral: true
      });
    }

    const message =
      interaction.options.getString("message");

    const type =
      interaction.options.getString("type");

    const role =
      interaction.options.getRole("role");

    const mention =
      interaction.options.getBoolean("mention");

    let members = Array.from(
      (await interaction.guild.members.fetch()).values()
    );

    // 👥 فلترة
    if (type === "online") {
      members = members.filter(
        m => m.presence?.status === "online"
      );
    }

    if (type === "role") {

      if (!role) {
        return interaction.reply({
          content: "حدد رول",
          ephemeral: true
        });
      }

      members = members.filter(
        m => m.roles.cache.has(role.id)
      );
    }

    // 📢 تأكيد
    const embed = new EmbedBuilder()
      .setTitle("📢 تأكيد البرودكاست")
      .setDescription(message)
      .addFields(
        {
          name: "👥 العدد",
          value: `${members.length}`
        },
        {
          name: "⏳ ETA",
          value: `${calcETA(members.length)} ثانية`
        }
      );

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("yes")
          .setLabel("تأكيد")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("no")
          .setLabel("إلغاء")
          .setStyle(ButtonStyle.Danger)
      );

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });

    const filter =
      i => i.user.id === interaction.user.id;

    const collector =
      interaction.channel.createMessageComponentCollector({
        filter,
        time: 15000
      });

    collector.on("collect", async i => {

      // ❌ إلغاء
      if (i.customId === "no") {

        await i.update({
          content: "تم الإلغاء",
          embeds: [],
          components: []
        });

        collector.stop();
      }

      // ✅ تأكيد
      if (i.customId === "yes") {

        await i.update({
          content: "🚀 جاري الإرسال...",
          embeds: [],
          components: []
        });

        const res = await broadcastAll(
          members,
          message,
          mention,
          interaction
        );

        const done = new EmbedBuilder()
          .setTitle("✅ انتهى")
          .addFields(
            {
              name: "📨 تم",
              value: `${res.sent}`
            },
            {
              name: "❌ فشل",
              value: `${res.fail}`
            }
          );

        await interaction.followUp({
          embeds: [done]
        });

        collector.stop();
      }
    });
  }
});