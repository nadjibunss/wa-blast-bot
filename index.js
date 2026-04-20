import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { createInterface } from 'readline';
import { handleCommand } from './handler.js';
import { Boom } from '@hapi/boom';

const logger = pino({ level: 'silent' });

function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve =>
    rl.question(prompt, ans => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`\n📦 Baileys version: ${version.join('.')} | isLatest: ${isLatest}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: false,
    mobile: false,
    browser: ['Ubuntu', 'Chrome', '120.0.6099.71'],
    markOnlineOnConnect: true,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false
  });

  // Pairing code jika belum login
  if (!state.creds.registered) {
    let phoneNumber = await question('\n📱 Masukkan nomor HP bot (contoh: 6285123533466): ');
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    console.log('⏳ Menunggu koneksi ke server WA...');

    // Tunggu sampai WebSocket benar-benar open
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout koneksi ke WA')), 30000);
      const interval = setInterval(() => {
        if (sock.ws?.readyState === 1) {
          clearInterval(interval);
          clearTimeout(timeout);
          resolve();
        }
      }, 500);
    });

    // Delay kecil agar handshake selesai
    await new Promise(r => setTimeout(r, 2000));

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log(`\n╔═══════════════════════════════╗`);
      console.log(`║   PAIRING CODE : ${formatted}   ║`);
      console.log(`╚═══════════════════════════════╝`);
      console.log('👉 Buka WA → Perangkat Tertaut → Tautkan dengan nomor telepon\n');
    } catch (e) {
      console.error('\n❌ Gagal minta pairing code:', e.message);
      console.log('🔁 Coba lagi dalam 5 detik...');
      setTimeout(() => { sock.ws.close(); startBot(); }, 5000);
      return;
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('🔴 Koneksi terputus | Code:', statusCode);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('🚪 Bot di-logout. Hapus folder session/ lalu jalankan ulang.');
        process.exit(0);
      } else if (statusCode === 405) {
        console.log('⚠️  WA menolak (405). Hapus folder session/ dan coba lagi.');
        process.exit(1);
      } else {
        console.log('🔁 Reconnect dalam 5 detik...');
        setTimeout(startBot, 5000);
      }
    } else if (connection === 'connecting') {
      console.log('🔵 Menghubungkan ke WhatsApp...');
    } else if (connection === 'open') {
      console.log('🟢 Bot berhasil terhubung!');
      console.log(`👤 Akun: ${sock.user?.id?.split(':')[0]}`);
      console.log('📌 Ketik .help di WA untuk melihat semua perintah\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message) return;

    const jid = msg.key.remoteJid;
    if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return;

    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      msg.message?.videoMessage?.caption ||
      '';

    if (!body.startsWith('.')) return;

    try {
      await handleCommand(sock, msg, body);
    } catch (e) {
      console.error('❌ Handler error:', e.message);
      await sock.sendMessage(jid, { text: '❌ Error: ' + e.message }, { quoted: msg }).catch(() => {});
    }
  });
}

startBot().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
