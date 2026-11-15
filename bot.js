require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    Options,
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
const { fork } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ==============================================================================
// CẤU HÌNH
// ==============================================================================
const API_BASE = 'https://discord.com/api/v9';
const DB_GUILD_ID = process.env.DB_GUILD_ID || '1571370887683375124';
const DEFAULT_THUMBNAIL = process.env.THUMBNAIL_URL || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop';
const STREAM_SCRIPT = path.join(__dirname, 'stream.js');

const LOCAL_CACHE_DIR = path.join(__dirname, 'cache_db');
if (!fs.existsSync(LOCAL_CACHE_DIR)) fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });

// Chỉ còn bảng "tokens" được lưu lên Discord (kênh db-tokens).
// "voice_streams" chỉ lưu file local để điền sẵn form, không đẩy lên Discord.
const CLOUD_TABLES = { tokens: 'db-tokens' };
const LOCAL_TABLES = ['tokens', 'voice_streams'];
// Các kênh cũ sẽ bị XÓA SẠCH TIN NHẮN 1 lần duy nhất (token ở db-tokens được giữ nguyên)
const PURGE_CHANNELS = ['db-fingerprints', 'db-sessions', 'db-setups', 'db-voice-streams'];
const PURGE_MARKER = path.join(LOCAL_CACHE_DIR, '.purged_v2');
const OLD_LOCAL_FILES = ['fingerprints.json', 'sessions.json', 'setups.json'];

const DEVICE_PROFILES = [
    {
        os: "Windows", os_version: "10.0.26100", os_arch: "x64", app_arch: "x64",
        browser: "Discord Client", client_version: "1.0.9175", browser_version: "32.2.7", native_build_number: 59498,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36"
    }
];

const HYPESQUAD_BADGES = {
    1: {
        name: "HypeSquad Bravery",
        badgeUrl: "https://images.credly.com/images/07d8d211-1ce6-42d6-84fc-8e47f7b57223/hypesquad_bravery.png",
        desc: "Dũng cảm & Nhiệt huyết"
    },
    2: {
        name: "HypeSquad Brilliance",
        badgeUrl: "https://images.credly.com/images/13c33971-8bc7-438e-8a22-c397500b4111/hypesquad_brilliance.png",
        desc: "Sáng suốt & Kỷ luật"
    },
    3: {
        name: "HypeSquad Balance",
        badgeUrl: "https://images.credly.com/images/9c379a29-22a1-4357-a45e-b9e7740e6c51/hypesquad_balance.png",
        desc: "Cân bằng & Hài hòa"
    }
};

const activeVoiceStreamers = new Map();
let cachedBuildNumber = 504649;

// ==============================================================================
// MODULE 1: LƯU TRỮ (nhẹ) - tokens đồng bộ lên Discord, phần còn lại lưu local
// ==============================================================================
async function purgeChannel(channel) {
    let total = 0;
    for (let i = 0; i < 50; i++) {
        const msgs = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        if (!msgs || msgs.size === 0) break;
        const deleted = await channel.bulkDelete(msgs, true).catch(() => null);
        let removed = deleted ? deleted.size : 0;
        const rest = msgs.filter(m => !deleted || !deleted.has(m.id));
        for (const m of rest.values()) {
            const ok = await m.delete().then(() => true).catch(() => false);
            if (ok) removed++;
        }
        total += removed;
        if (removed === 0) break;
    }
    return total;
}

class DiscordCloudDB {
    constructor() {
        this.channels = {};
        this.store = {};
        for (const t of LOCAL_TABLES) this.store[t] = {};
        this.syncTimers = {};
    }

    _cachePath(table) { return path.join(LOCAL_CACHE_DIR, `${table}.json`); }
    _readLocal(table) {
        try {
            const p = this._cachePath(table);
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {}
        return {};
    }
    _writeLocal(table, data) {
        try { fs.writeFileSync(this._cachePath(table), JSON.stringify(data), 'utf8'); } catch (e) {}
    }

    async init(client) {
        for (const table of LOCAL_TABLES) this.store[table] = this._readLocal(table);

        const guild = await client.guilds.fetch(DB_GUILD_ID).catch(() => null);
        if (!guild) { console.log('[DB] Không thấy server DB, dùng file local.'); return; }

        const allChannels = await guild.channels.fetch().catch(() => null);
        if (!allChannels) return;

        let category = allChannels.find(c => c.type === ChannelType.GuildCategory && c.name === 'BOT-CLOUD-DB');
        if (!category) {
            category = await guild.channels.create({
                name: 'BOT-CLOUD-DB',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }]
            }).catch(() => null);
        }

