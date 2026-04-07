const CACHE_NAME = 'echo-text-neural-cache-v1';

const CACHE_URLS = [
  '/',
  '/index.html'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
  self.clients.claim();
});

// Stale-While-Revalidate + Permanent Cache for CDN
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // If fetching MediaPipe CDN assets, use Cache-First strategy to ensure 100% offline capability
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com' || url.hostname === 'tfhub.dev') {
     event.respondWith(
       caches.match(event.request).then(cachedResponse => {
         if (cachedResponse) return cachedResponse;
         return fetch(event.request).then(networkResponse => {
           const clonedResponse = networkResponse.clone();
           caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedResponse));
           return networkResponse;
         }).catch(() => {
           return new Response('Offline: Resource not cached.', { status: 503 });
         });
       })
     );
  } else {
     // Default network-first for dev
     event.respondWith(
         fetch(event.request)
         .catch(() => caches.match(event.request))
     );
  }
});
