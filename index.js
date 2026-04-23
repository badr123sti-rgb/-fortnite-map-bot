/**
 * ============================================
 * FORTNITE MAP TRACKER BOT v4.0
 * ============================================
 */

require('dotenv').config();

const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActivityType,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionsBitField
} = require('discord.js');

const cron = require('node-cron');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// CONFIG
const CONFIG = {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    channelId: process.env.CHANNEL_ID,
    updateInterval: parseInt(process.env.UPDATE_INTERVAL) || 1,
    mapUrl: process.env.MAP_URL || null,
    maxPlayers: parseInt(process.env.MAX_PLAYERS) || 40
};

if (!CONFIG.token) {
    console.error('DISCORD_TOKEN not set');
    process.exit(1);
}

if (!CONFIG.channelId) {
    console.error('CHANNEL_ID not set');
    process.exit(1);
}

// STATE
const state = {
    lastPlayerCount: null,
    lastUpdateTime: null,
    isRunning: false,
    totalUpdates: 0,
    errorsCount: 0,
    startTime: new Date(),
    lastNotification: { count: null, type: null, time: null },
    mapInfo: { name: null, imageUrl: null, code: null, description: null, creator: null, fetchedAt: null },
    browser: null,
    page: null,
    lastMapChange: { by: null, oldUrl: null, newUrl: null, time: null }
};

// DISCORD CLIENT
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// SLASH COMMANDS
const slashCommands = [
    new SlashCommandBuilder().setName('status').setDescription('Show current map status'),
    new SlashCommandBuilder().setName('forceupdate').setDescription('Force immediate update'),
    new SlashCommandBuilder().setName('setmap').setDescription('Change map URL (Admin only)').addStringOption(option => option.setName('url').setDescription('fortnite.gg map URL').setRequired(true)),
    new SlashCommandBuilder().setName('currentmap').setDescription('Show current map'),
    new SlashCommandBuilder().setName('setinterval').setDescription('Change update interval').addIntegerOption(option => option.setName('minutes').setDescription('Minutes').setRequired(true).setMinValue(1).setMaxValue(60)),
    new SlashCommandBuilder().setName('mapinfo').setDescription('Show map info'),
    new SlashCommandBuilder().setName('stats').setDescription('Bot statistics'),
    new SlashCommandBuilder().setName('info').setDescription('Bot info')
];

// PUPPETEER
async function initBrowser() {
    try {
        console.log('Starting Puppeteer...');
        state.browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1920,1080'],
            defaultViewport: { width: 1920, height: 1080 }
        });
        state.page = await state.browser.newPage();
        await state.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        console.log('Puppeteer ready');
        return true;
    } catch (error) {
        console.error('Puppeteer error:', error.message);
        return false;
    }
}

async function closeBrowser() {
    if (state.browser) { await state.browser.close(); state.browser = null; state.page = null; }
}

