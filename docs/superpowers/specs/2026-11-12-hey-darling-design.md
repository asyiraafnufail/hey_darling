# Desain Sistem: Hey Darling (Aplikasi Chat & Voice Call PWA Murni 1-on-1)

Tanggal: 2026-11-12  
Status: Draf Revisi (PWA Web Murni — 100% Gratis Tanpa Akun Apple Developer)  
Target Platform: Progressive Web App (PWA) untuk iOS (Safari / Home Screen) & Android (Chrome / Mobile Browser) serta Desktop Browser

---

## 1. Intent dan Mengapa (The Why)

Aplikasi `hey_darling` adalah aplikasi komunikasi privat yang dibuat khusus hanya untuk 2 orang (pengguna dan pasangannya).

**Alasan Beralih dari Flutter Native ke PWA Web Murni**:
1. **Nol Biaya untuk iOS & Android**:
   - Push notification latar belakang (layar mati) pada native iOS mewajibkan Apple Developer Account berbayar ($99/tahun).
   - Sejak **iOS 16.4+**, Apple resmi mendukung standar **W3C Web Push** untuk PWA yang ditambahkan ke Home Screen ("Add to Home Screen"). Ini memungkinkan push notification saat layar mati di iPhone **100% GRATIS** tanpa biaya tahunan, sama seperti di Android.
2. **Ukuran dan Performa Sangat Ringan**:
   - Flutter Web menghasilkan bundle awal berukuran besar (CanvasKit/Wasm 2–4 MB) dan boros baterai browser HP.
   - PWA Web Murni (HTML5, Modern CSS, Vanilla JavaScript / ESM ringan, Service Worker) berukuran total **< 100 KB**, memuat halaman secara instan (< 100 ms), hemat RAM, dan sangat irit baterai.
3. **Efisiensi Ekstrem Kuota Supabase Free Tier**:
   - Mempertahankan kuota gratis Supabase (500 MB DB, 5 GB egress/bulan, 200 koneksi Realtime, 500K Edge Function/bulan, dan anti-pause 7 hari).

---

## 2. Goals, Non-Goals, dan Anti-Goals

### 2.1. Goals
- **G1**: Registrasi dan login akun email + password langsung di web, terkunci ketat maksimal 2 pengguna sah (whitelist `allowed_emails` / batas 2 akun via trigger DB).
- **G2**: Chat teks 1-on-1 real-time dengan UI responsif **mobile-first sekaligus nyaman di desktop browser** (shortcut `Enter` untuk kirim, `Shift+Enter` untuk baris baru, tampilan terpusat rapi di layar lebar) (Fase 1).
- **G3**: Push notification saat layar mati atau browser ditutup menggunakan standar **W3C Web Push (VAPID)** melalui Service Worker (`sw.js`) pada **iOS (Home Screen PWA), Android, dan Desktop Browser**, termasuk dukungan multi-perangkat per pengguna (misal HP + Laptop menerima notifikasi secara bersamaan) (Fase 1).
- **G4**: Minimalisir kuota Supabase Free Tier secara agresif:
  - Cache riwayat percakapan lokal di setiap browser menggunakan **IndexedDB native**.
  - Mekanisme **delta sync** (hanya menarik pesan baru `created_at > last_synced_at` saat tab aktif kembali).
  - Skema tabel minimalis tanpa tabel perantara (`conversations`, `rooms`, `participants`).
  - Pemutusan koneksi WebSocket Supabase Realtime otomatis saat tab web tidak aktif / layar mati (`visibilitychange`).
- **G5**: Mekanisme auto-ping / keep-alive otomatis agar Supabase Free Tier tidak terkena auto-pause 7 hari.
- **G6**: Panggilan suara berbasis internet 1-on-1 langsung di browser (HP & Desktop) menggunakan API native **WebRTC (`RTCPeerConnection`)** dengan signaling Supabase Realtime Broadcast (Fase 2).
- **G7**: Kemudahan instalasi PWA: file `manifest.webmanifest` lengkap dengan ikon, standalone display, dan petunjuk jelas "Add to Home Screen" di Safari iOS maupun install PWA di desktop.

