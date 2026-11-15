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
const DEFAULT_THUMBNAIL = process.env.THUMBNAIL_URL || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1000&auto=format&fit=crop';

const LOCAL_CACHE_DIR = path.join(__dirname, 'cache_db');
if (!fs.existsSync(LOCAL_CACHE_DIR)) fs.mkdirSync(LOCAL_CACHE_DIR, { recursive: true });

const DB_CHANNELS_SPEC = {
    tokens: 'db-tokens',
    fingerprints: 'db-fingerprints',
    sessions: 'db-sessions',
    setups: 'db-setups',
    voice_streams: 'db-voice-streams'
};

const DEVICE_PROFILES = [
    {
        os: "Windows", os_version: "10.0.26100", os_arch: "x64", app_arch: "x64",
        browser: "Discord Client", client_version: "1.0.9175", browser_version: "32.2.7", native_build_number: 59498,
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 Electron/32.2.7 Safari/537.36"
    }
];

// Ảnh mạng chất lượng cao cho HypeSquad (Dùng link ảnh chuẩn từ web/CDN thay vì emoji custom của bot khác)
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

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

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
        try {
            const p = this._cachePath(table);
            if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (e) {}
        return {};
    }
    _writeLocal(table, data) {
        try { fs.writeFileSync(this._cachePath(table), JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
    }

    async init(client) {
        for (const table of Object.keys(DB_CHANNELS_SPEC)) {
            this.store[table] = this._readLocal(table);
        }
        const guild = await client.guilds.fetch(DB_GUILD_ID).catch(() => null);
        if (!guild) return;

        let allChannels = await guild.channels.fetch().catch(() => null);
        if (!allChannels) return;

        let category = allChannels.find(c => c.type === ChannelType.GuildCategory && c.name === 'BOT-CLOUD-DB');
        if (!category) {
            category = await guild.channels.create({
                name: 'BOT-CLOUD-DB',
                type: ChannelType.GuildCategory,
                permissionOverwrites: [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }]
            }).catch(() => null);
        }
        if (!category) return;

        for (const [table, chName] of Object.entries(DB_CHANNELS_SPEC)) {
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
                await this._loadFromChannel(table, channel);
            }
        }
    }

    async _loadFromChannel(table, channel) {
        try {
            const messages = await channel.messages.fetch({ limit: 5 });
            const msg = messages.first();
            if (msg) {
                let raw = msg.content;
                const match = raw.match(/```json([\s\S]*?)```/);
                if (match) {
                    const parsed = JSON.parse(match[1]);
                    this.store[table] = parsed;
                    this._writeLocal(table, parsed);
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
        this.syncTimers[table] = setTimeout(() => this.flush(table), 3000);
    }

    async flush(table) {
        const channel = this.channels[table];
        if (!channel) return;
        try {
            const dataStr = JSON.stringify(this.store[table], null, 2);
            if (dataStr.length <= 1900) {
                const msgs = await channel.messages.fetch({ limit: 5 });
                const botMsg = msgs.find(m => m.author.id === channel.client.user.id);
                const content = `\`\`\`json\n${dataStr}\n\`\`\``;
                if (botMsg) await botMsg.edit(content);
                else await channel.send(content);
            }
        } catch (e) {}
    }
}

const db = new DiscordCloudDB();

// ==============================================================================
// MODULE 2: VOICE STREAMER & ANTI-BAN STREAM (RTSP / UDP STABILIZER)
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
            console.log(`[VoiceStream - AntiBan] Selfbot stream đã đăng nhập an toàn: ${selfClient.user.tag}`);
            try {
                const streamer = new Streamer(selfClient);
                await streamer.joinVoice(guildId, channelId);

                // Khóa cứng Micro (Mute) & chống lộ giọng tuyệt đối
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
                // Anti-Ban: Giới hạn 15fps, bitrate 600k tối ưu để tránh bị quét spam video stream
                new prism.FFmpeg({
                    args: [
                        '-f', 'lavfi',
                        '-i', 'color=c=black:s=1280x720:r=15',
                        '-pix_fmt', 'yuv420p',
                        '-vcodec', 'libx264',
                        '-preset', 'ultrafast',
                        '-tune', 'zerolatency',
                        '-r', '15',
                        '-g', '30',
                        '-b:v', '600k',
                        '-f', 'rtsp',
                        udpStream
                    ]
                });
                console.log(`[VoiceStream] Đã bật stream chống ban thành công vào phòng [${channelId}]!`);
            } catch (err) {
                console.error(`[VoiceStream] Lỗi luồng stream:`, err.message);
            }
        });

        await selfClient.login(streamerToken);
    } catch (err) {
        console.error(`[VoiceStream] Không thể khởi chạy selfclient:`, err.message);
    }
}

