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

// File cache cục bộ (đồng bộ 2 chiều với kênh trên Discord DB Server)
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
    },
    {
        os: "Windows", os_version: "10.0.22631", os_arch: "x64", app_arch: "x64",
        browser: "Discord Client", client_version: "1.0.9168", browser_version: "32.2.5", native_build_number: 59210,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9168 Chrome/128.0.6613.162 Electron/32.2.5 Safari/537.36"
    },
    {
        os: "Windows", os_version: "10", os_arch: "x64", app_arch: "x64",
        browser: "Chrome", client_version: "130.0.0.0", browser_version: "130.0.0.0", native_build_number: 59498,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    },
    {
        os: "Mac OS X", os_version: "15.1.0", os_arch: "arm64", app_arch: "arm64",
        browser: "Discord Client", client_version: "1.0.9175", browser_version: "32.2.7", native_build_number: 59498,
        ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36"
    },
    {
        os: "Linux", os_version: "6.8.0-45-generic", os_arch: "x64", app_arch: "x64",
        browser: "Discord Client", client_version: "0.0.72", browser_version: "32.2.7", native_build_number: 59498,
        ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) discord/0.0.72 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36"
    }
];

const HYPESQUAD_HOUSES = {
    1: { name: "HypeSquad Bravery", emoji: "<:hypesquad_2:1571114614975107144>", desc: "Dũng cảm & Nhiệt huyết" },
    2: { name: "HypeSquad Brilliance", emoji: "<:hypesquad_1:1571114521601245224>", desc: "Sáng suốt & Kỷ luật" },
    3: { name: "HypeSquad Balance", emoji: "<:hypesquad:1571114469130633316>", desc: "Cân bằng & Hài hòa" }
};

const activeQuests = new Map();
const activeGameSessions = new Map();
const activeVoiceStreamers = new Map(); // Quản lý tiến trình stream voice share màn hình
let cachedBuildNumber = 504649;

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const randRange = (min, max) => Math.random() * (max - min) + min;

// ==============================================================================
// MODULE 1: DISCORD CLOUD DATABASE (TỰ TẠO KÊNH & ĐỒNG BỘ DỮ LIỆU SERVER)
// ==============================================================================
class DiscordCloudDB {
    constructor() {
        this.channels = {};
        this.store = {
            tokens: {},
            fingerprints: {},
            sessions: {},
            setups: {},
            voice_streams: {}
        };
        this.syncTimers = {};
    }

    _cachePath(table) {
        return path.join(LOCAL_CACHE_DIR, `${table}.json`);
    }

    _readLocal(table) {
        try {
            const p = this._cachePath(table);
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {}
        return {};
    }

    _writeLocal(table, data) {
        try {
            fs.writeFileSync(this._cachePath(table), JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {}
    }

    // Thay thế đoạn phương thức init trong class DiscordCloudDB bằng đoạn code này để hiện thông báo lỗi chi tiết nếu thiếu quyền:

    async init(client) {
        for (const table of Object.keys(DB_CHANNELS_SPEC)) {
            this.store[table] = this._readLocal(table);
        }

        const guild = await client.guilds.fetch(DB_GUILD_ID).catch((err) => {
            console.error(`[-] Không thể truy cập Server lưu trữ ID: ${DB_GUILD_ID}. Lỗi:`, err.message);
            return null;
        });
        if (!guild) return;

        console.log(`[CloudDB] Đã kết nối Server lưu trữ: ${guild.name} (${guild.id})`);
        
        let allChannels;
        try {
            allChannels = await guild.channels.fetch();
        } catch (err) {
            console.error(`[-] Bot không có quyền đọc danh sách kênh trên server DB! Hãy cấp quyền Administrator cho bot tại server DB.`);
            return;
        }

        let category = allChannels.find(c => c.type === ChannelType.GuildCategory && c.name === 'BOT-CLOUD-DB');
        if (!category) {
            try {
                category = await guild.channels.create({
                    name: 'BOT-CLOUD-DB',
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }
                    ]
                });
                console.log(`[CloudDB] Đã tạo thành công danh mục bảo mật: BOT-CLOUD-DB`);
            } catch (err) {
                console.error(`[-] Lỗi khi tạo danh mục BOT-CLOUD-DB (Kiểm tra lại quyền Quản lý Kênh của bot):`, err.message);
                return;
            }
        }

        for (const [table, chName] of Object.entries(DB_CHANNELS_SPEC)) {
            let channel = allChannels.find(c => c.type === ChannelType.GuildText && c.name === chName);
            if (!channel) {
                try {
                    channel = await guild.channels.create({
                        name: chName,
                        type: ChannelType.GuildText,
                        parent: category.id,
                        topic: `Hệ thống lưu trữ tự động bảng [${table}] - Không xóa thủ công!`
                    });
                    console.log(`[CloudDB] Đã khởi tạo thành công kênh lưu trữ: #${chName}`);
                } catch (e) {
                    console.error(`[-] Không thể tạo kênh #${chName}:`, e.message);
                }
            }
            if (channel) {
                this.channels[table] = channel;
                await this._loadFromChannel(table, channel);
            }
        }
    }

    async _loadFromChannel(table, channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            const sorted = [...messages.values()].reverse();
            const merged = { ...this.store[table] };

            for (const msg of sorted) {
                let raw = msg.content || '';
                const codeMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
                if (codeMatch) raw = codeMatch[1];

                if (msg.attachments.size > 0) {
                    const att = msg.attachments.first();
                    if (att && att.name.endsWith('.json')) {
                        const res = await axios.get(att.url, { timeout: 10000 }).catch(() => null);
                        if (res && typeof res.data === 'object') {
                            Object.assign(merged, res.data);
                            continue;
                        }
                    }
                }

                if (raw.trim().startsWith('{')) {
                    try {
                        const parsed = JSON.parse(raw.trim());
                        Object.assign(merged, parsed);
                    } catch (e) {}
                }
            }

            this.store[table] = merged;
            this._writeLocal(table, merged);
            console.log(`[CloudDB] Đã khôi phục ${Object.keys(merged).length} bản ghi từ #${channel.name}`);
        } catch (err) {
            console.error(`[CloudDB] Lỗi đọc kênh #${channel.name}:`, err.message);
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
        this._scheduleFlush(table);
    }

    delete(table, key) {
        if (this.store[table] && this.store[table][String(key)] !== undefined) {
            delete this.store[table][String(key)];
            this._writeLocal(table, this.store[table]);
            this._scheduleFlush(table);
        }
    }

    _scheduleFlush(table) {
        clearTimeout(this.syncTimers[table]);
        this.syncTimers[table] = setTimeout(() => this.flush(table), 2500);
    }

    async flush(table) {
        const channel = this.channels[table];
        if (!channel) return;
        try {
            const payloadStr = JSON.stringify(this.store[table], null, 2);
            const oldMsgs = await channel.messages.fetch({ limit: 10 }).catch(() => null);

            if (payloadStr.length <= 1900) {
                const content = `\`\`\`json\n${payloadStr}\n\`\`\``;
                const lastBotMsg = oldMsgs?.find(m => m.author.id === channel.client.user.id);
                if (lastBotMsg) {
                    await lastBotMsg.edit({ content, files: [] });
                } else {
                    await channel.send({ content });
                }
            } else {
                const buf = Buffer.from(payloadStr, 'utf8');
                if (oldMsgs && oldMsgs.size > 0) {
                    await channel.bulkDelete(oldMsgs).catch(() => {});
                }
                await channel.send({
                    content: `📦 **Backup ${table}** (${Object.keys(this.store[table]).length} mục) — ${new Date().toLocaleString('vi-VN')}`,
                    files: [{ attachment: buf, name: `${table}.json` }]
                });
            }
        } catch (err) {
            console.error(`[CloudDB] Lỗi đồng bộ bảng ${table}:`, err.message);
        }
    }
}

const db = new DiscordCloudDB();

// ==============================================================================
// VOICE STREAM MANAGER (Treo Voice + Mute Mic + Stream Màn hình thật qua UDP)
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
                await streamer.joinVoice(guildId, channelId);