### 2.2. Non-Goals
- **NG1**: Tidak ada grup chat, profil publik, atau fitur multi-user.
- **NG2**: Tidak ada upload foto/video/file besar di Fase 1 (menjaga egress dan storage tetap di bawah 10 MB).
- **NG3**: Tidak ada typing indicator, presence heartbeat online/offline berulang, atau per-message read receipt di Fase 1.
- **NG4**: Tidak menggunakan framework frontend besar (React, Angular, Vue, atau Flutter Web). Cukup Vanilla JavaScript modular / ES Modules atau Vite minimalis.

### 2.3. Anti-Goals
- **AG1**: Mewajibkan biaya langganan apa pun (bebas biaya $99 Apple Developer dan biaya server hosting; hosting statis di Cloudflare Pages / Vercel / GitHub Pages gratis).
- **AG2**: Melakukan full-fetch pesan dari Supabase setiap kali web dibuka.
- **AG3**: Notifikasi Web Push gagal di iOS karena pengguna tidak dipandu untuk melakukan "Add to Home Screen" (syarat mutlak iOS Web Push).

---

## 3. Batasan Teknis (Constraints)

1. **Persyaratan iOS**:
   - iPhone harus menjalankan **iOS 16.4 atau lebih baru**.
   - Pengguna iPhone **wajib menambahkan web ke Home Screen** ("Share" -> "Add to Home Screen") dan membuka aplikasi dari ikon Home Screen tersebut agar izin notifikasi Web Push dapat diaktifkan.
   - Izin notifikasi (`Notification.requestPermission()`) di iOS Safari **wajib** dipicu langsung oleh klik tombol oleh pengguna (*user gesture*), tidak bisa dipanggil otomatis saat halaman dimuat.
   - **Batasan PWA Panggilan Masuk (Fase 2)**: PWA web tidak memiliki akses ke Apple CallKit / Android ConnectionService native. Saat layar mati, panggilan masuk berbunyi/tampil sebagai **notifikasi push prioritas tinggi** (ketuk notifikasi untuk langsung membuka layar panggilan dan terhubung ke WebRTC), bukan layar telepon bawaan penuh seperti WhatsApp native.
2. **Backend**: Supabase Free Tier (PostgreSQL, GoTrue Auth, Realtime Broadcast/Postgres Changes, Edge Functions).
3. **Standar Web Push & Keamanan Kunci**:
   - Menggunakan sepasang kunci VAPID (*Voluntary Application Server Identification*): `VAPID_PUBLIC_KEY` (aman di frontend) dan `VAPID_PRIVATE_KEY` (rahasia mutlak di Supabase Secrets).
   - `SUPABASE_URL` dan `SUPABASE_ANON_KEY` disimpan di `config.js` frontend (aman karena semua akses data dikunci oleh RLS & trigger whitelist 2 akun); `SUPABASE_SERVICE_ROLE_KEY` hanya disimpan di Supabase Edge Functions.
   - Browser menghasilkan endpoint push (`push.apple.com` untuk iOS, `fcm.googleapis.com` untuk Android/Chrome).
4. **Hosting Web Frontend**:
   - File statis murni (`index.html`, `style.css`, `app.js`, `sw.js`, `manifest.webmanifest`).
   - Dapat dihosting gratis di **Cloudflare Pages**, **Vercel**, atau **GitHub Pages** dengan SSL HTTPS wajib (syarat Service Worker & Web Push).

---

## 4. Keputusan Arsitektur & Desain Rinci (The How)

### 4.1. Manajemen Akun & Penguncian 2 Pengguna

Registrasi menggunakan form email & password di web via Supabase JS SDK:
1. **Tabel Whitelist & Kuota 2 User**:
   ```sql
   create table public.allowed_emails (
       email text primary key
   );
   ```
2. **Trigger Database `handle_new_user()`**:
   - Dipasang `after insert on auth.users`.
   - Jika `allowed_emails` ada isinya: validasi bahwa email pendaftar ada di `allowed_emails`.
   - Jika `allowed_emails` kosong: izinkan pendaftaran selama jumlah baris di `public.profiles` masih `< 2`.
   - Jika batas terlampaui atau tidak sah: `raise exception 'Pendaftaran ditolak'`, membatalkan signup.
3. **RLS (Row Level Security)**:
   - `public.profiles` dan `public.messages` hanya dapat diakses oleh user terautentikasi yang ada di `profiles`.

