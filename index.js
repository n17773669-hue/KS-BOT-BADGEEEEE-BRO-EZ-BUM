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
            let idx = html.indexOf('.pinimg.com/videos/');
            if (idx !== -1) {
                let start = html.lastIndexOf('https://', idx);
                let end = html.indexOf('.mp4', idx);
                if (start !== -1 && end !== -1) {
                    bestMp4 = html.substring(start, end + 4);
                }
            }
            const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i);
            return {
                type: 'pinterest',
                streamUrl: bestMp4,
                title: titleMatch ? titleMatch[1].slice(0, 60) : 'Pinterest Video Loop'
            };
        } catch (e) {
            return null;
        }
    }

    if (/\.(mp4|webm|mkv|m3u8)(\?.*)?$/i.test(mediaUrl)) {
        return {
            type: 'direct',
            streamUrl: mediaUrl,
            title: 'Direct Media Loop'
        };
    }

    return null;
}

// ==============================================================================
// MODULE 3: VOICE STREAMER & BOT TREO CHUNG + DỪNG LIVE
// ==============================================================================
async function stopVoiceStreamer(botClient, userId) {
    const active = activeVoiceStreamers.get(userId);
    if (!active) return false;

    try {
        if (active.ffmpeg) {
            try { active.ffmpeg.kill('SIGKILL'); } catch (e) {}
        }
        if (active.selfClient) {
            try { active.selfClient.destroy(); } catch (e) {}
        }
        if (active.guildId && botClient) {
            const guild = botClient.guilds.cache.get(active.guildId);
            if (guild) {
                guild.voiceAdapterCreator.destroyConnection(active.guildId);
            }
        }
    } catch (e) {}

    activeVoiceStreamers.delete(userId);
    db.delete('voice_streams', userId);
    return true;
}

async function startVoiceStreamer(botClient, userId, streamerToken, guildId, channelId, mediaUrl = '') {
    if (!channelId || !streamerToken) return { ok: false, msg: "Thiếu Token hoặc Voice Channel ID!" };

    await stopVoiceStreamer(botClient, userId);

    try {
        const selfClient = new SelfClient({ checkUpdate: false });
        const sessionObj = { selfClient, ffmpeg: null, guildId, channelId, mediaUrl };
        activeVoiceStreamers.set(userId, sessionObj);

        selfClient.on('ready', async () => {
            console.log(`[VoiceStream - AntiBan] Selfbot đăng nhập: ${selfClient.user.tag}`);
            try {
                let targetGuildId = guildId;
                if (!targetGuildId) {
                    const ch = await selfClient.channels.fetch(channelId).catch(() => null);
                    if (ch && ch.guild) targetGuildId = ch.guild.id;
                }
                if (!targetGuildId) {
                    console.error("[-] Không xác định được Guild ID!");
                    return;
                }
                sessionObj.guildId = targetGuildId;

                const botGuild = await botClient.guilds.fetch(targetGuildId).catch(() => null);
                if (botGuild) {
                    try {
                        botGuild.shard.send({
                            op: 4,
                            d: {
                                guild_id: targetGuildId,
                                channel_id: channelId,
                                self_mute: true,
                                self_deaf: true
                            }
                        });
                        console.log(`[BotVoice] Bot chính đã tham gia phòng [${channelId}] thành công!`);
                    } catch (err) {
                        console.error(`[BotVoice] Lỗi bot tham gia voice:`, err.message);
                    }
                }

                const streamer = new Streamer(selfClient);
                await streamer.joinVoice(targetGuildId, channelId);

                await selfClient.ws.broadcast({
                    op: 4,
                    d: {
                        guild_id: targetGuildId,
                        channel_id: channelId,
                        self_mute: true,
                        self_deaf: false
                    }
                });

                const udpStream = await streamer.createStream();

                let resolved = mediaUrl ? await resolveMediaSource(mediaUrl) : null;
                let ffmpegArgs = [];

                if (resolved && resolved.streamUrl) {
                    ffmpegArgs = [
                        '-re',
                        '-stream_loop', '-1',
                        '-i', resolved.streamUrl,
                        '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                        '-pix_fmt', 'yuv420p',
                        '-vcodec', 'libx264',
                        '-preset', 'ultrafast',
                        '-tune', 'zerolatency',
                        '-r', '20',
                        '-g', '40',
                        '-b:v', '900k',
                        '-an',
                        '-f', 'rtsp',
                        udpStream
                    ];
                } else {
                    ffmpegArgs = [
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
                    ];
                }

                const ffmpegProc = new prism.FFmpeg({ args: ffmpegArgs });
                sessionObj.ffmpeg = ffmpegProc;

                console.log(`[VoiceStream] Đã bật stream thành công!`);
            } catch (err) {
                console.error(`[VoiceStream] Lỗi luồng stream:`, err.message);
            }
        });

        await selfClient.login(streamerToken);
        return { ok: true };
    } catch (err) {
        activeVoiceStreamers.delete(userId);
        return { ok: false, msg: err.message };
    }
}

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
// MODULE 5: GIAO DIỆN COMPONENTS V2 (CHIA 2 HÀNG GỌN GÀNG, KHÔNG BỊ TRÀN)
// ==============================================================================
function buildDashboard() {
    return [
        {
            type: 17,
            accent_color: 0x2B2D31,
            components: [
                {
                    type: 9,
                    components: [
                        {
                            type: 10,
                            content: "## 🪽 HỆ THỐNG STREAM ANTI-BAN & HYPESQUAD 🪽\nChọn tính năng bạn muốn sử dụng bên dưới:"
                        }
                    ],
                    accessory: { type: 11, media: { url: DEFAULT_THUMBNAIL } }
                },
                { type: 14, divider: true, spacing: 1 },
                {
                    type: 1,
                    components: [
                        { type: 2, style: 2, label: "Stream Share Voice", emoji: { name: "🎥" }, custom_id: "v2:all:voice_stream" },
                        { type: 2, style: 2, label: "Dừng Live", emoji: { name: "⏹️" }, custom_id: "v2:all:stop_stream" }
                    ]
                },
                {
                    type: 1,
                    components: [
                        { type: 2, style: 2, label: "Đổi HypeSquad", emoji: { name: "🛡️" }, custom_id: "v2:all:hypesquad" },
                        { type: 2, style: 2, label: "Lưu Token", emoji: { name: "🔐" }, custom_id: "v2:all:token" }
                    ]
                }
            ]
        }
    ];
}

