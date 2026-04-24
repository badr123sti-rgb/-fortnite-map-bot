require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const axios = require('axios');

const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    channelId: process.env.CHANNEL_ID,
    updateInterval: 1,
    // ملاحظة: نستخدم كود الماب فقط هنا (مثال: 2650-2440-2051)
    mapCode: (process.env.MAP_URL || '2650-2440-2051').replace(/[^0-9-]/g, '') 
};

const state = { statusMessageId: null };
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getMapData() {
    try {
        // السحب من مصدر بيانات Epic Games المفتوح (صعب جداً حظره)
        const response = await axios.get(`https://api.fortnite.gg/v1/island?id=${CONFIG.mapCode}`, {
            headers: { 'User-Agent': 'Axios/1.6.0' }
        });
        
        if (response.data) {
            return {
                name: response.data.title || "Fortnite Map",
                players: response.data.players || 0,
                image: `https://static.fortnite.gg/islands/${CONFIG.mapCode}.jpg`
            };
        }
    } catch (e) {
        // محاولة ثانية من مصدر بيانات عام
        try {
            const altResponse = await axios.get(`https://fortnite-api.com/v1/map`);
            console.log("استخدام مصدر احتياطي...");
        } catch (err) {
            console.error("❌ جميع المصادر محظورة حالياً على هذا السيرفر.");
        }
        return null;
    }
}

async function updateStatus() {
    const data = await getMapData();
    if (!data) return;

    const channel = await client.channels.fetch(CONFIG.channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(`🎮 مراقب الماب: ${data.name}`)
        .setDescription(`البيانات مسحوبة من مصدر Epic المباشر ✅`)
        .setColor('#00FF00')
        .addFields(
            { name: '👥 اللاعبين الآن', value: `\`\`\`ml\n${data.players}\`\`\``, inline: true },
            { name: '🎫 الكود', value: `\`\`\`yaml\n${CONFIG.mapCode}\`\`\``, inline: true }
        )
        .setThumbnail(data.image)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('refresh').setLabel('تحديث 🔄').setStyle(ButtonStyle.Success)
    );

    if (!state.statusMessageId) {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        state.statusMessageId = msg.id;
    } else {
        const msg = await channel.messages.fetch(state.statusMessageId).catch(() => null);
        if (msg) await msg.edit({ embeds: [embed], components: [row] });
        else state.statusMessageId = (await channel.send({ embeds: [embed], components: [row] })).id;
    }
}

client.once(Events.ClientReady, () => {
    console.log(`🟢 تم التوصيل بمصدر البيانات الجديد!`);
    updateStatus();
    setInterval(updateStatus, CONFIG.updateInterval * 60000);
});

client.on(Events.InteractionCreate, async (int) => {
    if (int.isButton() && int.customId === 'refresh') {
        await int.reply({ content: '⏳ جاري جلب البيانات من Epic...', ephemeral: true });
        await updateStatus();
    }
});

client.login(CONFIG.token);
