# Hey Darling (PWA Web Murni 1-on-1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun aplikasi chat teks 1-on-1 (Fase 1) dan panggilan suara internet P2P (Fase 2) berbasis Progressive Web App (PWA) super ringan (< 100 KB), 100% gratis tanpa akun Apple Developer, dengan notifikasi layar mati (W3C Web Push VAPID multi-device), cache lokal IndexedDB + delta sync, serta auto-ping anti-pause Supabase Free Tier.

**Architecture:** Frontend statis murni (HTML5, Modern CSS, Vanilla JS ES Modules) dengan Service Worker untuk offline caching dan Web Push. Backend menggunakan Supabase Free Tier (Auth email/password, PostgreSQL dengan RLS & DB trigger pengunci 2 user, Realtime WebSocket untuk chat foreground, dan Edge Functions Deno untuk VAPID Web Push). Signaling panggilan suara P2P (Fase 2) dialirkan lewat Supabase Realtime Broadcast tanpa membebani disk database.

**Tech Stack:** Vanilla JavaScript (ESM), HTML5, CSS3 native, IndexedDB API, Service Worker API, W3C Web Push (VAPID), WebRTC native (`RTCPeerConnection`), Supabase JS SDK v2 (`@supabase/supabase-js`), Supabase Edge Functions (Deno), Node.js built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-12-hey-darling-design.md`

## Global Constraints

- Ukuran seluruh file aset frontend (HTML + CSS + JS) wajib di bawah 100 KB sebelum gzipping.
- Nol framework frontend eksternal (tidak menggunakan React, Vue, Angular, atau Flutter Web).
- Nol font eksternal (hanya system font stack OS) dan nol icon font (hanya inline SVG).
- Animasi UI hanya menggunakan properti GPU-composited (`transform` dan `opacity`), menghormati `@media (prefers-reduced-motion: reduce)`.
- Semua pembacaan pesan dari Supabase wajib memilih kolom eksplisit (`id, sender_id, body, created_at`), tidak pernah `SELECT *`.
- Koneksi Supabase Realtime wajib diputus saat tab tidak aktif/layar mati (`visibilitychange`) dan dihubungkan kembali dengan 1 delta query saat tab aktif.
- Pendaftaran akun dikunci ketat maksimal 2 pengguna sah (whitelist `allowed_emails` atau kuota 2 user via DB trigger).
- Semua test ditulis menggunakan `node:test` dan `node:assert` bawaan Node.js tanpa framework pengujian eksternal.

## Review Focus

1. **Pengiriman pesan saat offline / koneksi putus**: Pengguna menekan kirim saat koneksi internet terputus. Sistem harus menampilkan status pesan "gagal dikirim" dengan opsi coba lagi (retry), bukan error senyap atau kehilangan teks.
2. **Deduplikasi pesan pada sinkronisasi bersamaan**: Realtime WebSocket dan query delta sync menerima pesan yang sama secara bersamaan. IndexedDB dan UI harus mengabaikan duplikat berdasarkan `id` unik tanpa memicu scroll lompat.
3. **Langganan Web Push kedaluwarsa (`410 Gone`)**: Pengguna mencabut izin browser atau berganti perangkat, endpoint mengembalikan HTTP `410` atau `404`. Edge Function harus otomatis menghapus endpoint usang dari tabel `push_subscriptions` dan tetap mengirim notifikasi ke perangkat pasangan lainnya yang masih aktif.
4. **Pendaftaran pihak ketiga ditolak secara atomik**: Orang luar mencoba mendaftar setelah kuota 2 akun terpenuhi. Database trigger harus membatalkan transaksi pendaftaran secara atomik sehingga tidak ada baris yang tersisa di `auth.users` maupun `profiles`.
5. **Deteksi lingkungan iOS Safari non-standalone**: Pengguna membuka web langsung di tab Safari biasa sebelum menambahkan ke Home Screen. Antarmuka harus menampilkan panduan ramah "Tambahkan ke Layar Utama (Add to Home Screen) untuk mengaktifkan notifikasi" dan tidak crash saat memanggil API Push.

---

### Task 1: Pembersihan Template Flutter & Inisialisasi Proyek PWA

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Delete: `android/`, `ios/`, `linux/`, `macos/`, `windows/`, `web/`, `lib/`, `test/`, `pubspec.yaml`, `pubspec.lock`, `analysis_options.yaml`, `hey_darling.iml`
- Test: `tests/scaffold.test.mjs`

**Interfaces:**
- Consumes: Sistem file lokal
- Produces: Proyek PWA bersih berbasis Node.js package (`"type": "module"`) dengan script `npm test`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/scaffold.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('scaffold: root directory has clean PWA layout and no flutter artifacts', () => {
  assert.strictEqual(fs.existsSync('package.json'), true, 'package.json must exist');
  assert.strictEqual(fs.existsSync('.gitignore'), true, '.gitignore must exist');
  assert.strictEqual(fs.existsSync('pubspec.yaml'), false, 'pubspec.yaml must be removed');
  assert.strictEqual(fs.existsSync('lib'), false, 'lib/ must be removed');
  assert.strictEqual(fs.existsSync('android'), false, 'android/ must be removed');
  assert.strictEqual(fs.existsSync('ios'), false, 'ios/ must be removed');

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.strictEqual(pkg.type, 'module');
  assert.ok(pkg.scripts?.test, 'test script must be defined');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scaffold.test.mjs`  
