// Service worker: network-first with cache fallback, so the app updates when
// online and keeps working fully offline once installed to the home screen.
// All paths are resolved relative to the SW location so this works at the
// domain root and under a subpath (GitHub Pages).
const CACHE = 'tinnitus-lab-v2';
const SCOPE_URL = new URL('./', self.location).href;
const INDEX_URL = new URL('./index.html', self.location).href;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll([SCOPE_URL, INDEX_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(
          (m) => m || (e.request.mode === 'navigate' ? caches.match(INDEX_URL) : undefined),
        ),
      ),
  );
});