// ==============================================================================
// MODULE 6: KHỞI TẠO BOT & SLASH COMMANDS
// ==============================================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('ready', async () => {
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
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID || client.user.id), { body: commands }).catch(() => {});
});

client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            const uid = interaction.user.id;

            if (interaction.commandName === 'setup_menu') {
                await interaction.channel.send({ flags: MessageFlags.IsComponentsV2, components: buildDashboard() });
                return interaction.reply({ content: "✅ Đã gửi bảng menu Stream & HypeSquad thành công!", ephemeral: true });
            }

            if (interaction.commandName === 'dung_live') {
                const stopped = await stopVoiceStreamer(client, uid);
                if (stopped) {
                    return interaction.reply({ content: "⏹️ **Đã dừng phiên Stream Share Voice** và cho Bot + Tài khoản rời phòng voice an toàn!", ephemeral: true });
                } else {
                    return interaction.reply({ content: "ℹ️ Bạn hiện không có phiên Stream Voice nào đang chạy.", ephemeral: true });
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
                const currentGuildId = interaction.guildId || savedV.guildId || '';

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
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('guild_id')
                            .setLabel('Guild ID (Tự nhận diện - Không bắt buộc)')
                            .setValue(currentGuildId)
                            .setStyle(TextInputStyle.Short)
                            .setRequired(false)
                    )
                );
                return interaction.showModal(modal);
            }

            if (action === 'stop_stream') {
                const stopped = await stopVoiceStreamer(client, uid);
                if (stopped) {
                    return interaction.reply({ content: "⏹️ **Đã tắt Live Share Màn Hình** và cho Bot + Tài khoản rời khỏi Voice Channel!", ephemeral: true });
                } else {
                    return interaction.reply({ content: "ℹ️ Hiện tại bạn chưa bật phiên Live nào.", ephemeral: true });
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
                const channelId = interaction.fields.getTextInputValue('channel_id').trim();
                const mediaUrl = interaction.fields.getTextInputValue('media_url').trim();
                const guildId = interaction.fields.getTextInputValue('guild_id').trim() || interaction.guildId || '';

                saveToken(uid, token);
                db.set('voice_streams', uid, { streamerToken: token, guildId, channelId, mediaUrl });

                await interaction.deferReply({ ephemeral: true });
                const res = await startVoiceStreamer(client, uid, token, guildId, channelId, mediaUrl);

                if (res.ok) {
                    const stopRow = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId('v2:all:stop_stream')
                            .setLabel('⏹️ Dừng Live Ngay')
                            .setStyle(ButtonStyle.Secondary)
                    );
                    return interaction.followUp({
                        content: `🚀 **Đã bật Stream Share Voice Anti-Ban!**\n• **Phòng Voice:** <#${channelId}>\n• **Chế độ phát:** ${mediaUrl ? `🔁 Loop Link (${mediaUrl})` : '⬛ Màn hình đen Anti-Ban'}\n• **Bot treo chung:** Đã tự động tham gia cùng phòng!`,
                        components: [stopRow],
                        ephemeral: true
                    });
                } else {
                    return interaction.followUp({
                        content: `❌ **Không thể khởi động Stream:** ${res.msg}`,
                        ephemeral: true
                    });
                }
            }
        }

        if (interaction.isButton() && interaction.customId.startsWith('hs:')) {
            const [, houseIdStr, ownerId] = interaction.customId.split(':');
            if (interaction.user.id !== ownerId) return interaction.reply({ content: "❌ Không phải bảng của bạn.", ephemeral: true });
            const token = getSavedToken(ownerId);
            if (!token) return interaction.reply({ content: "❌ Bạn chưa lưu Token trên hệ thống! Vui lòng bấm 'Lưu Token' trước.", ephemeral: true });

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
