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
  ButtonStyle,
  Partials
} = require("discord.js");

const fs = require("fs");

if (!process.env.TOKEN) {
  console.log("TOKEN missing");
  process.exit(1);
}

const TOKEN = process.env.TOKEN;
const OWNER_ID = "1085967235740336249";
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

let CONCURRENT = 1;
let DELAY = 10;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

client.login(TOKEN);

client.once("ready", () => {
  console.log(`${client.user.tag} Online`);
});

const commands = [
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
        .setDescription("النوع")
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
        .setDescription("منشن")
    )
    .addBooleanOption(opt =>
      opt.setName("embed")
        .setDescription("Embed")
    )
    .addStringOption(opt =>
      opt.setName("embed_title")
        .setDescription("عنوان الامبيد")
    ),
  new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("تعيين روم اللوق")
    .addChannelOption(opt =>
      opt.setName("channel")
        .setDescription("الروم")
        .setRequired(true)
    )
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

client.once("ready", async () => {
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("Slash Commands Ready");
  } catch (err) {
    console.log(err);
  }
});

function calcETA(total) {
  const rate = CONCURRENT / (DELAY / 10);
  return Math.ceil(total / rate);
}

async function sendWorker(members, message, mention, embedMode, embedTitle, progress) {
  let sent = 0;
  let fail = 0;
  let closedDMs = 0;

  for (let i = 0; i < members.length; i += CONCURRENT) {
    const batch = members.slice(i, i + CONCURRENT);

    await Promise.all(
      batch.map(async m => {
        try {
          let msg = message;
          if (mention) msg = `${message}\n<@${m.id}>`;

          if (embedMode) {
            const embed = new EmbedBuilder()
              .setTitle(embedTitle || "رسالة")
              .setDescription(msg)
              .setColor("Blue");
            await m.send({ embeds: [embed] });
          } else {
            await m.send({ content: msg });
          }
          sent++;
        } catch (err) {
          fail++;
          if (err.code === 50007) {
            closedDMs++;
          }
        }
      })
    );

    progress.done += batch.length;
    const percent = ((progress.done / progress.total) * 100).toFixed(1);
    console.log(`${percent}%`);
    await new Promise(r => setTimeout(r, DELAY));
  }

  return { sent, fail, closedDMs };
}

