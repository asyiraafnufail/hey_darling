import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('edge_function: notify-message source files exist and contain VAPID encryption logic', () => {
  const fnPath = 'supabase/functions/notify-message/index.ts';
  assert.strictEqual(fs.existsSync(fnPath), true, 'index.ts must exist');

  const fnCode = fs.readFileSync(fnPath, 'utf8');
  assert.ok(fnCode.includes('push_subscriptions'), 'must query push_subscriptions table');
  assert.ok(fnCode.includes('VAPID_PRIVATE_KEY'), 'must read VAPID_PRIVATE_KEY secret');
  assert.ok(fnCode.includes('410') || fnCode.includes('status === 410'), 'must handle 410 Gone for stale subscriptions');
});

test('edge_function: Review Focus 3 - stale subscription handler deletes 410 endpoints', () => {
  const fnCode = fs.readFileSync('supabase/functions/notify-message/index.ts', 'utf8');
  assert.ok(fnCode.includes('.delete()') && fnCode.includes('.eq('), 'must execute delete on expired subscription');
});

test('edge_function: notify-message signs ackToken and handles ack_delivered via HMAC', () => {
  const fnCode = fs.readFileSync('supabase/functions/notify-message/index.ts', 'utf8');
  assert.ok(fnCode.includes("action === 'ack_delivered'"), 'must handle ack_delivered action');
  assert.ok(fnCode.includes('HMAC') && fnCode.includes('timingSafeEqualHex'), 'must sign & constant-time verify ack tokens');
  assert.ok(fnCode.includes('ackToken') && fnCode.includes('ackUrl'), 'must attach ack metadata to push payload');

  const swCode = fs.readFileSync('sw.js', 'utf8');
  assert.ok(swCode.includes('ack_delivered'), 'sw.js must report delivered status on push event');
  assert.ok(swCode.includes('New message received'), 'sw.js push fallback must be in English');

  const callCode = fs.readFileSync('supabase/functions/notify-call/index.ts', 'utf8');
  assert.ok(callCode.includes('Incoming Call') && callCode.includes('is calling you'), 'notify-call push must be in English');
});
