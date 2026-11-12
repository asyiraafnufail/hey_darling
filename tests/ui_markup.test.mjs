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
  assert.ok(html.includes('id="partner-avatar"'), 'must have centered partner avatar in iMessage header');
});

test('ui_markup: style.css enforces system fonts, 100dvh viewport, and GPU-only animations', () => {
  const css = fs.readFileSync('style.css', 'utf8');
  assert.ok(css.includes('system-ui'), 'must use system font stack');
  assert.ok(css.includes('100dvh'), 'must use dynamic viewport height');
  assert.ok(css.includes('transform') && css.includes('opacity'), 'must use GPU animation properties');
  assert.ok(css.includes('prefers-reduced-motion'), 'must respect reduced motion accessibility');
  assert.ok(css.includes('backdrop-filter') && css.includes('-webkit-backdrop-filter'), 'must support iOS Safari glassmorphism blur');
  assert.ok(css.includes('grid-template-columns: 1fr auto 1fr'), 'must center iMessage header profile');
  assert.ok(css.includes('inset: 0'), 'must anchor mobile app-shell edge-to-edge without iOS bottom gap');
});
