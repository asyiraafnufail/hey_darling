import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('keepalive: workflow and cloudflare script use correct rpc endpoint and cron cadence', () => {
  const ghWorkflow = fs.readFileSync('.github/workflows/supabase-keepalive.yml', 'utf8');
  assert.ok(ghWorkflow.includes("cron: '0 0 */3 * *'"), 'GH Action must run every 3 days');
  assert.ok(ghWorkflow.includes('/rest/v1/rpc/keep_alive'), 'GH Action must ping keep_alive rpc');

  const cfWorker = fs.readFileSync('scripts/cloudflare-worker-keepalive.js', 'utf8');
  assert.ok(cfWorker.includes('/rest/v1/rpc/keep_alive'), 'CF Worker must ping keep_alive rpc');
  assert.ok(cfWorker.includes('scheduled'), 'CF Worker must handle cron scheduled event');

  assert.strictEqual(fs.existsSync('docs/keepalive-setup.md'), true, 'Documentation guide must exist');
});
