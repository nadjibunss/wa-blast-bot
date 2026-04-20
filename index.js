import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers
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

function waitForOpen(sock, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout: WS tidak terbuka dalam 30 detik')), timeoutMs);
    const iv = setInterval(() => {
      if (sock.ws?.readyState === 1) {
        clearInterval(iv);
        clearTimeout(timer);
        resolve();
      }
    }, 300);
  });
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();
  console.log(`\n📦 Using WA version: ${version.join('.')}`);

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: false,
    browser: Browsers.macOS('Safari'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    fireInitQueries: true,
    generateHighQualityLinkPreview: false,
    shouldSyncHistoryMessage: () => false
  });

  if (!state.creds.registered) {
    let phone = await question('\n📱 Nomor bot (contoh: 6285123533466): ');
    phone = phone.replace(/[^0-9]/g, '');

    console.log('⏳ Menunggu WS terhubung ke server WA...');
    try {
      await waitForOpen(sock);
    } catch (e) {
      console.error('❌', e.message);
      sock.end();
      return setTimeout(startBot, 3000);
    }

    await new Promise(r => setTimeout(r, 1500));

    try {
      const code = await sock.requestPairingCode(phone);
      const fmt = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log('\n╬══════════════════════════════╬');
      console.log(`  🔑 PAIRING CODE : ${fmt}`);
      console.log('╬══════════════════════════════╬');
      console.log('👉 WA → Perangkat Tertaut → Tautkan dg nomor telepon\n');
    } catch (e) {
      console.error('❌ Gagal pairing code:', e.message);
      sock.end();
      return setTimeout(startBot, 5000);
    }
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log('🔴 Disconnect | Code:', code, lastDisconnect?.error?.message || '');

      if (code === DisconnectReason.loggedOut) {
        console.log('🚪 Logged out. Hapus folder session/ lalu restart.');
        return process.exit(0);
      }
      if (code === 405 || code === 403) {
        console.log(`⚠️  WA menolak koneksi (${code}). Hapus session/ lalu coba lagi.`);
        return process.exit(1);
      }
      console.log('🔁 Reconnect 5 detik...');
      setTimeout(startBot, 5000);
    } else if (connection === 'connecting') {
      console.log('🔵 Menghubungkan...');
    } else if (connection === 'open') {
      console.log('🟢 Terhubung ke WhatsApp!');
      console.log(`👤 Akun: ${sock.user?.id?.split(':')[0]}`);
      console.log('📌 Ketik .help di WA untuk melihat commands\n');
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
      sock.sendMessage(jid, { text: '❌ Error: ' + e.message }, { quoted: msg }).catch(() => {});
    }
  });
}

startBot().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
