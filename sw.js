const CACHE = 'risale-v14';
const ASSETS = ['/oku2/', '/oku2/index.html', '/oku2/manifest.json', '/oku2/icon-192.png', '/oku2/icon-512.png'];

// ── CLOUDFLARE WORKER / D1 API CONFIG ──────────────────────
const WORKER_API_URL = 'https://risale-takip-api.risalekelime.workers.dev'; // index.html'deki WORKER_API_URL ile aynı olmalı

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.startsWith('/api/')) return; // API yanıtları önbelleğe alınmaz
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
        if (c.url.includes('/oku2/') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/oku2/');
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
    const { hour, minute, userId, groupId, goalPages } = e.data;
    // Alarm bilgisini cache'e kaydet
    caches.open('notif-config').then(c => {
      c.put('config', new Response(JSON.stringify({ hour, minute, userId, groupId, goalPages, lastNotifDate: '' })));
    });
    // İlk kontrolü yap
    checkNotifFromSW({ hour, minute, userId, groupId, goalPages });
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
  const { hour, minute, userId, groupId, goalPages } = cfg;
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

  // 1. D1 Kontrolü: Kullanıcı bugün okuma yaptı mı?
  try {
    const res = await fetch(`${WORKER_API_URL}/api/logs/check?userId=${userId}&groupId=${groupId}&date=${today}`);
    const data = await res.json();
    
    if (data && data.hasLogged) {
      // Zaten okuma var, sadece tarihi güncelle
      await saveConfig({ ...cfg2, lastNotifDate: today });
      return;
    }
  } catch { return; }

  // 2. D1 Kontrolü: Bugün grupta kaç kişi okudu?
  let readerCount = 0;
  try {
    const logRes = await fetch(`${WORKER_API_URL}/api/logs/group-count?groupId=${groupId}&date=${today}`);
    const countData = await logRes.json();
    readerCount = countData.count || 0;
  } catch (e) {}

  const readerMsg = readerCount > 0 ? ` Bugün ${readerCount} kişi okumasını yaptı.` : '';

  // Bildirim göster
  await saveConfig({ ...(await getConfig()), lastNotifDate: today });
  await showReminder('📖 Risale Okuma Takip', `Günlük ${goalPages} sayfalık okumanı kaydetmeyi unutma!${readerMsg}`);
}

async function showReminder(title = '📖 Risale Okuma Takip', body = 'Bugünkü okumanı kaydetmeyi unutma!') {
  return self.registration.showNotification(title, {
    body, icon: '/oku2/icon-192.png', badge: '/oku2/icon-192.png',
    tag: 'daily-reminder', vibrate: [200, 100, 200]
  });
}