        // Kênh lưu token
        for (const [table, chName] of Object.entries(CLOUD_TABLES)) {
            let channel = allChannels.find(c => c.type === ChannelType.GuildText && c.name === chName);
            if (!channel && category) {
                channel = await guild.channels.create({
                    name: chName,
                    type: ChannelType.GuildText,
                    parent: category.id
                }).catch(() => null);
            }
            if (channel) {
                this.channels[table] = channel;
                await this._loadFromChannel(table, channel, client);
            }
        }

        // Dọn các kênh cũ (chỉ 1 lần)
        if (!fs.existsSync(PURGE_MARKER)) {
            console.log('[DB] Đang xóa tin nhắn các kênh DB cũ...');
            for (const chName of PURGE_CHANNELS) {
                const ch = allChannels.find(c => c.type === ChannelType.GuildText && c.name === chName);
                if (ch) {
                    const n = await purgeChannel(ch);
                    console.log(`[DB] ${chName}: đã xóa ${n} tin nhắn`);
                }
            }
            for (const f of OLD_LOCAL_FILES) {
                try { fs.unlinkSync(path.join(LOCAL_CACHE_DIR, f)); } catch (e) {}
            }
            try { fs.writeFileSync(PURGE_MARKER, new Date().toISOString()); } catch (e) {}
            console.log('[DB] Dọn dẹp xong.');
        }
    }

    // Đọc được cả bản mới (file đính kèm tokens.json) lẫn bản cũ (khối ```json)
    async _loadFromChannel(table, channel, client) {
        try {
            const messages = await channel.messages.fetch({ limit: 10 });
            const mine = messages.filter(m => m.author.id === client.user.id);
            for (const msg of mine.values()) {
                const att = msg.attachments.find(a => a.name === `${table}.json`);
                if (att) {
                    const res = await axios.get(att.url, { responseType: 'json', timeout: 15000 });
                    if (res.data && typeof res.data === 'object') {
                        this.store[table] = res.data;
                        this._writeLocal(table, res.data);
                        return;
                    }
                }
                const match = msg.content.match(/```json([\s\S]*?)```/);
                if (match) {
                    const parsed = JSON.parse(match[1]);
                    this.store[table] = parsed;
                    this._writeLocal(table, parsed);
                    return;
                }
            }
        } catch (e) {
            console.error('[DB] Lỗi đọc từ kênh:', e.message);
        }
    }

    get(table, key = null) {
        if (!key) return this.store[table] || {};
        return (this.store[table] || {})[String(key)] || null;
    }

    set(table, key, value) {
        if (!this.store[table]) this.store[table] = {};
        this.store[table][String(key)] = value;
        this._writeLocal(table, this.store[table]);
        if (CLOUD_TABLES[table]) this._scheduleFlush(table);
    }

    delete(table, key) {
        if (this.store[table] && this.store[table][String(key)] !== undefined) {
            delete this.store[table][String(key)];
            this._writeLocal(table, this.store[table]);
            if (CLOUD_TABLES[table]) this._scheduleFlush(table);
        }
    }

    _scheduleFlush(table) {
        clearTimeout(this.syncTimers[table]);
        this.syncTimers[table] = setTimeout(() => this.flush(table), 3000);
    }

    // Đẩy lên Discord dạng 1 file đính kèm (không giới hạn 2000 ký tự)
    async flush(table) {
        const channel = this.channels[table];
        if (!channel) return;
        try {
            const buf = Buffer.from(JSON.stringify(this.store[table]), 'utf8');
            const old = await channel.messages.fetch({ limit: 10 });
            const sent = await channel.send({
                content: `📦 ${table} (${Object.keys(this.store[table]).length})`,
                files: [{ attachment: buf, name: `${table}.json` }]
            });
            for (const m of old.values()) {
                if (m.id !== sent.id && m.author.id === channel.client.user.id) {
                    await m.delete().catch(() => {});
                }
            }
        } catch (e) {
            console.error('[DB] Lỗi đồng bộ:', e.message);
        }
    }
}

const db = new DiscordCloudDB();

