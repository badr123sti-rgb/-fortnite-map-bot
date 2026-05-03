const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require("discord.js");

// 🔑 من Railway Variables
const TOKENS = process.env.TOKENS?.split(",") || [];

if (TOKENS.length === 0) {
  console.log("❌ TOKENS غير موجود في Railway Variables");
}

const PREFIX = "!";

const CONCURRENT = 4;
const DELAY = 1000;

// 🤖 تشغيل كل البوتات
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

  client.login(token);

  client.once("ready", () => {
    console.log(`🤖 Bot ${i + 1} جاهز: ${client.user.tag}`);
  });

  return client;
});

// 🔐 صلاحيات
function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// 📦 تقسيم الأعضاء
function chunk(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// 🚀 إرسال سريع
async function sendWorker(botId, members, message) {
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

    const done = sent + fail;
    console.log(`🤖 Bot ${botId} | ${done}/${members.length}`);

    await new Promise(r => setTimeout(r, DELAY));
  }

  return { sent, fail };
}

// 🔥 برودكاست كامل
async function broadcast(guild, message, filter = null) {
  let members = Array.from((await guild.members.fetch()).values());

  if (filter) members = members.filter(filter);

  const chunks = chunk(members, bots.length);

  const results = await Promise.all(
    chunks.map((c, i) =>
      sendWorker(i + 1, c, message)
    )
  );

  return {
    sent: results.reduce((a, b) => a + b.sent, 0),
    fail: results.reduce((a, b) => a + b.fail, 0)
  };
}

// 🎮 الأوامر
bots[0].on("messageCreate", async msg => {
  if (!msg.content.startsWith(PREFIX)) return;
  if (msg.author.bot) return;

  if (!isAdmin(msg.member)) return;

  const args = msg.content.slice(PREFIX.length).split(" ");
  const cmd = args.shift().toLowerCase();

  // 📢 برودكاست عام
  if (cmd === "bc") {
    const text = args.join(" ");
    msg.channel.send("🚀 جاري الإرسال...");

    const res = await broadcast(msg.guild, text);

    msg.channel.send(`✅ تم\n📨 ${res.sent}\n❌ ${res.fail}`);
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