const CACHE_NAME = "shift-tap-cache-v1";

const APP_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./pdf-export.js",
  "./jspdf.umd.min.js",
  "./icon-192.png",
  "./icon-512.png",
  "./ST-logo.png",
  "./lock_open.svg",
  "./lock_close.svg",
  "./support.html"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      return cachedResponse || fetch(event.request);
    }).catch(() => {
      return caches.match("./index.html");
    })
  );
});