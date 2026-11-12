// BauTag – Service Worker.
// Hält nur die App-Hülle (HTML, CSS, JS, Icons) vor, damit die App ohne Netz startet.
// /api wird NIE zwischengespeichert (Preise, Löhne, Kalkulation bleiben am Server) – Anfragen gehen direkt ins Netz.
const VERSION = 'bautag-huelle-v2';
const HUELLE = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/zahl.js', '/js/offline.js',
  '/js/views/login.js', '/js/views/stempeln.js', '/js/views/kolonne.js', '/js/views/woche.js', '/js/views/berichte.js',
  '/js/views/dashboard.js', '/js/views/baustellen.js', '/js/views/preise.js', '/js/views/kalkulation.js',
  '/js/views/monat.js', '/js/views/benutzer.js', '/js/views/mehr.js',
  '/icons/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png',
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
      if (req.mode === 'navigate') { const start = await cache.match('/index.html'); if (start) return start; }
      throw err;
    }
  })());
});
