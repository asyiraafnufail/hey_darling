# Panduan Deployment Hey Darling (100% Gratis Selamanya)

Aplikasi ini berjalan sepenuhnya tanpa biaya server bulanan menggunakan **Supabase Free Tier**, **Cloudflare Pages / Vercel**, dan **W3C Web Push**.

---

## Langkah 1: Siapkan Proyek & Database Supabase

1. Buat proyek gratis di [supabase.com](https://supabase.com) (pilih region terdekat, misal `ap-southeast-1` Singapore).
2. Buka **SQL Editor** di Supabase Dashboard, salin seluruh isi file `supabase/migrations/20261112_init.sql`, lalu klik **Run**.
3. **(Sangat Disarankan) Kunci Akses Email Berdua**:
   Jalankan query berikut di SQL Editor dengan email Anda dan pasangan agar tidak ada orang lain yang bisa mendaftar:
   ```sql
   insert into public.allowed_emails (email) values
     ('email_kamu@gmail.com'),
     ('email_pacar@gmail.com');
   ```
   *(Catatan: Jika tabel `allowed_emails` dikosongkan, sistem tetap mengunci otomatis setelah 2 akun pertama berhasil mendaftar).*
4. **Aktifkan Realtime untuk Tabel `messages`**:
   - Masuk ke **Database -> Replication** (atau **Publications -> supabase_realtime**).
   - Pastikan tabel `messages` dicentang aktif.
5. **Pengaturan Auth Praktis (Opsional)**:
   - Masuk ke **Authentication -> Providers -> Email**.
   - Nonaktifkan **Confirm email** jika Anda ingin langsung masuk tanpa menunggu tautan verifikasi email.

---

## Langkah 2: Generate VAPID Keys & Deploy Edge Functions

Web Push membutuhkan pasangan kunci VAPID (gratis dan dihasilkan secara lokal sekali saja).

1. Hasilkan kunci VAPID dari terminal Anda:
   ```bash
   npx web-push generate-vapid-keys
   ```
   Simpan `Public Key` dan `Private Key`.

2. Install & login Supabase CLI, lalu hubungkan proyek Anda:
   ```bash
   npx supabase login
   npx supabase link --project-ref <PROJECT_REF_ANDA>
   ```

3. Simpan rahasia VAPID di Supabase Secrets:
   ```bash
   npx supabase secrets set \
     VAPID_PUBLIC_KEY=<VAPID_PUBLIC_KEY> \
     VAPID_PRIVATE_KEY=<VAPID_PRIVATE_KEY> \
     VAPID_SUBJECT=mailto:admin@example.com
   ```

4. Deploy kedua Edge Functions (`notify-message` dan `notify-call`):
   ```bash
   npx supabase functions deploy notify-message --no-verify-jwt
   npx supabase functions deploy notify-call --no-verify-jwt
   ```
   *(Catatan: `--no-verify-jwt` pada `notify-call` tetap aman karena fungsi memvalidasi sesi user secara langsung di dalam kode dan mencegah error saat proyek menggunakan Asymmetric JWT / Publishable Key baru).*

5. **Pasang Database Webhook untuk Notifikasi Chat**:
   - Di Supabase Dashboard -> **Database -> Webhooks -> Create a new hook**.
   - **Name**: `notify_new_message`
   - **Table**: `messages`
   - **Events**: Centang `INSERT` saja.
   - **Type**: `Supabase Edge Functions` -> Pilih `notify-message`.
   - Klik **Create webhook**.

---

## Langkah 3: Konfigurasi & Deploy Frontend Statis (HTTPS)

1. Edit `src/config.js` dan isi nilai dari **Supabase Dashboard -> Project Settings -> API**:
   - `SUPABASE_URL` (contoh: `https://xyzabc.supabase.co`)
   - `SUPABASE_ANON_KEY` (Anon public key)
   - `VAPID_PUBLIC_KEY` (Public key dari Langkah 2)

2. Deploy seluruh folder proyek statis ini (tanpa proses build apa pun) ke salah satu layanan gratis:
   - **Cloudflare Pages** (Recommended): Hubungkan repo Git atau upload folder langsung. *Build command*: kosongkan, *Build output directory*: `/`.
   - **Vercel**: Jalankan `npx vercel --prod` di folder root proyek.
   - **GitHub Pages**: Push ke GitHub lalu aktifkan Pages dari branch utama (`/`).

> **Penting**: Web Push dan WebRTC mikrofon mewajibkan HTTPS (sudah otomatis disediakan Cloudflare Pages, Vercel, dan GitHub Pages).

---

## Langkah 4: Aktifkan Anti-Pause (Wajib untuk Supabase Free Tier)

Ikuti panduan singkat 2 menit di `docs/keepalive-setup.md` agar database tidak pernah tertidur (*paused*) setelah 7 hari tanpa chat.

---

## Langkah 5: Cara Pakai & Aktifkan Notifikasi Layar Mati

### Di iPhone / iPad (iOS 16.4+)
1. Buka URL web aplikasi menggunakan **Safari** (bukan Chrome iOS).
2. Ketuk tombol **Bagikan (Share)** di bilah bawah Safari -> pilih **Tambahkan ke Layar Utama (Add to Home Screen)**.
3. **Buka aplikasi dari ikon Layar Utama** tersebut (jangan dari tab Safari biasa).
4. Login/Daftar, lalu ketuk ikon **Lonceng (Bell)** di pojok kanan atas dan pilih **Allow / Izinkan**. Notifikasi chat & panggilan kini tetap masuk saat layar iPhone mati.

### Di Android (Chrome / Edge)
1. Buka URL web di Chrome, pilih **Install App / Tambahkan ke Layar Utama**.
2. Ketuk ikon **Lonceng** di header dan izinkan notifikasi.

### Di Desktop (Windows / macOS)
1. Buka URL web di Chrome, Edge, Safari macOS, atau Firefox.
2. Ketuk ikon **Lonceng** di header untuk menerima notifikasi langsung ke desktop Anda.
3. Gunakan `Enter` untuk mengirim pesan dan `Shift + Enter` untuk baris baru.
