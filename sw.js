const CACHE = 'risale-v13';
const ASSETS = ['/oku/', '/oku/index.html', '/oku/manifest.json', '/oku/icon-192.png', '/oku/icon-512.png'];
const SUPABASE_URL = 'https://rrupsidrdgwgagetcojx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lQXYDZqUPATZNwM8Cb17kg_F-T1XsOI';

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

  // Supabase'den bugünkü logu kontrol et
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/reading_logs?select=id&user_id=eq.${userId}&group_id=eq.${groupId}&log_date=eq.${today}&limit=1`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const logs = await res.json();
    if (!logs || logs.length > 0) {
      // Zaten okuma var, sadece tarihi güncelle
      await saveConfig({ ...cfg2, lastNotifDate: today });
      return;
    }
  } catch { return; }

  // Bugün kaç kişi okudu?
  let readerCount = 0;
  try {
    const gmRes = await fetch(
      `${SUPABASE_URL}/rest/v1/group_members?select=user_id&group_id=eq.${groupId}`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const allMembers = await gmRes.json();
    const allIds = (allMembers || []).map(m => m.user_id);
    if (allIds.length) {
      const inFilter = allIds.map(id => `user_id.eq.${id}`).join(',');
      const logRes = await fetch(
        `${SUPABASE_URL}/rest/v1/reading_logs?select=user_id&log_date=eq.${today}&or=(${inFilter})`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      );
      const todayLogs = await logRes.json();
      readerCount = (todayLogs || []).length;
    }
  } catch(e) {}

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
