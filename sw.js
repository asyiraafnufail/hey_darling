/**
 * Hey Darling: Service Worker
 * Strategi Cache-First untuk aset statis (< 10ms muat ulang) dan W3C Web Push (layar mati).
 */

const CACHE_NAME = 'hey_darling_v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/src/config.js',
  '/src/db.js',
  '/src/api.js',
  '/src/app.js',
  '/src/call.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Hanya cache aset origin sendiri & bukan endpoint API Supabase
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Hey Darling',
    body: 'Pesan baru masuk',
    tag: 'chat-msg',
    url: '/',
  };

  if (event.data) {
    try {
      const data = event.data.json();
      payload = { ...payload, ...data };
    } catch {
      payload.body = event.data.text();
    }
  }

  const isCall = payload.tag === 'incoming-call';

  const options = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'chat-msg',
    renotify: true,
    requireInteraction: isCall,
    vibrate: isCall ? [300, 100, 300, 100, 300] : [120],
    data: {
      url: payload.url || '/',
      tag: payload.tag,
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
