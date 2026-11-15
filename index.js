require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');
const { Client: SelfClient } = require('discord.js-selfbot-v13');
const { Streamer } = require('@dank074/discord-video-stream');
const prism = require('prism-media');
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ==============================================================================
// CẤU HÌNH HỆ THỐNG & DISCORD CLOUD DATABASE
// ==============================================================================
const API_BASE = 'https://discord.com/api/v9';
const DB_GUILD_ID = process.env.DB_GUILD_ID || '1571370887683375124';
const DEFAULT_THUMBNAIL = process.env.THUMBNAIL_URL || 'https://cdn.discordapp.com/emojis/1571114469130633316.png';
const MAX_CONCURRENT_QUESTS = 5;

const LOCAL_CACHE_DIR = path.join(__dirname, 'cache_db');
if (!fs.existsSync(LOCAL_CACHE_DIR)) fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });

const DB_CHANNELS_SPEC = {
    tokens: 'db-tokens',
    fingerprints: 'db-fingerprints',
    sessions: 'db-sessions',
    setups: 'db-setups',
    voice_streams: 'db-voice-streams'
};

const PC_GAMES_110 = [
    "Roblox", "Geometry Dash", "Grand Theft Auto V", "Minecraft", "League of Legends",
    "Cyberpunk 2077", "Valorant", "Counter-Strike 2", "Dota 2", "Apex Legends",
    "Fortnite", "Rocket League", "Terraria", "Stardew Valley", "Among Us",
    "Genshin Impact", "Honkai: Star Rail", "Elden Ring", "Baldur's Gate 3", "Palworld",
    "Monster Hunter: World", "The Witcher 3: Wild Hunt", "Red Dead Redemption 2", "Forza Horizon 5", "Call of Duty: Warzone",
    "Overwatch 2", "Dead Cells", "Hades", "Hollow Knight", "Cuphead",
    "Rust", "ARK: Survival Evolved", "Subnautica", "The Forest", "Sons Of The Forest",
    "Phasmophobia", "Lethal Company", "Content Warning", "Fall Guys", "Team Fortress 2",
    "Left 4 Dead 2", "Portal 2", "Half-Life 2", "Garry's Mod", "Euro Truck Simulator 2",
    "American Truck Simulator", "Cities: Skylines", "Civilization VI", "Hearts of Iron IV", "Stellaris",
    "Europa Universalis IV", "Crusader Kings III", "Factorio", "Satisfactory", "RimWorld",
    "Project Zomboid", "Don't Starve Together", "Valheim", "V Rising", "Enshrouded",
    "Deep Rock Galactic", "Helldivers 2", "Warframe", "Destiny 2", "Path of Exile",
    "Diablo IV", "Lost Ark", "Black Desert", "Final Fantasy XIV", "World of Warcraft",
    "osu!", "Muse Dash", "A Dance of Fire and Ice", "Beat Saber", "Friday Night Funkin'",
    "Sekiro: Shadows Die Twice", "Dark Souls III", "NieR:Automata", "Devil May Cry 5", "Resident Evil 4",
    "Resident Evil Village", "Silent Hill 2", "Dead by Daylight", "Dying Light 2", "Outlast",
    "God of War", "Marvel's Spider-Man Remastered", "Ghost of Tsushima", "Horizon Zero Dawn", "The Last of Us Part I",
    "Hogwarts Legacy", "Starfield", "No Man's Sky", "Sea of Thieves", "Grounded",
    "It Takes Two", "A Way Out", "Portal", "Undertale", "Deltarune",
    "OMORI", "Celeste", "Ori and the Will of the Wisps", "Little Nightmares II", "Limbo",
    "Inside", "Stray", "Sifu", "Hades II", "Manor Lords"
];

const SUPPORTED_TASKS = [
    "WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"
];

const DEVICE_PROFILES = [
    {
        os: "Windows", os_version: "10.0.26100", os_arch: "x64", app_arch: "x64",
        browser: "Discord Client", client_version: "1.0.9175", browser_version: "32.2.7", native_build_number: 59498,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36"
    }
];

const activeQuests = new Map();
const activeGameSessions = new Map();
const activeVoiceStreamers = new Map();
let cachedBuildNumber = 504649;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const randRange = (min, max) => Math.random() * (max - min) + min;

