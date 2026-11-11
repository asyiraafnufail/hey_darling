# Hey Darling

Aplikasi chat teks 1-on-1 dan panggilan suara internet P2P berbasis Progressive Web App (PWA) super ringan untuk iOS, Android, Windows, dan macOS dengan backend Supabase Free Tier.

Didesain khusus untuk pasangan berdua dengan prinsip zero-cost, ultra-hemat egress Supabase, dan privasi penuh.

---

## Fitur Utama

- **1-on-1 Chatting**: Riwayat percakapan instan tersinkronisasi dengan delta sync hemat bandwidth (< 1 KB per sinkronisasi) dan cache lokal IndexedDB.
- **Panggilan Suara Internet (VoIP P2P)**: Panggilan audio real-time WebRTC peer-to-peer menggunakan STUN publik Google (gratis selamanya, 0 beban media server, 0 egress).
- **Notifikasi Layar Mati (W3C Web Push)**: Tetap menerima notifikasi chat & panggilan saat HP terkunci atau aplikasi ditutup, berjalan di iOS 16.4+ (Home Screen), Android, dan Desktop browser.
- **Multi-Device Support**: Masing-masing pengguna dapat mengaktifkan notifikasi di HP dan laptop sekaligus tanpa token saling menimpa.
- **Kunci Akses Ketat 2 Pengguna**: Atomic trigger database menolak pendaftaran pihak ketiga secara otomatis (opsi whitelist email atau batas 2 pengguna).
- **Anti-Pause Otomatis**: RPC Postgres 1-byte dengan trigger cron eksternal agar database Supabase Free Tier tidak pernah tertidur setelah 7 hari.
- **Performa 60 FPS Super Ringan**: Total aset < 100 KB, tanpa framework berat, sistem font bawaan OS, ikon SVG inline, animasi GPU-only, dan pembatasan 150 DOM nodes untuk laptop/HP spek rendah.

---

## Struktur Berkas

```text
├── index.html                           # Kerangka aplikasi PWA & dialog panggilan
├── style.css                            # Desain responsif, tema gelap, animasi GPU-only
├── sw.js                                # Service Worker untuk offline cache & Web Push
├── manifest.webmanifest                 # Manifest instalasi PWA
├── icons/                               # Ikon PWA (192x192, 512x512, apple-touch-icon)
├── src/
│   ├── config.js                        # Kredensial publik Supabase & VAPID key
│   ├── app.js                           # Controller UI, lifecycle, dan keyboard handler
│   ├── api.js                           # Integrasi Supabase Auth, delta sync, dan Push
│   ├── db.js                            # Wrapper IndexedDB lokal
│   └── call.js                          # WebRTC P2P audio call & broadcast signaling
├── supabase/
│   ├── migrations/20261112_init.sql     # Schema database, RLS, trigger 2 user, RPC keepalive
│   └── functions/
│       ├── notify-message/              # Edge Function Web Push untuk pesan baru
│       └── notify-call/                 # Edge Function Web Push untuk panggilan suara
├── docs/
│   ├── deployment-guide.md              # Panduan setup & deployment langkah-demi-langkah
│   ├── keepalive-setup.md               # Panduan setup cron anti-pause Supabase
│   └── superpowers/                     # Dokumen arsitektur & rencana implementasi TDD
└── tests/                               # Test suite lengkap berbasis Node.js native test runner
```

---

## Menjalankan Pengujian

Proyek ini menggunakan test runner bawaan Node.js tanpa dependensi eksternal:

```bash
# Menjalankan seluruh test suite
npm test
```

---

## Panduan Deployment

Ikuti panduan lengkap di:
- [Panduan Deployment Hey Darling](docs/deployment-guide.md)
- [Panduan Anti-Pause Supabase](docs/keepalive-setup.md)
