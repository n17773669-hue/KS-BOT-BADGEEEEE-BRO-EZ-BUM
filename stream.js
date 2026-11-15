// stream.js - tiến trình riêng cho MỖI phiên treo.
// Lõi giữ y hệt file index.js chạy được (joinVoice -> mute -> createStream -> ffmpeg).
// File này được bot.js tự gọi, KHÔNG chạy tay.

const { Client } = require('discord.js-selfbot-v13');
const { Streamer } = require('@dank074/discord-video-stream');
const prism = require('prism-media');

const TOKEN = process.env.STREAM_TOKEN;
const CHANNEL_ID = process.env.STREAM_CHANNEL_ID;
const MEDIA_URL = process.env.STREAM_MEDIA_URL || '';

// ===== Cấu hình cho NHẸ (chỉnh ở đây nếu muốn nét hơn) =====
// Màn hình đen: không cần nét nên để thấp để tiết kiệm CPU/RAM.
// Nếu stream không lên hình, thử đổi lại 1280x720 / 30fps / 1000k như bản gốc.
const BLACK = { size: '640x360', fps: 15, bitrate: '250k' };
// Video loop (Pinterest / mp4)
const VIDEO = { width: 854, height: 480, fps: 24, bitrate: '600k' };
// ============================================================

let finished = false;
let streaming = false;

function send(msg) {
    if (process.send) process.send(msg);
}

function fail(code, text) {
    if (finished) return;
    finished = true;
    send({ type: 'error', code, text });
    setTimeout(() => process.exit(1), 500);
}

function withTimeout(promise, ms, label) {
    let t;
    const timeout = new Promise((_, reject) => {
        t = setTimeout(() => reject(new Error(`TIMEOUT: ${label} quá ${ms / 1000}s`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// Bot chính chết / dừng phiên -> tiến trình này tự thoát
process.on('disconnect', () => process.exit(0));

process.on('uncaughtException', (e) => {
    console.error('[stream] uncaughtException:', e);
    if (!streaming) fail('CRASH', `❌ Lỗi không mong muốn: ${e.message}`);
});
process.on('unhandledRejection', (e) => {
    console.error('[stream] unhandledRejection:', e);
    if (!streaming) fail('CRASH', `❌ Lỗi không mong muốn: ${e && e.message ? e.message : e}`);
});

if (!TOKEN || !CHANNEL_ID) {
    fail('BAD_INPUT', '❌ Thiếu Token hoặc Voice Channel ID.');
} else {
    const client = new Client({ checkUpdate: false });

    // Nếu 30s chưa đăng nhập xong -> báo lỗi
    const loginTimer = setTimeout(() => {
        fail('LOGIN_TIMEOUT', '❌ Đăng nhập tài khoản streamer quá lâu (30s). Token có thể sai hoặc acc đang bị Discord chặn tạm thời.');
    }, 30000);

    client.once('ready', async () => {
        clearTimeout(loginTimer);
        console.log(`[+] Đã đăng nhập thành công với tài khoản: ${client.user.tag}`);

        try {
            // Tìm phòng voice, tự lấy Guild ID từ phòng
            const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
            if (!channel || !channel.guild) {
                return fail('NO_CHANNEL', `❌ Không tìm thấy Voice Channel \`${CHANNEL_ID}\`.\nKiểm tra lại ID, hoặc tài khoản streamer chưa tham gia server chứa phòng đó.`);
            }
            if (typeof channel.isVoice === 'function' && !channel.isVoice()) {
                return fail('NOT_VOICE', `❌ Kênh \`${CHANNEL_ID}\` không phải kênh Voice.`);
            }
            const guildId = channel.guild.id;
            console.log(`[+] Tìm thấy phòng: ${channel.name} (server: ${channel.guild.name})`);
            send({ type: 'channel', guildId, channelName: channel.name });

            const streamer = new Streamer(client);

            console.log('[+] Đang kết nối vào Voice Channel...');
            try {
                await withTimeout(streamer.joinVoice(guildId, CHANNEL_ID), 20000, 'vào voice');
            } catch (e) {
                console.error(e);
                return fail('JOIN_TIMEOUT', `❌ Không vào được phòng voice <#${CHANNEL_ID}> (quá 20 giây).\nCó thể acc streamer không có quyền **Kết nối** vào phòng, phòng đã đầy, hoặc phòng bị giới hạn.`);
            }
            console.log('[+] Đã vào phòng voice thành công!');

            // Khóa cứng Mic (Mute)
            await client.ws.broadcast({
                op: 4,
                d: {
                    guild_id: guildId,
                    channel_id: CHANNEL_ID,
                    self_mute: true,
                    self_deaf: false
                }
            });
            console.log('[+] Đã khóa cứng Mic (Mute) thành công!');

            console.log('[+] Đang khởi tạo luồng stream...');
            const udpStream = await withTimeout(streamer.createStream(), 20000, 'tạo luồng stream');

            let args;
            if (MEDIA_URL) {
                args = [
                    '-re',
                    '-stream_loop', '-1',
                    '-i', MEDIA_URL,
                    '-vf', `scale=${VIDEO.width}:${VIDEO.height}:force_original_aspect_ratio=decrease,pad=${VIDEO.width}:${VIDEO.height}:(ow-iw)/2:(oh-ih)/2`,
                    '-pix_fmt', 'yuv420p',
                    '-vcodec', 'libx264',
                    '-preset', 'ultrafast',
                    '-tune', 'zerolatency',
                    '-threads', '1',
                    '-r', String(VIDEO.fps),
                    '-g', String(VIDEO.fps * 2),
                    '-b:v', VIDEO.bitrate,
                    '-an',
                    '-f', 'rtsp',
                    udpStream
                ];
            } else {
                args = [
                    '-f', 'lavfi',
                    '-i', `color=c=black:s=${BLACK.size}:r=${BLACK.fps}`,
                    '-pix_fmt', 'yuv420p',
                    '-vcodec', 'libx264',
                    '-preset', 'ultrafast',
                    '-tune', 'zerolatency',
                    '-threads', '1',
                    '-r', String(BLACK.fps),
                    '-g', String(BLACK.fps * 2),
                    '-b:v', BLACK.bitrate,
                    '-f', 'rtsp',
                    udpStream
                ];
            }

            const ffmpeg = new prism.FFmpeg({ args });
            ffmpeg.on('error', (e) => {
                console.error('[stream] ffmpeg lỗi:', e);
                if (!streaming) fail('FFMPEG', `❌ ffmpeg lỗi: ${e.message}`);
                else send({ type: 'ended', reason: `ffmpeg lỗi: ${e.message}` });
            });

            streaming = true;
            finished = true;
            console.log('[+] Stream đang chạy ngầm ổn định!');
            send({ type: 'ready', channelName: channel.name });
        } catch (error) {
            console.error('[-] Có lỗi xảy ra khi stream:', error);
            fail('ERROR', `❌ Lỗi khi stream: ${error.message}`);
        }
    });

    // Token sai -> login ném lỗi
    client.login(TOKEN).catch((err) => {
        clearTimeout(loginTimer);
        console.error('[-] Lỗi đăng nhập:', err);
        fail('TOKEN_INVALID', `❌ Token không hợp lệ hoặc không đăng nhập được.\nChi tiết: ${err.message}`);
    });
}
