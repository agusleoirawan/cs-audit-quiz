/* =========================================================
   SERVICE WORKER — CS Audit Quiz
   Strategi: cache-first untuk app shell (HTML/CSS/JS/icons),
   supaya aplikasi tetap bisa dibuka & dipakai offline.
   Data quiz (soal, hasil, leaderboard) tetap disimpan di
   LocalStorage seperti sebelumnya — service worker ini TIDAK
   menyentuh atau mengubah LocalStorage sama sekali.
   ========================================================= */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `cs-audit-quiz-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.ico'
];

/* ---------- INSTALL: simpan app shell ke cache ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
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

  // Hanya tangani request GET
  if (req.method !== 'GET') return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((networkRes) => {
          // simpan salinan ke cache untuk offline berikutnya
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => {
            // hanya cache response yang valid & same-origin
            if (networkRes.ok && req.url.startsWith(self.location.origin)) {
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