                // Khóa cứng Mic (Mute) an toàn tuyệt đối, chống lộ giọng
                await selfClient.ws.broadcast({
                    op: 4,
                    d: {
                        guild_id: guildId,
                        channel_id: channelId,
                        self_mute: true,
                        self_deaf: false
                    }
                });

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
                console.log(`[VoiceStream] Đã bật thành công luồng stream màn hình vào Voice Channel [${channelId}]!`);
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
// HÀM TIỆN ÍCH TOKEN, FINGERPRINT & PINTEREST PARSER
// ==============================================================================
function getSavedToken(userId) {
    return db.get('tokens', userId);
}

function saveToken(userId, token) {
    db.set('tokens', userId, token.trim());
}

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
    if (savedIdx !== null && DEVICE_PROFILES[savedIdx]) {
        return DEVICE_PROFILES[savedIdx];
    }
    const idx = Math.floor(Math.random() * DEVICE_PROFILES.length);
    db.set('fingerprints', userId, idx);
    return DEVICE_PROFILES[idx];
}

async function resolvePinterestVideo(pinUrl) {
    if (!pinUrl || !/^https?:\/\//i.test(pinUrl)) return null;
    try {
        const res = await axios.get(pinUrl, {
            maxRedirects: 5,
            timeout: 12000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8'
            }
        });
        const html = String(res.data || '');
        const finalUrl = res.request?.res?.responseUrl || pinUrl;

        const titleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)
            || html.match(/<title>([^<]+)<\/title>/i);
        let title = titleMatch ? titleMatch[1].replace(/\s*\|\s*Pinterest.*$/i, '').trim() : 'Pinterest Video Stream';
        if (!title) title = 'Pinterest Video Loop';

        const mp4Matches = html.match(/https:\/\/v\d*\.pinimg\.com\/videos\/[^"'\s\\]+\.mp4/gi) || [];
        const bestMp4 = mp4Matches.find(u => u.includes('720p')) || mp4Matches[0] || null;

        const imgMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i);
        const thumbnail = imgMatch ? imgMatch[1] : null;

        return {
            sourceUrl: finalUrl,
            videoUrl: bestMp4,
            thumbnail,
            title: title.slice(0, 100)
        };
    } catch (e) {
        return {
            sourceUrl: pinUrl,
            videoUrl: null,
            thumbnail: null,
            title: 'Pinterest Live Stream'
        };
    }
}

async function fetchLatestBuildNumber() {
    try {
        const ua = DEVICE_PROFILES[0].ua;
        const res = await axios.get('https://discord.com/app', { headers: { 'User-Agent': ua }, timeout: 10000 });
        const matches = [...res.data.matchAll(/\/assets\/([a-f0-9]+)\.js/g)].map(m => m[1]);
        for (const hash of matches.slice(-5)) {
            try {
                const jsRes = await axios.get(`https://discord.com/assets/${hash}.js`, { headers: { 'User-Agent': ua }, timeout: 10000 });
                const m = jsRes.data.match(/buildNumber["\s:]+["\s]*(\d{5,7})/);
                if (m) {
                    cachedBuildNumber = parseInt(m[1], 10);
                    return cachedBuildNumber;
                }
            } catch (e) {}
        }
    } catch (e) {}
    return cachedBuildNumber;
}

