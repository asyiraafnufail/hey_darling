/**
 * Hey Darling: Modul Panggilan Suara WebRTC P2P (Fase 2)
 * Menggunakan koneksi P2P langsung via RTCPeerConnection dengan STUN publik Google (gratis selamanya),
 * pensinyalan broadcast in-memory via Supabase Realtime (0 egress & 0 disk write),
 * dan trigger Web Push prioritas tinggi untuk membangunkan perangkat saat layar mati.
 */

import { CONFIG } from './config.js';

export const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
  ],
};

export const CALL_STATE = {
  IDLE: 'IDLE',
  CALLING: 'CALLING',
  RINGING: 'RINGING',
  CONNECTED: 'CONNECTED',
};

export function createCallController({ api, currentUser, partnerProfile, dom }) {
  let state = CALL_STATE.IDLE;
  let peerConnection = null;
  let localStream = null;
  let signalChannel = null;
  let callTimerInterval = null;
  let callDurationSeconds = 0;
  let isMuted = false;
  let activePartner = partnerProfile;
  let pendingCandidates = [];

  function onEndClick() {
    endCall(true);
  }

  const {
    callBtn,
    callOverlay,
    callPartnerName,
    callStatusText,
    callAnswerBtn,
    callMuteBtn,
    callEndBtn,
    remoteAudio,
  } = dom || {};

  function setState(newState) {
    state = newState;
    updateUI();
  }

  function formatDuration(sec) {
    const mins = Math.floor(sec / 60).toString().padStart(2, '0');
    const secs = (sec % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }

  function startDurationTimer() {
    stopDurationTimer();
    callDurationSeconds = 0;
    callTimerInterval = setInterval(() => {
      callDurationSeconds++;
      if (callStatusText) {
        callStatusText.textContent = `Terhubung (${formatDuration(callDurationSeconds)})`;
      }
    }, 1000);
  }

  function stopDurationTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
    callDurationSeconds = 0;
  }

  function updateUI() {
    if (!callOverlay) return;

    if (callPartnerName) {
      callPartnerName.textContent = activePartner?.display_name || partnerProfile?.display_name || 'Pasangan';
    }

    switch (state) {
      case CALL_STATE.IDLE:
        callOverlay.classList.add('hidden');
        if (callAnswerBtn) callAnswerBtn.classList.add('hidden');
        if (callMuteBtn) callMuteBtn.classList.add('hidden');
        stopDurationTimer();
        break;

      case CALL_STATE.CALLING:
        callOverlay.classList.remove('hidden');
        if (callStatusText) callStatusText.textContent = 'Memanggil...';
        if (callAnswerBtn) callAnswerBtn.classList.add('hidden');
        if (callMuteBtn) callMuteBtn.classList.add('hidden');
        break;

      case CALL_STATE.RINGING:
        callOverlay.classList.remove('hidden');
        if (callStatusText) callStatusText.textContent = 'Panggilan Masuk...';
        if (callAnswerBtn) callAnswerBtn.classList.remove('hidden');
        if (callMuteBtn) callMuteBtn.classList.add('hidden');
        break;

      case CALL_STATE.CONNECTED:
        callOverlay.classList.remove('hidden');
        if (callStatusText) callStatusText.textContent = 'Terhubung (00:00)';
        if (callAnswerBtn) callAnswerBtn.classList.add('hidden');
        if (callMuteBtn) {
          callMuteBtn.classList.remove('hidden');
          callMuteBtn.textContent = isMuted ? 'Suara Aktif' : 'Bisu';
        }
        startDurationTimer();
        break;
    }
  }

  // --- Realtime Broadcast Signaling ---
  function initSignaling() {
    if (signalChannel || !api) return;

    // Supabase broadcast channel via client
    const supabase = api.client || (typeof window !== 'undefined' ? window.supabaseClient : null);
    if (!supabase) return;

    signalChannel = supabase.channel('call_signals');

    signalChannel
      .on('broadcast', { event: 'call:offer' }, async ({ payload }) => {
        if (!payload || payload.targetId !== currentUser?.id) return;
        if (state !== CALL_STATE.IDLE) {
          // Sedang dalam panggilan lain, kirim sinyal sibuk
          sendSignal('call:end', { reason: 'busy' });
          return;
        }
        await handleReceiveOffer(payload);
      })
      .on('broadcast', { event: 'call:answer' }, async ({ payload }) => {
        if (!payload || payload.targetId !== currentUser?.id) return;
        await handleReceiveAnswer(payload);
      })
      .on('broadcast', { event: 'call:candidate' }, async ({ payload }) => {
        if (!payload || payload.targetId !== currentUser?.id) return;
        await handleReceiveCandidate(payload);
      })
      .on('broadcast', { event: 'call:end' }, ({ payload }) => {
        if (payload?.senderId === currentUser?.id) return;
        if (payload?.targetId === currentUser?.id || state !== CALL_STATE.IDLE) {
          endCall(false);
        }
      })
      .subscribe();
  }

  function sendSignal(event, payload) {
    if (!signalChannel) return;
    const targetId = activePartner?.id || partnerProfile?.id;
    signalChannel.send({
      type: 'broadcast',
      event,
      payload: {
        ...payload,
        senderId: currentUser?.id,
        targetId,
      },
    });
  }

  // Panggil Edge Function notify-call untuk membangunkan HP pasangan jika layar mati
  async function triggerPushNotification() {
    try {
      const url = `${CONFIG.SUPABASE_URL}/functions/v1/notify-call`;
      const { session } = await api.getSession();
      const headers = {
        'Content-Type': 'application/json',
        apikey: CONFIG.SUPABASE_ANON_KEY,
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          caller_id: currentUser?.id,
          caller_name: currentUser?.user_metadata?.display_name || 'Pasangan',
        }),
      });
    } catch (err) {
      console.warn('Call push trigger error:', err);
    }
  }

  // --- WebRTC Peer Connection Core ---
  async function setupPeerConnection() {
    peerConnection = new RTCPeerConnection(RTC_CONFIG);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal('call:candidate', { candidate: event.candidate });
      }
    };

    peerConnection.ontrack = (event) => {
      if (remoteAudio && event.streams[0]) {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch((e) => console.warn('Audio play error:', e));
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      if (peerConnection.connectionState === 'connected') {
        setState(CALL_STATE.CONNECTED);
      } else if (
        peerConnection.connectionState === 'disconnected' ||
        peerConnection.connectionState === 'failed' ||
        peerConnection.connectionState === 'closed'
      ) {
        endCall(false);
      }
    };

    // Ambil input microphone
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const track of localStream.getTracks()) {
      peerConnection.addTrack(track, localStream);
    }
  }

  // --- Handlers: Mulai & Terima Panggilan ---
  let pendingOffer = null;

  async function flushPendingCandidates() {
    if (!peerConnection || !peerConnection.remoteDescription) return;
    while (pendingCandidates.length > 0) {
      const cand = pendingCandidates.shift();
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('Flush ICE candidate error:', err);
      }
    }
  }

  async function startCall() {
    if (state !== CALL_STATE.IDLE || !currentUser) return;

    if (!activePartner?.id && api?.syncPartnerProfile) {
      const { partnerProfile: p } = await api.syncPartnerProfile(currentUser.id);
      if (p) activePartner = p;
    }

    if (!activePartner?.id && !partnerProfile?.id) {
      alert('Belum ada pasangan terdaftar.');
      return;
    }

    setState(CALL_STATE.CALLING);

    try {
      await setupPeerConnection();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      sendSignal('call:offer', { sdp: offer });
      await triggerPushNotification();
    } catch (err) {
      console.error('Start call error:', err);
      alert('Gagal mengakses mikrofon: ' + (err.message || err));
      endCall(false);
    }
  }

  async function handleReceiveOffer(payload) {
    pendingOffer = payload.sdp;
    if (payload.senderId) {
      activePartner = { id: payload.senderId, display_name: partnerProfile?.display_name || 'Pasangan' };
    }
    setState(CALL_STATE.RINGING);
  }

  async function answerCall() {
    if (state !== CALL_STATE.RINGING || !pendingOffer) return;

    try {
      await setupPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      await flushPendingCandidates();

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      sendSignal('call:answer', { sdp: answer });
      setState(CALL_STATE.CONNECTED);
      pendingOffer = null;
    } catch (err) {
      console.error('Answer call error:', err);
      endCall(true);
    }
  }

  async function handleReceiveAnswer(payload) {
    if (!peerConnection || !payload.sdp) return;
    try {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await flushPendingCandidates();
    } catch (err) {
      console.error('Handle answer error:', err);
    }
  }

  async function handleReceiveCandidate(payload) {
    if (!payload?.candidate) return;
    if (!peerConnection || !peerConnection.remoteDescription) {
      pendingCandidates.push(payload.candidate);
      return;
    }
    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
    } catch (err) {
      console.warn('Add ICE candidate error:', err);
    }
  }

  function toggleMute() {
    if (!localStream) return;
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      isMuted = !audioTrack.enabled;
      if (callMuteBtn) {
        callMuteBtn.textContent = isMuted ? 'Suara Aktif' : 'Bisu';
      }
    }
  }

  function endCall(notifyPartner = true) {
    if (notifyPartner && state !== CALL_STATE.IDLE) {
      sendSignal('call:end', {});
    }

    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
      localStream = null;
    }

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    if (remoteAudio) {
      remoteAudio.srcObject = null;
    }

    pendingOffer = null;
    pendingCandidates = [];
    isMuted = false;
    setState(CALL_STATE.IDLE);
  }

  function init() {
    initSignaling();

    if (callBtn) {
      callBtn.addEventListener('click', startCall);
    }
    if (callAnswerBtn) {
      callAnswerBtn.addEventListener('click', answerCall);
    }
    if (callMuteBtn) {
      callMuteBtn.addEventListener('click', toggleMute);
    }
    if (callEndBtn) {
      callEndBtn.addEventListener('click', onEndClick);
    }
  }

  function destroy() {
    endCall(true);
    if (callBtn) callBtn.removeEventListener('click', startCall);
    if (callAnswerBtn) callAnswerBtn.removeEventListener('click', answerCall);
    if (callMuteBtn) callMuteBtn.removeEventListener('click', toggleMute);
    if (callEndBtn) callEndBtn.removeEventListener('click', onEndClick);

    if (signalChannel && api?.client) {
      api.client.removeChannel(signalChannel);
      signalChannel = null;
    }
  }

  return {
    init,
    destroy,
    startCall,
    answerCall,
    endCall,
    toggleMute,
    getState: () => state,
  };
}
