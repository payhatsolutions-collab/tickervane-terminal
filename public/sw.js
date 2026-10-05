// Alpha Nova service worker: push delivery only (no offline caching, so a new
// deploy is never masked by stale assets).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Alpha Nova', {
    body: data.body || 'Market update',
    tag: data.tag || 'alphanova',
    renotify: true,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    timestamp: Date.now(),
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) return open.navigate(target).then(w => (w || open).focus()).catch(() => open.focus());
    return self.clients.openWindow(target);
  }));
});
