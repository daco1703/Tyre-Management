const CACHE = 'shepards-v1.12';
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/icon-192.png', '/manifest.webmanifest']))); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); }
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('/') : Response.error()))));
});

// Push works independently of an open app; the API sends only generic counts.
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data?.json(); } catch { return; }
  if (!payload || payload.data?.kind !== 'reminders') return;
  event.waitUntil(self.registration.showNotification(
    String(payload.title || 'Shepards Tyre Management').slice(0, 100),
    {
      body: String(payload.body || '').slice(0, 400),
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: String(payload.tag || 'fleet-reminders').slice(0, 120),
      data: { kind: 'reminders', url: '/?reminders=1' },
    },
  ));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // Never navigate to a URL supplied in an incoming payload.
  const target = new URL('/?reminders=1', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(async clients => {
      const client = clients.find(item => {
        try { return new URL(item.url).origin === self.location.origin; }
        catch { return false; }
      });
      if (client) {
        client.postMessage({ type: 'fleet-reminders-open' });
        return client.focus();
      }
      return self.clients.openWindow(target);
    }));
});
self.addEventListener('pushsubscriptionchange', event => {
  // Re-enrollment needs the signed-in user's explicit device consent.
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => clients.forEach(client =>
      client.postMessage({ type: 'fleet-push-subscription-changed' }))));
});
