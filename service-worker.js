/* =========================================================
   SERVICE WORKER — CS Audit Quiz
   Strategi: cache-first untuk app shell (HTML/CSS/JS/icons),
   supaya aplikasi tetap bisa dibuka & dipakai offline.

   PENTING: data quiz sekarang disimpan di Firebase Firestore
   (bukan LocalStorage lagi). Service worker ini SENGAJA tidak
   ikut campur dengan request ke Firebase/Google API — biarkan
   itu ditangani langsung oleh Firebase SDK (yang punya cache
   offline sendiri via IndexedDB) supaya data selalu konsisten.
   ========================================================= */

const CACHE_VERSION = 'v2';
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

/* ---------- FETCH: cache-first, fallback ke network ----------
   Kalau file ada di cache -> pakai cache (offline aman).
   Kalau tidak ada -> ambil dari network, lalu simpan ke cache
   untuk pemakaian offline berikutnya.
   Kalau network gagal & request adalah navigasi halaman ->
   tampilkan index.html dari cache (biar app tetap terbuka
   walau tanpa internet).
------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Hanya tangani request GET, dan lewati request ke Firebase/Google API
  if (req.method !== 'GET' || shouldBypass(req.url)) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((networkRes) => {
          // simpan salinan ke cache untuk offline berikutnya (termasuk CDN gstatic)
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => {
            if (networkRes.ok || networkRes.type === 'opaque') {
              cache.put(req, resClone);
            }
          });
          return networkRes;
        })
        .catch(() => {
          // offline & tidak ada di cache -> fallback ke index.html untuk navigasi
          if (req.mode === 'navigate') {
            return caches.match('./index.html');
          }
        });
    })
  );
});