function makeSuperProperties(profile) {
    const obj = {
        os: profile.os,
        browser: profile.browser,
        release_channel: "stable",
        client_version: profile.client_version,
        os_version: profile.os_version,
        os_arch: profile.os_arch,
        app_arch: profile.app_arch,
        system_locale: "vi-VN",
        browser_user_agent: profile.ua,
        browser_version: profile.browser_version,
        client_build_number: cachedBuildNumber || profile.native_build_number,
        native_build_number: profile.native_build_number,
        client_event_source: null
    };
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

class DiscordUserAPI {
    constructor(token, userId) {
        this.token = token;
        this.profile = getUserDeviceProfile(userId);
        this.client = axios.create({
            baseURL: API_BASE,
            timeout: 15000,
            headers: {
                "Authorization": token,
                "Content-Type": "application/json",
                "Accept": "*/*",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
                "User-Agent": this.profile.ua,
                "X-Super-Properties": makeSuperProperties(this.profile),
                "X-Discord-Locale": "vi",
                "X-Discord-Timezone": "Asia/Ho_Chi_Minh",
                "Origin": "https://discord.com",
                "Referer": "https://discord.com/channels/@me"
            },
            validateStatus: () => true
        });
    }

    async get(url) { return this.client.get(url); }
    async post(url, data = {}) { return this.client.post(url, data); }
}

// ==============================================================================
// MODULE 2: QUEST PARSERS
// ==============================================================================
function getTaskConfig(q) {
    const cfg = q?.config || {};
    return cfg.taskConfig || cfg.task_config || cfg.taskConfigV2 || cfg.task_config_v2 || null;
}

function getQuestName(q) {
    const cfg = q?.config || {};
    const msgs = cfg.messages || {};
    return (msgs.questName || msgs.quest_name || msgs.gameTitle || msgs.game_title || cfg.application?.name || `Quest#${q.id}`).trim();
}

function isCompletable(q) {
    const expires = q?.config?.expiresAt || q?.config?.expires_at;
    if (expires && new Date(expires) <= new Date()) return false;
    const tc = getTaskConfig(q);
    if (!tc || !tc.tasks) return false;
    return SUPPORTED_TASKS.some(t => tc.tasks[t] != null);
}

function isEnrolled(q) {
    const us = q?.userStatus || q?.user_status || {};
    return Boolean(us.enrolledAt || us.enrolled_at);
}

function isCompleted(q) {
    const us = q?.userStatus || q?.user_status || {};
    return Boolean(us.completedAt || us.completed_at);
}

function getTaskType(q) {
    const tc = getTaskConfig(q);
    if (!tc || !tc.tasks) return null;
    return SUPPORTED_TASKS.find(t => tc.tasks[t] != null) || null;
}

function getSecondsNeeded(q) {
    const tc = getTaskConfig(q);
    const t = getTaskType(q);
    return (tc && t && tc.tasks[t]?.target) ? tc.tasks[t].target : 0;
}

function getSecondsDone(q) {
    const t = getTaskType(q);
    const us = q?.userStatus || q?.user_status || {};
    return (t && us.progress?.[t]?.value) ? us.progress[t].value : 0;
}

function parseQuestOrbs(q) {
    const cfg = q?.config || {};
    const rwCfg = cfg.rewardsConfig || cfg.rewards_config || {};
    const rewards = rwCfg.rewards || cfg.rewards || [];
    for (const rw of rewards) {
        if (rw.orb_quantity) return rw.orb_quantity;
        if (rw.amount && [0, "ORBS", "ORB"].includes(rw.type)) return rw.amount;
        const rName = String(rw.messages?.name || rw.messages?.title || "");
        const nums = rName.match(/\d+/);
        if (nums && (rName.toLowerCase().includes("orb") || rw.type === 0)) return parseInt(nums[0], 10);
    }
    const t = getTaskType(q);
    return ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"].includes(t) ? 200 : 700;
}

// ==============================================================================
// MODULE 3: BADGE & MULTI-GAME FARMER (30S SPAM 100 GAME + TREO 5000H + STREAM PIN)
// ==============================================================================
class BadgeFarmSession {
    constructor(userId, token, options = {}) {
        this.userId = userId;
        this.token = token;
        this.profile = getUserDeviceProfile(userId);
        this.maxGames = Math.max(1, Math.min(options.maxGames || 100, 100, PC_GAMES_110.length));
        this.targetHours = Math.max(1, Math.min(options.targetHours || 5000, 5000));
        this.startTime = options.startTime || Date.now();

        this.streamEnabled = Boolean(options.streamEnabled);
        this.pinUrl = options.pinUrl || '';
        this.pinData = options.pinData || null;
        this.loopCount = options.loopCount || 0;

        this.isRunning = true;
        this.isPaused = false;
        this.phase = "⚡ Giai đoạn 1: Quét nhanh 100 game (30s)";
        this.activeGamesList = [];
        this.gamesRotated = options.gamesRotated || 0;
        this.uniqueScanned = new Set();

        this.ws = null;
        this._hbTimer = null;
        this._rotTimer = null;
        this._loopTimer = null;
        this._mySid = null;
        this._seq = null;
    }

    toJSON() {
        return {
            maxGames: this.maxGames,
            targetHours: this.targetHours,
            startTime: this.startTime,
            streamEnabled: this.streamEnabled,
            pinUrl: this.pinUrl,
            pinData: this.pinData,
            gamesRotated: this.gamesRotated,
            loopCount: this.loopCount,
            active: this.isRunning
        };
    }

    saveState() {
        if (this.isRunning) {
            db.set('sessions', this.userId, this.toJSON());
        } else {
            db.delete('sessions', this.userId);
        }
    }

    toggleStream(enable, pinUrl = null, pinData = null) {
        this.streamEnabled = enable;
        if (pinUrl !== null) this.pinUrl = pinUrl;
        if (pinData !== null) this.pinData = pinData;
        this.saveState();
        this.sendMultiPresence(this.activeGamesList);
    }

    sendMultiPresence(gamesList) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const activities = [];
        const now = Date.now();

        if (this.streamEnabled) {
            const streamTitle = this.pinData?.title || "Pinterest Video Loop 24/7";
            const streamLink = this.pinData?.sourceUrl || this.pinUrl || "https://www.twitch.tv/discord";
            const validTwitchUrl = /^https?:\/\/(www\.)?(twitch\.tv|youtube\.com)\//i.test(streamLink)
                ? streamLink
                : "https://www.twitch.tv/pinterest_live";

            activities.push({
                name: streamTitle,
                type: 1,
                url: validTwitchUrl,
                details: this.pinUrl ? `🔁 Loop Pin #${this.loopCount + 1}` : "🔴 Đang phát trực tiếp 24/7",
                state: this.pinData?.videoUrl ? `MP4: ${this.pinData.videoUrl.slice(0, 60)}...` : (this.pinUrl || "Đang treo Stream"),
                timestamps: { start: now }
            });
        }

        if (gamesList && gamesList.length > 0) {
            for (const g of gamesList) {
                activities.push({
                    name: g,
                    type: 0,
                    timestamps: { start: this.startTime }
                });
            }
        }

        const payload = {
            op: 3,
            d: {
                since: activities.length === 0 ? now : null,
                activities,
                status: "online",
                afk: false
            }
        };
        try { this.ws.send(JSON.stringify(payload)); } catch (e) {}
    }

    async _runRapid30sBurst() {
        this.phase = "⚡ Giai đoạn 1: Đang spam quét đủ 100 game (30s)...";
        const pool = [...PC_GAMES_110.slice(0, this.maxGames)];
        const batchSize = 5;
        const totalBatches = Math.ceil(pool.length / batchSize);
        const intervalMs = Math.max(250, Math.floor(29000 / Math.max(totalBatches, 1)));

        for (let i = 0; i < pool.length; i += batchSize) {
            if (!this.isRunning || this.isPaused) break;
            const batch = pool.slice(i, i + batchSize);
            batch.forEach(g => this.uniqueScanned.add(g));
            this.activeGamesList = batch;
            this.gamesRotated += batch.length;
            this.sendMultiPresence(batch);
            await sleep(intervalMs);
        }
    }

    _startContinuousMultiGameLoop() {
        this.phase = "🔥 Giai đoạn 2: Treo Multi-Game liên tục (5000h)";
        const pickBatch = () => {
            const shuffled = [...PC_GAMES_110.slice(0, this.maxGames)].sort(() => Math.random() - 0.5);
            const selected = shuffled.slice(0, Math.min(8, shuffled.length));
            selected.forEach(g => this.uniqueScanned.add(g));
            this.activeGamesList = selected;
            this.gamesRotated += selected.length;
            return selected;
        };

        if (!this.isPaused) {
            this.sendMultiPresence(pickBatch());
        }

        clearInterval(this._rotTimer);
        this._rotTimer = setInterval(() => {
            if (!this.isRunning) return;
            if ((Date.now() - this.startTime) >= this.targetHours * 3600 * 1000) {
                this.stop();
                return;
            }
            if (!this.isPaused) {
                this.sendMultiPresence(pickBatch());
                this.saveState();
            }
        }, 60 * 1000);

        clearInterval(this._loopTimer);
        this._loopTimer = setInterval(() => {
            if (this.isRunning && this.streamEnabled && !this.isPaused) {
                this.loopCount += 1;
                this.sendMultiPresence(this.activeGamesList);
            }
        }, 45 * 1000);
    }

    start() {
        if (!this.isRunning) return;
        if ((Date.now() - this.startTime) >= this.targetHours * 3600 * 1000) {
            this.stop();
            return;
        }

        this.saveState();
        const ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");
        this.ws = ws;

        ws.on('message', async (raw) => {
            if (!this.isRunning) return;
            let data;
            try { data = JSON.parse(raw); } catch (e) { return; }
            if (data.s) this._seq = data.s;

            if (data.op === 10) {
                const hbInterval = data.d.heartbeat_interval;
                ws.send(JSON.stringify({
                    op: 2,
                    d: {
                        token: this.token,
                        properties: {
                            os: this.profile.os,
                            browser: this.profile.browser,
                            device: ""
                        },
                        presence: { status: "online", activities: [], afk: false }
                    }
                }));

                clearInterval(this._hbTimer);
                this._hbTimer = setInterval(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ op: 1, d: this._seq }));
                    }
                }, hbInterval);
            } else if (data.op === 7 || data.op === 9) {
                ws.close();
            } else if (data.t === "READY") {
                this._mySid = data.d?.session_id;
                await this._runRapid30sBurst();
                if (this.isRunning) {
                    this._startContinuousMultiGameLoop();
                }
            } else if (data.t === "SESSIONS_REPLACE") {
                const sessions = data.d || [];
                const realActive = sessions.some(s => ["online", "idle", "dnd"].includes(s.status) && s.session_id !== this._mySid);
                if (realActive && !this.isPaused) {
                    this.isPaused = true;
                    this.sendMultiPresence([]);
                } else if (!realActive && this.isPaused) {
                    this.isPaused = false;
                    this.sendMultiPresence(this.activeGamesList);
                }
            }
        });

        ws.on('close', (code) => {
            clearInterval(this._hbTimer);
            clearInterval(this._rotTimer);
            clearInterval(this._loopTimer);
            if (code === 4004) {
                removeToken(this.userId);
                this.isRunning = false;
                activeGameSessions.delete(this.userId);
                return;
            }
            if (this.isRunning) {
                setTimeout(() => this.start(), Math.floor(randRange(5000, 10000)));
            }
        });

        ws.on('error', () => {});
    }

    stop() {
        this.isRunning = false;
        clearInterval(this._hbTimer);
        clearInterval(this._rotTimer);
        clearInterval(this._loopTimer);
        db.delete('sessions', this.userId);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            try { this.ws.close(1000); } catch (e) {}
        }
    }
}