// SCRAPE
async function scrapeWithPuppeteer(url) {
    if (!state.page) { const success = await initBrowser(); if (!success) return { playerCount: null, mapInfo: null }; }
    try {
        console.log(`Scraping: ${url}`);
        await state.page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await state.page.waitForTimeout(5000);
        const html = await state.page.content();
        const cheerio = require('cheerio');
        const $ = cheerio.load(html);

        const mapInfo = { name: null, imageUrl: null, code: null, description: null, creator: null, fetchedAt: new Date() };

        // Name
        const nameSelectors = ['h1', '.map-title', '.title', '[data-map-name]', 'meta[property="og:title"]', 'meta[name="twitter:title"]'];
        for (const selector of nameSelectors) {
            const el = $(selector).first();
            if (el.length) {
                let text = selector.startsWith('meta') ? el.attr('content') : el.text().trim();
                if (text && text.length > 0 && !text.includes('Fortnite.GG')) { mapInfo.name = text.replace(/[-–|].*$/, '').trim(); break; }
            }
        }

        // Image
        const imageSelectors = ['meta[property="og:image"]', 'meta[name="twitter:image"]', '.map-image img', '.map-thumbnail img'];
        for (const selector of imageSelectors) {
            const el = $(selector).first();
            if (el.length) {
                let src = selector.startsWith('meta') ? el.attr('content') : (el.attr('src') || el.attr('data-src'));
                if (src) { if (src.startsWith('/')) src = `https://fortnite.gg${src}`; mapInfo.imageUrl = src; break; }
            }
        }

        // Code
        const codeMatch = url.match(/[?&]code=([0-9A-Z]{4,5}-[0-9A-Z]{4,5}-[0-9A-Z]{4,5})/i) || html.match(/([0-9A-Z]{4,5}-[0-9A-Z]{4,5}-[0-9A-Z]{4,5})/i);
        if (codeMatch) mapInfo.code = codeMatch[1].toUpperCase();

        // Description
        const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content');
        if (desc) mapInfo.description = desc.substring(0, 200);

        // Creator
        const creatorSelectors = ['.creator-name', '.map-creator', '[data-creator]'];
        for (const selector of creatorSelectors) {
            const el = $(selector).first();
            if (el.length) { const text = el.text().trim(); if (text && text.length < 50) { mapInfo.creator = text; break; } }
        }

        // Player Count
        let playerCount = null;
        const pageText = $('body').text();
        const patterns = [
            /(\d[\d,]*)\s*players?\s*online/i, /(\d[\d,]*)\s*online\s*players?/i,
            /(\d[\d,]*)\s*players?/i, /(\d[\d,]*)\s*online/i,
            /(\d[\d,]*)\s*playing/i, /online[:\s]+(\d[\d,]*)/i, /players[:\s]+(\d[\d,]*)/i
        ];
        for (const pattern of patterns) {
            const match = pageText.match(pattern);
            if (match) { playerCount = parseInt(match[1].replace(/,/g, '')); break; }
        }
        if (!playerCount) {
            const selectors = ['[data-players]', '[data-online]', '.player-count', '.online-count'];
            for (const selector of selectors) {
                const el = $(selector).first();
                if (el.length) {
                    const text = el.text().trim();
                    const numMatch = text.match(/(\d[\d,]*)/);
                    if (numMatch) { playerCount = parseInt(numMatch[1].replace(/,/g, '')); break; }
                }
            }
        }

        console.log(`Found: ${playerCount !== null ? playerCount + ' players' : 'not found'}`);
        return { playerCount, mapInfo };
    } catch (error) {
        console.error('Scrape error:', error.message);
        state.errorsCount++;
        return { playerCount: null, mapInfo: null };
    }
}

async function scrapeMapData(url) {
    const result = await scrapeWithPuppeteer(url);
    if (result.mapInfo && result.mapInfo.name) state.mapInfo = result.mapInfo;
    return result.playerCount;
}

// NOTIFICATION
async function sendSmartNotification(channel, currentCount, previousCount) {
    const now = new Date();
    const mapInfo = state.mapInfo;
    if (currentCount === previousCount) return;

    const diff = currentCount - previousCount;
    const slotsLeft = CONFIG.maxPlayers - currentCount;
    let changeType, changeEmoji, changeColor, changeTitle, changeDescription;

    if (currentCount >= CONFIG.maxPlayers) {
        changeType = 'full'; changeEmoji = '🔴'; changeColor = '#FF0000';
        changeTitle = '⚠️ الماب امتلأ!';
        changeDescription = `العدد وصل للحد الأقصى: **${CONFIG.maxPlayers}** لاعب!`;
    } else if (diff > 0) {
        changeType = 'join'; changeEmoji = '🟢'; changeColor = '#00FF00';
        changeTitle = '✅ دخول لاعب جديد!';
        changeDescription = `**+${diff}** لاعب دخل الماب\nالمتبقي: **${slotsLeft}** مقعد`;
    } else {
        changeType = 'leave'; changeEmoji = '🟡'; changeColor = '#FFA500';
        changeTitle = '👋 خروج لاعب';
        changeDescription = `**${diff}** لاعب خرج من الماب\nالمتبقي: **${slotsLeft}** مقعد`;
    }

    if (state.lastNotification.count === currentCount && state.lastNotification.type === changeType) return;

    const embed = new EmbedBuilder()
        .setTitle(`${changeEmoji} ${changeTitle}`)
        .setColor(changeColor)
        .setDescription(changeDescription)
        .addFields(
            { name: '👥 العدد الحالي', value: `\`\`\`ml\n${currentCount} / ${CONFIG.maxPlayers}\`\`\``, inline: true },
            { name: '📊 المقاعد المتبقية', value: `\`\`\`yaml\n${slotsLeft} مقعد\`\`\``, inline: true },
            { name: '🕐 الوقت', value: `<t:${Math.floor(now.getTime() / 1000)}:t>`, inline: true }
        )
        .setFooter({ text: `${mapInfo.name || 'Map'} | لقد تم التحديث`, iconURL: mapInfo.imageUrl || undefined })
        .setTimestamp();

    const progressPercent = Math.round((currentCount / CONFIG.maxPlayers) * 100);
    const filledBlocks = Math.round((currentCount / CONFIG.maxPlayers) * 10);
    const progressBar = '█'.repeat(filledBlocks) + '░'.repeat(10 - filledBlocks);
    embed.addFields({ name: '📈 الامتلاء', value: `\`${progressBar}\` **${progressPercent}%**`, inline: false });

    if (mapInfo.imageUrl) embed.setThumbnail(mapInfo.imageUrl);
    embed.addFields({ name: '🔗 رابط الماب', value: `[اضغط هنا للدخول](${CONFIG.mapUrl})`, inline: false });

    let mentionText = null;
    if (currentCount >= CONFIG.maxPlayers) mentionText = '🔴 الماب امتلأ!';
    else if (slotsLeft <= 5 && slotsLeft > 0) mentionText = `⚠️ باقي ${slotsLeft} مقاعد فقط!`;

    await channel.send({ content: mentionText, embeds: [embed] });
    state.lastNotification = { count: currentCount, type: changeType, time: now };
    console.log(`Notification sent: ${changeType} (${currentCount} players)`);
}

