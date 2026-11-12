import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWebPush } from './webpush.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function signAckToken(secret: string, messageId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(messageId));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const rawText = await req.text();
    const body = rawText ? JSON.parse(rawText) : {};

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SECRET_KEY') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@heydarling.local';

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Handle delivery acknowledgment from recipient Service Worker push event
    if (body?.action === 'ack_delivered') {
      const messageId = String(body.message_id || '');
      const token = String(body.token || '');
      if (!messageId || !token) {
        return new Response(JSON.stringify({ error: 'Missing message_id or token' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        });
      }

      const expected = await signAckToken(vapidPrivateKey, messageId);
      if (!timingSafeEqualHex(token, expected)) {
        return new Response(JSON.stringify({ error: 'Invalid ack token' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        });
      }

      const { error: updErr } = await supabase
        .from('messages')
        .update({ delivered_at: new Date().toISOString() })
        .eq('id', messageId)
        .is('delivered_at', null);

      if (updErr) throw updErr;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const record = body?.record;

    if (!record || !record.sender_id || !record.body) {
      return new Response(JSON.stringify({ error: 'Invalid webhook payload' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    // 1. Fetch sender display name
    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', record.sender_id)
      .maybeSingle();

    const senderName = senderProfile?.display_name || 'Partner';

    // 2. Fetch all partner push subscriptions (multi-device: phone + desktop)
    const { data: subs, error: subsErr } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .neq('user_id', record.sender_id);

    if (subsErr) throw subsErr;
    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No recipient subscriptions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const ackToken = record.id ? await signAckToken(vapidPrivateKey, String(record.id)) : '';

    const notificationPayload = {
      title: senderName,
      body: String(record.body).slice(0, 140),
      tag: 'chat-msg',
      url: '/',
      messageId: record.id || null,
      ackUrl: `${supabaseUrl}/functions/v1/notify-message`,
      ackKey: anonKey,
      ackToken,
    };

    let sentCount = 0;
    const staleEndpoints: string[] = [];

    // 3. Deliver push to all active partner devices
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

    // 4. Clean up expired subscriptions (410 Gone / 404)
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