// ==============================================================================
// MODULE 4: AUTO-QUEST / CÀY ORB TRỰC QUAN (COMPONENTS V2 DASHBOARD)
// ==============================================================================
function buildOrbQuestComponentsV2(userId) {
    const data = activeQuests.get(userId);
    if (!data) {
        return [
            {
                type: 17,
                accent_color: 0xED4245,
                components: [
                    {
                        type: 10,
                        content: "## 🛡️ TRẠM CÀY ORB & QUEST\nHiện tại bạn **không có tiến trình cày Orb/Quest** nào đang chạy."
                    }
                ]
            }
        ];
    }

    const quests = data.quests;
    const total = quests.length;
    const completed = quests.filter(q => q.done_seconds >= q.duration).length;
    const earnedOrbs = quests.reduce((sum, q) => {
        const ratio = Math.min(q.done_seconds, q.duration) / Math.max(q.duration, 1);
        return sum + Math.floor(q.orb * ratio);
    }, 0);

    const avgProgress = total > 0
        ? Math.floor(quests.reduce((acc, q) => acc + (Math.min(q.done_seconds, q.duration) / Math.max(q.duration, 1)) * 100, 0) / total)
        : 0;
    const mainBar = "▰".repeat(Math.floor(avgProgress / 10)) + "▱".repeat(10 - Math.floor(avgProgress / 10));

    const questLines = quests.map((q, idx) => {
        const icon = String(q.type).includes("VIDEO") ? "🎬" : "🎮";
        const dur = Math.max(q.duration, 1);
        const done = Math.min(q.done_seconds, dur);
        const pct = Math.min(100, Math.floor((done / dur) * 100));
        const subBar = "█".repeat(Math.floor(pct / 12.5)) + "░".repeat(8 - Math.floor(pct / 12.5));

        const remSec = Math.max(0, dur - done);
        const remM = Math.floor(remSec / 60), remS = Math.floor(remSec % 60);
        const statusIcon = done >= dur ? "✅" : "⚡";

        return `${statusIcon} **#${idx + 1} ${q.title.slice(0, 28)}** • 🔮 **+${q.orb} Orbs**\n` +
               `╰ ${icon} \`[${subBar}]\` **${pct}%** • Còn lại: \`${remM}p${String(remS).padStart(2, '0')}s\``;
    }).join("\n\n");

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
                            content:
                                `## 🔮 TRẠM CÀY ORB & QUEST TRỰC QUAN\n` +
                                `👤 **Tài khoản:** \`${data.userName}\`\n` +
                                `💎 **Orb thu hoạch:** \`${earnedOrbs} / ${data.totalOrbs} Orbs\`\n` +
                                `📊 **Tổng tiến độ:** \`[${mainBar}]\` **${avgProgress}%** (${completed}/${total} xong)`
                        }
                    ],
                    accessory: {
                        type: 11,
                        media: { url: DEFAULT_THUMBNAIL }
                    }
                },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 10,
                    content: questLines || "Đang đồng bộ danh sách nhiệm vụ..."
                },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: 2,
                            label: "Làm mới tiến độ",
                            emoji: { name: "🔄" },
                            custom_id: `qctrl:refresh:${userId}`
                        },
                        {
                            type: 2,
                            style: 4,
                            label: "Dừng cày Orb",
                            emoji: { name: "🛑" },
                            custom_id: `qctrl:cancel:${userId}`
                        }
                    ]
                }
            ]
        }
    ];
}