// ==============================================================================
// MODULE 2: RESOLVE LINK PINTEREST / DIRECT MP4
// ==============================================================================
async function resolveMediaSource(mediaUrl) {
    if (!mediaUrl || !/^https?:\/\//i.test(mediaUrl)) return null;

    if (/pinterest\.com|pin\.it/i.test(mediaUrl)) {
        try {
            const res = await axios.get(mediaUrl, {
                maxRedirects: 5,
                timeout: 10000,
                headers: { 'User-Agent': DEVICE_PROFILES[0].ua }
            });
            const html = String(res.data || '');
            let bestMp4 = null;
            const idx = html.indexOf('.pinimg.com/videos/');
            if (idx !== -1) {
                const start = html.lastIndexOf('https://', idx);
                const end = html.indexOf('.mp4', idx);
                if (start !== -1 && end !== -1) bestMp4 = html.substring(start, end + 4);
            }
            return { type: 'pinterest', streamUrl: bestMp4 };
        } catch (e) {
            return null;
        }
    }

    if (/\.(mp4|webm|mkv|m3u8)(\?.*)?$/i.test(mediaUrl)) {
        return { type: 'direct', streamUrl: mediaUrl };
    }

    return null;
}

// ==============================================================================
// MODULE 3: VOICE STREAMER - mỗi phiên chạy trong 1 tiến trình riêng (stream.js)
// ==============================================================================
async function notifyUser(botClient, userId, text) {
    try {
        const user = await botClient.users.fetch(userId);
        await user.send(text);
    } catch (e) {
        console.error('[Notify] Không DM được user (có thể đang tắt DM):', e.message);
    }
}

function botLeaveVoiceIfIdle(botClient, guildId, exceptUserId) {
    if (!guildId || !botClient) return;
    // Còn người khác đang treo trong cùng server thì bot ở lại
    for (const [uid, s] of activeVoiceStreamers) {
        if (uid !== exceptUserId && s.guildId === guildId) return;
    }
    const guild = botClient.guilds.cache.get(guildId);
    if (!guild) return;
    try {
        guild.shard.send({
            op: 4,
            d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false }
        });
    } catch (e) {}
}

async function stopVoiceStreamer(botClient, userId) {
    const active = activeVoiceStreamers.get(userId);
    if (!active) return false;

    active.stopping = true;
    try { active.child.kill('SIGKILL'); } catch (e) {}

    botLeaveVoiceIfIdle(botClient, active.guildId, userId);

    activeVoiceStreamers.delete(userId);
    db.delete('voice_streams', userId);
    return true;
}

function startVoiceStreamer(botClient, userId, streamerToken, channelId, mediaUrl = '') {
    return new Promise(async (resolve) => {
        if (!channelId || !streamerToken) return resolve({ ok: false, msg: "Thiếu Token hoặc Voice Channel ID!" });
        if (!/^\d{15,22}$/.test(channelId)) return resolve({ ok: false, msg: "Voice Channel ID không hợp lệ (phải toàn số)!" });
        if (!fs.existsSync(STREAM_SCRIPT)) return resolve({ ok: false, msg: "Thiếu file stream.js cạnh file bot! Hãy upload cả 2 file vào cùng thư mục." });

        await stopVoiceStreamer(botClient, userId);

        // Lấy link video thật (nếu có)
        let streamUrl = '';
        let note = '';
        if (mediaUrl) {
            const r = await resolveMediaSource(mediaUrl);
            if (r && r.streamUrl) streamUrl = r.streamUrl;
            else note = '⚠️ Không lấy được video từ link, đang treo màn hình đen.';
        }

        const env = { ...process.env, STREAM_TOKEN: streamerToken, STREAM_CHANNEL_ID: channelId, STREAM_MEDIA_URL: streamUrl };
        delete env.BOT_TOKEN; // tiến trình stream không cần token bot

        const child = fork(STREAM_SCRIPT, [], {
            env,
            stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
            execArgv: ['--max-old-space-size=160']
        });

        const sess = { child, guildId: null, channelId, stopping: false };
        activeVoiceStreamers.set(userId, sess);

        let finished = false;
        let overallTimer;

        const done = async (ok, msg) => {
            if (finished) return;
            finished = true;
            clearTimeout(overallTimer);
            if (!ok) {
                console.error('[VoiceStream] THẤT BẠI:', msg);
                if (activeVoiceStreamers.get(userId) === sess) await stopVoiceStreamer(botClient, userId);
                await notifyUser(botClient, userId, msg);
            }
            resolve({ ok, msg, note });
        };

        overallTimer = setTimeout(() => done(false, '❌ Khởi động stream quá lâu (75s), đã hủy.'), 75000);

        child.on('message', (m) => {
            if (!m || !m.type) return;

            if (m.type === 'channel') {
                sess.guildId = m.guildId;
                // Bot chính vào voice chung (nếu bot có trong server và chưa ở phòng nào)
                const botGuild = botClient.guilds.cache.get(m.guildId);
                if (botGuild) {
                    const cur = botGuild.voiceStates.cache.get(botClient.user.id)?.channelId;
                    if (!cur) {
                        try {
                            botGuild.shard.send({
                                op: 4,
                                d: { guild_id: m.guildId, channel_id: channelId, self_mute: true, self_deaf: true }
                            });
                            console.log(`[BotVoice] Bot chính đã tham gia phòng [${channelId}]`);
                        } catch (err) {
                            console.error('[BotVoice] Lỗi bot tham gia voice:', err);
                        }
                    }
                }
            } else if (m.type === 'ready') {
                done(true, `Đã vào phòng **${m.channelName || channelId}**`);
            } else if (m.type === 'error') {
                done(false, m.text);
            } else if (m.type === 'ended') {
                if (activeVoiceStreamers.get(userId) === sess && !sess.stopping) {
                    stopVoiceStreamer(botClient, userId);
                    notifyUser(botClient, userId, `⚠️ Phiên stream đã dừng bất ngờ: ${m.reason || 'không rõ lý do'}`);
                }
            }
        });

        child.on('exit', (code) => {
            if (sess.stopping) return;
            if (!finished) {
                done(false, `❌ Tiến trình stream bị tắt đột ngột (code ${code}). Có thể hosting hết RAM.`);
            } else if (activeVoiceStreamers.get(userId) === sess) {
                stopVoiceStreamer(botClient, userId);
                notifyUser(botClient, userId, `⚠️ Phiên stream đã dừng bất ngờ (code ${code}). Có thể hosting hết RAM, hãy bật lại.`);
            }
        });

        child.on('error', (err) => {
            done(false, `❌ Không chạy được tiến trình stream: ${err.message}`);
        });
    });
}

