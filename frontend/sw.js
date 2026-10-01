// ── FilaFlow Service Worker ──────────────────────────────
const CACHE_NAME    = 'filaflow-v1.10.0';   // cache hors-ligne uniquement
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/api.js',
  '/js/app.js',
  '/js/nfc.js',
  '/js/components.js',
  '/js/label-editor.js',
  '/js/tabs/filaments.js',
  '/js/tabs/inventory.js',
  '/js/tabs/spoolweights.js',
  '/js/tabs/settings.js',
  '/js/tabs/history.js',
  '/fonts/barlow-condensed-latin-600-normal.woff2',
  '/fonts/barlow-condensed-latin-700-normal.woff2',
  '/fonts/ibm-plex-mono-latin-400-normal.woff2',
  '/fonts/ibm-plex-mono-latin-500-normal.woff2',
  '/fonts/ibm-plex-sans-latin-400-normal.woff2',
  '/fonts/ibm-plex-sans-latin-500-normal.woff2',
  '/fonts/ibm-plex-sans-latin-600-normal.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

// ── Installation ──────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activation — nettoyage ancien cache ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────
// - API (/api/…) et requêtes non-GET : jamais interceptées (réseau direct,
//   y compris le flux SSE du lecteur NFC).
// - Polices et bibliothèques CDN : Cache First (fichiers immuables).
// - Pages, JS, CSS, manifest : Network First. Le Pi est interrogé à chaque
//   chargement, le cache ne sert qu'en cas de coupure réseau. Une mise à jour
//   s'affiche donc dès le premier chargement.
const NETWORK_TIMEOUT_MS = 4000;

function putInCache(request, response) {
  if (response && response.ok && response.type !== 'opaque') {
    const clone = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
  }
  return response;
}

function networkFirst(request, fallbackUrl) {
  return new Promise(resolve => {
    let settled = false;
    const fromCache = () => caches.match(request)
      .then(r => r || (fallbackUrl ? caches.match(fallbackUrl) : undefined))
      .then(r => r || new Response('Hors ligne', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
    // Réseau lent ou coupé : on bascule sur le cache au bout du délai
    const timer = setTimeout(() => {
      caches.match(request).then(r => { if (r && !settled) { settled = true; resolve(r); } });
    }, NETWORK_TIMEOUT_MS);
    fetch(request, { cache: 'no-cache' })
      .then(response => {
        clearTimeout(timer);
        putInCache(request, response);
        if (!settled) { settled = true; resolve(response); }
      })
      .catch(() => {
        clearTimeout(timer);
        if (!settled) { settled = true; fromCache().then(resolve); }
      });
  });
}

function cacheFirst(request) {
  return caches.match(request).then(cached =>
    cached || fetch(request).then(response => putInCache(request, response))
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  // Applications voisines servies sur le même hôte (PrepFlow, Adminer) : jamais interceptées
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/prepflow') || url.pathname.startsWith('/adminer'))) return;

  if (url.pathname.startsWith('/fonts/') || url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/index.html'));
    return;
  }

  event.respondWith(networkFirst(request));
});

// Notifications push désactivées