// ==============================================================================
// MODULE 1: DISCORD CLOUD DATABASE
// ==============================================================================
class DiscordCloudDB {
    constructor() {
        this.channels = {};
        this.store = { tokens: {}, fingerprints: {}, sessions: {}, setups: {}, voice_streams: {} };
        this.syncTimers = {};
    }

    _cachePath(table) { return path.join(LOCAL_CACHE_DIR, `${table}.json`); }
    _readLocal(table) {
        try { const p = this._cachePath(table); if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
        return {};
    }
    _writeLocal(table, data) {
        try { fs.writeFileSync(this._cachePath(table), JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
    }

    async init(client) {
        for (const table of Object.keys(DB_CHANNELS_SPEC)) { this.store[table] = this._readLocal(table); }
        const guild = await client.guilds.fetch(DB_GUILD_ID).catch(() => null);
        if (!guild) return;

        let allChannels = await guild.channels.fetch().catch(() => null);
        if (!allChannels) return;

        let category = allChannels.find(c => c.type === ChannelType.GuildCategory && c.name === 'BOT-CLOUD-DB');
        if (!category) {
            category = await guild.channels.create({
                name: 'BOT-CLOUD-DB',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [
                    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }
                ]
            }).catch(() => null);
        }

        for (const [table, chName] of Object.entries(DB_CHANNELS_SPEC)) {
            let channel = allChannels.find(c => c.type === ChannelType.GuildText && c.name === chName);
            if (!channel && category) {
                channel = await guild.channels.create({
                    name: chName, type: ChannelType.GuildText, parent: category.id,
                    topic: `Hệ thống lưu trữ tự động bảng [${table}]`
                }).catch(() => null);
            }
            if (channel) {
                this.channels[table] = channel;
                await this._loadFromChannel(table, channel);
            }
        }
    }

    async _loadFromChannel(table, channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            for (const msg of messages.values()) {
                let raw = msg.content || '';
                const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (codeMatch) raw = codeMatch[1];
                if (raw.trim().startsWith('{')) {
                    Object.assign(this.store[table], JSON.parse(raw.trim()));
                }
            }
        } catch (e) {}
    }

    get(table, key = null) {
        if (!key) return this.store[table] || {};
        return (this.store[table] || {})[String(key)] || null;
    }

    set(table, key, value) {
        if (!this.store[table]) this.store[table] = {};
        this.store[table][String(key)] = value;
        this._writeLocal(table, this.store[table]);
        clearTimeout(this.syncTimers[table]);
        this.syncTimers[table] = setTimeout(() => this.flush(table), 2500);
    }

    delete(table, key) {
        if (this.store[table] && this.store[table][String(key)] !== undefined) {
            delete this.store[table][String(key)];
            this._writeLocal(table, this.store[table]);
            clearTimeout(this.syncTimers[table]);
            this.syncTimers[table] = setTimeout(() => this.flush(table), 2500);
        }
    }

    async flush(table) {
        const channel = this.channels[table];
        if (!channel) return;
        try {
            const payloadStr = JSON.stringify(this.store[table], null, 2);
            const oldMsgs = await channel.messages.fetch({ limit: 5 }).catch(() => null);
            if (payloadStr.length <= 1900) {
                const content = `\`\`\`json\n${payloadStr}\n\`\`\``;
                const lastMsg = oldMsgs?.find(m => m.author.id === channel.client.user.id);
                if (lastMsg) await lastMsg.edit({ content });
                else await channel.send({ content });
            }
        } catch (e) {}
    }
}

const db = new DiscordCloudDB();

// ==============================================================================
// VOICE STREAM MANAGER (Tích hợp chuẩn từ index_2.js)
// ==============================================================================
async function startVoiceStreamer(userId, streamerToken, guildId, channelId) {
    if (!guildId || !channelId || !streamerToken) return;

    if (activeVoiceStreamers.has(userId)) {
        try { activeVoiceStreamers.get(userId).destroy(); } catch (e) {}
        activeVoiceStreamers.delete(userId);
    }

    try {
        const selfClient = new SelfClient({ checkUpdate: false });
        activeVoiceStreamers.set(userId, selfClient);

        selfClient.on('ready', async () => {
            console.log(`[VoiceStream] Selfbot streamer đã đăng nhập: ${selfClient.user.tag}`);
            try {
                const streamer = new Streamer(selfClient);

                console.log("[+] Đang kết nối vào Voice Channel...");
                await streamer.joinVoice(guildId, channelId);
                console.log("[+] Đã vào phòng voice thành công!");

                // Chờ 1.5 giây để socket ổn định rồi khóa cứng Mic Mute
                await sleep(1500);
                await selfClient.ws.broadcast({
                    op: 4,
                    d: {
                        guild_id: guildId,
                        channel_id: channelId,
                        self_mute: true,
                        self_deaf: false
                    }
                });
                console.log("[+] Đã khóa cứng Mic (Mute) thành công!");

                console.log("[+] Đang khởi tạo luồng màn hình đen (Stream Video)...");
                const udpStream = await streamer.createStream();

                new prism.FFmpeg({
                    args: [
                        '-f', 'lavfi',
                        '-i', 'color=c=black:s=1280x720:r=30',
                        '-pix_fmt', 'yuv420p',
                        '-vcodec', 'libx264',
                        '-preset', 'ultrafast',
                        '-tune', 'zerolatency',
                        '-r', '30',
                        '-g', '60',
                        '-b:v', '1000k',
                        '-f', 'rtsp',
                        udpStream
                    ]
                });
                console.log(`[VoiceStream] 🚀 Stream màn hình vào Voice Channel [${channelId}] đang chạy ngầm ổn định tuyệt đối!`);
            } catch (err) {
                console.error(`[VoiceStream] Lỗi khi tạo luồng stream:`, err.message);
            }
        });

        await selfClient.login(streamerToken);
    } catch (err) {
        console.error(`[VoiceStream] Không thể khởi chạy selfclient:`, err.message);
    }
}

// ==============================================================================
// HÀM TIỆN ÍCH & PINTEREST PARSER
// ==============================================================================
function getSavedToken(userId) { return db.get('tokens', userId); }
function saveToken(userId, token) { db.set('tokens', userId, token.trim()); }
function removeToken(userId) {
    db.delete('tokens', userId);
    db.delete('sessions', userId);
    db.delete('voice_streams', userId);
    if (activeVoiceStreamers.has(userId)) {
        try { activeVoiceStreamers.get(userId).destroy(); } catch (e) {}
        activeVoiceStreamers.delete(userId);
    }
}
function getUserDeviceProfile(userId) {
    const savedIdx = db.get('fingerprints', userId);
    if (savedIdx !== null && DEVICE_PROFILES[savedIdx]) return DEVICE_PROFILES[savedIdx];
    return DEVICE_PROFILES[0];
}

async function resolvePinterestVideo(pinUrl) {
    if (!pinUrl || !/^https?:\/\//i.test(pinUrl)) return null;
    try {
        const res = await axios.get(pinUrl, { maxRedirects: 5, timeout: 10000, headers: { 'User-Agent': DEVICE_PROFILES[0].ua } });
        const html = String(res.data || '');
        const mp4Matches = html.match(/https:\/\/v\d*\.pinimg\.com\/videos\/[^"'\s\\]+\.mp4/gi) || [];
        const bestMp4 = mp4Matches.find(u => u.includes('720p')) || mp4Matches[0] || null;
        const imgMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i);
        return {
            sourceUrl: res.request?.res?.responseUrl || pinUrl,
            videoUrl: bestMp4,
            thumbnail: imgMatch ? imgMatch[1] : null,
            title: 'Pinterest Video Loop'
        };
    } catch (e) {
        return { sourceUrl: pinUrl, videoUrl: null, thumbnail: null, title: 'Pinterest Live Stream' };
    }
}

async function fetchLatestBuildNumber() {
    try {
        const res = await axios.get('https://discord.com/app', { headers: { 'User-Agent': DEVICE_PROFILES[0].ua }, timeout: 8000 });
        const m = res.data.match(/buildNumber["\s:]+["\s]*(\d{5,7})/);
        if (m) cachedBuildNumber = parseInt(m[1], 10);
    } catch (e) {}
    return cachedBuildNumber;
}

function makeSuperProperties(profile) {
    const obj = {
        os: profile.os, browser: profile.browser, release_channel: "stable",
        client_version: profile.client_version, os_version: profile.os_version,
        os_arch: profile.os_arch, app_arch: profile.app_arch, system_locale: "vi-VN",
        browser_user_agent: profile.ua, browser_version: profile.browser_version,
        client_build_number: cachedBuildNumber, native_build_number: profile.native_build_number
    };
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

class DiscordUserAPI {
    constructor(token, userId) {
        this.token = token;
        this.profile = getUserDeviceProfile(userId);
        this.client = axios.create({
            baseURL: API_BASE, timeout: 15000,
            headers: {
                "Authorization": token, "Content-Type": "application/json",
                "User-Agent": this.profile.ua, "X-Super-Properties": makeSuperProperties(this.profile)
            },
            validateStatus: () => true
        });
    }
    async get(url) { return this.client.get(url); }
    async post(url, data = {}) { return this.client.post(url, data); }
}

// ==============================================================================
// GIAO DIỆN COMPONENTS V2 (Thiết kế đẹp mắt, icon góc phải giống mẫu ảnh)
// ==============================================================================
const SETUP_PRESETS = {
    all: {
        label: "🌟 Tất Cả Chức Năng (Full Menu)",
        features: ["autoquest", "progress", "badge", "stream", "hypesquad", "token", "voice_stream"],
        lines: [
            "**1. AutoQuest** — Tự động cày Discord Quest & nhận Orb",
            "**2. Tiến Trình** — Theo dõi % hoàn thành trực quan",
            "**3. Badge Farmer** — 30s quét 100 game + treo 5000 giờ",
            "**4. Stream & Pin** — Bật/Tắt Rich Presence & Loop Pinterest",
            "**5. Stream Voice** — Treo Share Màn Hình trực tiếp vào phòng Voice",
            "**6. HypeSquad** — Đổi nhà HypeSquad <:hypesquad_2:1571114614975107144> tức thì",
            "**7. Token Cloud** — Lưu Token lên Server tự động khôi phục"
        ]
    }
};

function buildComponentsV2Dashboard(presetKey = "all", customThumbUrl = null) {
    const preset = SETUP_PRESETS[presetKey] || SETUP_PRESETS.all;
    const thumbUrl = customThumbUrl || DEFAULT_THUMBNAIL;

    const buttonConfigs = {
        autoquest: { type: 2, style: 3, label: "AutoQuest", emoji: { name: "🔮" }, custom_id: `v2:${presetKey}:autoquest` },
        progress: { type: 2, style: 2, label: "Tiến Trình", emoji: { name: "📊" }, custom_id: `v2:${presetKey}:progress` },
        badge: { type: 2, style: 1, label: "Badge Farmer", emoji: { name: "🎮" }, custom_id: `v2:${presetKey}:badge` },
        stream: { type: 2, style: 2, label: "Stream Pin", emoji: { name: "📺" }, custom_id: `v2:${presetKey}:stream` },
        voice_stream: { type: 2, style: 3, label: "Stream Voice", emoji: { name: "🎥" }, custom_id: `v2:${presetKey}:voice_stream` },
        hypesquad: { type: 2, style: 2, label: "HypeSquad", emoji: { id: "1571114469130633316", name: "hypesquad" }, custom_id: `v2:${presetKey}:hypesquad` },
        token: { type: 2, style: 2, label: "Token Cloud", emoji: { name: "🔐" }, custom_id: `v2:${presetKey}:token` }
    };

    const buttons = preset.features.map(f => buttonConfigs[f]).filter(Boolean);
    const actionRows = [];
    for (let i = 0; i < buttons.length; i += 3) {
        actionRows.push({ type: 1, components: buttons.slice(i, i + 3) });
    }

    return [
        {
            type: 17,
            accent_color: 0x9B59B6,
            components: [
                {
                    type: 9,
                    components: [
                        {
                            type: 10,
                            content: `## 🪽 TỔNG HỢP CHỨC NĂNG 🪽\n\n**Danh sách chức năng:**\n${preset.lines.join("\n")}`
                        }
                    ],
                    accessory: {
                        type: 11,
                        media: { url: thumbUrl }
                    }
                },
                { type: 14, divider: true, spacing: 1 },
                ...actionRows
            ]
        }
    ];
}

// ==============================================================================
// KHỞI TẠO CLIENT & TỰ ĐỘNG KHÔI PHỤC KHI RESET
// ==============================================================================
async function autoRestoreAllSessions(client) {
    const allTokens = db.get('tokens');
    const voiceConfigs = db.get('voice_streams');
    const userIds = Object.keys(allTokens);

    for (const uid of userIds) {
        const token = allTokens[uid];
        if (!token) continue;

        // Khôi phục Voice Stream
        const vCfg = voiceConfigs[uid];
        if (vCfg && vCfg.guildId && vCfg.channelId) {
            await startVoiceStreamer(uid, token, vCfg.guildId, vCfg.channelId);
        }
        await sleep(1500);
    }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
    console.log(`[+] Bot đã đăng nhập thành công: ${client.user.tag}`);
    await fetchLatestBuildNumber();
    await db.init(client);
    await autoRestoreAllSessions(client);

    const commands = [
        new SlashCommandBuilder()
            .setName('setup_menu')
            .setDescription('[ADMIN] Gửi bảng điều khiển Components V2 chuẩn mẫu')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(opt => opt.setName('che_do').setDescription('Chọn chế độ menu').setRequired(true).addChoices({ name: '🌟 Full Menu', value: 'all' }))
            .addStringOption(opt => opt.setName('anh_gif').setDescription('Link ảnh/gif góc phải').setRequired(false)),
        new SlashCommandBuilder()
            .setName('tien_trinh')
            .setDescription('[ORB/GAME] Xem bảng điều khiển tiến trình'),
        new SlashCommandBuilder()
            .setName('stream_pin')
            .setDescription('[STREAM] Bật/tắt Stream hoặc gắn link Pinterest')
            .addBooleanOption(opt => opt.setName('trang_thai').setDescription('Bật/Tắt').setRequired(true))
            .addStringOption(opt => opt.setName('link_pinterest').setDescription('Link Pinterest').setRequired(false))
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || client.user.id), { body: commands }).catch(() => {});
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const uid = interaction.user.id;
            if (interaction.commandName === 'setup_menu') {
                const presetKey = interaction.options.getString('che_do');
                const customGif = interaction.options.getString('anh_gif');
                const componentsV2 = buildComponentsV2Dashboard(presetKey, customGif);

                await interaction.channel.send({ flags: MessageFlags.IsComponentsV2, components: componentsV2 });
                return interaction.reply({ content: `✅ Đã thiết lập bảng menu thành công!`, flags: MessageFlags.Ephemeral });
            }
        }

        if (interaction.isButton()) {
            const cid = interaction.customId;
            const uid = interaction.user.id;

            if (cid.startsWith('v2:')) {
                const action = cid.split(':')[2];
                const savedToken = getSavedToken(uid);

                if (action === 'voice_stream') {
                    const modal = new ModalBuilder().setCustomId('modal:voice_stream_config').setTitle('Stream Badge – Cấu hình');
                    const savedV = db.get('voice_streams', uid) || {};
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('streamer_token').setLabel('Token Streamer *').setValue(savedToken || '').setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('viewer_token').setLabel('Token Viewer (Không bắt buộc)').setValue(savedV.viewerToken || '').setStyle(TextInputStyle.Short).setRequired(false)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID (ID Server) *').setValue(savedV.guildId || '').setStyle(TextInputStyle.Short).setRequired(true)),
                        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Voice Channel ID *').setValue(savedV.channelId || '').setStyle(TextInputStyle.Short).setRequired(true))
                    );
                    return interaction.showModal(modal);
                }

                if (action === 'token') {
                    const modal = new ModalBuilder().setCustomId('modal:token:save').setTitle('🔐 LƯU USER TOKEN');
                    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('token_val').setLabel('User Token Discord').setStyle(TextInputStyle.Short).setRequired(true)));
                    return interaction.showModal(modal);
                }
            }
        }

        if (interaction.isModalSubmit()) {
            const uid = interaction.user.id;
            if (interaction.customId === 'modal:voice_stream_config') {
                const streamerToken = interaction.fields.getTextInputValue('streamer_token').trim();
                const viewerToken = interaction.fields.getTextInputValue('viewer_token').trim();
                const guildId = interaction.fields.getTextInputValue('guild_id').trim();
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();

                db.set('voice_streams', uid, { streamerToken, viewerToken, guildId, channelId });
                saveToken(uid, streamerToken);

                await interaction.reply({ content: "🚀 Đang kết nối vào Voice Channel và tự động bật Stream màn hình...", flags: MessageFlags.Ephemeral });
                await startVoiceStreamer(uid, streamerToken, guildId, channelId);
            }

            if (interaction.customId === 'modal:token:save') {
                const token = interaction.fields.getTextInputValue('token_val').trim();
                saveToken(uid, token);
                return interaction.reply({ content: "✅ Đã lưu Token thành công!", flags: MessageFlags.Ephemeral });
            }
        }
    } catch (err) {
        console.error('[-] Lỗi xử lý:', err);
    }
});

process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

client.login(process.env.BOT_TOKEN);
