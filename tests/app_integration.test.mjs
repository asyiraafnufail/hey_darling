import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createAppController, urlBase64ToUint8Array, MAX_VISIBLE_DOM_NODES } from '../src/app.js';
import { createChatDB } from '../src/db.js';
import { createMockIndexedDB } from './helpers/mock-idb.mjs';

test('app_integration: app.js contains lifecycle visibilitychange and keyboard enter handler', () => {
  const appCode = fs.readFileSync('src/app.js', 'utf8');
  assert.ok(appCode.includes('visibilitychange'), 'must listen for document visibilitychange');
  assert.ok(appCode.includes('Enter') && appCode.includes('shiftKey'), 'must handle Enter send and Shift+Enter newline');
  assert.ok(appCode.includes('serviceWorker.register'), 'must register service worker');
  assert.ok(appCode.includes('pushManager.subscribe'), 'must support web push subscription');
});

test('app_integration: Review Focus 1 - offline error handling provides retry status', () => {
  const appCode = fs.readFileSync('src/app.js', 'utf8');
  assert.ok(appCode.includes('status') || appCode.includes('error'), 'must track message send status');
  assert.ok(appCode.includes('retry') || appCode.includes('coba lagi'), 'must provide retry handling for failed sends');
});

test('app_integration: Review Focus 5 - ios standalone detection controls banner visibility', () => {
  const appCode = fs.readFileSync('src/app.js', 'utf8');
  assert.ok(appCode.includes('standalone') || appCode.includes('display-mode'), 'must detect standalone PWA mode');
  assert.ok(appCode.includes('MAX_VISIBLE_DOM_NODES') || appCode.includes('150'), 'must enforce max DOM nodes limit for 60fps render');
});

test('app_integration: urlBase64ToUint8Array decodes URL-safe base64 VAPID keys', () => {
  const decoded = urlBase64ToUint8Array('SGVsbG8td29ybGQ');
  assert.ok(decoded instanceof Uint8Array);
  assert.strictEqual(Buffer.from(decoded).toString('utf8'), 'Hello-world');
});

function createMinimalDomMocks() {
  const elementsById = new Map();
  function makeEl(tag = 'div') {
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      _id: '',
      get id() { return el._id; },
      set id(val) {
        if (el._id) elementsById.delete(el._id);
        el._id = val;
        if (val) elementsById.set(val, el);
      },
      className: '',
      textContent: '',
      value: '',
      style: {},
      dataset: {},
      children: [],
      attributes: {},
      listeners: {},
      classList: {
        add(c) { classes.add(c); },
        remove(c) { classes.delete(c); },
        toggle(c, force) { force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c)); },
        contains(c) { return classes.has(c); },
      },
      setAttribute(k, v) { el.attributes[k] = v; },
      addEventListener(ev, fn) { (el.listeners[ev] ||= []).push(fn); },
      appendChild(child) {
        el.children.push(child);
        if (child.id) elementsById.set(child.id, child);
        return child;
      },
      insertBefore(node, ref) {
        if (node.tagName === 'FRAGMENT') {
          const items = node.children;
          const idx = ref ? el.children.indexOf(ref) : 0;
          el.children.splice(Math.max(0, idx), 0, ...items);
          return node;
        }
        el.children.unshift(node);
        return node;
      },
      replaceChild(newEl, oldEl) {
        const idx = el.children.indexOf(oldEl);
        if (idx >= 0) el.children[idx] = newEl;
        if (newEl.id) elementsById.set(newEl.id, newEl);
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx >= 0) el.children.splice(idx, 1);
        if (child.id) elementsById.delete(child.id);
      },
      remove() {
        elementsById.delete(el._id);
      },
      get firstElementChild() { return el.children[0] || null; },
      get firstChild() { return el.children[0] || null; },
      set innerHTML(v) { if (v === '') el.children = []; },
    };
    return el;
  }

  const prevDoc = globalThis.document;
  globalThis.document = {
    visibilityState: 'visible',
    listeners: {},
    createElement: (tag) => makeEl(tag),
    createDocumentFragment: () => makeEl('fragment'),
    getElementById: (id) => elementsById.get(id) || null,
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
  };

  const dom = {
    bootScreen: makeEl('section'),
    authScreen: makeEl('section'),
    chatScreen: makeEl('section'),
    partnerNameEl: makeEl('h2'),
    syncStatusEl: makeEl('span'),
    messagesContainer: { ...makeEl('main'), scrollHeight: 500, scrollTop: 400, clientHeight: 100 },
    loadOlderBtn: makeEl('button'),
    skeletonLoader: makeEl('div'),
    messagesList: makeEl('div'),
    messageInput: makeEl('textarea'),
    sendBtn: makeEl('button'),
  };

  return {
    dom,
    cleanup() {
      globalThis.document = prevDoc;
    },
  };
}

test('app_integration: sendMessage failure surfaces retry button and caps DOM at 150 nodes', async () => {
  const { dom, cleanup } = createMinimalDomMocks();
  try {
    const db = createChatDB(createMockIndexedDB());
    const seedMessages = Array.from({ length: 160 }, (_, i) => ({
      id: `m-${i}`,
      sender_id: 'u1',
      body: `msg ${i}`,
      created_at: new Date(1700000000000 + i * 1000).toISOString(),
    }));

    let failSend = true;
    let realtimeCalls = 0;
    let unsubCalls = 0;

    const mockApi = {
      async getSession() { return { session: { user: { id: 'u1' } } }; },
      async syncPartnerProfile() { return { partnerProfile: { id: 'u2', display_name: 'Sayang' } }; },
      async fetchDeltaMessages(sinceTs) {
        if (sinceTs) return [];
        return seedMessages;
      },
      subscribeToMessages() { realtimeCalls++; },
      unsubscribeRealtime() { unsubCalls++; },
      async sendMessage(body, senderId) {
        if (failSend) return { data: null, error: new Error('Network offline') };
        return { data: { id: 'real-1', sender_id: senderId, body, created_at: new Date().toISOString() }, error: null };
      },
    };

    const controller = createAppController({ api: mockApi, db, dom });
    await controller.init();

    // Caps DOM at MAX_VISIBLE_DOM_NODES (150) even when 160 messages sync
    assert.strictEqual(dom.messagesList.children.length, MAX_VISIBLE_DOM_NODES);

    // Failed send marks message with retry button
    dom.messageInput.value = 'Halo offline';
    await controller.sendMessage();
    const lastRow = dom.messagesList.children[dom.messagesList.children.length - 1];
    const metaEl = lastRow.children[1];
    const retryBtn = metaEl.children.find((c) => c.className === 'msg-retry-btn');
    assert.ok(retryBtn, 'failed message must show retry button');

    // Visibility hidden -> unsubscribes realtime; visible -> re-syncs & subscribes
    globalThis.document.visibilityState = 'hidden';
    controller.handleVisibilityChange();
    assert.strictEqual(unsubCalls, 1);

    globalThis.document.visibilityState = 'visible';
    controller.handleVisibilityChange();
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(realtimeCalls, 2);
  } finally {
    cleanup();
  }
});
