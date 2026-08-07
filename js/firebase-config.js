/* =========================================================
   KONFIGURASI FIREBASE — CS Audit Quiz
   ---------------------------------------------------------
   Ganti nilai di bawah ini dengan config project Firebase
   kamu sendiri. Cara mendapatkannya:

   1. Buka https://console.firebase.google.com
   2. Buat project baru (atau pakai yang sudah ada)
   3. Di dashboard project: klik ikon "</>" (Web) untuk
      menambahkan Web App
   4. Beri nama app (bebas), lalu Firebase akan menampilkan
      object "firebaseConfig" seperti contoh di bawah ini
   5. Copy semua nilainya, tempel menggantikan nilai contoh
      di bawah (yang di dalam tanda kutip)
   6. Simpan file ini, lalu upload ulang ke GitHub

   File ini SENGAJA dipisah dari app.js supaya kamu bisa
   ganti config tanpa menyentuh logic aplikasi sama sekali.
   ========================================================= */

const firebaseConfig = {
  apiKey: "AIzaSyCrBWbWV3hVH-E8UoqEIMlyHIQCQRGwdIY",
  authDomain: "cs-audit-quiz.firebaseapp.com",
  projectId: "cs-audit-quiz",
  storageBucket: "cs-audit-quiz.firebasestorage.app",
  messagingSenderId: "1072161181002",
  appId: "1:1072161181002:web:bcaf6ffe6617652761c5b3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