---

### 4.2. Skema Database Minimalis

```sql
-- 1. Profil Pengguna
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null,
    updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Profil dapat dibaca oleh user sah"
on public.profiles for select to authenticated
using (exists (select 1 from public.profiles where id = auth.uid()));

create policy "User dapat update profil sendiri"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- 2. Langganan Web Push Multi-Device (Mendukung HP + Laptop sekaligus)
create table public.push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    updated_at timestamptz not null default now()
);

create index idx_push_subs_user_id on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "User dapat mengelola push subscription sendiri"
on public.push_subscriptions for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- 3. Pesan Chat (Hanya 1 percakapan bersama)
create table public.messages (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references auth.users(id) on delete cascade,
    body text not null check (char_length(body) between 1 and 2000),
    created_at timestamptz not null default now()
);

create index idx_messages_created_at on public.messages (created_at desc);

alter table public.messages enable row level security;

create policy "Pesan dapat dibaca oleh user sah"
on public.messages for select to authenticated
using (exists (select 1 from public.profiles where id = auth.uid()));

create policy "User dapat kirim pesan atas nama sendiri"
on public.messages for insert to authenticated
with check (
    auth.uid() = sender_id and
    exists (select 1 from public.profiles where id = auth.uid())
);
```

---

### 4.3. Strategi Penghematan Egress & Baterai (IndexedDB & Lifecycle)

1. **Penyimpanan Lokal IndexedDB Native**:
   - Browser menyimpan pesan di IndexedDB lokal (`store: 'messages'`, key: `id`, index: `created_at`).
   - Kapasitas IndexedDB di browser HP mencapai ratusan megabyte tanpa memperlambat memori tab.
2. **Delta Sync**:
   - Buka pertama: Ambil 50 pesan terakhir (`order by created_at desc limit 50`).
   - Kembali aktif / buka ulang: Baca `max(created_at)` dari IndexedDB lokal (`last_synced_at`), lalu panggil:
     `select id, sender_id, body, created_at from public.messages where created_at > :last_synced_at order by created_at asc limit 200`.
   - Scroll ke atas: Ambil batch 50 pesan sebelumnya (`created_at < oldest_local_created_at`).
3. **Manajemen Lifecycle Koneksi Realtime**:
   - Saat tab aktif (`document.visibilityState === 'visible'`): Berlangganan Supabase Realtime channel `postgres_changes` untuk event `INSERT` pada tabel `messages`.
   - Saat tab tertutup/layar mati (`document.visibilityState === 'hidden'`): Channel Realtime langsung di-*unsubscribe*. Tidak ada WebSocket yang menahan kuota concurrent saat layar mati; notifikasi ditangani oleh Service Worker.
   - Saat tab aktif kembali: Jalankan 1 query **delta sync** dan buka kembali channel Realtime.

---

### 4.4. Push Notification Layar Mati (Standar W3C Web Push VAPID Multi-Perangkat)

1. **Alur di Sisi Klien (PWA HP & Desktop)**:
   - Pengguna menekan tombol "Aktifkan Notifikasi" di antarmuka web (wajib via aksi klik pengguna agar lolos kebijakan izin iOS Safari).
   - Browser mendaftarkan Service Worker: `navigator.serviceWorker.register('/sw.js')`.
   - Meminta izin: `Notification.requestPermission()`.
   - Berlangganan push:
     ```javascript
     const sub = await registration.pushManager.subscribe({
       userVisibleOnly: true,
       applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
     });
     ```
   - Komponen langganan (`endpoint`, `p256dh`, `auth`) disimpan/di-upsert ke tabel `public.push_subscriptions` milik `auth.uid()`.
   - Jika pengguna membuka dan mengaktifkan notifikasi di HP DAN Laptop, kedua endpoint tersimpan secara independen sehingga kedua perangkat sama-sama berdering saat ada pesan.