async function broadcastAll(members, message, mention, embedMode, embedTitle, interaction) {
  const logs = loadLogs();
  const logChannelId = logs[interaction.guild.id];
  const logChannel = interaction.guild.channels.cache.get(logChannelId);

  const progress = {
    done: 0,
    total: members.length
  };

  const startEmbed = new EmbedBuilder()
    .setTitle("بدء البرودكاست")
    .addFields(
      { name: "العدد", value: `${members.length}` },
      { name: "ETA", value: `${calcETA(members.length)} ثانية` }
    )
    .setColor("Blue");

  if (logChannel) {
    await logChannel.send({ embeds: [startEmbed] });
  }

  const result = await sendWorker(members, message, mention, embedMode, embedTitle, progress);

  const doneEmbed = new EmbedBuilder()
    .setTitle("انتهى البرودكاست")
    .addFields(
      { name: "تم", value: `${result.sent}` },
      { name: "فشل", value: `${result.fail}` },
      { name: "خاص مغلق", value: `${result.closedDMs}` }
    )
    .setColor("Green");

  if (logChannel) {
    await logChannel.send({ embeds: [doneEmbed] });
  }

  return result;
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setlog") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "ما عندك صلاحية",
        ephemeral: true
      });
    }

    const channel = interaction.options.getChannel("channel");
    const logs = loadLogs();
    logs[interaction.guild.id] = channel.id;
    saveLogs(logs);

    return interaction.reply({
      content: `تم تعيين ${channel}`,
      ephemeral: true
    });
  }

  if (interaction.commandName === "broadcast") {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({
        content: "ما عندك صلاحية",
        ephemeral: true
      });
    }

    const message = interaction.options.getString("message");
    const type = interaction.options.getString("type");
    const role = interaction.options.getRole("role");
    const targetUser = interaction.options.getUser("user");
    const mention = interaction.options.getBoolean("mention");
    let embedMode = interaction.options.getBoolean("embed");
    const embedTitle = interaction.options.getString("embed_title");

    if (type === "embed") embedMode = true;

    let members = Array.from((await interaction.guild.members.fetch()).values());

    if (type === "user") {
      if (!targetUser) {
        return interaction.reply({
          content: "حدد شخص",
          ephemeral: true
        });
      }
      const member = await interaction.guild.members.fetch(targetUser.id);
      members = [member];
    }

    if (type === "online") {
      members = members.filter(m => m.presence?.status === "online");
    }

    if (type === "role") {
      if (!role) {
        return interaction.reply({
          content: "حدد رول",
          ephemeral: true
        });
      }
      members = members.filter(m => m.roles.cache.has(role.id));
    }

    const embed = new EmbedBuilder()
      .setTitle("تأكيد البرودكاست")
      .setDescription(message)
      .addFields(
        { name: "العدد", value: `${members.length}` },
        { name: "Embed", value: embedMode ? "نعم" : "لا" }
      )
      .setColor("Blue");

    const row = new ActionRowBuilder().addComponents(
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

    const filter = i => i.user.id === interaction.user.id;
    const collector = interaction.channel.createMessageComponentCollector({
      filter,
      time: 15000
    });

    collector.on("collect", async i => {
      if (i.customId === "no") {
        await i.update({
          content: "تم الإلغاء",
          embeds: [],
          components: []
        });
        collector.stop();
      }

      if (i.customId === "yes") {
        await i.update({
          content: "جاري الإرسال...",
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
          .setTitle("التقرير النهائي للبرودكاست")
          .addFields(
            { name: "نجاح", value: `${res.sent}` },
            { name: "إجمالي الفشل", value: `${res.fail}` },
            { name: "خاص مغلق / لا يوجد سيرفر مشترك", value: `${res.closedDMs}` }
          )
          .setColor("Green");

        await interaction.followUp({
          embeds: [done],
          ephemeral: true
        });

        collector.stop();
      }
    });
  }
});

client.on("messageCreate", async message => {
  if (message.guild) return;
  if (message.author.bot) return;

  if (message.author.id === OWNER_ID) {
    if (message.content.startsWith("send ")) {
      try {
        const args = message.content.split(" ");
        const userId = args[1];
        const msg = args.slice(2).join(" ");

        if (!userId || !msg) {
          return message.reply({
            content: "استخدم:\nsend USER_ID الرسالة"
          });
        }

        const user = await client.users.fetch(userId).catch(() => null);

        if (!user) {
          return message.reply({
            content: "ما قدرت ألقى هذا الشخص. تأكد من صحة الـ ID."
          });
        }

        await user.send({ content: msg });

        return message.reply({
          content: "تم الإرسال بنجاح."
        });

      } catch (err) {
        console.log(err);
        if (err.code === 50007) {
          return message.reply({
            content: "(الشخص قفل الخاص، او طلع من السيرفر ومافيه بيننا أي سيرفر مشترك)."
          });
        }
        return message.reply({
          content: `فشل الإرسال:\n${err.message}`
        });
      }
    }
  }

  try {
    const owner = await client.users.fetch(OWNER_ID);
    const guilds = client.guilds.cache.filter(g =>
      g.members.cache.has(message.author.id)
    );
    const guildNames = guilds.map(g => g.name).join(", ") || "غير معروف";

    const embed = new EmbedBuilder()
      .setTitle("رسالة جديدة للبوت")
      .addFields(
        { name: "الشخص", value: `${message.author.tag}` },
        { name: "ID", value: `${message.author.id}` },
        { name: "السيرفرات", value: guildNames },
        { name: "الرسالة", value: message.content || "رساله البرودكاست" }
      )
      .setThumbnail(message.author.displayAvatarURL())
      .setColor("Blue")
      .setTimestamp();

    await owner.send({ embeds: [embed] });
  } catch (err) {
    console.log(err);
  }
});