Expected: FAIL (pubspec.yaml still exists, package.json missing)

- [ ] **Step 3: Hapus boilerplate Flutter & buat file package.json, .gitignore, README.md**

Hapus folder bawaan Flutter (`android`, `ios`, `linux`, `macos`, `windows`, `web`, `lib`, `test`, `pubspec.yaml`, `pubspec.lock`, `analysis_options.yaml`, `hey_darling.iml`).  
Buat `package.json`:
```json
{
  "name": "hey_darling",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test tests",
    "serve": "python3 -m http.server 8080"
  }
}
```
Buat `.gitignore` mengabaikan `node_modules/`, `.DS_Store`, `config.local.js`.  
Inisialisasi `git init` jika repositori git belum aktif.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scaffold.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean flutter template and scaffold pwa project structure"
```

---

### Task 2: Skema Database Supabase, RLS & Trigger Pengunci 2 Pengguna

**Files:**
- Create: `supabase/migrations/20261112_init.sql`
- Test: `tests/sql_schema.test.mjs`

**Interfaces:**
- Consumes: Spesifikasi tabel `allowed_emails`, `profiles`, `push_subscriptions`, `messages`, fungsi `keep_alive()`, dan trigger `handle_new_user()`.
- Produces: File migrasi SQL murni yang siap disalin ke Supabase SQL Editor.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/sql_schema.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('sql_schema: migration file defines required tables, constraints, rls, and triggers', () => {
  const sqlPath = 'supabase/migrations/20261112_init.sql';
  assert.strictEqual(fs.existsSync(sqlPath), true, 'SQL migration file must exist');

  const sql = fs.readFileSync(sqlPath, 'utf8');
  assert.ok(sql.includes('create table public.allowed_emails'), 'must create allowed_emails table');
  assert.ok(sql.includes('create table public.profiles'), 'must create profiles table');
  assert.ok(sql.includes('create table public.push_subscriptions'), 'must create push_subscriptions table');
  assert.ok(sql.includes('create table public.messages'), 'must create messages table');
  assert.ok(sql.includes('char_length(body) between 1 and 2000'), 'must enforce 2000 char limit on message body');
  assert.ok(sql.includes('idx_messages_created_at'), 'must create index on messages.created_at');
  assert.ok(sql.includes('idx_push_subs_user_id'), 'must create index on push_subscriptions.user_id');
  assert.ok(sql.includes('handle_new_user'), 'must define handle_new_user trigger function');
  assert.ok(sql.includes('keep_alive'), 'must define keep_alive RPC function');
  assert.ok(sql.includes('enable row level security'), 'must enable RLS on tables');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sql_schema.test.mjs`  
Expected: FAIL (file `supabase/migrations/20261112_init.sql` does not exist)

- [ ] **Step 3: Implement `supabase/migrations/20261112_init.sql`**

Tulis script SQL lengkap sesuai Section 4.1, 4.2, dan 4.5 dokumen desain:
- Pembuatan tabel `allowed_emails`, `profiles`, `push_subscriptions`, dan `messages`.
- Definisi RLS: hanya user terdaftar yang bisa membaca pesan dan profil; insert pesan mewajibkan `auth.uid() = sender_id`.
- Fungsi `handle_new_user()` yang memeriksa whitelist jika ada atau membatasi jumlah akun di `profiles` maksimal 2.
- Fungsi RPC `public.keep_alive()` `returns int` yang mengembalikan `1` dengan grant ke `anon, authenticated`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sql_schema.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261112_init.sql tests/sql_schema.test.mjs
git commit -m "feat(db): add supabase migration with 2-user lock, rls, and keepalive rpc"
```

---

### Task 3: Mekanisme Keep-Alive Anti-Pause Supabase Free Tier

**Files:**
- Create: `.github/workflows/supabase-keepalive.yml`
- Create: `scripts/cloudflare-worker-keepalive.js`
- Create: `docs/keepalive-setup.md`
- Test: `tests/keepalive.test.mjs`

**Interfaces:**
- Consumes: Endpoint `POST /rest/v1/rpc/keep_alive` dengan header `apikey: <ANON_KEY>`.
- Produces: Workflow GitHub Actions terjadwal dan Cloudflare Worker Cron trigger script untuk auto-ping 3 hari sekali.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/keepalive.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('keepalive: workflow and cloudflare script use correct rpc endpoint and cron cadence', () => {
  const ghWorkflow = fs.readFileSync('.github/workflows/supabase-keepalive.yml', 'utf8');
  assert.ok(ghWorkflow.includes("cron: '0 0 */3 * *'"), 'GH Action must run every 3 days');
  assert.ok(ghWorkflow.includes('/rest/v1/rpc/keep_alive'), 'GH Action must ping keep_alive rpc');

  const cfWorker = fs.readFileSync('scripts/cloudflare-worker-keepalive.js', 'utf8');
  assert.ok(cfWorker.includes('/rest/v1/rpc/keep_alive'), 'CF Worker must ping keep_alive rpc');
  assert.ok(cfWorker.includes('scheduled'), 'CF Worker must handle cron scheduled event');

  assert.strictEqual(fs.existsSync('docs/keepalive-setup.md'), true, 'Documentation guide must exist');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/keepalive.test.mjs`  
