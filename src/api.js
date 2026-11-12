/**
 * Hey Darling: Supabase API & Network Module
 * Handles authentication, delta sync with explicit column selection, receipts, presence, and Realtime WebSocket.
 */

import { CONFIG } from './config.js';

const SELECT_MESSAGE_COLUMNS = 'id, sender_id, body, created_at, delivered_at, read_at';

export function createApi(supabaseClient) {
  let activeRealtimeChannel = null;
  let activePresenceChannel = null;

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
    unsubscribePresence();
    await supabaseClient.auth.signOut();
  }

  /**
   * Fetch new messages after sinceTimestamp (Delta Sync).
   * If sinceTimestamp is null (initial load), fetches the newest messages up to limit.
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
      // Fetch latest 'limit' messages (descending), then reverse to ascending order
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
   * Fetch older messages before beforeTimestamp (Scroll-up pagination).
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

  async function fetchMessageStatuses(messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return [];
    const { data, error } = await supabaseClient
      .from('messages')
      .select('id, delivered_at, read_at')
      .in('id', messageIds);

    if (error) throw error;
    return data || [];
  }

  async function markMessagesDelivered(messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return 0;
    const { data, error } = await supabaseClient.rpc('mark_messages_delivered', {
      message_ids: messageIds,
    });
    if (error) throw error;
    return data || 0;
  }

  async function markMessagesRead(messageIds) {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return 0;
    const { data, error } = await supabaseClient.rpc('mark_messages_read', {
      message_ids: messageIds,
    });
    if (error) throw error;
    return data || 0;
  }

  async function sendMessage(body, senderId) {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Message cannot be empty');
    if (trimmed.length > 2000) throw new Error('Message exceeds 2000 character limit');

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

  function subscribeToMessages(onNewMessage, onMessageUpdate = null, onPartnerProfileUpdate = null) {
    unsubscribeRealtime();

    let channel = supabaseClient
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
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload) => {
          if (payload.new && onMessageUpdate) {
            onMessageUpdate(payload.new);
          }
        }
      );

    if (onPartnerProfileUpdate) {
      channel = channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles' },
        (payload) => {
          if (payload.new) {
            onPartnerProfileUpdate(payload.new);
          }
        }
      );
    }

    activeRealtimeChannel = channel.subscribe();

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
      .select('id, display_name, last_seen_at')
      .neq('id', currentUserId)
      .maybeSingle();

    return { partnerProfile: data || null, error };
  }

  async function updateLastSeen(userId) {
    if (!userId) return { error: null };
    const now = new Date().toISOString();
    const { error } = await supabaseClient
      .from('profiles')
      .update({ last_seen_at: now, updated_at: now })
      .eq('id', userId);

    return { error };
  }

  function subscribePresence(currentUserId, onPresenceChange) {
    unsubscribePresence();
    if (!currentUserId || typeof supabaseClient.channel !== 'function') return null;

    const channel = supabaseClient.channel('presence:chat', {
      config: { presence: { key: currentUserId } },
    });

    activePresenceChannel = channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState ? channel.presenceState() : {};
        if (onPresenceChange) onPresenceChange(state);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track?.({
            user_id: currentUserId,
            online_at: new Date().toISOString(),
          });
        }
      });

    return {
      unsubscribe: unsubscribePresence,
    };
  }

  function unsubscribePresence() {
    if (activePresenceChannel) {
      try {
        activePresenceChannel.untrack?.();
      } catch {
        // noop
      }
      supabaseClient.removeChannel(activePresenceChannel);
      activePresenceChannel = null;
    }
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
    fetchMessageStatuses,
    markMessagesDelivered,
    markMessagesRead,
    sendMessage,
    subscribeToMessages,
    unsubscribeRealtime,
    syncPartnerProfile,
    updateLastSeen,
    subscribePresence,
    unsubscribePresence,
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