// SEND UPDATE
async function sendUpdate(force = false) {
    if (state.isRunning && !force) return;
    state.isRunning = true;

    try {
        if (!CONFIG.mapUrl) { console.error('No map set'); state.isRunning = false; return; }
        const channel = await client.channels.fetch(CONFIG.channelId);
        if (!channel) throw new Error('Channel not found');

        const playerCount = await scrapeMapData(CONFIG.mapUrl);
        if (playerCount === null) {
            await channel.send({ embeds: [new EmbedBuilder().setTitle('⚠️ تعذر سحب البيانات').setColor('#FF6600').setDescription('لم أتمكن من قراءة عدد اللاعبين.').setTimestamp()] });
            state.isRunning = false; return;
        }

        if (state.lastPlayerCount === null) {
            state.lastPlayerCount = playerCount; state.lastUpdateTime = new Date(); state.totalUpdates++;
            const embed = new EmbedBuilder().setTitle('🎮 بدء المراقبة').setColor('#0099FF')
                .setDescription(`بدأت مراقبة الماب\nالعدد الحالي: **${playerCount}** لاعب`)
                .addFields(
                    { name: '👥 اللاعبين', value: `${playerCount} / ${CONFIG.maxPlayers}`, inline: true },
                    { name: '📊 المقاعد', value: `${CONFIG.maxPlayers - playerCount}`, inline: true }
                ).setFooter({ text: 'لقد تم التحديث' }).setTimestamp();
            if (state.mapInfo.imageUrl) embed.setThumbnail(state.mapInfo.imageUrl);
            await channel.send({ embeds: [embed] });
            client.user.setActivity(`${playerCount}/${CONFIG.maxPlayers} في ${state.mapInfo.name || 'Map'}`, { type: ActivityType.Watching });
            state.isRunning = false; return;
        }

        if (playerCount !== state.lastPlayerCount) await sendSmartNotification(channel, playerCount, state.lastPlayerCount);
        else console.log(`No change: ${playerCount} players`);

        state.lastPlayerCount = playerCount; state.lastUpdateTime = new Date(); state.totalUpdates++;
        client.user.setActivity(`${playerCount}/${CONFIG.maxPlayers} في ${state.mapInfo.name || 'Map'}`, { type: ActivityType.Watching });
        console.log(`Update #${state.totalUpdates}: ${playerCount} players`);
    } catch (error) {
        console.error(`Error: ${error.message}`); state.errorsCount++;
    } finally { state.isRunning = false; }
}

// REGISTER COMMANDS
async function registerCommands() {
    try {
        const rest = new REST({ version: '10' }).setToken(CONFIG.token);
        const appId = CONFIG.clientId || client.user.id;
        await rest.put(Routes.applicationCommands(appId), { body: slashCommands.map(cmd => cmd.toJSON()) });
        console.log(`${slashCommands.length} Commands registered`);
    } catch (error) { console.error('Commands error:', error.message); }
}

