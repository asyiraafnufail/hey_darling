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
  assert.strictEqual(query.selectedColumns, 'id, sender_id, body, created_at');
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
  assert.strictEqual(query.selectedColumns, 'id, sender_id, body, created_at');
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
