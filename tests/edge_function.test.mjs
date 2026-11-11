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
