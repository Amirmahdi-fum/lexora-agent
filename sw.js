/* Lexora 5 service worker
   - network-first for HTML/CSS/JS (GitHub Pages updates arrive immediately)
   - cache fallback for offline use
   - SKIP_WAITING message support for in-app update button */
const CACHE_NAME = 'lexora-v5.0.0';
const ASSETS = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './lexora.webmanifest',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))),
      self.clients.claim()
    ])
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

const NETWORK_FIRST = /\.(?:html|css|js)$|\/$/;

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  /* Never intercept cross-origin API calls (OpenAI-compatible APIs, GitHub, dictionary, fonts are fine either way) */
  if (url.origin !== location.origin) return;

  if (e.request.mode === 'navigate' || NETWORK_FIRST.test(url.pathname)) {
    /* network first → cache fallback */
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
    );
  } else {
    /* cache first for static assets (icons) */
    e.respondWith(
      caches.match(e.request).then(res => res || fetch(e.request).then(net => {
        const copy = net.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy)).catch(() => {});
        return net;
      }))
    );
  }
});