// ==============================================================================
// MODULE 3: TOKEN & PINTEREST PARSER
// ==============================================================================
function getSavedToken(userId) { return db.get('tokens', userId); }
function saveToken(userId, token) { db.set('tokens', userId, token.trim()); }

function getUserDeviceProfile(userId) {
    return DEVICE_PROFILES[0];
}

async function resolvePinterestVideo(pinUrl) {
    if (!pinUrl || !/^https?:\/\//i.test(pinUrl)) return null;
    try {
        const res = await axios.get(pinUrl, {
            maxRedirects: 5,
            timeout: 10000,
            headers: { 'User-Agent': DEVICE_PROFILES[0].ua }
        });
        const html = String(res.data || '');
        const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
        const imgMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
        const mp4Matches = html.match(/https:\/\/v\d*\.pinimg\.com\/videos\/[^"'\s\\]+\.mp4/gi) || [];

        return {
            sourceUrl: pinUrl,
            videoUrl: mp4Matches[0] || null,
            thumbnail: imgMatch ? imgMatch[1] : null,
            title: titleMatch ? titleMatch[1].slice(0, 80) : 'Pinterest Video Loop'
        };
    } catch (e) {
        return { sourceUrl: pinUrl, videoUrl: null, thumbnail: null, title: 'Pinterest Live Stream' };
    }
}

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
    constructor(token, userId) {
        this.token = token;
        this.profile = getUserDeviceProfile(userId);
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
    async get(url) { return this.client.get(url); }
    async post(url, data = {}) { return this.client.post(url, data); }
}

// ==============================================================================
// MODULE 4: GIAO DIỆN COMPONENTS V2 (CHỈ GIỮ STREAM & HYPESQUAD)
// ==============================================================================
function buildDashboard() {
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
                            content: "## 🪽 HỆ THỐNG STREAM ANTI-BAN & HYPESQUAD 🪽\nChọn tính năng bạn muốn sử dụng:"
                        }
                    ],
                    accessory: { type: 11, media: { url: DEFAULT_THUMBNAIL } }
                },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 1,
                    components: [
                        { type: 2, style: 3, label: "Stream Share Voice", emoji: { name: "🎥" }, custom_id: "v2:all:voice_stream" },
                        { type: 2, style: 2, label: "Đổi HypeSquad", emoji: { name: "🛡️" }, custom_id: "v2:all:hypesquad" },
                        { type: 2, style: 1, label: "Lưu Token", emoji: { name: "🔐" }, custom_id: "v2:all:token" }
                    ]
                }
            ]
        }
    ];
}

// ==============================================================================
// MODULE 5: KHỞI TẠO BOT & XỬ LÝ SỰ KIỆN
// ==============================================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

