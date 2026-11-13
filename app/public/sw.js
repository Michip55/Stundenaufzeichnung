// BauTag – Service Worker.
// Hält nur die App-Hülle (HTML, CSS, JS, Icons) vor, damit die App ohne Netz startet.
// /api wird NIE zwischengespeichert (Preise, Löhne, Kalkulation bleiben am Server) – Anfragen gehen direkt ins Netz.
const VERSION = 'bautag-huelle-v24';
const HUELLE = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/zahl.js', '/js/offline.js', '/js/schaden-offline.js',
  '/js/views/login.js', '/js/views/stempeln.js', '/js/views/kolonne.js', '/js/views/woche.js', '/js/views/berichte.js',
  '/js/views/dashboard.js', '/js/views/baustellen.js', '/js/views/preise.js', '/js/views/kalkulation.js',
  '/js/views/monat.js', '/js/views/benutzer.js', '/js/views/mehr.js', '/js/views/pin.js', '/js/views/abwesenheiten.js', '/js/views/korrektur.js', '/js/views/positionen.js', '/js/views/katalog.js',
  '/js/views/fuhrpark.js', '/js/views/fuhrpark-dialoge.js', '/js/views/anlage.js', '/js/views/schaeden.js',
  '/js/installieren.js', '/js/preisstand.js', '/js/views/push.js', '/js/views/dienste.js', '/js/views/zweifaktor.js', '/js/views/fern.js', '/js/views/bericht-assistent.js', '/js/views/hilfe.js', '/offline.html',
  '/js/ziehen.js', '/js/arbeitstag.js', '/js/views/plan.js', '/js/views/zeitplan.js', '/js/views/fuhren.js', '/js/views/lebenslauf.js', '/js/views/dokumente.js', '/js/views/rechnungen.js', '/js/views/import.js', '/js/views/urlaub.js', '/js/views/lohnvorlagen.js', '/js/views/zeitraum.js',
  '/icons/favicon.svg', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(HUELLE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((namen) => Promise.all(namen.filter((n) => n !== VERSION).map((n) => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;          // nie cachen, nie abfangen
  if (req.method !== 'GET') return;
  // Hülle: zuerst Netz (immer aktueller Stand), ohne Netz aus dem Zwischenspeicher
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const antwort = await fetch(req);
      if (antwort.ok && antwort.type === 'basic') cache.put(req, antwort.clone());
      return antwort;
    } catch (err) {
      const treffer = await cache.match(req, { ignoreSearch: true });
      if (treffer) return treffer;
      if (req.mode === 'navigate') {
        const start = await cache.match('/index.html'); if (start) return start;
        const offline = await cache.match('/offline.html'); if (offline) return offline; // Hülle noch nicht vollständig im Speicher
      }
      throw err;
    }
  })());
});

/* ---------- Push-Benachrichtigungen (API.md 12.3) ---------- */
// Der Server schickt nur neutrale Texte ohne Beträge: {title, body, url, tag}
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'BauTag', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'BauTag', {
    body: d.body || '', tag: d.tag || undefined, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'de-AT', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const ziel = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenster) { if ('focus' in f) { await f.focus(); if ('navigate' in f) { try { await f.navigate(ziel); } catch (x) { /* andere Herkunft */ } } return; } }
    if (self.clients.openWindow) await self.clients.openWindow(ziel);
  })());
});