// Tắt bot thì tắt luôn các tiến trình stream
function killAllStreams() {
    for (const s of activeVoiceStreamers.values()) {
        try { s.child.kill('SIGKILL'); } catch (e) {}
    }
}
process.on('exit', killAllStreams);
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// ==============================================================================
// MODULE 4: TOKEN & API HELPER
// ==============================================================================
function getSavedToken(userId) { return db.get('tokens', userId); }
function saveToken(userId, token) { db.set('tokens', userId, token.trim()); }

async function fetchLatestBuildNumber() {
    try {
        const res = await axios.get('https://discord.com/app', { headers: { 'User-Agent': DEVICE_PROFILES[0].ua } });
        const m = res.data.match(/buildNumber["\s:]+["\s]*(\d{5,7})/);
        if (m) cachedBuildNumber = parseInt(m[1], 10);
    } catch (e) {}
    return cachedBuildNumber;
}

function makeSuperProperties(profile) {
    return Buffer.from(JSON.stringify({
        os: profile.os, browser: profile.browser, release_channel: "stable",
        client_version: profile.client_version, os_version: profile.os_version,
        system_locale: "vi-VN", client_build_number: cachedBuildNumber || 59498, native_build_number: 59498
    })).toString('base64');
}

class DiscordUserAPI {
    constructor(token) {
        this.profile = DEVICE_PROFILES[0];
        this.client = axios.create({
            baseURL: API_BASE, timeout: 15000,
            headers: {
                "Authorization": token, "Content-Type": "application/json",
                "User-Agent": this.profile.ua,
                "X-Super-Properties": makeSuperProperties(this.profile)
            },
            validateStatus: () => true
        });
    }
    async post(url, data = {}) { return this.client.post(url, data); }
}

