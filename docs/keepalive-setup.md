# Panduan Setup Keep-Alive Supabase Free Tier (Anti-Pause)

Supabase Free Tier otomatis menonaktifkan (*pause*) proyek jika tidak ada aktivitas API/Database selama **7 hari berturut-turut**. Pilih salah satu metode gratis di bawah ini agar database selalu aktif selamanya.

---

## Opsi 1: cron-job.org (Termudah — 2 Menit Tanpa Coding)

1. Buat akun gratis di [cron-job.org](https://cron-job.org).
2. Klik **Create Cronjob**:
   - **Title**: `Hey Darling Supabase Keep-Alive`
   - **URL**: `https://<PROJECT_REF>.supabase.co/rest/v1/rpc/keep_alive`
   - **Execution schedule**: Custom / Every 3 days (`0 0 */3 * *` atau tiap hari pukul 03:00).
3. Buka tab **Advanced**:
   - **Request method**: `POST`
   - **Headers**:
     - `apikey`: `<SUPABASE_ANON_KEY atau sb_publishable_...>`
     - `Content-Type`: `application/json`
     - *(Tambahkan `Authorization`: `Bearer <key>` **hanya jika** memakai legacy `anon` key yang diawali `eyJ`; jika memakai `Publishable key` baru `sb_publishable_...`, jangan isi `Authorization`)*
4. Klik **Save**. Database akan diping dengan response 1 byte (`1`) dan tidak pernah auto-pause.

---

## Opsi 2: Cloudflare Workers Cron (Paling Andal & Gratis Selamanya)

1. Buka Cloudflare Dashboard -> **Workers & Pages** -> **Create Worker**.
2. Salin isi script dari `scripts/cloudflare-worker-keepalive.js` ke editor Worker.
3. Di menu **Settings -> Variables**, tambahkan:
   - `SUPABASE_URL`: `https://<PROJECT_REF>.supabase.co`
   - `SUPABASE_ANON_KEY`: `<SUPABASE_ANON_KEY>`
4. Di menu **Triggers -> Cron Triggers**, tambahkan jadwal `0 0 */3 * *`.

---

## Opsi 3: GitHub Actions (Cadangan)

File `.github/workflows/supabase-keepalive.yml` sudah tersedia.
1. Tambahkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` di **GitHub Repo -> Settings -> Secrets and variables -> Actions**.
2. *Catatan*: GitHub otomatis mematikan cron workflow jika repositori tidak mendapat git commit selama 60 hari. Gunakan Opsi 1 atau 2 sebagai pengaman utama.
