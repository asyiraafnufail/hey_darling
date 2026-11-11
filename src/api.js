/**
 * Hey Darling: Modul API & Jaringan Supabase
 * Mengelola otentikasi, delta sync dengan pemilihan kolom eksplisit, dan Realtime WebSocket.
 */

import { CONFIG } from './config.js';

const SELECT_MESSAGE_COLUMNS = 'id, sender_id, body, created_at';

export function createApi(supabaseClient) {
  let activeRealtimeChannel = null;

  async function getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    return { session: data?.session ?? null, error };
  }

  async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    return { user: data?.user ?? null, session: data?.session ?? null, error };
  }

  async function register(email, password, displayName) {
    const trimmedEmail = email.trim();
    const name = displayName?.trim() || trimmedEmail.split('@')[0];

    const { data, error } = await supabaseClient.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        data: { display_name: name },
      },
    });

    return { user: data?.user ?? null, session: data?.session ?? null, error };
  }

  async function logout() {
    unsubscribeRealtime();
    await supabaseClient.auth.signOut();
  }

  /**
   * Mengambil pesan baru setelah sinceTimestamp (Delta Sync).
   * Jika sinceTimestamp null (buka pertama kali), mengambil pesan terbaru hingga limit.
   */
  async function fetchDeltaMessages(sinceTimestamp = null, limit = 50) {
    let query = supabaseClient
      .from('messages')
      .select(SELECT_MESSAGE_COLUMNS);

    if (sinceTimestamp) {
      query = query
        .gt('created_at', sinceTimestamp)
        .order('created_at', { ascending: true })
        .limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } else {
      // Ambil 'limit' pesan terbaru (descending), lalu balik urutannya (ascending)
      query = query
        .order('created_at', { ascending: false })
        .limit(limit);

      const { data, error } = await query;
      if (error) throw error;
      const list = data || [];
      return list.reverse();
    }
  }

  /**
   * Mengambil pesan lebih lama sebelum beforeTimestamp (Pagination scroll-up).
   */
  async function fetchOlderMessages(beforeTimestamp, limit = 50) {
    const { data, error } = await supabaseClient
      .from('messages')
      .select(SELECT_MESSAGE_COLUMNS)
      .lt('created_at', beforeTimestamp)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const list = data || [];
    return list.reverse();
  }

  async function sendMessage(body, senderId) {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Pesan tidak boleh kosong');
    if (trimmed.length > 2000) throw new Error('Pesan melebihi batas 2000 karakter');

    const { data, error } = await supabaseClient
      .from('messages')
      .insert({
        sender_id: senderId,
        body: trimmed,
      })
      .select(SELECT_MESSAGE_COLUMNS)
      .single();

    return { data, error };
  }

  function subscribeToMessages(onNewMessage) {
    unsubscribeRealtime();

    activeRealtimeChannel = supabaseClient
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.new && onNewMessage) {
            onNewMessage(payload.new);
          }
        }
      )
      .subscribe();

    return {
      unsubscribe: unsubscribeRealtime,
    };
  }

  function unsubscribeRealtime() {
    if (activeRealtimeChannel) {
      supabaseClient.removeChannel(activeRealtimeChannel);
      activeRealtimeChannel = null;
    }
  }

  async function syncPartnerProfile(currentUserId) {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('id, display_name')
      .neq('id', currentUserId)
      .maybeSingle();

    return { partnerProfile: data || null, error };
  }

  async function savePushSubscription(userId, subscription, userAgent = '') {
    if (!subscription || !subscription.endpoint) return null;
    const p256dh = subscription.keys?.p256dh || '';
    const auth = subscription.keys?.auth || '';

    const { data, error } = await supabaseClient
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subscription.endpoint,
          p256dh,
          auth,
          user_agent: userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' }
      );

    return { data, error };
  }

  return {
    client: supabaseClient,
    getSession,
    login,
    register,
    logout,
    fetchDeltaMessages,
    fetchOlderMessages,
    sendMessage,
    subscribeToMessages,
    unsubscribeRealtime,
    syncPartnerProfile,
    savePushSubscription,
  };
}

// Inisialisasi otomatis jika dijalankan di browser dengan @supabase/supabase-js
export async function initSupabaseClient() {
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    return window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  // Dinamic import via ESM CDN di browser
  if (typeof window !== 'undefined') {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return null;
}
