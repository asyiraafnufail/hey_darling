/**
 * Hey Darling: Konfigurasi Publik Frontend
 * Ganti nilai di bawah ini dengan kredensial proyek Supabase Anda.
 */

export const CONFIG = {
  // URL Proyek Supabase (contoh: https://xyzcompany.supabase.co)
  SUPABASE_URL: 'https://YOUR_PROJECT_ID.supabase.co',

  // Supabase Anon Public Key (aman disimpan di frontend)
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_ANON_KEY',

  // VAPID Public Key untuk Web Push (dihasilkan via npx web-push generate-vapid-keys)
  VAPID_PUBLIC_KEY: 'YOUR_VAPID_PUBLIC_KEY',
};
