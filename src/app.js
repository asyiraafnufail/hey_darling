/**
 * Hey Darling: Main PWA Application Controller
 * Manages authentication, delta message sync, receipts (Sent/Delivered/Read),
 * realtime presence & last seen, Web Push, offline error handling,
 * background/foreground lifecycle, 150-node DOM cap for 60 FPS,
 * and Voice Calls integration.
 */

import { CONFIG } from './config.js';
import { defaultDB } from './db.js';
import { createApi, initSupabaseClient } from './api.js';

export const MAX_VISIBLE_DOM_NODES = 150;

export function formatLastSeen(isoStr) {
  if (!isoStr) return 'Offline';
  try {
    const date = new Date(isoStr);
    if (Number.isNaN(date.getTime())) return 'Offline';
    const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diffSec < 60) return 'Last seen just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Last seen ${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) {
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return `Last seen today at ${timeStr}`;
    }
    const dayStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Last seen ${dayStr} at ${timeStr}`;
  } catch {
    return 'Offline';
  }
}

export function formatMessageStatus(msg) {
  if (msg?.read_at) return { text: 'Read', isRead: true };
  if (msg?.delivered_at) return { text: 'Delivered', isRead: false };
  return { text: 'Sent', isRead: false };
}

// Convert URL-safe Base64 VAPID public key to Uint8Array for PushManager
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
  let isSyncing = false;
  let isOnline = typeof navigator !== 'undefined' && navigator.onLine !== undefined ? navigator.onLine : true;
  let isPartnerOnline = false;
  let lastSeenTimer = null;
  const cachedMessagesById = new Map();

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

  function renderHeaderStatus() {
    if (!syncStatusEl) return;
    if (!isOnline) {
      syncStatusEl.textContent = 'Offline';
      syncStatusEl.classList.remove('online');
      return;
    }
    if (isSyncing) {
      syncStatusEl.textContent = 'Syncing...';
      syncStatusEl.classList.remove('online');
      return;
    }
    if (isPartnerOnline) {
      syncStatusEl.textContent = 'Online';
      syncStatusEl.classList.add('online');
      return;
    }
    if (partnerProfile?.last_seen_at) {
      syncStatusEl.textContent = formatLastSeen(partnerProfile.last_seen_at);
      syncStatusEl.classList.remove('online');
      return;
    }
    syncStatusEl.textContent = 'Connected';
    syncStatusEl.classList.remove('online');
  }

  function startLastSeenTimer() {
    stopLastSeenTimer();
    lastSeenTimer = setInterval(() => {
      if (!isPartnerOnline && partnerProfile?.last_seen_at && !isSyncing && isOnline) {
        renderHeaderStatus();
      }
    }, 30000);
    if (lastSeenTimer && typeof lastSeenTimer.unref === 'function') {
      lastSeenTimer.unref();
    }
  }

  function stopLastSeenTimer() {
    if (lastSeenTimer) {
      clearInterval(lastSeenTimer);
      lastSeenTimer = null;
    }
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
      authSubmit.textContent = register ? 'Sign Up' : 'Sign In';
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
        if (!user) throw new Error('Sign up failed. Please check your email or system capacity.');
      } else {
        const { user, error } = await api.login(email, password);
        if (error) throw error;
        if (!user) throw new Error('Invalid email or password.');
      }

      const { session } = await api.getSession();
      if (session?.user) {
        await onUserAuthenticated(session.user);
      } else if (isRegisterTab && authError) {
        authError.textContent = 'Registration successful! Please check your email confirmation then sign in.';
        authError.classList.remove('hidden');
      }
    } catch (err) {
      if (authError) {
        authError.textContent = err.message || 'Authentication error occurred.';
        authError.classList.remove('hidden');
      }
    } finally {
      if (authSubmit) authSubmit.disabled = false;
    }
  }

  async function handleLogout() {
    stopLastSeenTimer();
    try {
      if (callService) {
        callService.destroy ? callService.destroy() : callService.endCall?.();
        callService = null;
      }
      stopRealtime();
      await api.logout();
    } catch (err) {
      console.warn('Logout warning:', err);
    }
    currentUser = null;
    partnerProfile = null;
    isPartnerOnline = false;
    cachedMessagesById.clear();
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
    const isMe = msg.sender_id === currentUser?.id;
    row.className = `msg-row ${isMe ? 'me' : 'other'}`;

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
      pendingSpan.textContent = ' • Sending...';
      meta.appendChild(pendingSpan);
    } else if (isFailed) {
      // Review Focus 1: Handle failed send with retry button
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'msg-retry-btn';
      retryBtn.textContent = 'Failed • retry';
      retryBtn.onclick = () => retrySendMessage(msg);
      meta.appendChild(retryBtn);
    } else if (isMe) {
      // Sent message: show status label (Sent / Delivered / Read)
      const statusSpan = document.createElement('span');
      statusSpan.id = `status-${msg.id}`;
      const statusInfo = formatMessageStatus(msg);
      statusSpan.className = `msg-status${statusInfo.isRead ? ' read' : ''}`;
      statusSpan.textContent = ` • ${statusInfo.text}`;
      meta.appendChild(statusSpan);
    }

    row.appendChild(meta);
    return row;
  }

  function updateMessageStatusInUI(msg) {
    if (!msg || !msg.id) return;
    const existing = cachedMessagesById.get(msg.id);
    if (existing) {
      Object.assign(existing, msg);
    } else {
      cachedMessagesById.set(msg.id, msg);
    }

    const statusSpan = document.getElementById(`status-${msg.id}`);
    if (statusSpan) {
      const statusInfo = formatMessageStatus(msg);
      statusSpan.className = `msg-status${statusInfo.isRead ? ' read' : ''}`;
      statusSpan.textContent = ` • ${statusInfo.text}`;
    }
  }

  async function processIncomingReceipts(messages) {
    if (!currentUser || !Array.isArray(messages) || messages.length === 0) return;
    const partnerMessages = messages.filter((m) => m && m.sender_id && m.sender_id !== currentUser.id);
    if (partnerMessages.length === 0) return;

    const toDeliver = [];
    const toRead = [];
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible';

    for (const msg of partnerMessages) {
      if (!msg.delivered_at) {
        toDeliver.push(msg.id);
      }
      if (isVisible && !msg.read_at) {
        toRead.push(msg.id);
      }
    }

    const now = new Date().toISOString();
    const locallyUpdated = [];

    if (toRead.length > 0) {
      try {
        if (api.markMessagesRead) {
          await api.markMessagesRead(toRead);
        }
        for (const id of toRead) {
          const item = cachedMessagesById.get(id) || partnerMessages.find((m) => m.id === id);
          if (item) {
            item.delivered_at = item.delivered_at || now;
            item.read_at = now;
            locallyUpdated.push(item);
          }
        }
      } catch (err) {
        console.warn('Mark read error:', err);
      }
    } else if (toDeliver.length > 0) {
      try {
        if (api.markMessagesDelivered) {
          await api.markMessagesDelivered(toDeliver);
        }
        for (const id of toDeliver) {
          const item = cachedMessagesById.get(id) || partnerMessages.find((m) => m.id === id);
          if (item) {
            item.delivered_at = item.delivered_at || now;
            locallyUpdated.push(item);
          }
        }
      } catch (err) {
        console.warn('Mark delivered error:', err);
      }
    }

    if (locallyUpdated.length > 0) {
      await db.saveMessages(locallyUpdated);
    }
  }

  function appendMessageToUI(msg, isPending = false, isFailed = false) {
    if (!messagesList) return;
    const existing = document.getElementById(`msg-${msg.id}`);
    if (existing) {
      // If permanent message already exists in UI, do not overwrite to avoid flicker
      if (!isPending && !isFailed && !existing.dataset.transient) return;
      const newEl = createMessageElement(msg, isPending, isFailed);
      messagesList.replaceChild(newEl, existing);
      return;
    }

    const row = createMessageElement(msg, isPending, isFailed);
    messagesList.appendChild(row);
    pruneMessagesDom();

    // Scroll to bottom if sent by current user or user is already near bottom
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
    isSyncing = true;
    renderHeaderStatus();
    try {
      const latestTs = await db.getLatestTimestamp();
      const newMessages = await api.fetchDeltaMessages(latestTs, 50);

      if (newMessages.length > 0) {
        await db.saveMessages(newMessages);
        for (const msg of newMessages) {
          cachedMessagesById.set(msg.id, msg);
          appendMessageToUI(msg);
        }
        await processIncomingReceipts(newMessages);
      }

      // Sync status updates for our sent messages
      if (api.fetchMessageStatuses && currentUser) {
        const pendingSentIds = [];
        for (const msg of cachedMessagesById.values()) {
          if (msg.sender_id === currentUser.id && !msg.read_at) {
            pendingSentIds.push(msg.id);
          }
        }
        if (pendingSentIds.length > 0) {
          const updatedStatuses = await api.fetchMessageStatuses(pendingSentIds.slice(-30));
          if (updatedStatuses.length > 0) {
            const toSave = [];
            for (const statusRow of updatedStatuses) {
              const cached = cachedMessagesById.get(statusRow.id);
              if (cached && (cached.delivered_at !== statusRow.delivered_at || cached.read_at !== statusRow.read_at)) {
                cached.delivered_at = statusRow.delivered_at;
                cached.read_at = statusRow.read_at;
                toSave.push(cached);
                updateMessageStatusInUI(cached);
              }
            }
            if (toSave.length > 0) {
              await db.saveMessages(toSave);
            }
          }
        }
      }

      // Refresh partner profile for last seen if not currently online
      if (!isPartnerOnline && api.syncPartnerProfile && currentUser) {
        const { partnerProfile: p } = await api.syncPartnerProfile(currentUser.id);
        if (p) {
          partnerProfile = p;
        }
      }

      isSyncing = false;
      isOnline = true;
      renderHeaderStatus();
    } catch (err) {
      console.warn('Delta sync error:', err);
      isSyncing = false;
      isOnline = false;
      renderHeaderStatus();
    }
  }

  function startRealtime() {
    if (isSubscribedToRealtime) return;
    isSubscribedToRealtime = true;

    api.subscribeToMessages(
      async (newMsg) => {
        cachedMessagesById.set(newMsg.id, newMsg);
        await db.saveMessages([newMsg]);
        appendMessageToUI(newMsg);
        if (newMsg.sender_id !== currentUser?.id) {
          await processIncomingReceipts([newMsg]);
        }
      },
      async (updatedMsg) => {
        if (!updatedMsg) return;
        cachedMessagesById.set(updatedMsg.id, updatedMsg);
        await db.saveMessages([updatedMsg]);
        updateMessageStatusInUI(updatedMsg);
      },
      (updatedProfile) => {
        if (updatedProfile && updatedProfile.id !== currentUser?.id) {
          partnerProfile = { ...(partnerProfile || {}), ...updatedProfile };
          renderHeaderStatus();
        }
      }
    );

    if (api.subscribePresence && currentUser) {
      api.subscribePresence(currentUser.id, (presenceState) => {
        const keys = Object.keys(presenceState || {});
        const hasPartner = keys.some((k) => k !== currentUser.id);
        const wasOnline = isPartnerOnline;
        isPartnerOnline = hasPartner;

        if (wasOnline && !hasPartner) {
          const now = new Date().toISOString();
          partnerProfile = { ...(partnerProfile || {}), last_seen_at: now };
        }
        renderHeaderStatus();
      });
    }

    startLastSeenTimer();
  }

  function stopRealtime() {
    stopLastSeenTimer();
    if (!isSubscribedToRealtime) return;
    api.unsubscribeRealtime();
    if (api.unsubscribePresence) {
      api.unsubscribePresence();
    }
    isSubscribedToRealtime = false;
    renderHeaderStatus();
  }

  // --- Optimistic Message Sending (Review Focus 1) ---
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

    // 1. Optimistically display in UI
    appendMessageToUI(tempMsg, true, false);

    try {
      const { data, error } = await api.sendMessage(text, currentUser.id);
      if (error) throw error;

      // 2. Save to IndexedDB and replace transient element with permanent ID
      if (data) {
        cachedMessagesById.set(data.id, data);
        await db.saveMessages([data]);
        const tempEl = document.getElementById(`msg-${tempId}`);
        if (tempEl) tempEl.remove();
        appendMessageToUI(data, false, false);
      }
    } catch (err) {
      console.error('Send message failed:', err);
      appendMessageToUI(tempMsg, false, true);
    }
  }

  async function retrySendMessage(failedMsg) {
    const tempEl = document.getElementById(`msg-${failedMsg.id}`);
    if (tempEl) tempEl.remove();

    appendMessageToUI(failedMsg, true, false);

    try {
      const { data, error } = await api.sendMessage(failedMsg.body, currentUser.id);
      if (error) throw error;
      if (data) {
        cachedMessagesById.set(data.id, data);
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

  // --- Pagination ---
  async function loadOlderMessages() {
    if (!messagesList || messagesList.children.length === 0) return;
    const firstRow = messagesList.firstElementChild;
    const beforeTs = firstRow?.dataset?.createdAt;
    if (!beforeTs) return;

    try {
      const olderFromDb = await db.getLocalMessages(30, beforeTs);
      if (olderFromDb.length > 0) {
        for (const msg of olderFromDb) {
          cachedMessagesById.set(msg.id, msg);
        }
        prependMessagesToUI(olderFromDb);
      } else {
        const olderFromApi = await api.fetchOlderMessages(beforeTs, 30);
        if (olderFromApi.length > 0) {
          for (const msg of olderFromApi) {
            cachedMessagesById.set(msg.id, msg);
          }
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
      console.log('Web Push is not supported in this browser');
      return;
    }

    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        alert('Notification permission is required to receive messages when the screen is locked.');
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
          notifBtn.title = 'Notifications Enabled';
        }
      }
    } catch (err) {
      console.error('Push subscription failed:', err);
      alert('Failed to enable notifications: ' + (err.message || err));
    }
  }

  // --- iOS Standalone Detection (Review Focus 5) ---
  function checkIosInstallBanner() {
    if (typeof window === 'undefined') return;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);

    if (isIos && !isStandalone && iosBanner) {
      iosBanner.classList.remove('hidden');
    }
  }

  // --- Lifecycle Hook: Visibility Change ---
  function handleVisibilityChange() {
    if (typeof document === 'undefined' || !currentUser) return;
    if (document.visibilityState === 'visible') {
      if (api.updateLastSeen) {
        api.updateLastSeen(currentUser.id).catch(() => {});
      }
      performDeltaSync().then(startRealtime);
      const unreadPartner = [];
      for (const msg of cachedMessagesById.values()) {
        if (msg.sender_id !== currentUser.id && !msg.read_at) {
          unreadPartner.push(msg);
        }
      }
      if (unreadPartner.length > 0) {
        processIncomingReceipts(unreadPartner);
      }
    } else {
      if (api.updateLastSeen) {
        api.updateLastSeen(currentUser.id).catch(() => {});
      }
      stopRealtime();
    }
  }

  // --- Authenticated User Setup ---
  async function onUserAuthenticated(user) {
    currentUser = user;
    showScreen(chatScreen);

    // Fetch partner profile
    const { partnerProfile: partner } = await api.syncPartnerProfile(user.id);
    if (partner) {
      partnerProfile = partner;
      if (partnerNameEl) partnerNameEl.textContent = partner.display_name;
      const avatarText = dom.partnerAvatarText || (typeof document !== 'undefined' ? document.getElementById('partner-avatar-text') : null);
      if (avatarText && partner.display_name) {
        avatarText.textContent = partner.display_name.trim().charAt(0).toUpperCase();
      }
      renderHeaderStatus();
    }

    // Load local messages from IndexedDB
    if (skeletonLoader) skeletonLoader.classList.remove('hidden');
    const localMessages = await db.getLocalMessages(50);
    if (skeletonLoader) skeletonLoader.classList.add('hidden');

    if (messagesList) messagesList.innerHTML = '';
    for (const msg of localMessages) {
      cachedMessagesById.set(msg.id, msg);
      appendMessageToUI(msg);
    }

    if (localMessages.length > 0) {
      await processIncomingReceipts(localMessages);
    }

    if (localMessages.length >= 30 && loadOlderBtn) {
      loadOlderBtn.classList.remove('hidden');
    }

    // Connect WebRTC Call if module is present
    if (callModule && typeof callModule.createCallController === 'function') {
      callService = callModule.createCallController({
        api,
        currentUser,
        partnerProfile,
        dom,
      });
      callService.init();
    }

    // Run delta sync and start Realtime
    await performDeltaSync();
    if (messagesList && messagesList.children.length >= 30 && loadOlderBtn) {
      loadOlderBtn.classList.remove('hidden');
    }
    startRealtime();
    checkIosInstallBanner();

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && notifBtn) {
      notifBtn.classList.add('notif-enabled');
      notifBtn.title = 'Notifications Enabled';
    }
  }

  // --- Boot Initialization ---
  async function init() {
    // 1. Register Service Worker
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('SW registration failed:', err);
      });
    }

    // 2. Attach DOM Event Listeners
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

    // Keyboard Handler: Enter sends message, Shift+Enter new line & auto-resize
    if (messageInput) {
      messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = Math.min(messageInput.scrollHeight, 110) + 'px';
      });
      messageInput.addEventListener('keydown', (e) => {
        const isMobile =
          (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) ||
          (typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || ''));

        if (!isMobile && !e.isComposing && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }

    // Attach lifecycle listeners
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', () => {
        isOnline = true;
        if (currentUser) performDeltaSync().then(startRealtime);
        renderHeaderStatus();
      });
      window.addEventListener('offline', () => {
        isOnline = false;
        renderHeaderStatus();
      });
      window.addEventListener('pagehide', () => {
        if (currentUser && api.updateLastSeen) {
          api.updateLastSeen(currentUser.id).catch(() => {});
        }
      });
    }

    // 3. Check existing auth session
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
