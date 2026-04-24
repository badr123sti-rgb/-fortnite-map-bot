require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, Events } = require('discord.js');
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

const state = { statusMessageId: null, didMentionEveryone: false, mapInfo: { name: "جاري السحب...", imageUrl: null, code: null } };
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function scrapeData(url) {
    if (!url || !url.startsWith('http')) return null;
    try {
        // محاولة استخدام وكيل مختلف وتغيير الرابط قليلاً لتضليل الحماية
        const response = await axios.get(`${url}?refresh=${Math.random()}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
                'Sec-Fetch-Mode': 'navigate',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(response.data);
        const playerCount = parseInt($('.island-players').text().replace(/,/g, '')) || 0;

        state.mapInfo = {
            name: $('h1').first().text().trim() || "Fortnite Map",
            imageUrl: $('meta[property="og:image"]').attr('content'),
            code: url.split('/').pop()
        };
        return playerCount;
    } catch (e) {
        console.error(`❌ حظر من الموقع: ${e.response?.status || e.message}`);
        return null;
    }
}

async function updateStatus(isManual = false) {
    try {
        const channel = await client.channels.fetch(CONFIG.channelId).catch(() => null);
        if (!channel) return;
        const count = await scrapeData(CONFIG.mapUrl);
        if (count === null) return; // إذا لا يزال 403 سيتوقف هنا ولن يرسل خطأ

        const embed = new EmbedBuilder()
            .setTitle(`🎮 مراقب الماب: ${state.mapInfo.name}`)
            .setURL(CONFIG.mapUrl)
            .setColor(count >= 10 ? '#FF0000' : '#0099FF')
            .addFields(
                { name: '👥 اللاعبين الآن', value: `\`\`\`ml\n${count} / ${CONFIG.maxPlayers}\`\`\``, inline: true },
                { name: '🎫 الكود', value: `\`\`\`yaml\n${state.mapInfo.code}\`\`\``, inline: true }
            )
            .setThumbnail(state.mapInfo.imageUrl)
            .setFooter({ text: `آخر تحديث: ${new Date().toLocaleTimeString('ar-SA')}` })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('refresh_stats').setLabel('تحديث 🔄').setStyle(ButtonStyle.Primary));

        if (!state.statusMessageId) {
            const msg = await channel.send({ embeds: [embed], components: [row] });
            state.statusMessageId = msg.id;
        } else {
            const msg = await channel.messages.fetch(state.statusMessageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed], components: [row] });
            else state.statusMessageId = (await channel.send({ embeds: [embed], components: [row] })).id;
        }

        if (count >= 10 && !state.didMentionEveryone) {
            await channel.send(`📢 @everyone الماب امتلأ! العدد: **${count}**`);
            state.didMentionEveryone = true;
        } else if (count < 10) state.didMentionEveryone = false;
        client.user.setActivity(`${count} لاعب`, { type: ActivityType.Watching });
    } catch (e) { console.error(e); }
}

client.once(Events.ClientReady, async (c) => {
    console.log(`🟢 متصل: ${c.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: [new SlashCommandBuilder().setName('setmap').setDescription('تغيير الرابط').addStringOption(o => o.setName('url').setRequired(true).setDescription('رابط fortnite.gg'))] });
    updateStatus();
    cron.schedule(`*/${CONFIG.updateInterval} * * * *`, () => updateStatus());
});

client.on(Events.InteractionCreate, async (int) => {
    if (int.isChatInputCommand() && int.commandName === 'setmap') {
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