2. **Alur di Sisi Server (Supabase)**:
   - Database Webhook memanggil Edge Function `notify-message` setiap kali ada baris baru di `public.messages`.
   - Edge Function mengambil semua baris `endpoint`, `p256dh`, `auth` dari `public.push_subscriptions` milik penerima (`user_id != record.sender_id`).
   - Edge Function menandatangani header VAPID dengan `VAPID_PRIVATE_KEY` dan mengirim push ke semua endpoint aktif milik pasangan.
   - Jika endpoint mengembalikan HTTP status `410 Gone` atau `404 Not Found` (misal browser di-uninstall atau izin dicabut), Edge Function otomatis menghapus baris endpoint usang tersebut dari `public.push_subscriptions` (membersihkan DB secara otomatis).
3. **Penerimaan di Service Worker (`sw.js`)**:
   - `self.addEventListener('push', event => { ... })` terbangun di latar belakang oleh sistem operasi HP atau OS Desktop (macOS/Windows/Linux).
   - Menampilkan notifikasi via `self.registration.showNotification(senderName, { body, icon: '/icons/icon-192.png', badge: '/icons/badge.png', tag: 'chat-msg' })`.
   - `self.addEventListener('notificationclick', event => { ... clients.openWindow('/') })` memfokuskan tab atau membuka jendela baru saat notifikasi diklik.

---

### 4.5. Anti-Pause Database Supabase (Tetap Aktif Selamanya)

1. **Fungsi RPC Ringan**:
   ```sql
   create or replace function public.keep_alive()
   returns int language sql security definer as $$ select 1; $$;
   grant execute on function public.keep_alive() to anon, authenticated;
   ```
2. **Cron Scheduler Eksternal Gratis**:
   - Cloudflare Worker Cron atau cron-job.org memanggil `POST https://<project>.supabase.co/rest/v1/rpc/keep_alive` dengan `apikey: <ANON_KEY>` setiap 3 hari sekali.
   - Respon hanya 1 byte (`1`), 100% mencegah auto-pause tanpa makan kuota egress.
   - Disertakan file `.github/workflows/supabase-keepalive.yml` sebagai cadangan.

---

### 4.6. Arsitektur Frontend PWA Seringan Mungkin & Responsif Desktop

- **Struktur File Proyek**:
  ```text
  /
  ├── index.html              # Struktur UI chat & auth
  ├── style.css               # Gaya tampilan mobile-first & desktop centered (CSS native)
  ├── app.js                  # Logika UI, Auth, Chat, IndexedDB, & Realtime
  ├── sw.js                   # Service Worker untuk Web Push & offline caching
  ├── manifest.webmanifest    # Definisi PWA (nama, warna, icon, display: standalone)
  ├── icons/                  # Icon 192x192, 512x512, apple-touch-icon
  ├── supabase/               # Migrasi SQL & Edge Functions
  └── .github/workflows/      # Keep-alive workflow cadangan
  ```
- **Karakteristik & Kenyamanan Desktop**:
  - Ukuran total aset: **< 100 KB** (HTML + CSS + JS).
  - **Tata Letak Adaptif**: Di HP memenuhi layar penuh (`height: 100vh; height: 100dvh;` anti-glitch keyboard), di Desktop tampil sebagai container chat terpusat yang elegan (`max-width: 600px`) dengan bayangan halus.
  - **Ergonomi Keyboard**: Menekan tombol `Enter` langsung mengirim pesan, `Shift + Enter` membuat baris baru.
  - Menggunakan Supabase JS via CDN ESM resmi (`@supabase/supabase-js@2`) atau vendor lokal tunggal.
  - Tanpa framework kompilasi yang rumit; bisa langsung diuji coba dengan local HTTP server sederhana dan siap dideploy langsung ke Cloudflare Pages / Vercel / GitHub Pages.

