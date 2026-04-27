const CACHE = 'hauspunkte-v5';
const ASSETS = ['./manifest.json', './icon.svg'];
const FB_URL = 'https://habits-168b8-default-rtdb.europe-west1.firebasedatabase.app/habits.json';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Benachrichtigung antippen → App öffnen
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('habits') && 'focus' in c) return c.focus();
      }
      return clients.openWindow('./');
    })
  );
});

// Hintergrund-Check alle 5 Minuten (Android Chrome)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'pending-check') e.waitUntil(checkPendingAndNotify());
});

async function checkPendingAndNotify() {
  try {
    const resp = await fetch(FB_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    if (!data) return;

    const week = data.weekKey;
    const completions = data.completions || {};
    const tasks = data.tasks || [];
    const kidNames = { daniil: 'Daniil', viktoria: 'Viktoria' };

    // Offene (pending) Aufgaben sammeln
    const pending = [];
    Object.keys(kidNames).forEach(kidId => {
      tasks.forEach(task => {
        const val = completions[kidId]?.[task.id];
        const isPending =
          (typeof val === 'string' && val === week + '_pending') ||
          (val && typeof val === 'object' && val.week === week && val.pending > 0);
        if (isPending) pending.push({ kid: kidNames[kidId], task: task.label });
      });
    });

    if (pending.length === 0) return;

    // Bereits für diese Kombination benachrichtigt?
    const pendingKey = pending.map(p => p.kid + ':' + p.task).sort().join('|');
    const cache = await caches.open(CACHE);
    const stored = await cache.match('/_pending_key');
    const storedKey = stored ? await stored.text() : '';
    if (storedKey === pendingKey) return;

    const byKid = {};
    pending.forEach(({ kid, task }) => { (byKid[kid] = byKid[kid] || []).push(task); });
    const body = Object.entries(byKid).map(([k, ts]) => `${k}: ${ts.join(', ')}`).join('\n');

    await self.registration.showNotification('✅ Aufgaben warten auf Bestätigung', {
      body,
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'pending-approval',
      renotify: true,
    });

    await cache.put('/_pending_key', new Response(pendingKey));
  } catch(e) {}
}

self.addEventListener('fetch', e => {
  if (!e.request.url.startsWith(self.location.origin)) return;
  const url = new URL(e.request.url);

  if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/habits/')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        return resp;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      if (resp && resp.status === 200) caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
      return resp;
    }))
  );
});
