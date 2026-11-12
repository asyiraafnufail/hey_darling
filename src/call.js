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
  let isSpeakerOn = false;
  let disconnectTimer = null;
  let keepAliveAudio = null;
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
    callSpeakerBtn,
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
    if (callTimerInterval) return;
    callDurationSeconds = 0;
    if (callStatusText) {
      callStatusText.textContent = 'Connected (00:00)';
    }
    callTimerInterval = setInterval(() => {
      callDurationSeconds++;
      if (callStatusText) {
        callStatusText.textContent = `Connected (${formatDuration(callDurationSeconds)})`;
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

  function clearDisconnectTimer() {
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  }

  function startKeepAlive() {
    if (typeof Audio === 'undefined') return;
    try {
      if (!keepAliveAudio) {
        // WAV hening minimal agar sesi audio WebKit iOS tetap aktif saat layar mati
        keepAliveAudio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=');
        keepAliveAudio.loop = true;
      }
      keepAliveAudio.play().catch(() => {});
    } catch {
      // Abaikan jika platform tidak mendukung Audio constructor (misal test Node)
    }
  }

  function stopKeepAlive() {
    if (keepAliveAudio) {
      try {
        keepAliveAudio.pause();
      } catch {
        // noop
      }
      keepAliveAudio = null;
    }
  }

  function setupMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      const partnerName = activePartner?.display_name || partnerProfile?.display_name || 'Partner';
      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: partnerName,
          artist: 'Hey Darling • Voice Call',
        });
      }
      navigator.mediaSession.playbackState = 'playing';
      navigator.mediaSession.setActionHandler?.('play', () => {
        remoteAudio?.play?.().catch?.(() => {});
        keepAliveAudio?.play?.().catch?.(() => {});
      });
      navigator.mediaSession.setActionHandler?.('hangup', () => {
        endCall(true);
      });
    } catch (e) {
      console.warn('MediaSession setup warning:', e);
    }
  }

  function clearMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = 'none';
      navigator.mediaSession.metadata = null;
    } catch {
      // noop
    }
  }

  function updateMuteUI() {
    if (!callMuteBtn) return;
    const onIcon = callMuteBtn.querySelector?.('.icon-mic-on');
    const offIcon = callMuteBtn.querySelector?.('.icon-mic-off');
    if (onIcon && offIcon) {
      if (isMuted) {
        onIcon.classList.add('hidden');
        offIcon.classList.remove('hidden');
      } else {
        onIcon.classList.remove('hidden');
        offIcon.classList.add('hidden');
      }
    }
    if (isMuted) {
      callMuteBtn.classList.add('active');
    } else {
      callMuteBtn.classList.remove('active');
    }
    callMuteBtn.setAttribute?.('aria-pressed', String(isMuted));
    callMuteBtn.title = isMuted ? 'Unmute Mic' : 'Mute Mic';
  }

  function updateSpeakerUI() {
    if (!callSpeakerBtn) return;
    const onIcon = callSpeakerBtn.querySelector?.('.icon-speaker-on');
    const offIcon = callSpeakerBtn.querySelector?.('.icon-speaker-off');
    if (onIcon && offIcon) {
      if (isSpeakerOn) {
        onIcon.classList.remove('hidden');
        offIcon.classList.add('hidden');
      } else {
        onIcon.classList.add('hidden');
        offIcon.classList.remove('hidden');
      }
    }
    if (isSpeakerOn) {
      callSpeakerBtn.classList.add('active');
    } else {
      callSpeakerBtn.classList.remove('active');
    }
    callSpeakerBtn.setAttribute?.('aria-pressed', String(isSpeakerOn));
    callSpeakerBtn.title = isSpeakerOn ? 'Turn Off Speaker' : 'Turn On Speaker';
  }

  function updateUI() {
    if (!callOverlay) return;

    if (callPartnerName) {
      callPartnerName.textContent = activePartner?.display_name || partnerProfile?.display_name || 'Partner';
    }

    switch (state) {
      case CALL_STATE.IDLE:
        callOverlay.classList.add('hidden');
        if (callAnswerBtn) callAnswerBtn.classList.add('hidden');
        if (callSpeakerBtn) callSpeakerBtn.classList.add('hidden');
        if (callMuteBtn) callMuteBtn.classList.add('hidden');
        stopDurationTimer();
        break;

      case CALL_STATE.CALLING:
        callOverlay.classList.remove('hidden');
        if (callStatusText) callStatusText.textContent = 'Calling...';
        if (callAnswerBtn) callAnswerBtn.classList.add('hidden');
        if (callSpeakerBtn) {
          callSpeakerBtn.classList.remove('hidden');
          updateSpeakerUI();
        }
        if (callMuteBtn) {
          callMuteBtn.classList.remove('hidden');
          updateMuteUI();
        }
        break;

      case CALL_STATE.RINGING:
        callOverlay.classList.remove('hidden');
        if (callStatusText) callStatusText.textContent = 'Incoming Call...';
        if (callAnswerBtn) callAnswerBtn.classList.remove('hidden');
        if (callSpeakerBtn) callSpeakerBtn.classList.add('hidden');
        if (callMuteBtn) callMuteBtn.classList.add('hidden');
        break;

      case CALL_STATE.CONNECTED:
        callOverlay.classList.remove('hidden');
        if (callAnswerBtn) callAnswerBtn.classList.add('hidden');
        if (callSpeakerBtn) {
          callSpeakerBtn.classList.remove('hidden');
          updateSpeakerUI();
        }
        if (callMuteBtn) {
          callMuteBtn.classList.remove('hidden');
          updateMuteUI();
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
          caller_name: currentUser?.user_metadata?.display_name || 'Partner',
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

    peerConnection.oniceconnectionstatechange = () => {
      if (!peerConnection) return;
      const ice = peerConnection.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') {
        clearDisconnectTimer();
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (!peerConnection) return;
      const cState = peerConnection.connectionState;

      if (cState === 'connected') {
        clearDisconnectTimer();
        setState(CALL_STATE.CONNECTED);
        setupMediaSession();
        startKeepAlive();
      } else if (cState === 'disconnected') {
        // Layar mati / ganti jaringan di HP memicu disconnected sementara.
        // Beri toleransi 15 detik untuk auto-reconnect ICE, jangan langsung putus.
        if (!disconnectTimer) {
          disconnectTimer = setTimeout(() => {
            if (peerConnection && peerConnection.connectionState === 'disconnected') {
              endCall(false);
            }
          }, 15000);
        }
      } else if (cState === 'failed' || cState === 'closed') {
        clearDisconnectTimer();
        endCall(false);
      }
    };

    // Ambil input microphone dengan echo cancellation & noise suppression
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.onmute = () => {
        // iOS mematikan capture saat app di background/layar mati (kebijakan privasi Apple)
      };
      audioTrack.onunmute = () => {
        // iOS mengaktifkan kembali capture saat app kembali ke foreground
        audioTrack.enabled = !isMuted;
      };
    }

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
      alert('No partner registered yet.');
      return;
    }

    setState(CALL_STATE.CALLING);

    try {
      startKeepAlive();
      await setupPeerConnection();
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      sendSignal('call:offer', { sdp: offer });
      await triggerPushNotification();
    } catch (err) {
      console.error('Start call error:', err);
      alert('Failed to access microphone: ' + (err.message || err));
      endCall(false);
    }
  }

  async function handleReceiveOffer(payload) {
    pendingOffer = payload.sdp;
    if (payload.senderId) {
      activePartner = { id: payload.senderId, display_name: partnerProfile?.display_name || 'Partner' };
    }
    setState(CALL_STATE.RINGING);
  }

  async function answerCall() {
    if (state !== CALL_STATE.RINGING || !pendingOffer) return;

    try {
      startKeepAlive();
      await setupPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      await flushPendingCandidates();

      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      sendSignal('call:answer', { sdp: answer });
      setState(CALL_STATE.CONNECTED);
      setupMediaSession();
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
      updateMuteUI();
    }
  }

  async function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    updateSpeakerUI();

    // 1. Dukungan W3C Audio Output Devices API (Brave, Chrome)
    if (remoteAudio && typeof remoteAudio.setSinkId === 'function') {
      try {
        const devices = await navigator.mediaDevices?.enumerateDevices?.();
        const outputs = devices?.filter((d) => d.kind === 'audiooutput') || [];
        if (outputs.length > 0) {
          const target = isSpeakerOn
            ? (outputs.find((d) => d.label.toLowerCase().includes('speaker')) || outputs[0])
            : (outputs.find((d) => !d.label.toLowerCase().includes('speaker')) || outputs[0]);
          if (target?.deviceId) {
            await remoteAudio.setSinkId(target.deviceId);
          }
        }
      } catch (err) {
        console.warn('Speaker setSinkId error:', err);
      }
    }

    // 2. Dukungan iOS Safari / WebKit native playback target picker (Speaker / Earpiece / Bluetooth)
    if (remoteAudio && typeof remoteAudio.webkitShowPlaybackTargetPicker === 'function') {
      try {
        remoteAudio.webkitShowPlaybackTargetPicker();
      } catch (err) {
        console.warn('iOS audio target picker error:', err);
      }
    }
  }

  function handleVisibilityChange() {
    if (typeof document === 'undefined' || state === CALL_STATE.IDLE) return;
    if (document.visibilityState === 'visible') {
      if (remoteAudio && remoteAudio.srcObject && remoteAudio.paused) {
        remoteAudio.play().catch(() => {});
      }
      if (keepAliveAudio && keepAliveAudio.paused) {
        keepAliveAudio.play().catch(() => {});
      }
      if (localStream) {
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = !isMuted;
        }
      }
      if (peerConnection && (peerConnection.iceConnectionState === 'disconnected' || peerConnection.connectionState === 'disconnected')) {
        peerConnection.restartIce?.();
      }
    }
  }

  function endCall(notifyPartner = true) {
    clearDisconnectTimer();
    stopKeepAlive();
    clearMediaSession();

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
    isSpeakerOn = false;
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
    if (callSpeakerBtn) {
      callSpeakerBtn.addEventListener('click', toggleSpeaker);
    }
    if (callMuteBtn) {
      callMuteBtn.addEventListener('click', toggleMute);
    }
    if (callEndBtn) {
      callEndBtn.addEventListener('click', onEndClick);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
  }

  function destroy() {
    endCall(true);
    if (callBtn) callBtn.removeEventListener('click', startCall);
    if (callAnswerBtn) callAnswerBtn.removeEventListener('click', answerCall);
    if (callSpeakerBtn) callSpeakerBtn.removeEventListener('click', toggleSpeaker);
    if (callMuteBtn) callMuteBtn.removeEventListener('click', toggleMute);
    if (callEndBtn) callEndBtn.removeEventListener('click', onEndClick);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }

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
    toggleSpeaker,
    getState: () => state,
  };
}
