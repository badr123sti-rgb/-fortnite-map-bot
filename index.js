/**
 * FORTNITE MAP TRACKER v8.0 - FINAL STABLE
 * - تم تحديث 'ready' إلى 'clientReady' لتجنب التحذير
 * - نظام حماية كامل لتجاوز 403
 * - رسالة واحدة متجددة + زر تحديث
 * - منشن @everyone عند 10 لاعبين
 */

require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, 
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField,
    Events // إضافة Events من المكتبة
} = require('discord.js');

const cron = require('node-cron');
const cheerio = require('cheerio');
const axios = require('axios');

const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    channelId: process.env.CHANNEL_ID,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 1,
    mapUrl: process.env.MAP_URL || 'https://fortnite.gg/island/2650-2440-2051',
    maxPlayers: 40
};

const state = {
    statusMessageId: null,
    didMentionEveryone: false,
    mapInfo: { name: "جاري السحب...", imageUrl: null, code: null }
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// --- دالة سحب البيانات ---
async function scrapeData(url) {
    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            timeout: 15000
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

        if (count >= 10 && !state.didMentionEveryone) {
            await channel.send(`📢 @everyone الجزيرة بدأت تمتلئ! 🔥 العدد: **${count}**`);
            state.didMentionEveryone = true;
        } else if (count < 10) { state.didMentionEveryone = false; }

        client.user.setActivity(`${count} لاعب`, { type: ActivityType.Watching });
    } catch (e) { console.error("❌ خطأ التحديث:", e.message); }
}

// --- استخدام ClientReady بدلاً من ready ---
client.once(Events.ClientReady, async (c) => {
    console.log(`🟢 تم التشغيل بنجاح باسم: ${c.user.tag}`);
    
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    try {
        await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: [
            new SlashCommandBuilder().setName('setmap').setDescription('تغيير الرابط').addStringOption(o => o.setName('url').setRequired(true).setDescription('رابط fortnite.gg'))
        ]});
    } catch (e) { console.error(e); }

    updateStatus();
    cron.schedule(`*/${CONFIG.updateInterval} * * * *`, () => updateStatus());
});

// --- التفاعلات ---
client.on(Events.InteractionCreate, async (int) => {
    if (int.isChatInputCommand() && int.commandName === 'setmap') {
        if (!int.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return int.reply({ content: "❌ لا تملك صلاحية!", ephemeral: true });
        }
        CONFIG.mapUrl = int.options.getString('url');
        state.didMentionEveryone = false;
        await int.reply({ content: '✅ تم التحديث!', ephemeral: true });
        updateStatus();
    }
    
    if (int.isButton() && int.customId === 'refresh_stats') {
        await int.reply({ content: '⏳ جاري التحديث...', ephemeral: true });
        await updateStatus(true);
    }
});

client.login(CONFIG.token);
