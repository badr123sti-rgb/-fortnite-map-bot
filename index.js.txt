require('dotenv').config();
const { 
    Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, 
    SlashCommandBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');

const cron = require('node-cron');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    channelId: process.env.CHANNEL_ID,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 1,
    mapUrl: process.env.MAP_URL || null,
    maxPlayers: parseInt(process.env.MAX_PLAYERS) || 40
};

const state = {
    statusMessageId: null,
    didMentionEveryone: false, 
    mapInfo: { name: "جاري السحب...", imageUrl: null, code: null },
    browser: null,
    page: null
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function initBrowser() {
    if (state.browser) return true;
    try {
        state.browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        state.page = await state.browser.newPage();
        return true;
    } catch (e) { return false; }
}

async function scrapeData(url) {
    await initBrowser();
    try {
        await state.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000)); 
        const html = await state.page.content();
        const $ = cheerio.load(html);
        let playerCount = 0;
        const match = $('body').text().match(/(\d[\d,]*)\s*players?\s*online/i);
        if (match) playerCount = parseInt(match[1].replace(/,/g, ''));
        state.mapInfo = {
            name: $('h1').first().text().trim() || "Fortnite Map",
            imageUrl: $('meta[property="og:image"]').attr('content'),
            code: url.split('/').pop()
        };
        return playerCount;
    } catch (e) { return null; }
}

async function updateStatus(isManual = false) {
    if (!CONFIG.mapUrl) return;
    try {
        const channel = await client.channels.fetch(CONFIG.channelId);
        const count = await scrapeData(CONFIG.mapUrl);
        if (count === null) return;

        const embed = new EmbedBuilder()
            .setTitle(`🎮 مراقب الماب: ${state.mapInfo.name}`)
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
            await channel.send(`📢 @everyone الجزيرة تجاوزت 10 لاعبين! العدد: **${count}**`);
            state.didMentionEveryone = true;
        } else if (count < 10) { state.didMentionEveryone = false; }
    } catch (e) { console.error(e); }
}

client.once('ready', async () => {
    const rest = new REST({ version: '10' }).setToken(CONFIG.token);
    await rest.put(Routes.applicationCommands(CONFIG.clientId), { body: [
        new SlashCommandBuilder().setName('setmap').setDescription('تغيير الرابط').addStringOption(o => o.setName('url').setRequired(true).setDescription('رابط fortnite.gg'))
    ]});
    updateStatus();
    cron.schedule(`*/${CONFIG.updateInterval} * * * *`, () => updateStatus());
});

client.on('interactionCreate', async (int) => {
    if (int.isChatInputCommand() && int.commandName === 'setmap') {
        CONFIG.mapUrl = int.options.getString('url');
        await int.reply({ content: '✅ تم التحديث!', ephemeral: true });
        updateStatus();
    }
    if (int.isButton() && int.customId === 'refresh_stats') {
        await int.reply({ content: '⏳ جاري التحديث...', ephemeral: true });
        await updateStatus(true);
    }
});

client.login(CONFIG.token);
