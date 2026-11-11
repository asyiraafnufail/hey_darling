import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWebPush } from './webpush.ts';

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const record = body?.record;

    if (!record || !record.sender_id || !record.body) {
      return new Response(JSON.stringify({ error: 'Invalid webhook payload' }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SECRET_KEY') || '';
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@heydarling.local';

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 1. Ambil nama pengirim
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', record.sender_id)
      .maybeSingle();

    const senderName = senderProfile?.display_name || 'Pasangan';

    // 2. Ambil semua push subscriptions milik pasangan (multi-device: HP + Desktop)
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .neq('user_id', record.sender_id);

    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No recipient subscriptions' }), { status: 200 });
    }

    const notificationPayload = {
      title: senderName,
      body: String(record.body).slice(0, 140),
      tag: 'chat-msg',
      url: '/',
    };

    let sentCount = 0;
    const staleEndpoints: string[] = [];

    // 3. Kirim ke seluruh device aktif pasangan
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const res = await sendWebPush(sub, notificationPayload, {
            publicKey: vapidPublicKey,
            privateKey: vapidPrivateKey,
            subject: vapidSubject,
          });

          if (res.ok) {
            sentCount++;
          } else {
            const errText = await res.text().catch(() => '');
            console.error('Push rejected:', res.status, sub.endpoint.slice(0, 50), errText);
            if (res.status === 410 || res.status === 404) {
              staleEndpoints.push(sub.endpoint);
            }
          }
        } catch (err) {
          console.error('Push delivery error:', err);
        }
      })
    );

    // 4. Review Focus 3: Bersihkan endpoint kedaluwarsa (410 Gone / 404)
    if (staleEndpoints.length > 0) {
      await Promise.all(
        staleEndpoints.map((ep) =>
          supabase.from('push_subscriptions').delete().eq('endpoint', ep)
        )
      );
    }

    return new Response(
      JSON.stringify({ sent: sentCount, cleaned: staleEndpoints.length }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