// EVENTS
client.once('ready', async () => {
    console.log('='.repeat(60));
    console.log('🎮 FORTNITE MAP TRACKER v4.0');
    console.log('='.repeat(60));
    console.log(`Connected: ${client.user.tag}`);
    console.log(`Map: ${CONFIG.mapUrl || 'Not set'}`);
    console.log(`Update interval: ${CONFIG.updateInterval} minutes`);
    console.log(`Max players: ${CONFIG.maxPlayers}`);
    console.log('='.repeat(60));

    await initBrowser();
    await registerCommands();

    if (!CONFIG.mapUrl) {
        console.log('\nNo map set! Use /setmap');
    } else {
        console.log('\nInitial scrape...');
        await sendUpdate();
        const cronExpression = `*/${CONFIG.updateInterval} * * * *`;
        cron.schedule(cronExpression, () => {
            if (!CONFIG.mapUrl) return;
            console.log(`\n[${new Date().toLocaleTimeString()}] Scheduled update`);
            sendUpdate();
        });
        console.log(`Schedule: ${cronExpression}`);
    }
    console.log('Bot running!\n');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    try {
        switch (commandName) {
            case 'status': {
                await interaction.deferReply();
                if (!CONFIG.mapUrl) { await interaction.editReply('❌ No map set.'); return; }
                const playerCount = await scrapeMapData(CONFIG.mapUrl);
                if (playerCount === null) { await interaction.editReply('❌ Failed to fetch data.'); return; }
                const slotsLeft = CONFIG.maxPlayers - playerCount;
                const progressPercent = Math.round((playerCount / CONFIG.maxPlayers) * 100);
                const embed = new EmbedBuilder().setTitle('📊 حالة الماب').setColor(playerCount >= CONFIG.maxPlayers ? '#FF0000' : '#00FF00')
                    .addFields(
                        { name: '👥 اللاعبين', value: `${playerCount} / ${CONFIG.maxPlayers}`, inline: true },
                        { name: '📊 المقاعد', value: `${slotsLeft}`, inline: true },
                        { name: '📈 الامتلاء', value: `${progressPercent}%`, inline: true }
                    ).setFooter({ text: 'لقد تم التحديث' }).setTimestamp();
                if (state.mapInfo.imageUrl) embed.setThumbnail(state.mapInfo.imageUrl);
                await interaction.editReply({ embeds: [embed] });
                break;
            }
            case 'forceupdate': {
                await interaction.deferReply();
                if (!CONFIG.mapUrl) { await interaction.editReply('❌ No map set.'); return; }
                await sendUpdate(true);
                await interaction.editReply('✅ Force update done!');
                break;
            }
            case 'setmap': {
                if (!interaction.memberPermissions.has(PermissionsBitField.Flags.Administrator)) {
                    await interaction.reply({ content: '❌ Requires Administrator!', ephemeral: true }); return;
                }
                const newUrl = interaction.options.getString('url');
                if (!newUrl.includes('fortnite.gg')) { await interaction.reply({ content: '❌ Must be fortnite.gg', ephemeral: true }); return; }
                await interaction.deferReply();
                const oldUrl = CONFIG.mapUrl;
                if (oldUrl === newUrl) { await interaction.editReply('⚠️ Same map!'); return; }
                CONFIG.mapUrl = newUrl;
                const result = await scrapeWithPuppeteer(newUrl);
                if (!result.mapInfo || !result.mapInfo.name) {
                    CONFIG.mapUrl = oldUrl;
                    await interaction.editReply('❌ Failed. Kept old map.'); return;
                }
                state.mapInfo = result.mapInfo;
                state.lastPlayerCount = null; state.lastUpdateTime = null; state.lastNotification = { count: null, type: null, time: null };
                state.lastMapChange = { by: interaction.user.id, oldUrl, newUrl, time: new Date() };
                const embed = new EmbedBuilder().setTitle('✅ تم تغيير الماب').setColor('#00FF00')
                    .setDescription(`By <@${interaction.user.id}>`)
                    .addFields(
                        { name: '🗺️ Name', value: result.mapInfo.name, inline: true },
                        { name: '🎫 Code', value: result.mapInfo.code || 'N/A', inline: true },
                        { name: '👤 Creator', value: result.mapInfo.creator || 'Unknown', inline: true },
                        { name: '🔗 URL', value: `[Map](${newUrl})`, inline: false }
                    );
                if (result.mapInfo.imageUrl) embed.setThumbnail(result.mapInfo.imageUrl);
                await interaction.editReply({ embeds: [embed] });
                setTimeout(() => sendUpdate(true), 2000);
                break;
            }
            case 'currentmap': {
                if (!CONFIG.mapUrl) { await interaction.reply('❌ No map set.'); return; }
                const embed = new EmbedBuilder().setTitle('🗺️ الماب الحالي').setColor('#0099FF')
                    .addFields(
                        { name: '🔗 URL', value: `[Map](${CONFIG.mapUrl})`, inline: false },
                        { name: '🗺️ Name', value: state.mapInfo.name || 'Unknown', inline: true },
                        { name: '🎫 Code', value: state.mapInfo.code || 'N/A', inline: true }
                    );
                if (state.mapInfo.imageUrl) embed.setImage(state.mapInfo.imageUrl);
                if (state.lastMapChange.time) embed.addFields({ name: '📝 Last change', value: `By: <@${state.lastMapChange.by}>\n<t:${Math.floor(state.lastMapChange.time.getTime() / 1000)}:R>`, inline: false });
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'setinterval': {
                const minutes = interaction.options.getInteger('minutes');
                CONFIG.updateInterval = minutes;
                await interaction.reply({ content: `⏱️ Interval: ${minutes} min\n⚠️ Restart to apply.`, ephemeral: true });
                break;
            }
            case 'mapinfo': {
                const embed = new EmbedBuilder().setTitle('🗺️ Map Info').setColor('#0099FF').setTimestamp();
                if (state.mapInfo.name) embed.setTitle(`🗺️ ${state.mapInfo.name}`);
                if (state.mapInfo.imageUrl) embed.setImage(state.mapInfo.imageUrl);
                embed.addFields(
                    { name: '🎫 Code', value: state.mapInfo.code || 'N/A', inline: true },
                    { name: '👤 Creator', value: state.mapInfo.creator || 'Unknown', inline: true },
                    { name: '🔗 URL', value: `[Map](${CONFIG.mapUrl})`, inline: false },
                    { name: '🔢 Max', value: `${CONFIG.maxPlayers} players`, inline: true },
                    { name: '⏱️ Interval', value: `${CONFIG.updateInterval} min`, inline: true }
                );
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'stats': {
                const uptime = Math.floor((new Date() - state.startTime) / 1000);
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                const embed = new EmbedBuilder().setTitle('📊 Stats').setColor('#0099FF')
                    .addFields(
                        { name: '🤖 Status', value: '🟢 Online', inline: true },
                        { name: '⏱️ Uptime', value: `${hours}h ${minutes}m`, inline: true },
                        { name: '📡 Updates', value: `${state.totalUpdates}`, inline: true },
                        { name: '❌ Errors', value: `${state.errorsCount}`, inline: true },
                        { name: '📊 Last count', value: state.lastPlayerCount !== null ? `${state.lastPlayerCount}` : 'N/A', inline: true },
                        { name: '🔒 Map', value: CONFIG.mapUrl ? '✅ Set' : '❌ Not set', inline: true }
                    );
                await interaction.reply({ embeds: [embed] });
                break;
            }
            case 'info': {
                const embed = new EmbedBuilder().setTitle('ℹ️ Bot Info').setColor('#7289DA')
                    .addFields(
                        { name: '🤖 Name', value: client.user.tag, inline: true },
                        { name: '🆔 ID', value: client.user.id, inline: true },
                        { name: '🗺️ Current Map', value: state.mapInfo.name || 'Unknown', inline: true },
                        { name: '🎫 Code', value: state.mapInfo.code || 'N/A', inline: true },
                        { name: '🔗 URL', value: CONFIG.mapUrl ? `[Map](${CONFIG.mapUrl})` : '❌ Not set', inline: false },
                        { name: '⏱️ Interval', value: `${CONFIG.updateInterval} min`, inline: true },
                        { name: '🔢 Max', value: `${CONFIG.maxPlayers} players`, inline: true },
                        { name: '🔒 Protection', value: 'Admin only', inline: true }
                    );
                if (state.mapInfo.imageUrl) embed.setThumbnail(state.mapInfo.imageUrl);
                await interaction.reply({ embeds: [embed] });
                break;
            }
        }
    } catch (error) {
        console.error(`Error in /${commandName}:`, error.message);
        const msg = '❌ Error occurred.';
        if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
        else await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
});

// ERROR HANDLING
client.on('error', (error) => { console.error('Discord Error:', error.message); state.errorsCount++; });
process.on('unhandledRejection', (error) => { console.error('Unhandled:', error.message); state.errorsCount++; });
process.on('uncaughtException', (error) => { console.error('Exception:', error.message); state.errorsCount++; });
process.on('SIGINT', async () => { console.log('\nShutting down...'); await closeBrowser(); client.destroy(); process.exit(0); });
process.on('SIGTERM', async () => { console.log('\nShutting down...'); await closeBrowser(); client.destroy(); process.exit(0); });

// START
console.log('🚀 Starting bot...');
client.login(CONFIG.token);
