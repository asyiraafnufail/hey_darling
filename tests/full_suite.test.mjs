import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('full_suite: all critical project assets and documentation are present and frontend < 100KB', () => {
  const requiredFiles = [
    'index.html',
    'style.css',
    'src/config.js',
    'src/app.js',
    'src/api.js',
    'src/db.js',
    'src/call.js',
    'sw.js',
    'manifest.webmanifest',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png',
    'supabase/migrations/20261112_init.sql',
    'supabase/functions/notify-message/index.ts',
    'supabase/functions/notify-call/index.ts',
    '.github/workflows/supabase-keepalive.yml',
    'docs/deployment-guide.md',
    'docs/keepalive-setup.md',
  ];

  for (const file of requiredFiles) {
    assert.strictEqual(fs.existsSync(file), true, `Required file ${file} must exist`);
  }

  const frontendAssets = [
    'index.html',
    'style.css',
    'src/config.js',
    'src/app.js',
    'src/api.js',
    'src/db.js',
    'src/call.js',
    'sw.js',
  ];
  const totalBytes = frontendAssets.reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert.ok(totalBytes < 102400, `Frontend assets must stay under 100KB (got ${totalBytes} bytes)`);
});
