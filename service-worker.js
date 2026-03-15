const CACHE_VERSION = 'shift-tap-v4';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const APP_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './support.html',
  './ST-logo.png',
  './icon-192.png',
  './icon-512.png',
  './pdf-export.js',
  './jspdf.umd.min.js',
  './service-worker.js',
  './lock_open.svg',
  './lock_close.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();

    await Promise.all(
      keys
        .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Alleen http/https behandelen
  if (!url.protocol.startsWith('http')) return;

  // Navigatie / HTML: network first, cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Zelfde origin bestanden: cache first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Externe requests: network first, cache fallback
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    if (request.destination === 'document') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);

    if (response && response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }

    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate' || request.destination === 'document') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }

    throw error;
  }
}