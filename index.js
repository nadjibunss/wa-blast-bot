// index.js
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { createInterface } from 'readline';
import { Boom } from '@hapi/boom';
import { handleCommand } from './handler.js';

const logger = pino({ level: 'silent' });

function question(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(prompt, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  console.log('\n==============================');
  console.log(' WA Blast Bot - Pairing Code');
  console.log('==============================');
  console.log('Using WA version:', version.join('.'));

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    // QR kita matikan karena pakai pairing code
    printQRInTerminal: false,
    browser: Browsers.macOS('Safari'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  // FLAG: sudah pernah minta pairing code atau belum (biar tidak double)
  let pairingRequested = false;
  let phoneNumber = null;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // LOG state
    if (connection) console.log('connection =>', connection);

    // Pola resmi: minta pairing saat status connecting ATAU saat ada qr. [web:34][web:37][web:125]
    if (!state.creds.registered && !pairingRequested && (connection === 'connecting' || qr)) {
      pairingRequested = true;

      // Minta nomor sekali di sini
      if (!phoneNumber) {
        let input = await question('\n📱 Nomor bot (contoh: 6285123533466): ');
        input = input.replace(/[^0-9]/g, '');
        phoneNumber = input;
      }

      try {
        console.log('⏳ Meminta pairing code ke WhatsApp...');
        const code = await sock.requestPairingCode(phoneNumber); // [web:35][web:6]
        const formatted = code.match(/.{1,4}/g)?.join('-') || code;
        console.log('\n╔══════════════════════════════╗');
        console.log(`║  PAIRING CODE: ${formatted}  ║`);
        console.log('╚══════════════════════════════╝');
        console.log('👉 WA > Perangkat tertaut > Tautkan dengan nomor telepon\n');
      } catch (e) {
        pairingRequested = false;
        console.error('❌ Gagal request pairing code:', e.message);
        console.log('🔁 Coba lagi dalam 7 detik...');
        setTimeout(() => {
          // biarkan event connection.update jalan lagi lalu minta ulang
        }, 7000);
      }
    }

    // Handle disconnect [web:34][web:71]
    if (connection === 'close') {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('🔴 Koneksi terputus, code:', statusCode);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('🚪 Logged out. Hapus folder session/ untuk login ulang.');
        process.exit(0);
      } else if (statusCode === 405 || statusCode === 403) {
        console.log('⚠️ WA menolak koneksi (405/403). Biasanya karena IP / VPS diblokir.');
        console.log('   Coba ganti server/VPS lain, atau pakai proxy jaringan.');
        process.exit(1);
      } else {
        console.log('🔁 Reconnect 5 detik...');
        setTimeout(startBot, 5000);
      }
    }

    if (connection === 'open') {
      console.log('\n🟢 Bot terhubung ke WhatsApp!');
      console.log(`👤 Akun: ${sock.user?.id?.split(':')[0]}`);
      console.log('📌 Ketik .help di chat bot untuk lihat menu.\n');
    }
  });

  // Handler pesan
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
      await sock
        .sendMessage(jid, { text: '❌ Terjadi error: ' + e.message }, { quoted: msg })
        .catch(() => {});
    }
  });
}

startBot().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