Expected: FAIL (files missing)

- [ ] **Step 3: Implement GitHub Actions workflow, Cloudflare Worker script, and setup docs**

- Buat `.github/workflows/supabase-keepalive.yml` dengan trigger `cron: '0 0 */3 * *'` dan `workflow_dispatch`, menjalankan `curl -f -X POST "${{ secrets.SUPABASE_URL }}/rest/v1/rpc/keep_alive" -H "apikey: ${{ secrets.SUPABASE_ANON_KEY }}"`.
- Buat `scripts/cloudflare-worker-keepalive.js` yang mengeksekusi `scheduled(event, env, ctx)` dengan `fetch(env.SUPABASE_URL + '/rest/v1/rpc/keep_alive', ...)`.
- Buat panduan `docs/keepalive-setup.md` menjelaskan cara setup 2 menit di cron-job.org dan Cloudflare Workers.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/keepalive.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/supabase-keepalive.yml scripts/cloudflare-worker-keepalive.js docs/keepalive-setup.md tests/keepalive.test.mjs
git commit -m "feat(keepalive): add automated 3-day cron ping via gh actions and cloudflare worker"
```

---

### Task 4: Modul Penyimpanan Lokal IndexedDB & Mesin Delta Sync (`src/db.js`)

**Files:**
- Create: `src/db.js`
- Test: `tests/db.test.mjs`

**Interfaces:**
- Consumes: IndexedDB API (didukung di iOS Safari, Android Chrome, Windows, dan macOS).
- Produces:
  - `openDB(): Promise<IDBDatabase>`
  - `saveMessages(messages: Array<{id, sender_id, body, created_at}>): Promise<number>`
  - `getLocalMessages(limit?: number, beforeTimestamp?: string): Promise<Array>`
  - `getLatestTimestamp(): Promise<string | null>`
  - `saveMeta(key: string, value: any): Promise<void>`
  - `getMeta(key: string): Promise<any>`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/db.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { createMemoryDB } from './helpers/mock-idb.mjs';

test('db: saveMessages stores deduplicated messages and updates latest timestamp', async () => {
  const db = createMemoryDB();
  const msgs = [
    { id: '1', sender_id: 'u1', body: 'Halo sayang', created_at: '2026-11-12T01:00:00Z' },
    { id: '2', sender_id: 'u2', body: 'Iya halo', created_at: '2026-11-12T01:05:00Z' },
  ];

  await db.saveMessages(msgs);
  // Duplicate save should not throw or duplicate
  await db.saveMessages([msgs[0]]);

  const stored = await db.getLocalMessages(10);
  assert.strictEqual(stored.length, 2);
  assert.strictEqual(stored[0].id, '1');
  assert.strictEqual(stored[1].id, '2');

  const latestTs = await db.getLatestTimestamp();
  assert.strictEqual(latestTs, '2026-11-12T01:05:00Z');
});

test('db: Review Focus 2 - deduplication ignores duplicate message id cleanly', async () => {
  const db = createMemoryDB();
  const msg = { id: 'dup-1', sender_id: 'u1', body: 'Tes', created_at: '2026-11-12T01:00:00Z' };
  await db.saveMessages([msg]);
  await db.saveMessages([msg]);
  const stored = await db.getLocalMessages(10);
  assert.strictEqual(stored.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.mjs`  
Expected: FAIL (`src/db.js` and mock helper missing)

- [ ] **Step 3: Implement `src/db.js` and test helper**

