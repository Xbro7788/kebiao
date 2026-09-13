/* sw.js — 离线缓存 */
const CACHE = 'kebiao-v3';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/parser.js',
  './js/importer.js',
  './lib/tesseract.min.js',
  './lib/worker.min.js',
  './lib/tesseract-core-simd.wasm.js',
  './lib/chi_sim.traineddata.gz',
  './lib/eng.traineddata.gz',
  './lib/pdf.min.js',
  './lib/pdf.worker.min.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
      .then(() => self.clients.claim())
      // 新版本接管后强制刷新所有已打开的页面，避免停留在旧版
      .then(() => self.clients.matchAll({ type: 'window' }).then((ws) =>
        ws.forEach((w) => w.navigate(w.url))
      ))
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 页面导航 network-first，确保每次拿到最新版本；静态资源 cache-first 提速
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
