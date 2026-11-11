// Cloudflare Worker Cron Keep-Alive untuk Supabase Free Tier
// Mencegah proyek Supabase mengalami auto-pause setelah 7 hari idle.
//
// Jadwal Cron (wrangler.toml):
// [triggers]
// crons = ["0 0 */3 * *"]
//
// Environment Variables / Secrets di Cloudflare Dashboard:
// - SUPABASE_URL: https://<project-ref>.supabase.co
// - SUPABASE_ANON_KEY: <anon-public-key>

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingSupabase(env));
  },

  async fetch(request, env, ctx) {
    // Endpoint manual opsional untuk tes lewat browser
    const res = await pingSupabase(env);
    return new Response(JSON.stringify(res), {
      headers: { 'Content-Type': 'application/json' },
      status: res.ok ? 200 : 500,
    });
  },
};

async function pingSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' };
  }

  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/keep_alive`;
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  // Legacy anon key berupa JWT (eyJ...); new publishable key (sb_publishable_...) hanya pakai header apikey
  if (env.SUPABASE_ANON_KEY.startsWith('eyJ')) {
    headers.Authorization = `Bearer ${env.SUPABASE_ANON_KEY}`;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    result: text,
    timestamp: new Date().toISOString(),
  };
}
