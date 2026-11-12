import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createCallController, CALL_STATE } from '../src/call.js';

test('call: call module defines WebRTC peer connection configuration with public STUN', () => {
  const callCode = fs.readFileSync('src/call.js', 'utf8');
  assert.ok(callCode.includes('RTCPeerConnection'), 'must use RTCPeerConnection');
  assert.ok(callCode.includes('stun:stun.l.google.com:19302'), 'must configure Google public STUN server');
  assert.ok(callCode.includes('call:offer'), 'must support call:offer signal');
  assert.ok(callCode.includes('call:answer'), 'must support call:answer signal');
  assert.ok(callCode.includes('call:candidate'), 'must support call:candidate signal');
  assert.ok(callCode.includes('call:end'), 'must support call:end signal');
});

test('call: notify-call edge function exists and handles high-priority call notifications', () => {
  const edgePath = 'supabase/functions/notify-call/index.ts';
  assert.strictEqual(fs.existsSync(edgePath), true, 'notify-call function must exist');
  const code = fs.readFileSync(edgePath, 'utf8');
  assert.ok(code.includes('incoming-call'), 'must send incoming-call tag payload');
});

test('call: call controller manages signaling events and transitions through IDLE, RINGING, and IDLE', async () => {
  const broadcastHandlers = {};
  const mockChannel = {
    on(type, filter, callback) {
      if (filter?.event) {
        broadcastHandlers[filter.event] = callback;
      }
      return mockChannel;
    },
    subscribe() { return mockChannel; },
    send({ event, payload }) {
      // simulate loopback if needed
    },
  };

  const mockClient = {
    channel(name) { return mockChannel; },
    removeChannel() {},
  };

  const mockApi = {
    client: mockClient,
    async getSession() { return { session: { access_token: 'tok' } }; },
  };

  const mockDom = {
    callBtn: { addEventListener() {}, removeEventListener() {} },
    callOverlay: { classList: { add() {}, remove() {} } },
    callPartnerName: { textContent: '' },
    callStatusText: { textContent: '' },
    callAnswerBtn: { classList: { add() {}, remove() {} }, addEventListener() {}, removeEventListener() {} },
    callMuteBtn: { classList: { add() {}, remove() {} }, addEventListener() {}, removeEventListener() {} },
    callEndBtn: { classList: { add() {}, remove() {} }, addEventListener() {}, removeEventListener() {} },
  };

  const callCtrl = createCallController({
    api: mockApi,
    currentUser: { id: 'user-1' },
    partnerProfile: { id: 'user-2', display_name: 'Darling' },
    dom: mockDom,
  });

  assert.strictEqual(callCtrl.getState(), CALL_STATE.IDLE);
  callCtrl.init();

  // Simulasikan panggilan masuk dari pasangan (call:offer)
  assert.ok(broadcastHandlers['call:offer'], 'must register call:offer handler');
  await broadcastHandlers['call:offer']({
    payload: {
      targetId: 'user-1',
      senderId: 'user-2',
      sdp: { type: 'offer', sdp: 'fake-sdp' },
    },
  });
  assert.strictEqual(callCtrl.getState(), CALL_STATE.RINGING);

  // Simulasikan kandidat ICE yang masuk sebelum diangkat (harus di-queue tanpa error)
  assert.ok(broadcastHandlers['call:candidate'], 'must register call:candidate handler');
  await broadcastHandlers['call:candidate']({
    payload: {
      targetId: 'user-1',
      candidate: { candidate: 'candidate:1' },
    },
  });

  // Simulasikan pasangan menutup panggilan (call:end)
  assert.ok(broadcastHandlers['call:end'], 'must register call:end handler');
  broadcastHandlers['call:end']({
    payload: {
      targetId: 'user-1',
      senderId: 'user-2',
    },
  });
  assert.strictEqual(callCtrl.getState(), CALL_STATE.IDLE);

  callCtrl.destroy();
});

test('call: index.html defines icon controls for speaker, mute, answer, and end call', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(html.includes('id="call-speaker-btn"'), 'must include call-speaker-btn');
  assert.ok(html.includes('id="call-mute-btn"'), 'must include call-mute-btn');
  assert.ok(html.includes('id="call-end-btn"'), 'must include call-end-btn');
  assert.ok(html.includes('icon-speaker-on') && html.includes('icon-speaker-off'), 'must have speaker toggle icons');
  assert.ok(html.includes('icon-mic-on') && html.includes('icon-mic-off'), 'must have mic toggle icons');
});