- Buat `tests/helpers/mock-idb.mjs` untuk menguji logika IndexedDB murni secara in-memory.
- Tulis `src/db.js` menggunakan API `indexedDB.open('hey_darling_db', 1)` dengan store `messages` (keyPath: `id`, index: `created_at`) dan store `meta` (keyPath: `key`).
- Fungsi `saveMessages` menggunakan transaction `readwrite` dengan operasi `put` (otomatis menimpa/mengabaikan duplikat tanpa error).
- Fungsi `getLocalMessages(limit = 50, beforeTimestamp = null)` mengambil pesan terurut berdasarkan `created_at`.
- Fungsi `getLatestTimestamp()` mengambil pesan dengan `created_at` tertinggi untuk kursor delta sync.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/db.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/db.test.mjs tests/helpers/mock-idb.mjs
git commit -m "feat(storage): implement indexeddb wrapper with delta sync timestamp tracking"
```

---

### Task 5: Modul Supabase Client, Auth & Jaringan Delta Sync (`src/api.js`)

**Files:**
- Create: `src/config.js`
- Create: `src/api.js`
- Test: `tests/api.test.mjs`

**Interfaces:**
- Consumes: Supabase JavaScript SDK, `src/db.js`, `src/config.js`.
- Produces:
  - `initSupabase(clientOverride?): SupabaseClient`
  - `createApi(client): ApiInstance` dengan method:
    - `login(email, password): Promise<{user, error}>`
    - `register(email, password, displayName): Promise<{user, error}>`
    - `logout(): Promise<void>`
    - `fetchDeltaMessages(sinceTimestamp?: string, limit?: number): Promise<Array>`
    - `sendMessage(body: string, senderId: string): Promise<{data, error}>`
    - `subscribeToMessages(onMessage: Function): { unsubscribe: Function }`
    - `syncPartnerProfile(currentUserId: string): Promise<{partnerProfile, error}>`
    - `savePushSubscription(userId: string, subscription: PushSubscriptionJSON, userAgent: string): Promise<{data, error}>`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/api.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { createMockSupabase } from './helpers/mock-supabase.mjs';
import { createApi } from '../src/api.js';

test('api: fetchDeltaMessages selects only explicit columns and orders by created_at asc', async () => {
  const mockClient = createMockSupabase();
  const api = createApi(mockClient);

  await api.fetchDeltaMessages('2026-11-12T01:00:00Z', 50);

  const query = mockClient.getLastQuery('messages');
  assert.strictEqual(query.selectedColumns, 'id, sender_id, body, created_at');
  assert.strictEqual(query.filters.gt.column, 'created_at');
  assert.strictEqual(query.filters.gt.value, '2026-11-12T01:00:00Z');
  assert.strictEqual(query.order.column, 'created_at');
  assert.strictEqual(query.order.ascending, true);
});

test('api: Review Focus 4 - register handles rejected signup atomically with clear error', async () => {
  const mockClient = createMockSupabase({
    signUpError: new Error('Pendaftaran ditolak: Akun tidak terdaftar dalam whitelist atau kuota penuh.')
  });
  const api = createApi(mockClient);

  const { user, error } = await api.register('stranger@evil.com', 'password123', 'Stranger');
  assert.strictEqual(user, null);
  assert.ok(error.message.includes('Pendaftaran ditolak'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api.test.mjs`  
Expected: FAIL (`src/api.js` missing)

- [ ] **Step 3: Implement `src/config.js` and `src/api.js`**

- Buat `src/config.js` berisi placeholder `SUPABASE_URL`, `SUPABASE_ANON_KEY`, dan `VAPID_PUBLIC_KEY`.
- Tulis `src/api.js` mengimplementasikan fungsi auth dan delta sync.
- Query delta sync mengeksekusi `.select('id, sender_id, body, created_at').gt('created_at', sinceTimestamp).order('created_at', { ascending: true }).limit(limit)`.
- Menggunakan factory pattern `createApi(client)` untuk memudahkan unit testing tanpa ketergantungan jaringan aktif.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/api.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.js src/api.js tests/api.test.mjs tests/helpers/mock-supabase.mjs
git commit -m "feat(api): implement supabase auth and minimal delta sync network client"
```

---

### Task 6: PWA Service Worker & Manifest Web Push (`sw.js`, `manifest.webmanifest`)

**Files:**
- Create: `sw.js`
- Create: `manifest.webmanifest`
- Create: `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`
- Test: `tests/pwa.test.mjs`

**Interfaces:**
- Consumes: W3C PWA Manifest standard & Service Worker Push API.
- Produces:
  - Cache Storage strategi Cache-First untuk aset statis (`/`, `/index.html`, `/style.css`, `/src/app.js`, `/src/api.js`, `/src/db.js`, `/src/config.js`, `/src/call.js`, `/manifest.webmanifest`, `/icons/`).
  - Event listener `push` untuk menampilkan notifikasi pesan saat browser tertutup/layar mati.
  - Event listener `notificationclick` untuk memfokuskan tab yang sudah ada atau membuka window baru.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/pwa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('pwa: manifest is valid JSON with standalone display and PNG icons', () => {
  const manifestRaw = fs.readFileSync('manifest.webmanifest', 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#1a1a1a');
  assert.ok(manifest.icons?.length >= 2, 'must define at least 192 and 512 PNG icons');
  assert.strictEqual(fs.existsSync('icons/icon-192.png'), true, '192px PNG icon must exist');
  assert.strictEqual(fs.existsSync('icons/apple-touch-icon.png'), true, 'apple-touch-icon PNG must exist');
});

test('pwa: service worker handles cache-first, push notification, and notificationclick', () => {
  const swCode = fs.readFileSync('sw.js', 'utf8');
  assert.ok(swCode.includes("addEventListener('install'"), 'SW must have install handler');
  assert.ok(swCode.includes("addEventListener('fetch'"), 'SW must have fetch handler');
  assert.ok(swCode.includes("addEventListener('push'"), 'SW must have push handler');
  assert.ok(swCode.includes('/src/app.js'), 'SW cache must reference /src/app.js');
  assert.ok(swCode.includes("showNotification"), 'SW must display notification');
  assert.ok(swCode.includes("addEventListener('notificationclick'"), 'SW must have notificationclick handler');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pwa.test.mjs`  
