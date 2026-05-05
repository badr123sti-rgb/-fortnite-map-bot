const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require("discord.js");

// ===== DB =====
mongoose.connect(process.env.MONGO_URI);

// ===== MODELS =====
const User = mongoose.model("User", {
  username: String,
  password: String,
  plan: { type: String, default: "free" },
  expiresAt: Date,
  dailySent: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});

const Log = mongoose.model("Log", {
  user: String,
  sent: Number,
  fail: Number,
  date: { type: Date, default: Date.now }
});

// ===== PLANS =====
const PLANS = {
  free:  { limit: 200 },
  pro:   { limit: 2000 },
  elite: { limit: 10000 }
};

// ===== APP =====
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

// ===== AUTH =====
function auth(req, res, next) {
  const token = req.headers.authorization;
  if (!token) return res.sendStatus(401);

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.sendStatus(403);
  }
}

// ===== HELPERS =====
function resetDaily(user) {
  const now = new Date();
  if (now.toDateString() !== new Date(user.lastReset).toDateString()) {
    user.dailySent = 0;
    user.lastReset = now;
  }
}

function checkSub(user) {
  if (user.plan === "free") return true;
  return user.expiresAt && new Date() < new Date(user.expiresAt);
}

// ===== AUTH API =====
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await User.create({ username, password: hash });
  res.send("✅ created");
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.send("❌");

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.send("❌");

  const token = jwt.sign({ username }, process.env.JWT_SECRET);
  res.json({ token });
});

// ===== UPGRADE =====
app.post("/upgrade", async (req, res) => {
  const { username, plan } = req.body;

  const user = await User.findOne({ username });
  if (!user) return res.send("❌");

  user.plan = plan;
  user.expiresAt = new Date(Date.now() + 30*24*60*60*1000);

  await user.save();
  res.send("✅ upgraded");
});

// ===== BOTS =====
const bots = process.env.TOKENS.split(",").map(t => {
  const c = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers
    ]
  });
  c.login(t.trim());
  return c;
});

const bot = bots[0];

// ===== SOCKET =====
let STOP = false;

io.on("connection", socket => {

  socket.on("start", async data => {

    STOP = false;

    const user = await User.findOne({ username: data.user });
    if (!user) return socket.emit("log", "❌ user not found");

    resetDaily(user);

    if (!checkSub(user)) {
      socket.emit("log", "❌ الاشتراك منتهي");
      return;
    }

    const limit = PLANS[user.plan].limit;

    if (user.dailySent >= limit) {
      socket.emit("log", "❌ وصلت الحد اليومي");
      return;
    }

    const guild = bot.guilds.cache.first();

    let members = Array.from(
      (await guild.members.fetch()).values()
    );

    let sent = 0;
    let fail = 0;

    for (const m of members) {
      if (STOP) break;

      if (user.dailySent >= limit) break;

      try {
        let msg = data.message;

        if (data.mention)
          msg += `\n<@${m.id}>`;

        if (data.embed) {
          const embed = new EmbedBuilder()
            .setDescription(msg);

          await m.send({ embeds: [embed] });
        } else {
          await m.send(msg);
        }

        sent++;
        user.dailySent++;
      } catch {
        fail++;
      }

      socket.emit("progress", {
        percent: ((sent+fail)/members.length*100).toFixed(1)
      });

      await new Promise(r => setTimeout(r, 700));
    }

    await user.save();

    await Log.create({
      user: user.username,
      sent,
      fail
    });

    socket.emit("done", { sent, fail });
  });

  socket.on("stop", () => STOP = true);
});

// ===== START =====
server.listen(process.env.PORT || 3000, () => {
  console.log("🚀 SaaS Running");
});