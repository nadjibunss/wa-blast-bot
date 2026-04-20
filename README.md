# WA Blast Bot 🤖

WhatsApp bot dengan fitur template pesan + URL button + pairing code.

## Install

```bash
npm install
```

## Jalankan

```bash
npm start
```

Nanti akan minta nomor HP untuk pairing code (format: `6285xxxxxxx`)

---

## Perintah

| Command | Keterangan |
|---|---|
| `.template <teks>` | Set template pesan teks |
| `.template` (reply gambar) | Set template dengan gambar |
| `.addbutton <label>\|<url>` | Tambah URL button ke template |
| `.delbutton <nomor>` | Hapus button nomor tertentu |
| `.listbutton` | Lihat semua button yang tersimpan |
| `.preview` | Preview template + button |
| `.test <nomor>` | Kirim template ke nomor tujuan |
| `.cleartemplate` | Hapus template & semua button |

---

## Contoh Penggunaan

```
.template Halo! Ini adalah pesan promo spesial untuk kamu 🎉

.addbutton Klaim Sekarang|https://wa.me/19845040852?text=解除限制

.addbutton Info Lebih Lanjut|https://wa.me/19845040852?text=info

.preview

.test 6283849080010
```

---

## Struktur File

```
wa-blast-bot/
├── index.js          # Main bot
├── handler.js        # Command handler
├── database.json     # Simpan template & button (auto generate)
├── session/          # Session WA (auto generate)
└── package.json
```
