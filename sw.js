/* Golf Pocket Trainer – Service Worker
   Strategie:
   - App-Shell (index.html, Manifest, Icons): beim Installieren zwischengespeichert.
     Seitenaufrufe sind "network-first" (Updates kommen sofort an), offline greift der Cache.
   - Google Fonts (CSS + Schriftdateien) und YouTube-Vorschaubilder:
     "stale-while-revalidate" in einem Laufzeit-Cache. Nach dem ersten Online-Besuch sind sie offline da.
   - Alles andere (z. B. YouTube-Player) wird nicht angefasst.
   Bei jedem Release VERSION erhöhen, damit der Shell-Cache erneuert wird. */
const VERSION = 'v4.41.0';
const SHELL_CACHE = `gpg-shell-${VERSION}`;
const RUNTIME_CACHE = 'gpg-runtime-v1';
const RUNTIME_MAX_ENTRIES = 80;
const NAVIGATION_TIMEOUT_MS = 4000;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-48.png'
];

const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'i.ytimg.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Einzeln laden: eine fehlende Datei (z. B. Icon) verhindert nicht die Offline-Fähigkeit.
    await Promise.allSettled(
      SHELL_FILES.map((url) => cache.add(new Request(url, { cache: 'reload' })))
    );
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('gpg-shell-') && k !== SHELL_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const fresh = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
    if (fresh && fresh.ok) cache.put('./index.html', fresh.clone());
    return fresh;
  } catch (e) {
    const cached = (await cache.match('./index.html')) || (await cache.match('./'));
    if (cached) return cached;
    return new Response('Offline – Golf Pocket Trainer wurde noch nicht vollständig geladen.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - maxEntries; i++) {
    await cache.delete(keys[i]);
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      // Opaque Antworten (Cross-Origin <link>/<img>) sind für Anzeige und Cache in Ordnung.
      if (res && (res.ok || res.type === 'opaque')) {
        cache.put(request, res.clone()).then(() => trimCache(cache, RUNTIME_MAX_ENTRIES));
      }
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const res = await network;
  return res || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