client.once('ready', async () => {
    console.log(`[+] Bot đã đăng nhập: ${client.user.tag}`);
    await fetchLatestBuildNumber();
    await db.init(client);

    const commands = [
        new SlashCommandBuilder()
            .setName('setup_menu')
            .setDescription('[ADMIN] Gửi bảng điều khiển Stream & HypeSquad')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(cmd => cmd.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || client.user.id), { body: commands }).catch(() => {});
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (interaction.commandName === 'setup_menu') {
                await interaction.channel.send({ flags: MessageFlags.IsComponentsV2, components: buildDashboard() });
                return interaction.reply({ content: "✅ Đã gửi bảng menu Stream & HypeSquad thành công!", ephemeral: true });
            }
        }

        if (interaction.isButton()) {
            const [, , action] = interaction.customId.split(':');
            const uid = interaction.user.id;

            if (action === 'voice_stream') {
                const modal = new ModalBuilder().setCustomId('modal:voice_stream_config').setTitle('Stream Voice Anti-Ban');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('streamer_token').setLabel('Token Streamer *').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('guild_id').setLabel('Guild ID (Server ID) *').setStyle(TextInputStyle.Short).setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Voice Channel ID *').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return interaction.showModal(modal);
            }

            if (action === 'token') {
                const modal = new ModalBuilder().setCustomId('modal:token').setTitle('🔐 LƯU USER TOKEN');
                modal.addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('token_val').setLabel('User Token Discord').setStyle(TextInputStyle.Short).setRequired(true))
                );
                return interaction.showModal(modal);
            }

            if (action === 'hypesquad') {
                // Hiển thị Embed HypeSquad dùng ảnh mạng badge chuẩn chất lượng cao
                const embed = new EmbedBuilder()
                    .setTitle("🏡 CHỌN NHÀ HYPESQUAD CHÍNH HÃNG")
                    .setDescription("Chọn nhà HypeSquad bạn muốn gia nhập bên dưới:")
                    .setColor(0x5865F2)
                    .setThumbnail("https://images.credly.com/images/13c33971-8bc7-438e-8a22-c397500b4111/hypesquad_brilliance.png");

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`hs:1:${uid}`).setLabel("Bravery (Dũng cảm)").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`hs:2:${uid}`).setLabel("Brilliance (Sáng suốt)").setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId(`hs:3:${uid}`).setLabel("Balance (Cân bằng)").setStyle(ButtonStyle.Secondary)
                );
                return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
            }
        }

        if (interaction.isModalSubmit()) {
            const uid = interaction.user.id;

            if (interaction.customId === 'modal:token') {
                const token = interaction.fields.getTextInputValue('token_val').trim();
                saveToken(uid, token);
                return interaction.reply({ content: "✅ Đã lưu User Token thành công!", ephemeral: true });
            }

            if (interaction.customId === 'modal:voice_stream_config') {
                const token = interaction.fields.getTextInputValue('streamer_token').trim();
                const guildId = interaction.fields.getTextInputValue('guild_id').trim();
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();

                saveToken(uid, token);
                db.set('voice_streams', uid, { streamerToken: token, guildId, channelId });

                await interaction.reply({ content: "🚀 Đang khởi động Stream Voice chống ban (Anti-Ban)...", ephemeral: true });
                await startVoiceStreamer(uid, token, guildId, channelId);
            }
        }

        if (interaction.isButton() && interaction.customId.startsWith('hs:')) {
            const [, houseIdStr, ownerId] = interaction.customId.split(':');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ Không phải bảng của bạn.", ephemeral: true });
            const token = getSavedToken(ownerId);
            if (!token) return interaction.reply({ content: "❌ Bạn chưa lưu Token trên hệ thống! Vui lòng bấm 'Lưu Token' trước.", ephemeral: true });

            const houseId = parseInt(houseIdStr, 10);
            const houseInfo = HYPESQUAD_BADGES[houseId];
            const api = new DiscordUserAPI(token, ownerId);
            
            const res = await api.post('/hypesquad/online', { house_id: houseId });
            if (res.status === 204 || res.status === 200) {
                const successEmbed = new EmbedBuilder()
                    .setTitle(`🎉 Đã gia nhập thành công ${houseInfo.name}!`)
                    .setDescription(`Huy hiệu của bạn đã được cập nhật.
*Mô tả:* ${houseInfo.desc}`)
                    .setImage(houseInfo.badgeUrl)
                    .setColor(0x57F287);
                return interaction.update({ embeds: [successEmbed], components: [] });
            } else {
                return interaction.update({ content: "❌ Token không hợp lệ hoặc lỗi khi đổi nhà HypeSquad.", embeds: [], components: [] });
            }
        }
    } catch (e) {}
});

client.login(process.env.BOT_TOKEN);