Expected: FAIL (`sw.js` and `manifest.webmanifest` missing)

- [ ] **Step 3: Implement `manifest.webmanifest`, `sw.js`, and PNG icons**

- Tulis `manifest.webmanifest` dengan `name: "Hey Darling"`, `short_name: "Darling"`, `display: "standalone"`, `start_url: "/"`, dan ikon PNG 192x192 & 512x512.
- Hasilkan ikon PNG valid (`icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png` 180x180) menggunakan Node.js `zlib` standar tanpa dependensi eksternal (wajib PNG agar Safari iOS & Chrome desktop mengenali Home Screen icon).
- Tulis `sw.js`:
  - `install`: simpan aset statis utama (`/`, `/index.html`, `/style.css`, `/src/app.js`, `/src/api.js`, `/src/db.js`, `/src/config.js`, `/src/call.js`, `/manifest.webmanifest`, `/icons/icon-192.png`, `/icons/icon-512.png`) ke `caches.open('hey_darling_v1')`.
  - `fetch`: strategi Cache-First untuk aset lokal (`style.css`, `src/`, `icons/`, dll.).
  - `push`: parse data JSON payload, panggil `self.registration.showNotification(data.title, { body: data.body, icon: '/icons/icon-192.png', tag: 'chat-msg' })`.
  - `notificationclick`: cari window klien yang terbuka, jika ada panggil `client.focus()`, jika tidak buka window `/`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pwa.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sw.js manifest.webmanifest icons/ tests/pwa.test.mjs
git commit -m "feat(pwa): add service worker with cache-first and web push notification handlers"
```

---

### Task 7: Supabase Edge Function untuk Multi-Device Web Push (`supabase/functions/notify-message/`)

**Files:**
- Create: `supabase/functions/notify-message/index.ts`
- Create: `supabase/functions/notify-message/webpush.ts`
- Test: `tests/edge_function.test.mjs`

**Interfaces:**
- Consumes: Supabase Database Webhook payload pada `public.messages INSERT` dan tabel `push_subscriptions`.
- Produces: Edge Function Deno yang mengenkripsi payload Web Push (RFC 8291) dengan tanda tangan VAPID (RFC 8292), mengirim ke semua endpoint pasangan, dan otomatis menghapus endpoint kedaluwarsa (`410 Gone`/`404`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/edge_function.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('edge_function: notify-message source files exist and contain VAPID encryption logic', () => {
  const fnPath = 'supabase/functions/notify-message/index.ts';
  assert.strictEqual(fs.existsSync(fnPath), true, 'index.ts must exist');

  const fnCode = fs.readFileSync(fnPath, 'utf8');
  assert.ok(fnCode.includes('push_subscriptions'), 'must query push_subscriptions table');
  assert.ok(fnCode.includes('VAPID_PRIVATE_KEY'), 'must read VAPID_PRIVATE_KEY secret');
  assert.ok(fnCode.includes('410') || fnCode.includes('status === 410'), 'must handle 410 Gone for stale subscriptions');
});

test('edge_function: Review Focus 3 - stale subscription handler deletes 410 endpoints', () => {
  const fnCode = fs.readFileSync('supabase/functions/notify-message/index.ts', 'utf8');
  assert.ok(fnCode.includes('delete().eq(') || fnCode.includes('.delete()'), 'must execute delete on expired subscription');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/edge_function.test.mjs`  
Expected: FAIL (`supabase/functions/notify-message/` missing)

- [ ] **Step 3: Implement `supabase/functions/notify-message/index.ts` and `webpush.ts`**