test('call: survives temporary disconnected state, supports toggleMute and toggleSpeaker', async () => {
  const prevRTC = globalThis.RTCPeerConnection;
  const prevDesc = globalThis.RTCSessionDescription;
  const prevNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  let lastPc = null;
  let pickerCalled = false;

  function makeClassList() {
    const set = new Set();
    return {
      add(c) { set.add(c); },
      remove(c) { set.delete(c); },
      contains(c) { return set.has(c); },
    };
  }

  function makeIconBtn(onCls, offCls) {
    const onEl = { classList: makeClassList() };
    const offEl = { classList: makeClassList() };
    const attrs = {};
    const btn = {
      classList: makeClassList(),
      title: '',
      addEventListener() {},
      removeEventListener() {},
      setAttribute(k, v) { attrs[k] = v; },
      getAttribute(k) { return attrs[k]; },
      querySelector(sel) {
        if (sel === `.${onCls}`) return onEl;
        if (sel === `.${offCls}`) return offEl;
        return null;
      },
      _onEl: onEl,
      _offEl: offEl,
    };
    return btn;
  }

  try {
    globalThis.RTCSessionDescription = class { constructor(d) { Object.assign(this, d); } };
    globalThis.RTCPeerConnection = class {
      constructor() {
        this.connectionState = 'new';
        this.iceConnectionState = 'new';
        lastPc = this;
      }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'sdp' }; }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() { this.connectionState = 'closed'; }
    };

    const audioTrack = { enabled: true, stop() {}, onmute: null, onunmute: null };
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          async getUserMedia() {
            return { getAudioTracks: () => [audioTrack], getTracks: () => [audioTrack] };
          },
          async enumerateDevices() { return []; },
        },
      },
      configurable: true,
      writable: true,
    });

    const mockChannel = {
      on() { return mockChannel; },
      subscribe() { return mockChannel; },
      send() {},
    };
    const mockApi = {
      client: { channel: () => mockChannel, removeChannel() {} },
      async getSession() { return { session: { access_token: 'tok' } }; },
    };

    const muteBtn = makeIconBtn('icon-mic-on', 'icon-mic-off');
    const speakerBtn = makeIconBtn('icon-speaker-on', 'icon-speaker-off');
    const mockDom = {
      callBtn: { addEventListener() {}, removeEventListener() {} },
      callOverlay: { classList: makeClassList() },
      callPartnerName: { textContent: '' },
      callStatusText: { textContent: '' },
      callAnswerBtn: { classList: makeClassList(), addEventListener() {}, removeEventListener() {} },
      callSpeakerBtn: speakerBtn,
      callMuteBtn: muteBtn,
      callEndBtn: { classList: makeClassList(), addEventListener() {}, removeEventListener() {} },
      remoteAudio: {
        srcObject: null,
        play: async () => {},
        webkitShowPlaybackTargetPicker() { pickerCalled = true; },
      },
    };

    const callCtrl = createCallController({
      api: mockApi,
      currentUser: { id: 'u1' },
      partnerProfile: { id: 'u2', display_name: 'Sayang' },
      dom: mockDom,
    });
    callCtrl.init();
    await callCtrl.startCall();

    // Simulasikan koneksi terhubung
    lastPc.connectionState = 'connected';
    lastPc.onconnectionstatechange();
    assert.strictEqual(callCtrl.getState(), CALL_STATE.CONNECTED);

    // Simulasikan layar mati -> disconnected sementara tidak langsung memutus panggilan
    lastPc.connectionState = 'disconnected';
    lastPc.onconnectionstatechange();
    assert.strictEqual(callCtrl.getState(), CALL_STATE.CONNECTED, 'temporary disconnected must not immediately end call');

    // Toggle Mute -> mic mati (isMuted = true)
    callCtrl.toggleMute();
    assert.strictEqual(audioTrack.enabled, false);
    assert.strictEqual(muteBtn.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(muteBtn._onEl.classList.contains('hidden'), true);
    assert.strictEqual(muteBtn._offEl.classList.contains('hidden'), false);

    // Toggle Speaker -> loudspeaker nyala & memicu iOS playback target picker
    await callCtrl.toggleSpeaker();
    assert.strictEqual(speakerBtn.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(speakerBtn._onEl.classList.contains('hidden'), false);
    assert.strictEqual(speakerBtn._offEl.classList.contains('hidden'), true);
    assert.strictEqual(pickerCalled, true);

    // Koneksi failed -> memutus panggilan
    lastPc.connectionState = 'failed';
    lastPc.onconnectionstatechange();
    assert.strictEqual(callCtrl.getState(), CALL_STATE.IDLE);

    callCtrl.destroy();
  } finally {
    if (prevRTC === undefined) delete globalThis.RTCPeerConnection; else globalThis.RTCPeerConnection = prevRTC;
    if (prevDesc === undefined) delete globalThis.RTCSessionDescription; else globalThis.RTCSessionDescription = prevDesc;
    if (prevNavDesc) Object.defineProperty(globalThis, 'navigator', prevNavDesc); else delete globalThis.navigator;
  }
});
