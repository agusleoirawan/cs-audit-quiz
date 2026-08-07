/* =========================================================
   SERVICE WORKER — CS Audit Quiz
   Strategi:
   - File kode kita sendiri (html/css/js/manifest) -> NETWORK-FIRST
     (selalu coba ambil versi terbaru dulu; kalau offline baru
     pakai cache). Ini penting supaya update kode (misal
     firebase-config.js) langsung kepakai begitu di-upload,
     tidak nyangkut di versi lama.
   - Icons & CDN Firebase -> CACHE-FIRST (jarang berubah, lebih
     hemat kuota & lebih cepat).

   PENTING: data quiz disimpan di Firebase Firestore (bukan
   LocalStorage). Service worker ini SENGAJA tidak ikut campur
   dengan request ke Firebase/Google API.
   ========================================================= */

const CACHE_VERSION = 'v4';
const CACHE_NAME = `cs-audit-quiz-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/firebase-config.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'
];

// File kita sendiri yang HARUS selalu dicek ke network dulu (network-first)
const NETWORK_FIRST_FILES = ['index.html', 'manifest.json', 'style.css', 'app.js', 'firebase-config.js'];
function isNetworkFirst(url){
  return NETWORK_FIRST_FILES.some(f => url.includes(f)) || url.endsWith('/');
}

// Domain yang TIDAK boleh disentuh service worker (biar Firebase SDK
// yang urus langsung, termasuk offline cache-nya sendiri)
const BYPASS_PATTERNS = ['googleapis.com', 'firebaseio.com', 'google.com/recaptcha'];
function shouldBypass(url){
  return BYPASS_PATTERNS.some(p => url.includes(p));
}

/* ---------- INSTALL: simpan app shell ke cache (per-file, tahan gagal satu file) ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(APP_SHELL.map((url) =>
        cache.add(url).catch((err) => console.warn('[SW] gagal cache:', url, err))
      ));
    }).then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE: bersihkan cache versi lama ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('cs-audit-quiz-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET' || shouldBypass(req.url)) return;

  // NETWORK-FIRST untuk file kode kita sendiri & navigasi halaman
  if (req.mode === 'navigate' || isNetworkFirst(req.url)) {
    event.respondWith(
      fetch(req)
        .then((networkRes) => {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return networkRes;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  // CACHE-FIRST untuk icons & CDN (jarang berubah)
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((networkRes) => {
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => {
          if (networkRes.ok || networkRes.type === 'opaque') cache.put(req, resClone);
        });
        return networkRes;
      });
    })
  );
});