- Tulis modul Web Push Deno murni menggunakan Web Crypto API (`crypto.subtle`) untuk membuat VAPID JWT header dan mengenkripsi payload AES-128-GCM tanpa dependensi npm Node.js yang berat.
- Pada `index.ts`, tangkap record pesan baru (`record: { id, sender_id, body }`), ambil nama pengirim dari `profiles`, lalu ambil semua baris dari `push_subscriptions` di mana `user_id != record.sender_id`.
- Loop setiap langganan pasangan: kirim HTTP POST Web Push.
- Jika status respon `410` atau `404`: eksekusi `supabaseClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)` untuk menjaga database tetap bersih dan tidak memboroskan kuota di masa depan.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/edge_function.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/notify-message/ tests/edge_function.test.mjs
git commit -m "feat(backend): implement multi-device web push edge function with auto 410 cleanup"
```

---

### Task 8: Antarmuka UI Responsif, CSS GPU-Only & Skeleton Loading (`index.html`, `style.css`)

**Files:**
- Create: `index.html`
- Create: `style.css`
- Test: `tests/ui_markup.test.mjs`

**Interfaces:**
- Consumes: Desain responsif mobile-first + desktop centered, system font stack, GPU animations, skeleton loading.
- Produces: File HTML semantik dan stylesheet CSS murni yang bebas glitch keyboard dan ultra-cepat di-paint.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/ui_markup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('ui_markup: index.html defines auth screen, chat screen, skeleton template, and PWA tags', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(html.includes('manifest.webmanifest'), 'must link PWA manifest');
  assert.ok(html.includes('apple-mobile-web-app-capable'), 'must include iOS standalone meta');
  assert.ok(html.includes('id="auth-screen"'), 'must have auth screen container');
  assert.ok(html.includes('id="chat-screen"'), 'must have chat screen container');
  assert.ok(html.includes('id="message-input"'), 'must have message input textarea');
  assert.ok(html.includes('id="skeleton-loader"'), 'must have skeleton loader for initial sync');
  assert.ok(html.includes('id="ios-install-banner"'), 'must have iOS install banner for Safari');
});

test('ui_markup: style.css enforces system fonts, 100dvh viewport, and GPU-only animations', () => {
  const css = fs.readFileSync('style.css', 'utf8');
  assert.ok(css.includes('system-ui'), 'must use system font stack');
  assert.ok(css.includes('100dvh'), 'must use dynamic viewport height');
  assert.ok(css.includes('transform') && css.includes('opacity'), 'must use GPU animation properties');
  assert.ok(css.includes('prefers-reduced-motion'), 'must respect reduced motion accessibility');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ui_markup.test.mjs`  
Expected: FAIL (`index.html` and `style.css` missing)

- [ ] **Step 3: Implement `index.html` and `style.css`**

- `index.html`:
  - Tag meta viewport adaptif: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`.
  - Section Auth: Tab Login / Daftar dengan input Email, Password, dan Nama Panggilan.
  - Section Chat: Header (nama pasangan, indikator sync, tombol izin notifikasi, tombol logout), Container Pesan dengan skeleton loading placeholder, Form Input Pesan dengan tombol kirim SVG inline.
  - Banner edukasi iOS: "Ketuk Bagikan (Share) -> Tambahkan ke Layar Utama (Add to Home Screen) untuk mengaktifkan notifikasi".
- `style.css`:
  - Reset modern ringan, CSS variables tema gelap/terang bersih (`#121212`, `#1e1e1e`, `#e0e0e0`, warna aksen mawar lembut `#e91e63`).
  - Layout: `height: 100vh; height: 100dvh; display: flex; flex-direction: column;`. Di layar lebar (> 600px): container terpusat `max-width: 600px; margin: 0 auto; box-shadow: ...`.
  - Animasi: `@keyframes messageIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }` (durasi 140ms).
  - Skeleton loading: animasi pulse `opacity: 0.4` ke `0.8` ringan tanpa layout reflow.
  - Rule `@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ui_markup.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html style.css tests/ui_markup.test.mjs
git commit -m "feat(ui): create responsive pwa html layout with skeleton loading and gpu animations"
```

---

### Task 9: Integrasi Controller Aplikasi, Keyboard Shortcuts & Lifecycle (`src/app.js`)

**Files:**
- Create: `src/app.js`
- Test: `tests/app_integration.test.mjs`

