require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder
} = require('discord.js');

const CONFIG = {
  PREFIX: "!",
  CONCURRENT: 4,
  DELAY: 1000,
  TOKENS: process.env.TOKENS.split(",")
};

// تشغيل البوتات
const bots = CONFIG.TOKENS.map((token, i) => {
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
    console.log(`🤖 Bot ${i + 1} جاهز`);
  });

  return client;
});

function isAdmin(member) {
  return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function chunkArray(array, parts) {
  const size = Math.ceil(array.length / parts);
  return Array.from({ length: parts }, (_, i) =>
    array.slice(i * size, i * size + size)
  );
}

async function runWorker(bot, members, message, id) {
  let sent = 0;
  let fail = 0;
  const start = Date.now();

  for (let i = 0; i < members.length; i += CONFIG.CONCURRENT) {
    const chunk = members.slice(i, i + CONFIG.CONCURRENT);

    await Promise.all(
      chunk.map(m =>
        m.send(message)
          .then(() => sent++)
          .catch(() => fail++)
      )
    );

    const done = sent + fail;
    const elapsed = (Date.now() - start) / 1000;
    const rate = done / elapsed;
    const eta = Math.round((members.length - done) / rate);

    console.log(`Bot ${id} | ${done}/${members.length} | ETA: ${eta}s`);

    await new Promise(r => setTimeout(r, CONFIG.DELAY));
  }

  return { sent, fail };
}

async function ultraBroadcast(guild, message, filterFn = null) {
  let members = Array.from((await guild.members.fetch()).values());

  if (filterFn) members = members.filter(filterFn);

  const chunks = chunkArray(members, bots.length);

  const results = await Promise.all(
    chunks.map((chunk, i) =>
      runWorker(bots[i], chunk, message, i + 1)
    )
  );

  return {
    totalSent: results.reduce((a, b) => a + b.sent, 0),
    totalFail: results.reduce((a, b) => a + b.fail, 0)
  };
}

// الأوامر
bots[0].on("messageCreate", async msg => {
  if (!msg.content.startsWith(CONFIG.PREFIX)) return;
  if (msg.author.bot) return;

  if (!isAdmin(msg.member))
    return msg.reply("❌ ما عندك صلاحية");

  const args = msg.content.slice(CONFIG.PREFIX.length).split(" ");
  const cmd = args.shift().toLowerCase();

  if (cmd === "bc") {
    const text = args.join(" ");
    msg.channel.send("🚀 جاري الإرسال...");
    const res = await ultraBroadcast(msg.guild, text);
    msg.channel.send(`✅ تم: ${res.totalSent} | ❌: ${res.totalFail}`);
  }

  if (cmd === "bc-online") {
    const text = args.join(" ");
    const res = await ultraBroadcast(
      msg.guild,
      text,
      m => m.presence?.status === "online"
    );
    msg.channel.send(`✅ أونلاين: ${res.totalSent}`);
  }

  if (cmd === "bc-role") {
    const role = msg.mentions.roles.first();
    const text = args.slice(1).join(" ");
    if (!role) return msg.reply("حدد رول");

    const res = await ultraBroadcast(
      msg.guild,
      text,
      m => m.roles.cache.has(role.id)
    );

    msg.channel.send(`✅ للرول: ${res.totalSent}`);
  }

  if (cmd === "bc-embed") {
    const text = args.join(" ");
    const embed = new EmbedBuilder()
      .setTitle("📢 إعلان")
      .setDescription(text)
      .setColor("Blue");

    const res = await ultraBroadcast(msg.guild, { embeds: [embed] });
    msg.channel.send(`✅ Embed: ${res.totalSent}`);
  }
});