// ==============================================================================
// MODULE 5: GIAO DIỆN COMPONENTS V2
// ==============================================================================
function buildDashboard(avatarUrl) {
    const thumb = process.env.THUMBNAIL_URL || avatarUrl || DEFAULT_THUMBNAIL;
    return [
        {
            type: 17,
            accent_color: 0x9B59FF,
            components: [
                {
                    type: 9,
                    components: [
                        {
                            type: 10,
                            content:
                                "# KS BADGE\n" +
                                "**Stream Anti-Ban  •  HypeSquad**\n" +
                                "-# Chọn chức năng bên dưới để bắt đầu"
                        }
                    ],
                    accessory: { type: 11, media: { url: thumb } }
                },
                { type: 14, divider: true, spacing: 2 },
                {
                    type: 10,
                    content: "### 🎥 Stream Voice\n-# Treo live trong phòng voice, màn hình đen hoặc video loop"
                },
                {
                    type: 1,
                    components: [
                        { type: 2, style: 3, label: "Bắt đầu Stream", emoji: { name: "▶️" }, custom_id: "v2:all:voice_stream" },
                        { type: 2, style: 4, label: "Dừng Live", emoji: { name: "⏹️" }, custom_id: "v2:all:stop_stream" }
                    ]
                },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 10,
                    content: "### 🛡️ Tài khoản\n-# Đổi nhà HypeSquad và lưu token"
                },
                {
                    type: 1,
                    components: [
                        { type: 2, style: 1, label: "Đổi HypeSquad", emoji: { name: "🛡️" }, custom_id: "v2:all:hypesquad" },
                        { type: 2, style: 2, label: "Lưu Token", emoji: { name: "🔐" }, custom_id: "v2:all:token" }
                    ]
                }
            ]
        }
    ];
}

// ==============================================================================
// MODULE 6: KHỞI TẠO BOT & SLASH COMMANDS (đã giảm intents + cache để nhẹ RAM)
// ==============================================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ],
    makeCache: Options.cacheWithLimits({
        ...(Options.DefaultMakeCacheSettings || {}),
        MessageManager: 0,
        PresenceManager: 0,
        ReactionManager: 0,
        ThreadManager: 0
    })
});

