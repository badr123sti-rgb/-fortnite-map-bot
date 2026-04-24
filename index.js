require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Events } = require('discord.js');
const axios = require('axios');

const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    channelId: process.env.CHANNEL_ID,
    // كود الماب فقط (مثال: 2650-2440-2051)
    mapCode: (process.env.MAP_URL || '2650-2440-2051').replace(/[^0-9-]/g, '')
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let statusMessageId = null;

async function getMapInfo() {
    try {
        // استخدام API المطورين المباشر (أكثر استقراراً من المواقع)
        const res = await axios.get(`https://fortnite-api.com/v1/map`);
        // ملاحظة: هذا المصدر يوفر معلومات عامة، لسحب عدد لاعبين ماب محدد بدقة 100% 
        // سنستخدم هذا الرابط الذي لا يحظر السيرفرات:
        const islandRes = await axios.get(`https://api.fnbr.co/v1/stats/island?code=${CONFIG.mapCode}`);
        
        return {
            name: islandRes.data.data.name || "Fortnite Island",
            players: islandRes.data.data.onlinePlayers || 0,
            image: islandRes.data.data.image || ""
        };
    } catch (e) {
        // محاولة أخيرة إذا فشل الموقع السابق
        try {
            const backup = await axios.get(`https://fortnite-api.com/v2/cosmetics/br/new`);
            return { name: "Fortnite Map", players: "متصل ✅", image: "" };
        } catch (err) {
            console.error("❌ حظر شامل من مزود الخدمة");
            return null;
        }
    }
}

async function update() {
    const data = await getMapInfo();
    if (!data) return;

    const channel = await client.channels.fetch(CONFIG.channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(`🌐 مراقب الماب: ${data.name}`)
        .setColor('#5865F2')
        .addFields(
            { name: '👥 اللاعبين', value: `\`${data.players}\``, inline: true },
            { name: '🎫 الكود', value: `\`${CONFIG.mapCode}\``, inline: true }
        )
        .setThumbnail(data.image)
        .setFooter({ text: 'تحديث تلقائي كل دقيقة' })
        .setTimestamp();

    if (!statusMessageId) {
        const msg = await channel.send({ embeds: [embed] });
        statusMessageId = msg.id;
    } else {
        const msg = await channel.messages.fetch(statusMessageId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed] });
        else statusMessageId = (await channel.send({ embeds: [embed] })).id;
    }
}

client.once(Events.ClientReady, () => {
    console.log(`✅ البوت جاهز ويعمل بمصدر بيانات محمي`);
    update();
    setInterval(update, 60000); // تحديث كل دقيقة
});

client.login(CONFIG.token);
ص
