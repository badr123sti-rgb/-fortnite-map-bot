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

const fs = require("fs");

// 🔐 ENV
if (!process.env.TOKEN) {
  console.log("❌ TOKEN missing");
  process.exit(1);
}

const TOKEN = process.env.TOKEN;

// 📁 ملف اللوق
const LOGS_FILE = "./logs.json";

if (!fs.existsSync(LOGS_FILE)) {
  fs.writeFileSync(LOGS_FILE, "{}");
}

function loadLogs() {
  return JSON.parse(fs.readFileSync(LOGS_FILE));
}

function saveLogs(data) {
  fs.writeFileSync(LOGS_FILE, JSON.stringify(data, null, 2));
}

// ⚙️ إعدادات
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

// 📦 الأوامر
const commands = [

  // 🚀 Broadcast
  new SlashCommandBuilder()
    .setName("broadcast")
    .setDescription("برودكاست متطور")

    .addStringOption(opt =>
      opt.setName("message")
        .setDescription("الرسالة")
        .setRequired(true)
    )

    .addStringOption(opt =>
      opt.setName("type")
        .setDescription("نوع الإرسال")
        .setRequired(true)
        .addChoices(
          { name: "الكل", value: "all" },
          { name: "اونلاين", value: "online" },
          { name: "رول", value: "role" },
          { name: "شخص", value: "user" },
          { name: "امبيد", value: "embed" }
        )
    )

    .addRoleOption(opt =>
      opt.setName("role")
        .setDescription("الرول")
    )

    .addUserOption(opt =>
      opt.setName("user")
        .setDescription("الشخص")
    )

    .addBooleanOption(opt =>
      opt.setName("mention")
        .setDescription("إظهار المنشن")
    )

    .addBooleanOption(opt =>
      opt.setName("embed")
        .setDescription("إرسال Embed")
    )

    .addStringOption(opt =>
      opt.setName("embed_title")
        .setDescription("عنوان الامبيد")
    ),

  // 📡 Set Log
  new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("تعيين روم اللوق")

    .addChannelOption(opt =>
      opt.setName("channel")
        .setDescription("روم اللوق")
        .setRequired(true)
    )

].map(c => c.toJSON());

// 📦 تسجيل الأوامر
const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );

  console.log("✅ Slash جاهز");
});

// 📊 ETA
function calcETA(total) {
  const rate = CONCURRENT / (DELAY / 1000);
  return Math.ceil(total / rate);
}

// 🔥 Worker
async function sendWorker(
  members,
  message,
  mention,
  embedMode,
  embedTitle,
  progress
) {

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

          // 📦 Embed
          if (embedMode) {

            const embed = new EmbedBuilder()
              .setTitle(embedTitle || "رسالة")
              .setDescription(msg)
              .setColor("Blue");

            await m.send({
              embeds: [embed]
            });

          } else {

            await m.send(msg);

          }

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
  embedMode,
  embedTitle,
  interaction
) {

  // 📡 روم اللوق
  const logs = loadLogs();

  const logChannelId =
    logs[interaction.guild.id];

  const logChannel =
    interaction.guild.channels.cache.get(logChannelId);

  const progress = {
    done: 0,
    total: members.length
  };

  const startTime = Date.now();

  // 📢 Embed البداية
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

  if (logChannel) {
    await logChannel.send({
      embeds: [startEmbed]
    });
  }

  // 🔥 إرسال
  const result = await sendWorker(
    members,
    message,
    mention,
    embedMode,
    embedTitle,
    progress
  );

  const duration =
    ((Date.now() - startTime) / 1000).toFixed(1);

  // ✅ النهاية
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

  if (logChannel) {
    await logChannel.send({
      embeds: [doneEmbed]
    });
  }

  return result;
}

// 🎮 الأوامر
client.on("interactionCreate", async interaction => {

  if (!interaction.isChatInputCommand()) return;

  // 📡 Set Log
  if (interaction.commandName === "setlog") {

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

    const channel =
      interaction.options.getChannel("channel");

    const logs = loadLogs();

    logs[interaction.guild.id] = channel.id;

    saveLogs(logs);

    return interaction.reply({
      content: `✅ تم تعيين ${channel}`,
      ephemeral: true
    });
  }

  // 🚀 Broadcast
  if (interaction.commandName === "broadcast") {

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

    const targetUser =
      interaction.options.getUser("user");

    const mention =
      interaction.options.getBoolean("mention");

    let embedMode =
      interaction.options.getBoolean("embed");

    const embedTitle =
      interaction.options.getString("embed_title");

    // 📦 امبيد تلقائي
    if (type === "embed")
      embedMode = true;

    let members = Array.from(
      (await interaction.guild.members.fetch()).values()
    );

    // 👤 شخص
    if (type === "user") {

      if (!targetUser) {
        return interaction.reply({
          content: "حدد شخص",
          ephemeral: true
        });
      }

      const member =
        await interaction.guild.members.fetch(targetUser.id);

      members = [member];
    }

    // 👥 اونلاين
    if (type === "online") {
      members = members.filter(
        m => m.presence?.status === "online"
      );
    }

    // 🎭 رول
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
        },
        {
          name: "📦 Embed",
          value: embedMode ? "نعم" : "لا"
        }
      )
      .setColor("Blue");

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
          embedMode,
          embedTitle,
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
          )
          .setColor("Green");

        await interaction.followUp({
          embeds: [done]
        });

        collector.stop();
      }

    });
  }
});