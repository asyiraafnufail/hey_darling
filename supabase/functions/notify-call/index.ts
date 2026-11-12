import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWebPush } from '../notify-message/webpush.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SECRET_KEY') || '';
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@heydarling.local';

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verifikasi user dari Authorization Bearer JWT (kompatibel dengan legacy & asymmetric JWT baru)
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid session token' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const body = await req.json().catch(() => ({}));
    const callerId = authData.user.id;

    // 1. Ambil nama pemanggil jika belum diberikan
    let callerName = body?.caller_name;
    if (!callerName) {
      const { data: callerProfile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', callerId)
        .maybeSingle();
      callerName = callerProfile?.display_name || 'Partner';
    }

    // 2. Fetch partner push subscriptions to wake device when screen is locked
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .neq('user_id', callerId);

    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No recipient subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const notificationPayload = {
      title: 'Incoming Call',
      body: `${callerName} is calling you...`,
      tag: 'incoming-call',
      url: '/',
    };

    let sentCount = 0;
    const staleEndpoints: string[] = [];

    // 3. Kirim push prioritas tinggi
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
            console.error('Call push rejected:', res.status, sub.endpoint.slice(0, 50), errText);
            if (res.status === 410 || res.status === 404) {
              staleEndpoints.push(sub.endpoint);
            }
          }
        } catch (err) {
          console.error('Call push error:', err);
        }
      })
    );

    // 4. Bersihkan endpoint yang expired
    if (staleEndpoints.length > 0) {
      await Promise.all(
        staleEndpoints.map((ep) =>
          supabase.from('push_subscriptions').delete().eq('endpoint', ep)
        )
      );
    }

    return new Response(
      JSON.stringify({ sent: sentCount, cleaned: staleEndpoints.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