// Nếu discord.js của bạn cũ hơn v14.22 thì đổi 'clientReady' thành 'ready'
client.once('clientReady', async () => {
    console.log(`[+] Bot đã đăng nhập: ${client.user.tag}`);
    await fetchLatestBuildNumber();
    await db.init(client);

    const commands = [
        new SlashCommandBuilder()
            .setName('setup_menu')
            .setDescription('[ADMIN] Gửi bảng điều khiển Stream & HypeSquad')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        new SlashCommandBuilder()
            .setName('dung_live')
            .setDescription('[STREAM] Dừng phiên Stream Share Voice & rời phòng voice ngay lập tức')
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || client.user.id), { body: commands }).catch(console.error);
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const uid = interaction.user.id;

            if (interaction.commandName === 'setup_menu') {
                await interaction.channel.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: buildDashboard(client.user.displayAvatarURL({ size: 256, extension: 'png' }))
                });
                return interaction.reply({ content: "✅ Đã gửi bảng menu Stream & HypeSquad thành công!", flags: MessageFlags.Ephemeral });
            }

            if (interaction.commandName === 'dung_live') {
                const stopped = await stopVoiceStreamer(client, uid);
                if (stopped) {
                    return interaction.reply({ content: "⏹️ **Đã dừng phiên Stream Share Voice** và cho Bot + Tài khoản rời phòng voice an toàn!", flags: MessageFlags.Ephemeral });
                } else {
                    return interaction.reply({ content: "ℹ️ Bạn hiện không có phiên Stream Voice nào đang chạy.", flags: MessageFlags.Ephemeral });
                }
            }
        }

        if (interaction.isButton()) {
            const [, , action] = interaction.customId.split(':');
            const uid = interaction.user.id;

            if (action === 'voice_stream') {
                const modal = new ModalBuilder().setCustomId('modal:voice_stream_config').setTitle('Stream Voice Anti-Ban & Loop');
                const savedToken = getSavedToken(uid) || '';
                const savedV = db.get('voice_streams', uid) || {};
                const memberVoiceChannelId = interaction.member?.voice?.channelId || savedV.channelId || '';

                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('streamer_token')
                            .setLabel('Token Streamer *')
                            .setValue(savedToken)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('channel_id')
                            .setLabel('Voice Channel ID (Tự điền nếu đang ở Voice) *')
                            .setValue(memberVoiceChannelId)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(true)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('media_url')
                            .setLabel('Link Video Pinterest / MP4 Loop (Tùy chọn)')
                            .setPlaceholder('Dán link Pinterest hoặc bỏ trống để treo màn hình đen...')
                            .setValue(savedV.mediaUrl || '')
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    )
                );
                return interaction.showModal(modal);
            }

            if (action === 'stop_stream') {
                const stopped = await stopVoiceStreamer(client, uid);
                if (stopped) {
                    return interaction.reply({ content: "⏹️ **Đã tắt Live Share Màn Hình** và cho Bot + Tài khoản rời khỏi Voice Channel!", flags: MessageFlags.Ephemeral });
                } else {
                    return interaction.reply({ content: "ℹ️ Hiện tại bạn chưa bật phiên Live nào.", flags: MessageFlags.Ephemeral });
                }
            }

            if (action === 'token') {
                const modal = new ModalBuilder().setCustomId('modal:token').setTitle('🔐 LƯU USER TOKEN');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('token_val').setLabel('User Token Discord').setStyle(TextInputStyle.Short).setRequired(true)
                    )
                );
                return interaction.showModal(modal);
            }

            if (action === 'hypesquad') {
                const embed = new EmbedBuilder()
                    .setTitle("🏡 CHỌN NHÀ HYPESQUAD CHÍNH HÃNG")
                    .setDescription("Chọn nhà HypeSquad bạn muốn gia nhập bên dưới:")
                    .setColor(0x2B2D31)
                    .setThumbnail("https://images.credly.com/images/13c33971-8bc7-438e-8a22-c397500b4111/hypesquad_brilliance.png");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`hs:1:${uid}`).setLabel("Bravery (Dũng cảm)").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`hs:2:${uid}`).setLabel("Brilliance (Sáng suốt)").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`hs:3:${uid}`).setLabel("Balance (Cân bằng)").setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
            }
        }

        if (interaction.isModalSubmit()) {
            const uid = interaction.user.id;

            if (interaction.customId === 'modal:token') {
                const token = interaction.fields.getTextInputValue('token_val').trim();
                saveToken(uid, token);
                return interaction.reply({ content: "✅ Đã lưu User Token thành công!", flags: MessageFlags.Ephemeral });
            }

            if (interaction.customId === 'modal:voice_stream_config') {
                const token = interaction.fields.getTextInputValue('streamer_token').trim();
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();
                const mediaUrl = interaction.fields.getTextInputValue('media_url').trim();

                saveToken(uid, token);
                // Không lưu token vào voice_streams nữa (đã có trong bảng tokens)
                db.set('voice_streams', uid, { channelId, mediaUrl });

                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const res = await startVoiceStreamer(client, uid, token, channelId, mediaUrl);

                if (res.ok) {
                    const stopRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('v2:all:stop_stream')
                            .setLabel('⏹️ Dừng Live Ngay')
                            .setStyle(ButtonStyle.Secondary)
                    );
                    return interaction.followUp({
                        content: `🚀 **Đã bật Stream Share Voice!**\n• **Phòng Voice:** <#${channelId}>\n• **Chế độ phát:** ${mediaUrl && !res.note ? '🔁 Loop Link' : '⬛ Màn hình đen'}${res.note ? `\n${res.note}` : ''}`,
                        components: [stopRow],
                        flags: MessageFlags.Ephemeral
                    });
                } else {
                    return interaction.followUp({
                        content: `❌ **Không thể khởi động Stream:**\n${res.msg}`,
                        flags: MessageFlags.Ephemeral
                    });
                }
            }
        }

        if (interaction.isButton() && interaction.customId.startsWith('hs:')) {
            const [, houseIdStr, ownerId] = interaction.customId.split(':');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ Không phải bảng của bạn.", flags: MessageFlags.Ephemeral });
            const token = getSavedToken(ownerId);
            if (!token) return interaction.reply({ content: "❌ Bạn chưa lưu Token trên hệ thống! Vui lòng bấm 'Lưu Token' trước.", flags: MessageFlags.Ephemeral });

            const houseId = parseInt(houseIdStr, 10);
            const houseInfo = HYPESQUAD_BADGES[houseId];
            const api = new DiscordUserAPI(token);

            const res = await api.post('/hypesquad/online', { house_id: houseId });
            if (res.status === 204 || res.status === 200) {
                const successEmbed = new EmbedBuilder()
                    .setTitle(`🎉 Đã gia nhập thành công ${houseInfo.name}!`)
                    .setDescription(`Huy hiệu của bạn đã được cập nhật.\n*Mô tả:* ${houseInfo.desc}`)
                    .setImage(houseInfo.badgeUrl)
                    .setColor(0x2B2D31);
                return interaction.update({ embeds: [successEmbed], components: [] });
            } else {
                return interaction.update({ content: "❌ Token không hợp lệ hoặc lỗi khi đổi nhà HypeSquad.", embeds: [], components: [] });
            }
        }
    } catch (e) {
        console.error(e);
    }
});

client.login(process.env.BOT_TOKEN);
