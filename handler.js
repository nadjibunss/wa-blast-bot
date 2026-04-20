import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadMediaMessage } from '@whiskeysockets/baileys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'database.json');

// ── Helpers database ──────────────────────────────────────────────
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { template: { text: '', image: null }, buttons: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Build pesan dengan URL button ─────────────────────────────────
function buildButtonMessage(db) {
  const buttons = db.buttons.map((btn, i) => ({
    buttonId: `btn_${i}`,
    buttonText: { displayText: btn.label },
    type: 5, // URL button
    nativeFlowInfo: {
      name: 'cta_url',
      paramsJson: JSON.stringify({
        display_text: btn.label,
        url: btn.url,
        merchant_url: btn.url
      })
    }
  }));

  const base = {
    text: db.template.text || ' ',
    footer: '',
    buttons,
    headerType: db.template.image ? 4 : 1 // 4 = image, 1 = text
  };

  if (db.template.image) {
    return {
      image: Buffer.from(db.template.image, 'base64'),
      caption: db.template.text || '',
      footer: '',
      buttons,
      headerType: 4
    };
  }

  return base;
}

// ── Main handler ──────────────────────────────────────────────────
export async function handleCommand(sock, msg, body) {
  const jid = msg.key.remoteJid;
  const args = body.trim().split(' ');
  const command = args[0].toLowerCase();
  const param = args.slice(1).join(' ').trim();

  const reply = (text) =>
    sock.sendMessage(jid, { text }, { quoted: msg });

  const db = loadDB();

  // ── .template ────────────────────────────────────────────────────
  if (command === '.template') {
    const isImage =
      msg.message?.imageMessage ||
      (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);

    if (isImage) {
      // Ada gambar
      let imgBuffer;
      if (msg.message?.imageMessage) {
        imgBuffer = await downloadMediaMessage(msg, 'buffer', {});
      } else {
        // quoted image
        const quotedMsg = {
          key: {
            remoteJid: jid,
            id: msg.message.extendedTextMessage.contextInfo.stanzaId,
            participant: msg.message.extendedTextMessage.contextInfo.participant
          },
          message: msg.message.extendedTextMessage.contextInfo.quotedMessage
        };
        imgBuffer = await downloadMediaMessage(quotedMsg, 'buffer', {});
      }
      db.template.image = imgBuffer.toString('base64');
      db.template.text = param || '';
      saveDB(db);
      return reply(`✅ Template dengan gambar berhasil disimpan!\n\n📝 Teks: ${db.template.text || '(kosong)'}\n🖼️ Gambar: ada\n🔘 Buttons: ${db.buttons.length}`);
    }

    // Hanya teks
    if (!param) return reply('❗ Masukkan teks template.\nContoh: .template Halo ini pesan promo!');
    db.template.text = param;
    saveDB(db);
    return reply(`✅ Template teks berhasil disimpan!\n\n📝 Teks: ${param}\n🔘 Buttons: ${db.buttons.length}`);
  }

  // ── .addbutton ───────────────────────────────────────────────────
  if (command === '.addbutton') {
    if (!param) return reply('❗ Format: .addbutton <label>|<url>\nContoh: .addbutton Klaim|https://wa.me/19845040852?text=解除限制');

    const parts = param.split('|');
    let label, url;

    if (parts.length >= 2) {
      label = parts[0].trim();
      url = parts.slice(1).join('|').trim();
    } else {
      // Jika tidak ada pipe, pakai label saja dengan default URL
      label = param.trim();
      url = 'https://wa.me/19845040852?text=解除限制';
    }

    if (db.buttons.length >= 3) return reply('❗ Maksimal 3 button!');

    db.buttons.push({ label, url });
    saveDB(db);
    return reply(`✅ Button ditambahkan!\n\n🔘 Label: ${label}\n🔗 URL: ${url}\n\nTotal button: ${db.buttons.length}/3`);
  }

  // ── .delbutton ───────────────────────────────────────────────────
  if (command === '.delbutton') {
    const index = parseInt(param) - 1;
    if (isNaN(index) || index < 0 || index >= db.buttons.length)
      return reply(`❗ Nomor button tidak valid!\nGunakan .listbutton untuk melihat daftar.`);
    const removed = db.buttons.splice(index, 1);
    saveDB(db);
    return reply(`✅ Button "${removed[0].label}" berhasil dihapus!`);
  }

  // ── .listbutton ──────────────────────────────────────────────────
  if (command === '.listbutton') {
    if (!db.buttons.length) return reply('📋 Belum ada button yang ditambahkan.');
    const list = db.buttons.map((b, i) => `${i + 1}. 🔘 ${b.label}\n   🔗 ${b.url}`).join('\n\n');
    return reply(`📋 *Daftar Button (${db.buttons.length}/3)*\n\n${list}`);
  }

  // ── .preview ─────────────────────────────────────────────────────
  if (command === '.preview') {
    if (!db.template.text && !db.template.image)
      return reply('❗ Template belum diset! Gunakan .template terlebih dahulu.');
    if (!db.buttons.length)
      return reply('❗ Belum ada button! Gunakan .addbutton terlebih dahulu.');

    try {
      const msgContent = buildButtonMessage(db);
      await sock.sendMessage(jid, msgContent, { quoted: msg });
    } catch (e) {
      console.error(e);
      return reply('❌ Gagal preview: ' + e.message);
    }
    return;
  }

  // ── .test ────────────────────────────────────────────────────────
  if (command === '.test') {
    if (!param) return reply('❗ Masukkan nomor tujuan!\nContoh: .test 6283849080010');

    const nomor = param.replace(/[^0-9]/g, '');
    if (nomor.length < 10) return reply('❗ Nomor tidak valid!');

    if (!db.template.text && !db.template.image)
      return reply('❗ Template belum diset! Gunakan .template terlebih dahulu.');
    if (!db.buttons.length)
      return reply('❗ Belum ada button! Gunakan .addbutton terlebih dahulu.');

    const targetJid = nomor + '@s.whatsapp.net';

    // Cek apakah nomor ada di WA
    const [result] = await sock.onWhatsApp(targetJid);
    if (!result?.exists) return reply(`❌ Nomor ${nomor} tidak ditemukan di WhatsApp!`);

    await reply(`📤 Mengirim ke ${nomor}...`);

    try {
      const msgContent = buildButtonMessage(db);
      await sock.sendMessage(targetJid, msgContent);
      return reply(`✅ Pesan berhasil dikirim ke ${nomor}!`);
    } catch (e) {
      console.error(e);
      return reply(`❌ Gagal kirim: ${e.message}`);
    }
  }

  // ── .cleartemplate ───────────────────────────────────────────────
  if (command === '.cleartemplate') {
    db.template = { text: '', image: null };
    db.buttons = [];
    saveDB(db);
    return reply('✅ Template dan semua button berhasil dihapus!');
  }

  // ── .help ────────────────────────────────────────────────────────
  if (command === '.help' || command === '.menu') {
    return reply(
      `🤖 *WA Blast Bot Commands*\n\n` +
      `📝 *.template <teks>*\n   Set template teks\n\n` +
      `🖼️ *.template* (kirim/reply gambar)\n   Set template dengan gambar\n\n` +
      `🔘 *.addbutton <label>|<url>*\n   Tambah URL button (maks 3)\n   Contoh: .addbutton Klaim|https://wa.me/19845040852?text=解除限制\n\n` +
      `🗑️ *.delbutton <nomor>*\n   Hapus button (nomor dari .listbutton)\n\n` +
      `📋 *.listbutton*\n   Lihat semua button\n\n` +
      `👁️ *.preview*\n   Preview template + button\n\n` +
      `📤 *.test <nomor>*\n   Kirim template ke nomor\n   Contoh: .test 6283849080010\n\n` +
      `🗑️ *.cleartemplate*\n   Hapus template & semua button`
    );
  }
}
