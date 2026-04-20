import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { createInterface } from 'readline';
import { handleCommand } from './handler.js';

const logger = pino({ level: 'silent' });

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    printQRInTerminal: false,
    browser: ['WA Blast Bot', 'Chrome', '1.0.0']
  });

  // Pairing code jika belum login
  if (!sock.authState.creds.registered) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const phoneNumber = await new Promise(resolve => {
      rl.question('\n📱 Masukkan nomor HP bot (contoh: 6285123533466): ', ans => {
        rl.close();
        resolve(ans.trim().replace(/[^0-9]/g, ''));
      });
    });

    await new Promise(resolve => setTimeout(resolve, 3000));
    const code = await sock.requestPairingCode(phoneNumber);
    const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
    console.log(`\n✅ PAIRING CODE: ${formatted}`);
    console.log('👉 Buka WA > Perangkat Tertaut > Tautkan Perangkat > Masukkan Kode\n');
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('🔴 Koneksi terputus. Reconnect:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('🟢 Bot terhubung ke WhatsApp!');
      console.log('📋 Prefix: . (titik)');
      console.log('📋 Commands: .template | .addbutton | .delbutton | .listbutton | .preview | .test | .cleartemplate');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    if (isGroup) return; // hanya private chat

    // Ambil body pesan
    const body =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      '';

    if (!body.startsWith('.')) return;

    await handleCommand(sock, msg, body);
  });
}

startBot();
