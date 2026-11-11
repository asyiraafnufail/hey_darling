import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

test('ui_markup: index.html defines auth screen, chat screen, skeleton template, and PWA tags', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(html.includes('manifest.webmanifest'), 'must link PWA manifest');
  assert.ok(html.includes('apple-mobile-web-app-capable'), 'must include iOS standalone meta');
  assert.ok(html.includes('id="auth-screen"'), 'must have auth screen container');
  assert.ok(html.includes('id="chat-screen"'), 'must have chat screen container');
  assert.ok(html.includes('id="message-input"'), 'must have message input textarea');
  assert.ok(html.includes('id="skeleton-loader"'), 'must have skeleton loader for initial sync');
  assert.ok(html.includes('id="ios-install-banner"'), 'must have iOS install banner for Safari');
});

test('ui_markup: style.css enforces system fonts, 100dvh viewport, and GPU-only animations', () => {
  const css = fs.readFileSync('style.css', 'utf8');
  assert.ok(css.includes('system-ui'), 'must use system font stack');
  assert.ok(css.includes('100dvh'), 'must use dynamic viewport height');
  assert.ok(css.includes('transform') && css.includes('opacity'), 'must use GPU animation properties');
  assert.ok(css.includes('prefers-reduced-motion'), 'must respect reduced motion accessibility');
});
