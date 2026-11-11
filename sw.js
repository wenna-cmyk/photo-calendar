// Offline cache. Bump VERSION after updating any app file.
const VERSION = 'v1';
const SHELL = 'shell-' + VERSION;
const BIG = 'models-v1'; // models and runtime rarely change
const SHELL_FILES = ['./', 'index.html', 'parser.js', 's2t.js', 'ocr-core.js', 'ocr-worker.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const BIG_FILES = ['vendor/ort.min.js', 'vendor/ort-wasm-simd-threaded.mjs', 'vendor/ort-wasm-simd-threaded.wasm', 'models/det.onnx', 'models/rec.onnx', 'models/keys.txt'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== BIG) await caches.delete(k);
    await self.clients.claim();
    // fill the model cache in the background
    const c = await caches.open(BIG);
    for (const f of BIG_FILES) { try { if (!(await c.match(f))) await c.add(f); } catch (err) {} }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isBig = BIG_FILES.some(f => req.url.endsWith(f));
  if (isBig) {
    // cache first
    e.respondWith(caches.open(BIG).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // app files: network first so updates show up, fall back to cache offline
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      return (await c.match(req, { ignoreSearch: true })) || (await c.match('index.html'));
    }
  })());
});