async function runSingleQuestAsync(pQuest, api, userId) {
    const qid = pQuest.id;
    const taskType = pQuest.type;
    const secondsNeeded = pQuest.duration;
    let secondsDone = pQuest.done_seconds;

    if (["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE"].includes(taskType)) {
        const speed = randRange(5.5, 7.5);
        while (secondsDone < secondsNeeded && activeQuests.has(userId)) {
            const timestamp = secondsDone + speed;
            const r = await api.post(`/quests/${qid}/video-progress`, {
                timestamp: Math.min(secondsNeeded, timestamp + randRange(0.1, 0.9))
            });

            if (r.status === 401) {
                removeToken(userId);
                activeQuests.delete(userId);
                return;
            } else if (r.status === 200) {
                if (r.data?.completed_at) {
                    pQuest.done_seconds = secondsNeeded;
                    return;
                }
                secondsDone = Math.min(secondsNeeded, timestamp);
                pQuest.done_seconds = secondsDone;
            } else if (r.status === 429) {
                const retry = r.data?.retry_after || 5;
                await sleep((retry + randRange(2, 4)) * 1000);
                continue;
            }
            if (timestamp >= secondsNeeded) break;
            await sleep(randRange(900, 1400));
        }
        if (activeQuests.has(userId)) {
            await api.post(`/quests/${qid}/video-progress`, { timestamp: secondsNeeded });
        }
    } else if (["PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"].includes(taskType)) {
        const pid = Math.floor(randRange(1000, 30000));
        const streamKey = taskType === "PLAY_ACTIVITY" ? "call:0:1" : `call:0:${pid}`;

        while (secondsDone < secondsNeeded && activeQuests.has(userId)) {
            const r = await api.post(`/quests/${qid}/heartbeat`, { stream_key: streamKey, terminal: false });
            if (r.status === 401) {
                removeToken(userId);
                activeQuests.delete(userId);
                return;
            } else if (r.status === 200) {
                const prog = r.data?.progress;
                if (prog && prog[taskType]) {
                    secondsDone = prog[taskType].value ?? secondsDone;
                }
                pQuest.done_seconds = secondsDone;
                if (r.data?.completed_at || secondsDone >= secondsNeeded) {
                    pQuest.done_seconds = secondsNeeded;
                    return;
                }
            } else if (r.status === 429) {
                const retry = r.data?.retry_after || 10;
                await sleep((retry + randRange(3, 5)) * 1000);
                continue;
            }
            await sleep(randRange(18000, 24000));
        }
        if (activeQuests.has(userId)) {
            await api.post(`/quests/${qid}/heartbeat`, { stream_key: streamKey, terminal: true });
        }
    }
    pQuest.done_seconds = secondsNeeded;
}

async function runQuestFarmingBackground(client, userId) {
    const data = activeQuests.get(userId);
    if (!data) return;

    while (activeQuests.has(userId)) {
        const remaining = data.quests.filter(q => q.done_seconds < q.duration);
        if (remaining.length === 0) break;

        const batch = remaining.slice(0, MAX_CONCURRENT_QUESTS);
        await Promise.allSettled(batch.map(q => runSingleQuestAsync(q, data.api, userId)));
        await sleep(randRange(2000, 4000));
    }

    if (activeQuests.has(userId)) {
        try {
            const user = await client.users.fetch(userId);
            await user.send(`🎉 **Chúc mừng ${data.userName}!** Đã thu hoạch xong toàn bộ **${data.totalOrbs} Orbs** từ Quest.`);
        } catch (e) {}
        activeQuests.delete(userId);
    }
}

async function startOrShowAutoQuest(interaction, userToken) {
    const userId = interaction.user.id;

    if (activeQuests.has(userId)) {
        const payload = {
            flags: MessageFlags.IsComponentsV2,
            components: buildOrbQuestComponentsV2(userId),
            ephemeral: true
        };
        return interaction.deferred || interaction.replied
            ? interaction.followUp(payload)
            : interaction.reply(payload);
    }

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }

    const api = new DiscordUserAPI(userToken, userId);
    const meRes = await api.get('/users/@me');
    if (meRes.status !== 200) {
        removeToken(userId);
        return interaction.followUp({ content: "❌ **Token đã hết hạn hoặc không hợp lệ!** Vui lòng cập nhật lại Token.", ephemeral: true });
    }

    const displayName = meRes.data.global_name || meRes.data.username;
    let qRes = await api.get('/quests/@me');
    if (qRes.status !== 200) {
        return interaction.followUp({ content: "❌ Không thể tải danh sách Quest lúc này.", ephemeral: true });
    }

    let rawQuests = Array.isArray(qRes.data) ? qRes.data : (qRes.data.quests || []);
    const unaccepted = rawQuests.filter(q => !isEnrolled(q) && !isCompleted(q) && isCompletable(q));

    for (const q of unaccepted) {
        await api.post(`/quests/${q.id}/enroll`, {
            location: 11,
            is_targeted: false,
            metadata_raw: null,
            metadata_sealed: null
        });
        await sleep(randRange(800, 1400));
    }

    if (unaccepted.length > 0) {
        qRes = await api.get('/quests/@me');
        if (qRes.status === 200) {
            rawQuests = Array.isArray(qRes.data) ? qRes.data : (qRes.data.quests || []);
        }
    }

    const actionable = rawQuests.filter(q => isEnrolled(q) && !isCompleted(q) && isCompletable(q));
    if (actionable.length === 0) {
        return interaction.followUp({ content: "⚠️ **Tài khoản hiện không có Quest/Orb khả dụng nào hoặc đã làm xong hết!**", ephemeral: true });
    }

    const parsedQuests = actionable.map(q => ({
        id: q.id,
        title: getQuestName(q),
        type: getTaskType(q),
        orb: parseQuestOrbs(q),
        duration: getSecondsNeeded(q),
        done_seconds: getSecondsDone(q)
    }));

    saveToken(userId, userToken);
    activeQuests.set(userId, {
        userName: displayName,
        token: userToken,
        api,
        quests: parsedQuests,
        totalOrbs: parsedQuests.reduce((s, q) => s + q.orb, 0)
    });

    await interaction.followUp({
        flags: MessageFlags.IsComponentsV2,
        components: buildOrbQuestComponentsV2(userId),
        ephemeral: true
    });

    runQuestFarmingBackground(interaction.client, userId);
}

// ==============================================================================
// MODULE 5: GIAO DIỆN COMPONENTS V2 MENU CHÍNH & BẢNG ĐIỀU KHIỂN STREAM/GAME
// ==============================================================================
const SETUP_PRESETS = {
    all: {
        label: "🌟 Tất Cả Chức Năng (Full Menu)",
        features: ["autoquest", "progress", "badge", "stream", "hypesquad", "token", "voice_stream"],
        lines: [
            "**1. AutoQuest (Orb)** — Tự nhận & cày Quest trực quan",
            "**2. Tiến Trình Orb** — Theo dõi phần trăm & Orb real-time",
            "**3. Badge 5000h** — 30s quét 100 game + treo đa game liên tục",
            "**4. Stream & Pin** — Bật/Tắt Stream & treo Loop Video Pinterest",
            "**5. Stream Voice (Modal)** — Treo Share Màn Hình vào phòng Voice cày huy hiệu",
            "**6. HypeSquad** — Đổi nhà <:hypesquad_2:1571114614975107144> <:hypesquad_1:1571114521601245224> <:hypesquad:1571114469130633316> tức thì",
            "**7. Token Cloud** — Lưu Token lên Server tự động khôi phục"
        ]
    }
};

