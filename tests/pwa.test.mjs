import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('pwa: manifest is valid JSON with standalone display and PNG icons', () => {
  const manifestRaw = fs.readFileSync('manifest.webmanifest', 'utf8');
  const manifest = JSON.parse(manifestRaw);
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#1a1a1a');
  assert.ok(manifest.icons?.length >= 2, 'must define at least 192 and 512 PNG icons');
  assert.strictEqual(fs.existsSync('icons/icon-192.png'), true, '192px PNG icon must exist');
  assert.strictEqual(fs.existsSync('icons/icon-512.png'), true, '512px PNG icon must exist');
  assert.strictEqual(fs.existsSync('icons/apple-touch-icon.png'), true, 'apple-touch-icon PNG must exist');
});

test('pwa: service worker handles cache-first, push notification, and notificationclick', () => {
  const swCode = fs.readFileSync('sw.js', 'utf8');
  assert.ok(swCode.includes("addEventListener('install'"), 'SW must have install handler');
  assert.ok(swCode.includes("addEventListener('fetch'"), 'SW must have fetch handler');
  assert.ok(swCode.includes("addEventListener('push'"), 'SW must have push handler');
  assert.ok(swCode.includes('/src/app.js'), 'SW cache must reference /src/app.js');
  assert.ok(swCode.includes('showNotification'), 'SW must display notification');
  assert.ok(swCode.includes("addEventListener('notificationclick'"), 'SW must have notificationclick handler');
});
