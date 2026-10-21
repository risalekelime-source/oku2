const CACHE = 'risale-v1';
const ASSETS = ['/oku/', '/oku/index.html', '/oku/manifest.json', '/oku/icon-192.png', '/oku/icon-512.png'];
const API_URL = '/api/reminder-status';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'notif-config').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(showReminder(data.title, data.body));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('/oku/') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/oku/');
    })
  );
});

self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIF') {
    const { hour, minute, userId, groupId, goalPages, token } = e.data;
    caches.open('notif-config').then(c => {
      c.put('config', new Response(JSON.stringify({ hour, minute, userId, groupId, goalPages, token, lastNotifDate: '' })));
    });
  }
});

async function showReminder(title = '📖 Risale Okuma Takip', body = 'Bugünkü okumanı kaydetmeyi unutma!') {
  return self.registration.showNotification(title, {
    body, icon: '/oku/icon-192.png', badge: '/oku/icon-192.png',
    tag: 'daily-reminder', vibrate: [200, 100, 200]
  });
}
