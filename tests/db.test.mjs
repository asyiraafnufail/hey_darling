import { test } from 'node:test';
import assert from 'node:assert';
import { createMockIndexedDB } from './helpers/mock-idb.mjs';
import { createChatDB } from '../src/db.js';

test('db: saveMessages stores messages, deduplicates by id, and tracks latest timestamp', async () => {
  const chatDB = createChatDB(createMockIndexedDB());
  await chatDB.openDB();

  const msgs = [
    { id: '1', sender_id: 'u1', body: 'Halo sayang', created_at: '2026-11-12T01:00:00.000Z' },
    { id: '2', sender_id: 'u2', body: 'Iya halo', created_at: '2026-11-12T01:05:00.000Z' },
  ];

  await chatDB.saveMessages(msgs);
  const stored = await chatDB.getLocalMessages(10);

  assert.strictEqual(stored.length, 2);
  assert.strictEqual(stored[0].id, '1');
  assert.strictEqual(stored[1].id, '2');

  const latestTs = await chatDB.getLatestTimestamp();
  assert.strictEqual(latestTs, '2026-11-12T01:05:00.000Z');
});

test('db: Review Focus 2 - deduplication ignores duplicate message id cleanly', async () => {
  const chatDB = createChatDB(createMockIndexedDB());
  await chatDB.openDB();

  const msg = { id: 'dup-1', sender_id: 'u1', body: 'Tes', created_at: '2026-11-12T01:00:00.000Z' };
  await chatDB.saveMessages([msg]);
  await chatDB.saveMessages([msg]);

  const stored = await chatDB.getLocalMessages(10);
  assert.strictEqual(stored.length, 1);
  assert.strictEqual(stored[0].id, 'dup-1');
});

test('db: getLocalMessages supports pagination cursor beforeTimestamp', async () => {
  const chatDB = createChatDB(createMockIndexedDB());
  await chatDB.openDB();

  await chatDB.saveMessages([
    { id: '1', sender_id: 'u1', body: 'Pesan 1', created_at: '2026-11-12T01:00:00.000Z' },
    { id: '2', sender_id: 'u1', body: 'Pesan 2', created_at: '2026-11-12T02:00:00.000Z' },
    { id: '3', sender_id: 'u2', body: 'Pesan 3', created_at: '2026-11-12T03:00:00.000Z' },
  ]);

  const latestTwo = await chatDB.getLocalMessages(2);
  assert.deepStrictEqual(latestTwo.map((m) => m.id), ['2', '3']);

  const older = await chatDB.getLocalMessages(2, '2026-11-12T02:00:00.000Z');
  assert.deepStrictEqual(older.map((m) => m.id), ['1']);
});

test('db: saveMeta and getMeta persist arbitrary metadata values', async () => {
  const chatDB = createChatDB(createMockIndexedDB());
  await chatDB.openDB();

  await chatDB.saveMeta('partner_name', 'Sayang');
  const val = await chatDB.getMeta('partner_name');
  assert.strictEqual(val, 'Sayang');
});
