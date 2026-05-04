const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
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

// ⚙️ إعدادات
const PREFIX = "!";
const CONCURRENT = 4;
const DELAY = 1000;

// 🤖 تشغيل البوتات
const bots = TOKENS.map((token, i) => {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildPresences
    ]
  });

  client.login(token.trim());

  client.once("ready", () => {
    console.log(`🤖 Bot ${i + 1} جاهز: ${client.user.tag}`);
  });

  return client;
});

// 🔐 صلاحيات
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// 📦 تقسيم
function chunk(array, size) {
  const res = [];
  for (let i = 0; i < array.length; i += size) {
    res.push(array.slice(i, i + size));
  }
  return res;
}

// 🚀 إرسال
async function sendWorker(id, members, message) {
  let sent = 0;
  let fail = 0;

  for (let i = 0; i < members.length; i += CONCURRENT) {
    const batch = members.slice(i, i + CONCURRENT);

    await Promise.all(
      batch.map(m =>
        m.send(message)
          .then(() => sent++)
          .catch(() => fail++)
      )
    );

    console.log(`🤖 Bot ${id}: ${sent + fail}/${members.length}`);

    await new Promise(r => setTimeout(r, DELAY));
  }

  return { sent, fail };
}

// 🔥 برودكاست
async function broadcast(guild, message, filter = null) {
  let members = Array.from((await guild.members.fetch()).values());

  if (filter) members = members.filter(filter);

  const parts = chunk(members, bots.length);

  const results = await Promise.all(
    parts.map((p, i) => sendWorker(i + 1, p, message))
  );

  return {
    sent: results.reduce((a, b) => a + b.sent, 0),
    fail: results.reduce((a, b) => a + b.fail, 0)
  };
}

// 🎮 أوامر
if (!bots[0]) {
  console.log("❌ No bots running");
  process.exit(1);
}

const controller = bots[0];

controller.on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX)) return;
  if (msg.author.bot) return;

  if (!isAdmin(msg.member)) return;

  const args = msg.content.slice(PREFIX.length).split(" ");
  const cmd = args.shift().toLowerCase();

  // 📢 برودكاست
  if (cmd === "bc") {
    const text = args.join(" ");
    msg.channel.send("🚀 جاري الإرسال...");

    const res = await broadcast(msg.guild, text);

    msg.channel.send(`✅ تم: ${res.sent} | ❌ ${res.fail}`);
  }

  // 🟢 أونلاين
  if (cmd === "bc-online") {
    const text = args.join(" ");

    const res = await broadcast(
      msg.guild,
      text,
      m => m.presence?.status === "online"
    );

    msg.channel.send(`🟢 أونلاين: ${res.sent}`);
  }

  // 🎭 رول
  if (cmd === "bc-role") {
    const role = msg.mentions.roles.first();
    const text = args.slice(1).join(" ");

    if (!role) return msg.reply("حدد رول");

    const res = await broadcast(
      msg.guild,
      text,
      m => m.roles.cache.has(role.id)
    );

    msg.channel.send(`🎭 رول: ${res.sent}`);
  }

  // ✨ Embed
  if (cmd === "bc-embed") {
    const text = args.join(" ");

    const embed = new EmbedBuilder()
      .setTitle("📢 إعلان")
      .setDescription(text)
      .setColor("Blue");

    const res = await broadcast(msg.guild, { embeds: [embed] });

    msg.channel.send(`✨ Embed: ${res.sent}`);
  }
});

process.on("unhandledRejection", err => {
  console.log("❌ Error:", err);
});