- **Optimasi Ekstrem Lintas Browser (Windows, macOS, Android, iOS)**:
  1. **Nol Webfont Eksternal**: Memakai *system font stack* native (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`). Menghemat ~200-500 KB unduhan font dan menghilangkan jeda kedip teks (*FOIT/FOUT*).
  2. **Nol Icon Font Eksternal**: Ikon (kirim, logout, notif, telepon) dibuat langsung dengan SVG inline murni (< 1 KB total).
  3. **Kecepatan Muat < 10 ms (Cache Storage)**: Service Worker menyimpan aset statis dengan strategi *Cache-First*. Kunjungan kedua dan seterusnya di semua browser memuat instan dari cache lokal (0 byte egress).
  4. **Render DOM Ringan & Hemat RAM**: Manipulasi DOM menggunakan `DocumentFragment` dan batching rendering. Menjaga jumlah node DOM tetap di bawah 150 node pada satu waktu agar scrolling selalu stabil 60 FPS bahkan di laptop tua atau HP low-end.
  5. **Animasi Ringan (GPU-Only) & Skeleton Loading**:
     - Animasi UI tetap ada namun **hanya memakai properti `transform` dan `opacity`** (GPU-composited, bebas layout reflow), misalnya bubble pesan baru masuk fade + geser naik (`140ms ease-out`) dan efek tekan tombol (`scale(0.96)`), serta menghormati `@media (prefers-reduced-motion: reduce)`.
     - **Skeleton Loading**: Saat cek sesi login atau sinkronisasi awal (ketika cache lokal kosong / baru install), tampilkan placeholder skeleton gelembung chat sederhana dengan animasi pulse `opacity` yang sangat ringan (bukan layar kosong atau animasi berat). Indikator skeleton mini juga muncul di atas saat memuat pesan lama.
     - Menghindari filter berat (`backdrop-filter: blur()`) berlebihan yang sering membuat patah-patah pada GPU terintegrasi Windows/Android lawas. Desain mengutamakan warna bersih, rapi, dan cepat di-paint oleh engine browser apa pun (WebKit, Blink, Gecko).

---

### 4.7. Rencana Fase 2: Panggilan Suara Berbasis Internet (WebRTC P2P di Browser)

1. **Native WebRTC Browser**:
   - Menggunakan `navigator.mediaDevices.getUserMedia({ audio: true })` dan `new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })`.
   - Nol plugin eksternal, performa native browser C++.
2. **Signaling Melalui Supabase Realtime Broadcast**:
   - Event `call:offer`, `call:answer`, `call:candidate`, `call:end` dikirim lewat channel broadcast memori (0 byte disk database, 0 biaya).
3. **Panggilan Masuk saat Layar Mati**:
   - Sisi pemanggil memicu Edge Function `notify-call`.
   - Mengirim Web Push prioritas tinggi dengan payload tipe panggilan.
   - Service Worker menampilkan notifikasi panggilan masuk dengan tombol aksi ("Jawab" / "Tolak") atau membuka jendela panggilan saat diklik.

---

## 5. Yang Ditinggalkan untuk Builder (What's Left to the Builder)

1. Penulisan kode UI HTML/CSS yang bersih, modern, dan nyaman untuk tampilan mobile layar penuh (termasuk safe area notch iPhone).
2. Penulisan modul IndexedDB wrapper sederhana di `app.js` untuk simpan, ambil delta, dan pagination.
3. Pembuatan pasangan VAPID key (`npx web-push generate-vapid-keys`) dan penulisan Supabase Edge Function `notify-message` & `notify-call` berbasis Deno.
4. Pembersihan file-file boilerplate Flutter lama (`android/`, `ios/`, `pubspec.yaml`, dll.) agar repositori rapi dan berfokus murni pada PWA web.
5. Panduan ringkas bagi pengguna untuk deploy ke Cloudflare Pages / Vercel dan langkah "Add to Home Screen" di iPhone.

---

## 6. Keputusan Builder & Catatan Tambahan (Builder Settle Calls)

1. **Pemilihan Stack Frontend**:
   - Memilih Vanilla HTML5 + CSS3 + Modern JavaScript (ES Modules) tanpa bundler berat agar beban runtime di HP sekecil mungkin dan tidak ada build step yang rentan usang.
2. **Pembersihan Boilerplate Flutter**:
   - Folder bawaan Flutter (`android`, `ios`, `linux`, `macos`, `windows`, `web`, `lib`, `test`, `pubspec.yaml`) akan dibersihkan agar proyek menjadi repositori PWA web yang bersih dan terstruktur rapi.
3. **Kompatibilitas Safari iOS**:
   - `manifest.webmanifest` menyertakan `display: standalone` dan tag `<meta name="apple-mobile-web-app-capable" content="yes">` serta `<link rel="apple-touch-icon" ...>` agar pengalaman di iPhone terasa seperti aplikasi native tanpa bar URL Safari.

Semua kebutuhan arsitektur telah disesuaikan dan siap untuk disusun ke dalam rencana implementasi teknis.