**Interfaces:**
- Consumes: `src/api.js`, `src/db.js`, `src/config.js`, dan elemen DOM dari `index.html`.
- Produces: Aplikasi interaktif lengkap yang mengelola siklus hidup auth, delta sync saat foreground, pemutusan Realtime saat background, pengiriman pesan optimistik, dan registrasi Web Push.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/app_integration.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('app_integration: app.js contains lifecycle visibilitychange and keyboard enter handler', () => {
  const appCode = fs.readFileSync('src/app.js', 'utf8');
  assert.ok(appCode.includes('visibilitychange'), 'must listen for document visibilitychange');
  assert.ok(appCode.includes('Enter') && appCode.includes('shiftKey'), 'must handle Enter send and Shift+Enter newline');
  assert.ok(appCode.includes('serviceWorker.register'), 'must register service worker');
  assert.ok(appCode.includes('pushManager.subscribe'), 'must support web push subscription');
});

test('app_integration: Review Focus 1 - offline error handling provides retry status', () => {
  const appCode = fs.readFileSync('src/app.js', 'utf8');
  assert.ok(appCode.includes('status') || appCode.includes('error'), 'must track message send status');
  assert.ok(appCode.includes('retry') || appCode.includes('coba lagi'), 'must provide retry handling for failed sends');
});

