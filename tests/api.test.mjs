import { test } from 'node:test';
import assert from 'node:assert';
import { createMockSupabase } from './helpers/mock-supabase.mjs';
import { createApi } from '../src/api.js';

test('api: fetchDeltaMessages selects only explicit columns and orders by created_at asc', async () => {
  const mockClient = createMockSupabase({
    rowsByTable: {
      messages: [
        { id: 'm2', sender_id: 'u2', body: 'Pagi', created_at: '2026-11-12T01:01:00Z' },
      ],
    },
  });
  const api = createApi(mockClient);

  const rows = await api.fetchDeltaMessages('2026-11-12T01:00:00Z', 50);

  const query = mockClient.getLastQuery('messages');
  assert.strictEqual(query.selectedColumns, 'id, sender_id, body, created_at, delivered_at, read_at');
  assert.strictEqual(query.filters.gt.column, 'created_at');
  assert.strictEqual(query.filters.gt.value, '2026-11-12T01:00:00Z');
  assert.strictEqual(query.order.column, 'created_at');
  assert.strictEqual(query.order.ascending, true);
  assert.strictEqual(rows.length, 1);
});

test('api: initial fetchDeltaMessages without timestamp loads latest 50 desc and reverses chronologically', async () => {
  const mockClient = createMockSupabase({
    rowsByTable: {
      messages: [
        { id: 'm2', sender_id: 'u1', body: 'Kedua', created_at: '2026-11-12T02:00:00Z' },
        { id: 'm1', sender_id: 'u2', body: 'Pertama', created_at: '2026-11-12T01:00:00Z' },
      ],
    },
  });
  const api = createApi(mockClient);

  const rows = await api.fetchDeltaMessages(null, 50);
  const query = mockClient.getLastQuery('messages');
  assert.strictEqual(query.selectedColumns, 'id, sender_id, body, created_at, delivered_at, read_at');
  assert.strictEqual(query.order.ascending, false);
  assert.strictEqual(query.limitCount, 50);
  assert.deepStrictEqual(rows.map((r) => r.id), ['m1', 'm2']);
});

test('api: Review Focus 4 - register handles rejected signup atomically with clear error', async () => {
  const mockClient = createMockSupabase({
    signUpError: new Error('Pendaftaran ditolak: Akun tidak terdaftar dalam whitelist atau kuota penuh.'),
  });
  const api = createApi(mockClient);

  const { user, error } = await api.register('stranger@evil.com', 'password123', 'Stranger');
  assert.strictEqual(user, null);
  assert.ok(error.message.includes('Pendaftaran ditolak'));
});

test('api: savePushSubscription upserts subscription keyed on endpoint', async () => {
  const mockClient = createMockSupabase();
  const api = createApi(mockClient);

  await api.savePushSubscription(
    'u1',
    { endpoint: 'https://push.apple.com/abc', keys: { p256dh: 'p1', auth: 'a1' } },
    'Mozilla/5.0'
  );

  const query = mockClient.getLastQuery('push_subscriptions');
  assert.strictEqual(query.upsertedData.user_id, 'u1');
  assert.strictEqual(query.upsertedData.endpoint, 'https://push.apple.com/abc');
  assert.strictEqual(query.upsertedData.p256dh, 'p1');
  assert.strictEqual(query.upsertedData.auth, 'a1');
  assert.strictEqual(query.upsertOpts.onConflict, 'endpoint');
});

test('api: fetchMessageStatuses, markMessagesDelivered, and markMessagesRead use explicit columns and RPCs', async () => {
  const mockClient = createMockSupabase({
    rowsByTable: {
      messages: [
        { id: 'm1', delivered_at: '2026-11-12T01:02:00Z', read_at: null },
      ],
    },
    rpcData: 2,
  });
  const api = createApi(mockClient);

  const statuses = await api.fetchMessageStatuses(['m1']);
  const query = mockClient.getLastQuery('messages');
  assert.strictEqual(query.selectedColumns, 'id, delivered_at, read_at');
  assert.deepStrictEqual(query.filters.in, { column: 'id', values: ['m1'] });
  assert.strictEqual(statuses.length, 1);

  const deliveredCount = await api.markMessagesDelivered(['m1', 'm2']);
  assert.strictEqual(deliveredCount, 2);
  assert.deepStrictEqual(mockClient.rpcCalls[0], {
    name: 'mark_messages_delivered',
    params: { message_ids: ['m1', 'm2'] },
  });

  const readCount = await api.markMessagesRead(['m1', 'm2']);
  assert.strictEqual(readCount, 2);
  assert.deepStrictEqual(mockClient.rpcCalls[1], {
    name: 'mark_messages_read',
    params: { message_ids: ['m1', 'm2'] },
  });

  assert.strictEqual(await api.fetchMessageStatuses([]).then((r) => r.length), 0);
  assert.strictEqual(await api.markMessagesDelivered([]), 0);
  assert.strictEqual(await api.markMessagesRead([]), 0);
});

test('api: updateLastSeen updates profiles.last_seen_at and subscribePresence tracks user presence', async () => {
  const mockClient = createMockSupabase({
    presenceState: { u2: [{ user_id: 'u2', online_at: '2026-11-12T01:00:00Z' }] },
  });
  const api = createApi(mockClient);

  await api.updateLastSeen('u1');
  const profQuery = mockClient.getLastQuery('profiles');
  assert.ok(profQuery.updatedData.last_seen_at);
  assert.deepStrictEqual(profQuery.filters.eq, { column: 'id', value: 'u1' });

  let lastState = null;
  api.subscribePresence('u1', (state) => {
    lastState = state;
  });

  const channels = mockClient.getChannels();
  const presChannel = channels.find((c) => c.name === 'presence:chat');
  assert.ok(presChannel);
  await new Promise((r) => setTimeout(r, 15));
  assert.strictEqual(presChannel.tracked.user_id, 'u1');

  const syncHandler = presChannel.handlers.find((h) => h.type === 'presence');
  syncHandler.cb();
  assert.ok(lastState.u2);

  api.unsubscribePresence();
  assert.strictEqual(presChannel.unsubscribed, true);
});

test('api: subscribeToMessages invokes INSERT, UPDATE message, and UPDATE profile callbacks', () => {
  const mockClient = createMockSupabase();
  const api = createApi(mockClient);
  const events = [];

  api.subscribeToMessages(
    (msg) => events.push({ kind: 'insert', msg }),
    (msg) => events.push({ kind: 'updateMsg', msg }),
    (prof) => events.push({ kind: 'updateProf', prof })
  );

  const ch = mockClient.getChannels().find((c) => c.name === 'public:messages');
  assert.strictEqual(ch.handlers.length, 3);
  ch.handlers[0].cb({ new: { id: 'm1' } });
  ch.handlers[1].cb({ new: { id: 'm1', delivered_at: '2026-11-12T01:00:00Z' } });
  ch.handlers[2].cb({ new: { id: 'u2', last_seen_at: '2026-11-12T01:05:00Z' } });

  assert.strictEqual(events.length, 3);
  assert.strictEqual(events[0].kind, 'insert');
  assert.strictEqual(events[1].kind, 'updateMsg');
  assert.strictEqual(events[2].kind, 'updateProf');
});
