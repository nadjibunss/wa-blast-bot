import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  PHONENUMBER_MCC
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
    generateHighQualityLinkPreview: false,
    shouldIgnoreJid: jid => jid.includes('@broadcast')
  });

  // Pairing code jika belum login
  if (!state.creds.registered) {
    let phoneNumber = await question('\n📱 Masukkan nomor HP bot (contoh: 6285123533466): ');
    phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

    if (!Object.keys(PHONENUMBER_MCC).some(v => phoneNumber.startsWith(v))) {
      console.log('⚠️  Kode negara tidak dikenali, tapi tetap mencoba...');
    }

    console.log('⏳ Menunggu socket siap...');
    // Tunggu sampai socket ready sebelum request pairing
    await new Promise(resolve => {
      const check = () => {
        if (sock.ws.readyState === 1) return resolve();
        setTimeout(check, 500);
      };
      check();
    });

    try {
      const code = await sock.requestPairingCode(phoneNumber);
      const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log(`\n╔══════════════════════════╗`);
      console.log(`║  PAIRING CODE: ${formatted.padEnd(11)}║`);
      console.log(`╚══════════════════════════╝`);
      console.log('👉 WA → Perangkat Tertaut → Tautkan dengan nomor telepon\n');
    } catch (e) {
      console.error('❌ Gagal request pairing code:', e.message);
      process.exit(1);
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = new Boom(err)?.output?.statusCode;

      console.log('🔴 Koneksi terputus | Status:', statusCode, '|', err?.message || '');

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('🚪 Bot di-logout. Hapus folder session/ lalu jalankan ulang.');
        process.exit(0);
      } else if (statusCode === DisconnectReason.restartRequired) {
        console.log('🔄 Restart required, reconnecting...');
        startBot();
      } else if (statusCode === 405) {
        console.log('⚠️  WA menolak koneksi (405). Hapus folder session/ lalu coba lagi.');
        process.exit(1);
      } else {
        console.log('🔁 Mencoba reconnect dalam 5 detik...');
        setTimeout(startBot, 5000);
      }
    } else if (connection === 'connecting') {
      console.log('🔵 Sedang menghubungkan ke WhatsApp...');
    } else if (connection === 'open') {
      console.log('🟢 Bot berhasil terhubung ke WhatsApp!');
      console.log(`👤 Nomor: ${sock.user?.id}`);
      console.log('📋 Prefix: . (titik)');
      console.log('📋 Ketik .help di WA untuk melihat commands\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg?.message) return;

    const jid = msg.key.remoteJid;
    if (!jid) return;
    if (jid.endsWith('@g.us')) return; // skip group
    if (jid === 'status@broadcast') return;

    // Ambil body pesan
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
      console.error('❌ Error handler:', e.message);
      await sock.sendMessage(jid, { text: '❌ Error: ' + e.message }, { quoted: msg }).catch(() => {});
    }
  });
}

startBot().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
