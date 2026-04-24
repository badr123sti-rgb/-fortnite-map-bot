require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } = require('discord.js');
const axios = require('axios');

const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    channelId: process.env.CHANNEL_ID,
    updateInterval: 1,
    mapUrl: process.env.MAP_URL || '2650-2440-2051' // ضع الكود فقط هنا
};

const state = { statusMessageId: null, mapData: null };
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function getMapData(mapCode) {
    // تنظيف الكود من الرابط إذا وجد
    const cleanCode = mapCode.includes('/') ? mapCode.split('/').pop() : mapCode;
    
    try {
        // محاولة السحب من رابط البيانات المباشر (أقل حماية)
        const response = await axios.get(`https://fortnite.gg/api/island.json?id=${cleanCode}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
                'Referer': 'https://fortnite.gg/' 
            }
        });
        
        return {
            name: response.data.title || "Fortnite Map",
            players: response.data.players || 0,
            image: `https://fortnite.gg/img/islands/${cleanCode}.jpg`,
            code: cleanCode
        };
    } catch (e) {
        console.error("❌ فشل السحب من الـ API البديل:", e.message);
        return null;
    }
}

async function updateStatus() {
    const data = await getMapData(CONFIG.mapUrl);
    if (!data) return;

    const channel = await client.channels.fetch(CONFIG.channelId).catch(() => null);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setTitle(`🎮 مراقب الماب: ${data.name}`)
        .setColor(data.players >= 10 ? '#FF0000' : '#0099FF')
        .addFields(
            { name: '👥 اللاعبين الآن', value: `\`\`\`ml\n${data.players} / 40\`\`\``, inline: true },
            { name: '🎫 الكود', value: `\`\`\`yaml\n${data.code}\`\`\``, inline: true }
        )
        .setThumbnail(data.image)
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('refresh').setLabel('تحديث 🔄').setStyle(ButtonStyle.Primary)
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
    console.log(`🟢 البوت متصل!`);
    updateStatus();
    setInterval(updateStatus, CONFIG.updateInterval * 60000);
});

client.on(Events.InteractionCreate, async (int) => {
    if (int.isButton() && int.customId === 'refresh') {
        await int.reply({ content: '⏳ جاري التحديث...', ephemeral: true });
        await updateStatus();
    }
});

client.login(CONFIG.token);
