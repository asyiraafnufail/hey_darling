/**
 * Hey Darling: Controller Utama Aplikasi PWA
 * Mengelola otentikasi, sinkronisasi delta pesan, Web Push, offline error handling,
 * siklus hidup background/foreground, pembatasan DOM nodes (150) untuk 60 FPS,
 * dan integrasi Panggilan Suara (Task 10).
 */

import { CONFIG } from './config.js';
import { defaultDB } from './db.js';
import { createApi, initSupabaseClient } from './api.js';

export const MAX_VISIBLE_DOM_NODES = 150;

// Helper konversi VAPID public key Base64 URL-safe ke Uint8Array untuk PushManager
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function createAppController({ api, db, dom, callModule = null }) {
  let currentUser = null;
  let partnerProfile = null;
  let isSubscribedToRealtime = false;
  let callService = null;

  // Elemen DOM
  const {
    bootScreen,
    authScreen,
    chatScreen,
    tabLogin,
    tabRegister,
    displayNameGroup,
    authForm,
    authNameInput,
    authEmailInput,
    authPasswordInput,
    authError,
    authSubmit,
    partnerNameEl,
    syncStatusEl,
    notifBtn,
    callBtn,
    logoutBtn,
    iosBanner,
    dismissIosBanner,
    messagesContainer,
    loadOlderBtn,
    skeletonLoader,
    messagesList,
    messageInput,
    sendBtn,
  } = dom;

  function showScreen(screen) {
    if (bootScreen) bootScreen.classList.add('hidden');
    if (authScreen) authScreen.classList.add('hidden');
    if (chatScreen) chatScreen.classList.add('hidden');

    if (screen) screen.classList.remove('hidden');
  }

  function setSyncStatus(text) {
    if (syncStatusEl) syncStatusEl.textContent = text;
  }

  // --- Auth Flow ---
  let isRegisterTab = false;

  function setAuthMode(register) {
    isRegisterTab = register;
    if (authError) authError.classList.add('hidden');

    if (tabLogin && tabRegister) {
      tabLogin.classList.toggle('active', !register);
      tabLogin.setAttribute('aria-selected', String(!register));
      tabRegister.classList.toggle('active', register);
      tabRegister.setAttribute('aria-selected', String(register));
    }

    if (displayNameGroup) {
      displayNameGroup.classList.toggle('hidden', !register);
    }

    if (authSubmit) {
      authSubmit.textContent = register ? 'Daftar' : 'Masuk';
    }
  }

  async function handleAuthSubmit(event) {
    if (event) event.preventDefault();
    if (authError) authError.classList.add('hidden');
    if (authSubmit) authSubmit.disabled = true;

    const email = authEmailInput?.value?.trim() || '';
    const password = authPasswordInput?.value || '';
    const name = authNameInput?.value?.trim() || '';

    try {
      if (isRegisterTab) {
        const { user, error } = await api.register(email, password, name);
        if (error) throw error;
        if (!user) throw new Error('Pendaftaran gagal. Periksa email atau kuota sistem.');
        // Registrasi sukses, cek konfirmasi atau session
      } else {
        const { user, error } = await api.login(email, password);
        if (error) throw error;
        if (!user) throw new Error('Email atau password tidak sesuai.');
      }

      const { session } = await api.getSession();
      if (session?.user) {
        await onUserAuthenticated(session.user);
      } else if (isRegisterTab && authError) {
        authError.textContent = 'Pendaftaran berhasil! Cek email konfirmasi Anda lalu masuk.';
        authError.classList.remove('hidden');
      }
    } catch (err) {
      if (authError) {
        authError.textContent = err.message || 'Terjadi kesalahan otentikasi.';
        authError.classList.remove('hidden');
      }
    } finally {
      if (authSubmit) authSubmit.disabled = false;
    }
  }

  async function handleLogout() {
    try {
      if (callService) {
        callService.destroy ? callService.destroy() : callService.endCall?.();
        callService = null;
      }
      api.unsubscribeRealtime();
      isSubscribedToRealtime = false;
      await api.logout();
    } catch (err) {
      console.warn('Logout warning:', err);
    }
    currentUser = null;
    partnerProfile = null;
    showScreen(authScreen);
  }

  // --- DOM Rendering & Optimasi 150 Nodes ---
  function pruneMessagesDom() {
    if (!messagesList) return;
    while (messagesList.children.length > MAX_VISIBLE_DOM_NODES) {
      messagesList.removeChild(messagesList.firstElementChild);
    }
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function createMessageElement(msg, isPending = false, isFailed = false) {
    const row = document.createElement('div');
    row.id = `msg-${msg.id}`;
    row.dataset.createdAt = msg.created_at || '';
    if (isPending || isFailed) row.dataset.transient = '1';
    row.className = `msg-row ${msg.sender_id === currentUser?.id ? 'me' : 'other'}`;

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.body;
    row.appendChild(bubble);

    const meta = document.createElement('div');
    meta.className = 'msg-meta';

    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTimestamp(msg.created_at);
    meta.appendChild(timeSpan);

    if (isPending) {
      const pendingSpan = document.createElement('span');
      pendingSpan.className = 'status-pending';
      pendingSpan.textContent = ' • mengirim...';
      meta.appendChild(pendingSpan);
    } else if (isFailed) {
      // Review Focus 1: Tangani kegagalan kirim dengan tombol retry
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'msg-retry-btn';
      retryBtn.textContent = 'Gagal • coba lagi';
      retryBtn.onclick = () => retrySendMessage(msg);
      meta.appendChild(retryBtn);
    }

    row.appendChild(meta);
    return row;
  }

  function appendMessageToUI(msg, isPending = false, isFailed = false) {
    if (!messagesList) return;
    const existing = document.getElementById(`msg-${msg.id}`);
    if (existing) {
      // Jika pesan permanen sudah ada di UI, jangan timpa untuk hindari flicker animasi
      if (!isPending && !isFailed && !existing.dataset.transient) return;
      const newEl = createMessageElement(msg, isPending, isFailed);
      messagesList.replaceChild(newEl, existing);
      return;
    }

    const row = createMessageElement(msg, isPending, isFailed);
    messagesList.appendChild(row);
    pruneMessagesDom();

    // Scroll ke bawah jika pengirim adalah diri sendiri atau pengguna berada dekat dasar
    const isMe = msg.sender_id === currentUser?.id;
    const isNearBottom = messagesContainer
      ? messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < 120
      : true;

    if (isMe || isNearBottom) {
      scrollToBottom();
    }
  }

  function prependMessagesToUI(messages) {
    if (!messagesList || !messages || messages.length === 0) return;
    const frag = document.createDocumentFragment();
    for (const msg of messages) {
      if (!document.getElementById(`msg-${msg.id}`)) {
        frag.appendChild(createMessageElement(msg));
      }
    }
    messagesList.insertBefore(frag, messagesList.firstChild);
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  // --- Delta Sync Lifecycle ---
  async function performDeltaSync() {
    setSyncStatus('Menyinkronkan...');
    try {
      const latestTs = await db.getLatestTimestamp();
      const newMessages = await api.fetchDeltaMessages(latestTs, 50);

      if (newMessages.length > 0) {
        await db.saveMessages(newMessages);
        for (const msg of newMessages) {
          appendMessageToUI(msg);
        }
      }

      setSyncStatus('Terhubung');
    } catch (err) {
      console.warn('Delta sync error:', err);
      setSyncStatus('Luring (offline)');
    }
  }

  function startRealtime() {
    if (isSubscribedToRealtime) return;
    isSubscribedToRealtime = true;

    api.subscribeToMessages(async (newMsg) => {
      await db.saveMessages([newMsg]);
      appendMessageToUI(newMsg);
    });
  }

  function stopRealtime() {
    if (!isSubscribedToRealtime) return;
    api.unsubscribeRealtime();
    isSubscribedToRealtime = false;
    setSyncStatus('Dijeda (hemat kuota)');
  }

  // --- Pengiriman Pesan Optimistik (Review Focus 1) ---
  async function sendMessage() {
    if (!messageInput || !currentUser) return;
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';

    const tempId = 'temp-' + Date.now();
    const tempMsg = {
      id: tempId,
      sender_id: currentUser.id,
      body: text,
      created_at: new Date().toISOString(),
    };

    // 1. Tampilkan optimistik langsung di UI
    appendMessageToUI(tempMsg, true, false);

    try {
      const { data, error } = await api.sendMessage(text, currentUser.id);
      if (error) throw error;

      // 2. Simpan ke IndexedDB dan ganti elemen sementara dengan ID permanen
      if (data) {
        await db.saveMessages([data]);
        const tempEl = document.getElementById(`msg-${tempId}`);
        if (tempEl) tempEl.remove();
        appendMessageToUI(data, false, false);
      }
    } catch (err) {
      console.error('Send message failed:', err);
      // Tandai gagal & tawarkan tombol coba lagi (retry)
      appendMessageToUI(tempMsg, false, true);
    }
  }

  async function retrySendMessage(failedMsg) {
    const tempEl = document.getElementById(`msg-${failedMsg.id}`);
    if (tempEl) tempEl.remove();

    // Tampilkan ulang sebagai pending
    appendMessageToUI(failedMsg, true, false);

    try {
      const { data, error } = await api.sendMessage(failedMsg.body, currentUser.id);
      if (error) throw error;
      if (data) {
        await db.saveMessages([data]);
        const retryEl = document.getElementById(`msg-${failedMsg.id}`);
        if (retryEl) retryEl.remove();
        appendMessageToUI(data, false, false);
      }
    } catch (err) {
      console.error('Retry failed:', err);
      appendMessageToUI(failedMsg, false, true);
    }
  }

  // --- Pagination Pesan Lama ---
  async function loadOlderMessages() {
    if (!messagesList || messagesList.children.length === 0) return;
    const firstRow = messagesList.firstElementChild;
    const beforeTs = firstRow?.dataset?.createdAt;
    if (!beforeTs) return;

    try {
      const olderFromDb = await db.getLocalMessages(30, beforeTs);
      if (olderFromDb.length > 0) {
        prependMessagesToUI(olderFromDb);
      } else {
        // Ambil dari Supabase jika di IndexedDB belum ada
        const olderFromApi = await api.fetchOlderMessages(beforeTs, 30);
        if (olderFromApi.length > 0) {
          await db.saveMessages(olderFromApi);
          prependMessagesToUI(olderFromApi);
        } else if (loadOlderBtn) {
          loadOlderBtn.classList.add('hidden');
        }
      }
    } catch (err) {
      console.warn('Load older messages error:', err);
    }
  }

  // --- Web Push Subscription ---
  async function setupWebPush() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('Web Push tidak didukung pada peramban ini');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Izin notifikasi diperlukan untuk menerima pesan saat layar mati.');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        const vapidKeyBytes = urlBase64ToUint8Array(CONFIG.VAPID_PUBLIC_KEY);
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes,
        });
      }

      if (sub && currentUser) {
        const subJson = sub.toJSON();
        const saveRes = await api.savePushSubscription(currentUser.id, subJson, navigator.userAgent);
        if (saveRes?.error) throw saveRes.error;
        if (notifBtn) {
          notifBtn.classList.add('notif-enabled');
          notifBtn.title = 'Notifikasi Aktif';
        }
      }
    } catch (err) {
      console.error('Push subscription failed:', err);
      alert('Gagal mengaktifkan notifikasi: ' + (err.message || err));
    }
  }

  // --- iOS Standalone Detection (Review Focus 5) ---
  function checkIosInstallBanner() {
    if (typeof window === 'undefined') return;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;

    if (isIos && !isStandalone && iosBanner) {
      iosBanner.classList.remove('hidden');
    }
  }

  // --- Lifecycle Hook: Visibility Change ---
  function handleVisibilityChange() {
    if (typeof document === 'undefined' || !currentUser) return;
    if (document.visibilityState === 'visible') {
      performDeltaSync().then(startRealtime);
    } else {
      stopRealtime();
    }
  }

  // --- Inisialisasi User Terotentikasi ---
  async function onUserAuthenticated(user) {
    currentUser = user;
    showScreen(chatScreen);

    // Ambil profil pasangan
    const { partnerProfile: partner } = await api.syncPartnerProfile(user.id);
    if (partner) {
      partnerProfile = partner;
      if (partnerNameEl) partnerNameEl.textContent = partner.display_name;
      const avatarText = dom.partnerAvatarText || (typeof document !== 'undefined' ? document.getElementById('partner-avatar-text') : null);
      if (avatarText && partner.display_name) {
        avatarText.textContent = partner.display_name.trim().charAt(0).toUpperCase();
      }
    }

    // Tampilkan pesan lokal dari IndexedDB
    if (skeletonLoader) skeletonLoader.classList.remove('hidden');
    const localMessages = await db.getLocalMessages(50);
    if (skeletonLoader) skeletonLoader.classList.add('hidden');

    if (messagesList) messagesList.innerHTML = '';
    for (const msg of localMessages) {
      appendMessageToUI(msg);
    }

    if (localMessages.length >= 30 && loadOlderBtn) {
      loadOlderBtn.classList.remove('hidden');
    }

    // Hubungkan WebRTC Call jika modul tersedia (Task 10)
    if (callModule && typeof callModule.createCallController === 'function') {
      callService = callModule.createCallController({
        api,
        currentUser,
        partnerProfile,
        dom,
      });
      callService.init();
    }

    // Lakukan delta sync dan nyalakan Realtime
    await performDeltaSync();
    if (messagesList && messagesList.children.length >= 30 && loadOlderBtn) {
      loadOlderBtn.classList.remove('hidden');
    }
    startRealtime();
    checkIosInstallBanner();

    // Sinkronkan status tombol notifikasi jika izin sudah diberikan sebelumnya
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notifBtn) {
      notifBtn.classList.add('notif-enabled');
      notifBtn.title = 'Notifikasi Aktif';
    }
  }

  // --- Boot Inisialisasi ---
  async function init() {
    // 1. Daftarkan Service Worker
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('SW registration failed:', err);
      });
    }

    // 2. Pasang Event Listeners DOM
    if (tabLogin) tabLogin.addEventListener('click', () => setAuthMode(false));
    if (tabRegister) tabRegister.addEventListener('click', () => setAuthMode(true));
    if (authForm) authForm.addEventListener('submit', handleAuthSubmit);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (notifBtn) notifBtn.addEventListener('click', setupWebPush);
    if (loadOlderBtn) loadOlderBtn.addEventListener('click', loadOlderMessages);
    if (dismissIosBanner && iosBanner) {
      dismissIosBanner.addEventListener('click', () => iosBanner.classList.add('hidden'));
    }

    // Keyboard Handler: Enter kirim pesan, Shift+Enter baris baru & auto-resize
    if (messageInput) {
      messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 110) + 'px';
      });
      messageInput.addEventListener('keydown', (e) => {
        const isMobile =
          (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
          (typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''));

        // Di HP: Enter buat baris baru; di Desktop: Enter kirim pesan, Shift+Enter baris baru
        if (!isMobile && !e.isComposing && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    // Pasang listener visibilitychange
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    // 3. Periksa sesi login yang ada
    try {
      const { session } = await api.getSession();
      if (session?.user) {
        await onUserAuthenticated(session.user);
      } else {
        showScreen(authScreen);
      }
    } catch (err) {
      console.warn('Session check error:', err);
      showScreen(authScreen);
    }
  }

  return {
    init,
    sendMessage,
    retrySendMessage,
    performDeltaSync,
    startRealtime,
    stopRealtime,
    handleVisibilityChange,
    setupWebPush,
    handleAuthSubmit,
    handleLogout,
  };
}

// Inisialisasi otomatis di browser saat DOM ready
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', async () => {
    try {
      const supabaseClient = await initSupabaseClient();
      const api = createApi(supabaseClient);
      const db = defaultDB;

      // Import dinamis modul call (Task 10) jika ada
      let callModule = null;
      try {
        callModule = await import('./call.js');
      } catch (e) {
        console.warn('Call module not yet loaded:', e);
      }

      const dom = {
        bootScreen: document.getElementById('boot-screen'),
        authScreen: document.getElementById('auth-screen'),
        chatScreen: document.getElementById('chat-screen'),
        tabLogin: document.getElementById('tab-login'),
        tabRegister: document.getElementById('tab-register'),
        displayNameGroup: document.getElementById('display-name-group'),
        authForm: document.getElementById('auth-form'),
        authNameInput: document.getElementById('auth-name'),
        authEmailInput: document.getElementById('auth-email'),
        authPasswordInput: document.getElementById('auth-password'),
        authError: document.getElementById('auth-error'),
        authSubmit: document.getElementById('auth-submit'),
        partnerNameEl: document.getElementById('partner-name'),
        syncStatusEl: document.getElementById('sync-status'),
        notifBtn: document.getElementById('notif-btn'),
        callBtn: document.getElementById('call-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        iosBanner: document.getElementById('ios-install-banner'),
        dismissIosBanner: document.getElementById('dismiss-ios-banner'),
        messagesContainer: document.getElementById('messages-container'),
        loadOlderBtn: document.getElementById('load-older-btn'),
        skeletonLoader: document.getElementById('skeleton-loader'),
        messagesList: document.getElementById('messages-list'),
        messageInput: document.getElementById('message-input'),
        sendBtn: document.getElementById('send-btn'),
        callOverlay: document.getElementById('call-overlay'),
        callPartnerName: document.getElementById('call-partner-name'),
        callStatusText: document.getElementById('call-status-text'),
        callAnswerBtn: document.getElementById('call-answer-btn'),
        callSpeakerBtn: document.getElementById('call-speaker-btn'),
        callMuteBtn: document.getElementById('call-mute-btn'),
        callEndBtn: document.getElementById('call-end-btn'),
        remoteAudio: document.getElementById('remote-audio'),
      };

      const app = createAppController({ api, db, dom, callModule });
      await app.init();
    } catch (err) {
      console.error('App init failed:', err);
    }
  });
}
