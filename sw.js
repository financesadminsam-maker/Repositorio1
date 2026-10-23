// Service worker: permite abrir la app sin internet.
// Estrategia "primero la red": siempre intenta la versión más nueva y,
// si no hay conexión, usa la copia guardada.
const CACHE = 'finanzas-v6';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/ui.js',
  'js/store.js',
  'js/calc.js',
  'js/charts.js',
  'js/csv.js',
  'js/simulator.js',
  'js/config.js',
  'vendor/chart.umd.js',
  'vendor/supabase.js',
  'manifest.webmanifest',
  'icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
