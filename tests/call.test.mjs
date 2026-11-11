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