function buildComponentsV2Dashboard(presetKey = "all", customThumbUrl = null) {
    const preset = SETUP_PRESETS[presetKey] || SETUP_PRESETS.all;
    const thumbUrl = customThumbUrl || DEFAULT_THUMBNAIL;

    const buttonConfigs = {
        autoquest: { type: 2, style: 3, label: "Cày Orb / Quest", emoji: { name: "🔮" }, custom_id: `v2:${presetKey}:autoquest` },
        progress: { type: 2, style: 2, label: "Tiến Trình", emoji: { name: "📊" }, custom_id: `v2:${presetKey}:progress` },
        badge: { type: 2, style: 1, label: "Treo 100 Game / 5000h", emoji: { name: "🎮" }, custom_id: `v2:${presetKey}:badge` },
        stream: { type: 2, style: 2, label: "Stream & Pin Loop", emoji: { name: "📺" }, custom_id: `v2:${presetKey}:stream` },
        voice_stream: { type: 2, style: 3, label: "Stream Share Voice", emoji: { name: "🎥" }, custom_id: `v2:${presetKey}:voice_stream` },
        hypesquad: {
            type: 2, style: 2, label: "HypeSquad",
            emoji: { id: "1571114469130633316", name: "hypesquad" },
            custom_id: `v2:${presetKey}:hypesquad`
        },
        token: { type: 2, style: 2, label: "Lưu Token", emoji: { name: "🔐" }, custom_id: `v2:${presetKey}:token` }
    };

    const buttons = preset.features.map(f => buttonConfigs[f]).filter(Boolean);
    const actionRows = [];
    for (let i = 0; i < buttons.length; i += 3) {
        actionRows.push({
            type: 1,
            components: buttons.slice(i, i + 3)
        });
    }

    return [
        {
            type: 17,
            accent_color: 0xFFFFFF,
            components: [
                {
                    type: 9,
                    components: [
                        {
                            type: 10,
                            content: `## 🪽 HỆ THỐNG TREO GAME, CÀY ORB & STREAM VOICE 🪽\n**Danh sách chức năng:**\n${preset.lines.join("\n")}`
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

function buildBadgeAndStreamControlV2(userId) {
    const ses = activeGameSessions.get(userId);
    if (!ses || !ses.isRunning) {
        return [
            {
                type: 17,
                accent_color: 0x2B2D31,
                components: [
                    {
                        type: 10,
                        content: "## 🎮 TRẠM TREO MULTI-GAME 5000H & STREAM PIN\nHiện chưa có phiên treo nào đang chạy."
                    }
                ]
            }
        ];
    }

    const elapsedH = ((Date.now() - ses.startTime) / 3600000).toFixed(2);
    const pct5000 = Math.min(100, Math.floor((parseFloat(elapsedH) / ses.targetHours) * 100));
    const bar5000 = "▰".repeat(Math.floor(pct5000 / 10)) + "▱".repeat(10 - Math.floor(pct5000 / 10));
    const streamBadge = ses.streamEnabled ? "🟢 **ĐANG BẬT (Nút Tím)**" : "🔴 **ĐANG TẮT**";
    const pinInfo = ses.pinUrl
        ? `🔗 **Link Pin:** [Mở Pinterest](${ses.pinUrl})\n🎬 **Tiêu đề Video:** \`${ses.pinData?.title || 'Pinterest Loop'}\` (Đã lặp **${ses.loopCount}** vòng)`
        : "🔗 **Link Pin:** Chưa gắn link video Pinterest";

    return [
        {
            type: 17,
            accent_color: ses.streamEnabled ? 0x9B59B6 : 0x5865F2,
            components: [
                {
                    type: 9,
                    components: [
                        {
                            type: 10,
                            content:
                                `## 🎮 TRẠM TREO MULTI-GAME & STREAM PIN\n` +
                                `📡 **Trạng thái:** ${ses.isPaused ? "⏸️ Tạm dừng (Bạn đang online)" : ses.phase}\n` +
                                `🕹️ **Cụm game đang treo (${ses.activeGamesList.length} game):** \`${ses.activeGamesList.slice(0, 4).join(", ")}${ses.activeGamesList.length > 4 ? "..." : ""}\`\n` +
                                `🏆 **Đã quét:** **${ses.uniqueScanned.size}/${ses.maxGames}** tựa game • Tổng lượt xoay: **${ses.gamesRotated}**\n` +
                                `⏳ **Tiến độ ${ses.targetHours}h:** \`[${bar5000}]\` **${elapsedH}h / ${ses.targetHours}h**\n` +
                                `📺 **Chế độ Stream:** ${streamBadge}\n${pinInfo}`
                        }
                    ],
                    accessory: {
                        type: 11,
                        media: { url: ses.pinData?.thumbnail || DEFAULT_THUMBNAIL }
                    }
                },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            style: ses.streamEnabled ? 4 : 3,
                            label: ses.streamEnabled ? "Tắt Stream" : "Bật Stream",
                            emoji: { name: ses.streamEnabled ? "📴" : "📺" },
                            custom_id: `badgeprog:togglestream:${userId}`
                        },
                        {
                            type: 2,
                            style: 1,
                            label: "Gắn Link Video Pinterest",
                            emoji: { name: "📌" },
                            custom_id: `badgeprog:setpin:${userId}`
                        },
                        {
                            type: 2,
                            style: 2,
                            label: "Làm mới",
                            emoji: { name: "🔄" },
                            custom_id: `badgeprog:view:${userId}`
                        },
                        {
                            type: 2,
                            style: 4,
                            label: "Dừng Treo",
                            emoji: { name: "⏹️" },
                            custom_id: `badgeprog:stop:${userId}`
                        }
                    ]
                }
            ]
        }
    ];
}

// ==============================================================================
// MODULE 6: TỰ ĐỘNG KHÔI PHỤC TẤT CẢ PHIÊN TREO & VOICE STREAM KHI RESET BOT
// ==============================================================================
async function autoRestoreAllSessions(client) {
    const allTokens = db.get('tokens');
    const savedSessions = db.get('sessions');
    const voiceConfigs = db.get('voice_streams');
    const userIds = Object.keys(allTokens);

    if (userIds.length === 0) {
        console.log('[Auto-Restore] Chưa có token người dùng nào được lưu trong CloudDB.');
        return;
    }

    console.log(`[Auto-Restore] Đang kiểm tra ${userIds.length} token từ Server lưu trữ...`);
    let restoredCount = 0;

    for (const uid of userIds) {
        const token = allTokens[uid];
        if (!token) continue;

        const api = new DiscordUserAPI(token, uid);
        const me = await api.get('/users/@me');
        if (me.status !== 200) {
            removeToken(uid);
            continue;
        }

        const uname = me.data.global_name || me.data.username;
        const prevSession = savedSessions[uid];

        const session = new BadgeFarmSession(uid, token, {
            maxGames: prevSession?.maxGames || 100,
            targetHours: prevSession?.targetHours || 5000,
            startTime: prevSession?.startTime || Date.now(),
            streamEnabled: prevSession?.streamEnabled || false,
            pinUrl: prevSession?.pinUrl || '',
            pinData: prevSession?.pinData || null,
            gamesRotated: prevSession?.gamesRotated || 0,
            loopCount: prevSession?.loopCount || 0
        });

        activeGameSessions.set(uid, session);
        session.start();

        // Khôi phục Voice Stream nếu có cấu hình trước đó
        const vCfg = voiceConfigs[uid];
        if (vCfg && vCfg.guildId && vCfg.channelId) {
            await startVoiceStreamer(uid, token, vCfg.guildId, vCfg.channelId);
        }

        restoredCount++;
        console.log(`[Auto-Restore] ✅ Đã khôi phục thành công cho: ${uname} (${uid})`);
        await sleep(2000);
    }

    console.log(`[Auto-Restore] Hoàn tất khôi phục ${restoredCount}/${userIds.length} tài khoản!`);
}

// ==============================================================================
// MODULE 7: KHỞI TẠO BOT & XỬ LÝ TƯƠNG TÁC
// ==============================================================================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', async () => {
    console.log(`[+] Bot đã đăng nhập thành công: ${client.user.tag}`);
    await fetchLatestBuildNumber();
    await db.init(client);
    await autoRestoreAllSessions(client);

    const commands = [
        new SlashCommandBuilder()
            .setName('setup_menu')
            .setDescription('[ADMIN] Gửi bảng điều khiển chức năng Components V2 cao cấp')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
            .addStringOption(opt =>
                opt.setName('che_do')
                    .setDescription('Chọn loại menu chức năng phù hợp cho server này')
                    .setRequired(true)
                    .addChoices(
                        { name: '🌟 Tất Cả Chức Năng (Full Menu)', value: 'all' }
                    )
            )
            .addStringOption(opt =>
                opt.setName('anh_gif')
                    .setDescription('Link ảnh GIF/PNG góc phải khung (để trống nếu dùng mặc định)')
                    .setRequired(false)
            ),
        new SlashCommandBuilder()
            .setName('tien_trinh')
            .setDescription('[ORB/GAME] Xem bảng điều khiển trực quan Orb & Treo 5000h'),
        new SlashCommandBuilder()
            .setName('stream_pin')
            .setDescription('[STREAM] Bật/tắt Stream tím hoặc gắn link video Pinterest loop')
            .addBooleanOption(opt =>
                opt.setName('trang_thai')
                    .setDescription('Bật (True) hoặc Tắt (False) chế độ Stream')
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName('link_pinterest')
                    .setDescription('Dán link video Pinterest (https://www.pinterest.com/pin/...)')
                    .setRequired(false)
            )
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || client.user.id), { body: commands });
        console.log('[+] Đã đồng bộ Slash Commands toàn cầu!');
    } catch (err) {
        console.error('[-] Lỗi đồng bộ Slash Commands:', err);
    }
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const uid = interaction.user.id;

            if (interaction.commandName === 'setup_menu') {
                const presetKey = interaction.options.getString('che_do');
                const customGif = interaction.options.getString('anh_gif');
                const componentsV2 = buildComponentsV2Dashboard(presetKey, customGif);

                const sent = await interaction.channel.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: componentsV2
                });

                if (interaction.guildId) {
                    db.set('setups', interaction.guildId, {
                        channelId: interaction.channelId,
                        messageId: sent.id,
                        preset: presetKey,
                        updatedAt: new Date().toISOString()
                    });
                }

                return interaction.reply({
                    content: `✅ Đã thiết lập bảng menu thành công & sao lưu lên Cloud DB!`,
                    ephemeral: true
                });
            }

            if (interaction.commandName === 'tien_trinh') {
                if (activeGameSessions.has(uid)) {
                    return interaction.reply({
                        flags: MessageFlags.IsComponentsV2,
                        components: buildBadgeAndStreamControlV2(uid),
                        ephemeral: true
                    });
                }
                if (activeQuests.has(uid)) {
                    return interaction.reply({
                        flags: MessageFlags.IsComponentsV2,
                        components: buildOrbQuestComponentsV2(uid),
                        ephemeral: true
                    });
                }
                return interaction.reply({ content: "ℹ️ Bạn hiện chưa bật phiên treo Game hay cày Orb nào.", ephemeral: true });
            }

            if (interaction.commandName === 'stream_pin') {
                const enable = interaction.options.getBoolean('trang_thai');
                const pinUrl = interaction.options.getString('link_pinterest')?.trim() || null;
                const savedToken = getSavedToken(uid);

                if (!savedToken) {
                    return interaction.reply({ content: "❌ Bạn chưa lưu Token! Vui lòng lưu Token trước.", ephemeral: true });
                }

                await interaction.deferReply({ ephemeral: true });
                let pinData = null;
                if (pinUrl) {
                    pinData = await resolvePinterestVideo(pinUrl);
                }

                let ses = activeGameSessions.get(uid);
                if (!ses || !ses.isRunning) {
                    ses = new BadgeFarmSession(uid, savedToken, {
                        maxGames: 100,
                        targetHours: 5000,
                        streamEnabled: enable,
                        pinUrl: pinUrl || '',
                        pinData
                    });
                    activeGameSessions.set(uid, ses);
                    ses.start();
                } else {
                    ses.toggleStream(enable, pinUrl, pinData);
                }

                return interaction.followUp({
                    flags: MessageFlags.IsComponentsV2,
                    components: buildBadgeAndStreamControlV2(uid),
                    ephemeral: true
                });
            }
        }

        if (interaction.isButton()) {
            const cid = interaction.customId;
            const uid = interaction.user.id;

            if (cid.startsWith('v2:')) {
                const action = cid.split(':')[2];
                const savedToken = getSavedToken(uid);

                if (action === 'autoquest') {
                    if (!savedToken) {
                        const modal = new ModalBuilder()
                            .setCustomId('modal:token:autoquest')
                            .setTitle('🔐 CẬP NHẬT USER TOKEN');
                        modal.addComponents(
                            new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('token_val')
                                    .setLabel('User Token Discord')
                                    .setPlaceholder('Dán token vào đây...')
                                    .setStyle(TextInputStyle.Short)
                                    .setRequired(true)
                            )
                        );
                        return interaction.showModal(modal);
                    }
                    return startOrShowAutoQuest(interaction, savedToken);
                }

                if (action === 'progress') {
                    if (!activeQuests.has(uid)) {
                        return interaction.reply({ content: "ℹ️ Không có tiến trình cày Orb/Quest nào đang chạy.", ephemeral: true });
                    }
                    return interaction.reply({
                        flags: MessageFlags.IsComponentsV2,
                        components: buildOrbQuestComponentsV2(uid),
                        ephemeral: true
                    });
                }

                if (action === 'badge') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal:badge')
                        .setTitle('🎮 Treo 100 Game (30s) & 5000 Giờ');
                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('token_val').setLabel('Discord User Token (Bỏ trống nếu đã lưu)').setValue('').setStyle(TextInputStyle.Short).setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('games_val').setLabel('Số game muốn cày').setValue('100').setStyle(TextInputStyle.Short).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('hours_val').setLabel('Số giờ muốn treo').setValue('5000').setStyle(TextInputStyle.Short).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('pin_val').setLabel('Link Video Pinterest Loop (Tùy chọn)').setValue('').setStyle(TextInputStyle.Short).setRequired(false)
                        )
                    );
                    return interaction.showModal(modal);
                }

                // Modal cấu hình Stream Voice Share Màn Hình (Giống ảnh mẫu yêu cầu)
                if (action === 'voice_stream') {
                    const modal = new ModalBuilder()
                        .setCustomId('modal:voice_stream_config')
                        .setTitle('Stream Badge – Cấu hình');

                    const savedV = db.get('voice_streams', uid) || {};
                    const savedT = getSavedToken(uid) || '';

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('streamer_token').setLabel('Token Streamer (tài khoản cần stream) *').setValue(savedT).setStyle(TextInputStyle.Short).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('viewer_token').setLabel('Token Viewer (Không bắt buộc)').setValue(savedV.viewerToken || '').setStyle(TextInputStyle.Short).setRequired(false)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID (ID server Discord) *').setValue(savedV.guildId || '').setStyle(TextInputStyle.Short).setRequired(true)
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder().setCustomId('channel_id').setLabel('Voice Channel ID (ID kênh voice) *').setValue(savedV.channelId || '').setStyle(TextInputStyle.Short).setRequired(true)
                        )
                    );
                    return interaction.showModal(modal);
                }

                if (action === 'hypesquad') {
                    if (!savedToken) {
                        const modal = new ModalBuilder().setCustomId('modal:token:save').setTitle('🔐 CẬP NHẬT USER TOKEN');
                        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('token_val').setLabel('User Token Discord').setStyle(TextInputStyle.Short).setRequired(true)));
                        return interaction.showModal(modal);
                    }

                    const embed = new EmbedBuilder()
                        .setTitle("🏡 CHỌN NHÀ HYPESQUAD")
                        .setDescription("Chọn nhà HypeSquad bạn muốn nhận huy hiệu:")
                        .setColor(0x2B2D31);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`hs:1:${uid}`).setLabel("Bravery").setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`hs:2:${uid}`).setLabel("Brilliance").setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder().setCustomId(`hs:3:${uid}`).setLabel("Balance").setStyle(ButtonStyle.Secondary)
                    );
                    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
                }

                if (action === 'token') {
                    const modal = new ModalBuilder().setCustomId('modal:token:save').setTitle('🔐 LƯU USER TOKEN LÊN CLOUD');
                    modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('token_val').setLabel('User Token Discord').setStyle(TextInputStyle.Short).setRequired(true)));
                    return interaction.showModal(modal);
                }
            }

            if (cid.startsWith('qctrl:')) {
                const [, subAction, ownerId] = cid.split(':');
                if (uid !== ownerId) return interaction.reply({ content: "❌ Không phải bảng của bạn.", ephemeral: true });
                if (subAction === 'refresh') return interaction.update({ flags: MessageFlags.IsComponentsV2, components: buildOrbQuestComponentsV2(uid) });
                if (subAction === 'cancel') {
                    activeQuests.delete(uid);
                    return interaction.update({ flags: MessageFlags.IsComponentsV2, components: buildOrbQuestComponentsV2(uid) });
                }
            }

            if (cid.startsWith('hs:')) {
                const [, houseIdStr, ownerId] = cid.split(':');
                if (uid !== ownerId) return interaction.reply({ content: "❌ Không phải bảng của bạn.", ephemeral: true });
                const savedToken = getSavedToken(uid);
                const houseId = parseInt(houseIdStr, 10);
                const api = new DiscordUserAPI(savedToken, uid);
                await api.post('/hypesquad/online', { house_id: houseId });
                return interaction.update({ content: "🎉 Đổi nhà HypeSquad thành công!", embeds: [], components: [] });
            }

            if (cid.startsWith('badgeprog:')) {
                const [, subAction, ownerId] = cid.split(':');
                if (uid !== ownerId) return interaction.reply({ content: "❌ Không phải bảng của bạn.", ephemeral: true });
                const ses = activeGameSessions.get(uid);
                if (subAction === 'togglestream' && ses) ses.toggleStream(!ses.streamEnabled);
                if (subAction === 'stop' && ses) {
                    ses.stop();
                    activeGameSessions.delete(uid);
                    return interaction.update({ content: "🛑 Đã dừng treo game!", embeds: [], components: [] });
                }
                return interaction.update({ flags: MessageFlags.IsComponentsV2, components: buildBadgeAndStreamControlV2(uid) });
            }
        }

        if (interaction.isModalSubmit()) {
            const uid = interaction.user.id;

            if (interaction.customId === 'modal:voice_stream_config') {
                const streamerToken = interaction.fields.getTextInputValue('streamer_token').trim();
                const viewerToken = interaction.fields.getTextInputValue('viewer_token').trim();
                const guildId = interaction.fields.getTextInputValue('guild_id').trim();
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();

                // Lưu vào Cloud DB server 1571370887683375124
                db.set('voice_streams', uid, { streamerToken, viewerToken, guildId, channelId });
                saveToken(uid, streamerToken);

                await interaction.reply({ content: "🚀 Đang khởi động kết nối Stream Voice màn hình vào phòng Voice và Treo Game cày huy hiệu...", ephemeral: true });

                // Kích hoạt Voice Streamer
                await startVoiceStreamer(uid, streamerToken, guildId, channelId);

                // Kích hoạt luôn Badge Farmer 5000h
                if (!activeGameSessions.has(uid)) {
                    const gameSes = new BadgeFarmSession(uid, streamerToken, { maxGames: 100, targetHours: 5000 });
                    activeGameSessions.set(uid, gameSes);
                    gameSes.start();
                }
            }

            if (interaction.customId.startsWith('modal:token:')) {
                const token = interaction.fields.getTextInputValue('token_val').trim();
                saveToken(uid, token);
                return interaction.reply({ content: "✅ Đã lưu Token lên Cloud DB thành công!", ephemeral: true });
            }

            if (interaction.customId === 'modal:badge') {
                const rawTok = interaction.fields.getTextInputValue('token_val').trim();
                const token = rawTok || getSavedToken(uid);
                if (!token) return interaction.reply({ content: "❌ Chưa có Token!", ephemeral: true });

                const maxG = parseInt(interaction.fields.getTextInputValue('games_val'), 10) || 100;
                const maxH = parseInt(interaction.fields.getTextInputValue('hours_val'), 10) || 5000;
                const pinUrl = interaction.fields.getTextInputValue('pin_val').trim();

                saveToken(uid, token);
                let pinData = pinUrl ? await resolvePinterestVideo(pinUrl) : null;

                const session = new BadgeFarmSession(uid, token, { maxGames: maxG, targetHours: maxH, streamEnabled: Boolean(pinUrl), pinUrl, pinData });
                activeGameSessions.set(uid, session);
                session.start();

                return interaction.reply({ flags: MessageFlags.IsComponentsV2, components: buildBadgeAndStreamControlV2(uid), ephemeral: true });
            }
        }
    } catch (err) {
        console.error('[-] Lỗi xử lý:', err);
    }
});

process.on('unhandledRejection', (err) => {});
process.on('uncaughtException', (err) => {});

client.login(process.env.BOT_TOKEN);
