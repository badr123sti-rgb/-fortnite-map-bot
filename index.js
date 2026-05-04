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


// 🔐 حماية من الخطأ

if (!process.env.TOKENS) {

  console.log("❌ TOKENS missing in Railway Variables");

  process.exit(1);

}

// 🤖 التوكنات

const TOKENS = process.env.TOKENS.split(",").filter(t => t.trim());

if (TOKENS.length === 0) {

  console.log("❌ No valid tokens found");

  process.exit(1);

}

// 🔐 // ⚙️ إعدادات
const CONCURRENT = 4;
const DELAY = 1000;

// 🤖 البوت
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// 📦 الأمر
const command = new SlashCommandBuilder()
  .setName("broadcast")
  .setDescription("برودكاست احترافي")
  .addStringOption(opt =>
    opt.setName("message").setDescription("الرسالة").setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName("type")
      .setDescription("لمن ترسل؟")
      .setRequired(true)
      .addChoices(
        { name: "الكل", value: "all" },
        { name: "اونلاين", value: "online" },
        { name: "رول", value: "role" }
      )
  )
  .addRoleOption(opt =>
    opt.setName("role").setDescription("حدد رول (لو اخترت رول)")
  )
  .addBooleanOption(opt =>
    opt.setName("mention").setDescription("إضافة اسم العضو؟")
  );

// تسجيل الأمر
const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands("1500614169601507519"),
    { body: [command.toJSON()] }
  );
})();

// ⏳ ETA
function calcETA(total) {
  const rate = CONCURRENT / (DELAY / 1000);
  return Math.ceil(total / rate);
}

// 📤 إرسال
async function sendAll(members, message, mention) {
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

    await new Promise(r => setTimeout(r, DELAY));
  }

  return { sent, fail };
}

// 🎮 الأوامر
client.on("interactionCreate", async interaction => {
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

    // فلترة
    if (type === "online") {
      members = members.filter(m => m.presence?.status === "online");
    }

    if (type === "role") {
      if (!role)
        return interaction.reply({ content: "❌ لازم تحدد رول", ephemeral: true });

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
        .setCustomId("confirm")
        .setLabel("✅ تأكيد")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("cancel")
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
      if (i.customId === "cancel") {
        await i.update({ content: "❌ تم الإلغاء", components: [] });
        collector.stop();
      }

      if (i.customId === "confirm") {
        await i.update({ content: "🚀 جاري الإرسال...", components: [] });

        const result = await sendAll(members, message, mention);

        const done = new EmbedBuilder()
          .setTitle("✅ انتهى")
          .addFields(
            { name: "📨 تم", value: `${result.sent}` },
            { name: "❌ فشل", value: `${result.fail}` }
          )
          .setColor("Green");

        await interaction.followUp({ embeds: [done] });
        collector.stop();
      }
    });
  }
});

client.login(TOKEN);