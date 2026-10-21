const CACHE = 'risale-v14';
const ASSETS = ['/oku/', '/oku/index.html', '/oku/manifest.json', '/oku/icon-192.png', '/oku/icon-512.png'];

// Supabase REST yerine kendi backend endpoint'in (bkz. api-reminder-status.js).
// Farkli bir alan adinda ise tam URL yaz: 'https://api.ornek.com/api/reminder-status'
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
  // API cevaplari cache'lenmez (eski veri gostermesin)
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

// ── PUSH BİLDİRİM ────────────────────────────────────────────
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(showReminder(data.title, data.body));
});

// ── NOTIFICATION CLICK ────────────────────────────────────────
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

// ── PERIODIC SYNC (Chrome Android) ───────────────────────────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'daily-reminder') e.waitUntil(tryNotify());
});

// ── MESSAGE: ana uygulama SW'ye bildirim zamanı gönderir ─────
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIF') {
    // token: uygulamanin kendi oturum token'i (opsiyonel, backend dogruluyorsa gerekli)
    const { hour, minute, userId, groupId, goalPages, token } = e.data;
    caches.open('notif-config').then(c => {
      c.put('config', new Response(JSON.stringify({ hour, minute, userId, groupId, goalPages, token, lastNotifDate: '' })));
    });
    checkNotifFromSW({ hour, minute, userId, groupId, goalPages, token });
  }
  if (e.data?.type === 'CHECK_NOTIF') {
    tryNotify();
  }
});

async function getConfig() {
  try {
    const c = await caches.open('notif-config');
    const r = await c.match('config');
    if (!r) return null;
    return await r.json();
  } catch { return null; }
}

async function saveConfig(cfg) {
  const c = await caches.open('notif-config');
  await c.put('config', new Response(JSON.stringify(cfg)));
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function tryNotify() {
  const cfg = await getConfig();
  if (!cfg) return;
  await checkNotifFromSW(cfg);
}

async function checkNotifFromSW(cfg) {
  const { hour, minute, userId, groupId, goalPages, token } = cfg;
  if (!userId || !groupId) return;

  const now = new Date();
  const today = todayStr();

  // Saat kontrolü (±2 dakika tolerans)
  const diffMin = now.getHours() * 60 + now.getMinutes() - (hour * 60 + minute);
  if (diffMin < 0 || diffMin > 2) return;

  // Aynı gün zaten bildirim gönderildiyse atla
  const cfg2 = await getConfig();
  if (cfg2?.lastNotifDate === today) return;

  // Aktif pencere varsa bildirim gösterme
  const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windowClients.length > 0) return;

  // Tek istek: bugün okuma var mı + bugün kaç kişi okudu
  let status;
  try {
    const qs = new URLSearchParams({ userId, groupId, date: today });
    const res = await fetch(`${API_URL}?${qs}`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      cache: 'no-store'
    });
    if (!res.ok) return;
    status = await res.json();
  } catch { return; }

  if (status.hasLog) {
    // Zaten okuma var, sadece tarihi güncelle
    await saveConfig({ ...cfg2, lastNotifDate: today });
    return;
  }

  const readerCount = Number(status.readerCount) || 0;
  const readerMsg = readerCount > 0 ? ` Bugün ${readerCount} kişi okumasını yaptı.` : '';

  // Bildirim göster
  await saveConfig({ ...(await getConfig()), lastNotifDate: today });
  await showReminder('📖 Risale Okuma Takip', `Günlük ${goalPages} sayfalık okumanı kaydetmeyi unutma!${readerMsg}`);
}

async function showReminder(title = '📖 Risale Okuma Takip', body = 'Bugünkü okumanı kaydetmeyi unutma!') {
  return self.registration.showNotification(title, {
    body, icon: '/oku/icon-192.png', badge: '/oku/icon-192.png',
    tag: 'daily-reminder', vibrate: [200, 100, 200]
  });
}