test('app_integration: Review Focus 5 - ios standalone detection controls banner visibility', () => {
  const appCode = fs.readFileSync('src/app.js', 'utf8');
  assert.ok(appCode.includes('standalone') || appCode.includes('display-mode'), 'must detect standalone PWA mode');
  assert.ok(appCode.includes('MAX_VISIBLE_DOM_NODES') || appCode.includes('150'), 'must enforce max DOM nodes limit for 60fps render');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/app_integration.test.mjs`  
Expected: FAIL (`src/app.js` missing)

- [ ] **Step 3: Implement `src/app.js`**

- Inisialisasi: Periksa session login via `api.initAuth()`. Jika belum login, tampilkan layar auth. Jika sudah login, muat pesan dari IndexedDB lokal lalu tampilkan layar chat.
- Sinkronisasi Delta: Saat aplikasi dibuka atau `document.visibilityState === 'visible'`:
  - Ambil `last_synced_at` dari IndexedDB.
  - Jalankan `api.fetchDeltaMessages(last_synced_at)`.
  - Simpan pesan baru ke IndexedDB dan render ke DOM menggunakan `DocumentFragment`.
  - Batasi jumlah elemen pesan DOM yang aktif maksimal 150 node (`MAX_VISIBLE_DOM_NODES = 150`) agar performa scroll di laptop/HP tua tetap mulus 60 FPS.
  - Buka channel Realtime `api.subscribeToMessages()`.
- Saat `document.visibilityState === 'hidden'`:
  - Panggil `api.unsubscribeRealtime()` untuk memutus koneksi WebSocket demi menghemat kuota dan baterai.
- Keyboard: Event listener `keydown` pada textarea input: jika `key === 'Enter'` dan `!event.shiftKey`, cegah default (`event.preventDefault()`) dan jalankan `sendMessage()`.
- Pengiriman Pesan Optimistik: Tampilkan pesan langsung di UI dengan status "mengirim...". Jika request Supabase berhasil, perbarui status menjadi terkirim. Jika gagal (misal koneksi terputus), tandai merah dengan tombol "coba lagi" (Review Focus 1).
- Tombol "Aktifkan Notifikasi": Dipicu via klik tombol pengguna (*user gesture*). Meminta izin `Notification.requestPermission()`, mendaftarkan VAPID subscription, dan menyimpan endpoint ke tabel `push_subscriptions`.
- Deteksi iOS Standalone: Periksa `window.navigator.standalone` atau `window.matchMedia('(display-mode: standalone)').matches`. Jika di iOS tetapi belum standalone, tampilkan banner panduan "Add to Home Screen" (Review Focus 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/app_integration.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app.js tests/app_integration.test.mjs
git commit -m "feat(client): implement app controller with delta sync lifecycle and keyboard shortcuts"
```

---

### Task 10 (Fase 2): Panggilan Suara Berbasis Internet WebRTC P2P (`src/call.js`, Edge Function `notify-call`)

**Files:**
- Create: `src/call.js`
- Create: `supabase/functions/notify-call/index.ts`
- Modify: `index.html` (tambahkan dialog overlay panggilan audio masuk/berlangsung)
- Modify: `style.css` (tampilan overlay panggilan responsif)
- Test: `tests/call.test.mjs`

**Interfaces:**
- Consumes: API native browser `RTCPeerConnection`, `navigator.mediaDevices.getUserMedia`, dan Supabase Realtime Broadcast.
- Produces: Modul panggilan suara 1-on-1 P2P tanpa beban media server dan notifikasi push panggilan masuk saat layar mati.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/call.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('call: call module defines WebRTC peer connection configuration with public STUN', () => {
  const callCode = fs.readFileSync('src/call.js', 'utf8');
  assert.ok(callCode.includes('RTCPeerConnection'), 'must use RTCPeerConnection');
  assert.ok(callCode.includes('stun:stun.l.google.com:19302'), 'must configure Google public STUN server');
  assert.ok(callCode.includes('call:offer'), 'must support call:offer signal');
  assert.ok(callCode.includes('call:answer'), 'must support call:answer signal');
  assert.ok(callCode.includes('call:candidate'), 'must support call:candidate signal');
  assert.ok(callCode.includes('call:end'), 'must support call:end signal');
});

test('call: notify-call edge function exists and handles high-priority call notifications', () => {
  const edgePath = 'supabase/functions/notify-call/index.ts';
  assert.strictEqual(fs.existsSync(edgePath), true, 'notify-call function must exist');
  const code = fs.readFileSync(edgePath, 'utf8');
  assert.ok(code.includes('incoming-call'), 'must send incoming-call tag payload');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/call.test.mjs`  
Expected: FAIL (`src/call.js` and `supabase/functions/notify-call/` missing)

- [ ] **Step 3: Implement `src/call.js`, `notify-call/index.ts`, and call overlay UI**

- `src/call.js`:
  - Kelola state panggilan: `IDLE`, `CALLING`, `RINGING`, `CONNECTED`.
  - Saat mulai panggil: Ambil stream mic `getUserMedia({ audio: true })`, buat `RTCPeerConnection` dengan ICE STUN Google, kirim `call:offer` lewat Supabase Realtime Broadcast channel `call_signals`, dan panggil Edge Function `notify-call` untuk membangunkan HP pasangan jika layar mati.
  - Saat menerima panggilan: Tampilkan overlay UI dering dengan tombol "Jawab" dan "Tolak". Jika dijawab, hubungkan audio stream P2P.
  - Tangani ICE candidates dan teardown koneksi bersih saat `call:end`.
- `supabase/functions/notify-call/index.ts`: Mengirim Web Push prioritas tinggi dengan `tag: 'incoming-call'`, judul "Panggilan Masuk dari [Nama Pasangan]", dan payload aksi.
- Update `index.html` dan `style.css` untuk elemen modal overlay panggilan audio (avatar pasangan, status durasi, tombol mute, dan tombol tutup merah).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/call.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/call.js supabase/functions/notify-call/ index.html style.css tests/call.test.mjs
git commit -m "feat(voip): implement webrtc p2p audio calling with realtime broadcast signaling"
```

---

### Task 11: Verifikasi Akhir Seluruh Sistem & Dokumentasi Deployment

**Files:**
- Create: `docs/deployment-guide.md`
- Modify: `README.md`
- Test: `tests/full_suite.test.mjs`

**Interfaces:**
- Consumes: Seluruh komponen Task 1 hingga 10.
- Produces: Panduan deployment langkah-demi-langkah ke Cloudflare Pages / Vercel dan checklist verifikasi menyeluruh.

- [ ] **Step 1: Write the end-to-end integration test**

```javascript
// tests/full_suite.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('full_suite: all critical project assets and documentation are present and frontend < 100KB', () => {
  const requiredFiles = [
    'index.html',
    'style.css',
    'src/config.js',
    'src/app.js',
    'src/api.js',
    'src/db.js',
    'src/call.js',
    'sw.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png',
    'supabase/migrations/20261112_init.sql',
    'supabase/functions/notify-message/index.ts',
    'supabase/functions/notify-call/index.ts',
    '.github/workflows/supabase-keepalive.yml',
    'docs/deployment-guide.md',
    'docs/keepalive-setup.md'
  ];

  for (const file of requiredFiles) {
    assert.strictEqual(fs.existsSync(file), true, `Required file ${file} must exist`);
  }

  const frontendAssets = ['index.html', 'style.css', 'src/config.js', 'src/app.js', 'src/api.js', 'src/db.js', 'src/call.js', 'sw.js'];
  const totalBytes = frontendAssets.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert.ok(totalBytes < 102400, `Frontend assets must stay under 100KB (got ${totalBytes} bytes)`);
});
```

- [ ] **Step 2: Run all tests to verify full test suite passes**

Run: `npm test`  
Expected: All test suites PASS

- [ ] **Step 3: Tulis `docs/deployment-guide.md` dan perbarui `README.md`**

Tulis panduan ringkas dan jelas mencakup:
1. Cara menjalankan migrasi SQL di Supabase Dashboard (1 kali klik di SQL Editor).
2. Cara deploy Edge Functions `notify-message` dan `notify-call` serta setting VAPID keys di Supabase Secrets.
3. Cara deploy frontend statis ke Cloudflare Pages / Vercel / GitHub Pages (gratis selamanya dengan HTTPS otomatis).
4. Panduan penggunaan di iOS ("Add to Home Screen") dan Android / Desktop.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/full_suite.test.mjs`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/deployment-guide.md README.md tests/full_suite.test.mjs
git commit -m "docs: add comprehensive deployment guide and complete integration verification"
```
