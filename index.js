/**
 * FORTNITE MAP TRACKER v6.0 - LIGHTWEIGHT
 * - بدون متصفح (توفير رام 100%)
 * - رسالة واحدة متجددة
 * - زر تحديث يدوي
 * - منشن @everyone عند وصول 10 لاعبين
 */

require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, 
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');

const cron = require('node-cron');
const cheerio = require('cheerio');
const axios = require('axios');

// --- الإعدادات ---
const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    channelId: process.env.CHANNEL_ID,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 1,
    mapUrl: process.env.MAP_URL || null,
    maxPlayers: 40
};

// --- الحالة ---
const state = {
    statusMessageId: null,
    didMentionEveryone: false,
    mapInfo: { name: "جاري السحب...", imageUrl: null, code: null }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// --- وظيفة سحب البيانات (خفيفة جداً) ---
async function scrapeData(url) {
    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        let playerCount = 0;
        
        const pageText = $('body').text();
        const match = pageText.match(/(\d[\d,]*)\s*players?\s*online/i);
        if (match) playerCount = parseInt(match[1].replace(/,/g, ''));

        state.mapInfo = {
            name: $('h1').first().text().trim() || "Fortnite Map",
            imageUrl: $('meta[property="og:image"]').attr('content'),
            code: url.split('/').pop()
        };
        return playerCount;
    } catch (e) {
        console.error("❌ فشل السحب:", e.message);
        return null;
    }
}

// --- تحديث الرسالة ---
async function updateStatus(isManual = false) {
    if (!CONFIG.mapUrl) return;
    try {
        const channel = await client.channels.fetch(CONFIG.channelId);
        const count = await scrapeData(CONFIG.mapUrl);
        if (count === null) return;

        const embed = new EmbedBuilder()
            .setTitle(`🎮 مراقب الماب: ${state.mapInfo.name}`)
            .setURL(CONFIG.mapUrl)
            .setColor(count >= 10 ? '#FF0000' : '#0099FF')
            .addFields(
                { name: '👥 اللاعبين الآن', value: `\`\`\`ml\n${count} / ${CONFIG.maxPlayers}\`\`\``, inline: true },
                { name: '🎫 الكود', value: `\`\`\`yaml\n${state.mapInfo.code}\`\`\``, inline: true }
            )
            .setThumbnail(state.mapInfo.imageUrl)
            .setFooter({ text: `آخر تحديث ${isManual ? '(يدوي)' : '(تلقائي)'}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('refresh_stats').setLabel('تحديث الآن 🔄').setStyle(ButtonStyle.Primary)
        );

        if (!state.statusMessageId) {
            const msg = await channel.send({ embeds: [embed], components: [row] });
            state.statusMessageId = msg.id;
        } else {
            try {
                const msg = await channel.messages.fetch(state.statusMessageId);
                await msg.edit({ embeds: [embed], components: [row] });
            } catch {
                const msg = await channel.send({ embeds: [embed], components: [row] });
                state.statusMessageId = msg.id;
            }
        }

        // منشن عند وصول 10 لاعبين
        if (count >= 10 && !state.didMentionEveryone) {
            await channel.send(`📢 @everyone الجزيرة بدأت تمتلئ! العدد الحالي: **${count}**`);
            state.didMentionEveryone = true;
        } else if (count < 10) {
            state.didMentionEveryone = false;
        }

        client.user.setActivity(`${count}/${CONFIG.maxPlayers} لاعب`, { type: ActivityType.Watching });
    } catch (e) {
        console.error("❌ خطأ في التحديث:", e.message);
    }
}

// --- التشغيل ---
client.once('ready', async () => {
    console.log(`🟢 البوت يعمل بنجاح باسم: ${client.user.tag}`);
    
    // تسجيل أمر /setmap
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: [
        new SlashCommandBuilder().setName('setmap').setDescription('تغيير رابط الماب').addStringOption(o => o.setName('url').setRequired(true).setDescription('رابط fortnite.gg'))
    ]});

    await updateStatus();
    cron.schedule(`*/${CONFIG.updateInterval} * * * *`, () => updateStatus());
});

// --- التفاعل ---
client.on('interactionCreate', async (int) => {
    if (int.isChatInputCommand() && int.commandName === 'setmap') {
        CONFIG.mapUrl = int.options.getString('url');
        state.didMentionEveryone = false;
        await int.reply({ content: '✅ تم تحديث الرابط!', ephemeral: true });
        updateStatus();
    }
    if (int.isButton() && int.customId === 'refresh_stats') {
        await int.reply({ content: '⏳ جاري التحديث...', ephemeral: true });
        await updateStatus(true);
    }
});

client.login(CONFIG.token);
