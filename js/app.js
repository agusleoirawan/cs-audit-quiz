/* =========================================================
   DATA LAYER — Firebase Firestore + Auth
   Sebelumnya pakai LocalStorage (data per-HP). Sekarang semua
   soal, periode, dan hasil quiz disimpan di Firestore supaya
   real-time ter-sinkron ke semua HP tim. Login Admin memakai
   Firebase Authentication (Email/Password), bukan lagi
   username/password yang disimpan manual.

   Cache lokal "DB" di bawah ini otomatis diperbarui oleh
   onSnapshot() setiap kali ada perubahan di server — jadi
   seluruh fungsi render() di file ini TETAP membaca dari
   DB.periods / DB.questions / DB.results seperti sebelumnya,
   tidak perlu diubah satu-satu.
   ========================================================= */
function uid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,8); }

let auth, db;
let firebaseInitOk = true;
try{
  auth = firebase.auth();
  db = firebase.firestore();
  try{ db.enablePersistence({synchronizeTabs:true}); }catch(e){ /* multi-tab / unsupported browser, aman diabaikan */ }
}catch(err){
  firebaseInitOk = false;
  console.error('Firebase init error', err);
  window.addEventListener('DOMContentLoaded', ()=>showBootError('inisialisasi Firebase (cek js/firebase-config.js)', err));
}

let DB = { periods:[], questions:{}, results:[] };
const dataLoaded = { periods:false, questions:false, results:false };

function isDataReady(){ return dataLoaded.periods && dataLoaded.questions && dataLoaded.results; }

function showBootError(label, err){
  const loader = document.getElementById('bootLoader');
  if(!loader) return;
  loader.innerHTML = `
    <div style="max-width:320px; text-align:center; padding:0 20px;">
      <div style="font-size:32px;">⚠️</div>
      <div style="font-weight:700; margin-top:10px; font-size:14px;">Gagal memuat: ${label}</div>
      <div style="font-size:11.5px; color:#a00; background:#fff0f0; border-radius:8px; padding:8px 10px; margin-top:10px; word-break:break-word; font-family:monospace;">
        ${err && err.code ? err.code : ''}<br>${err && err.message ? err.message : String(err)}
      </div>
      <div style="font-size:11.5px; color:#4a5872; margin-top:12px; text-align:left;">
        Kemungkinan penyebab:<br>
        • Firestore Rules belum di-Publish<br>
        • firebase-config.js belum diisi nilai asli<br>
        • Firestore database belum selesai dibuat<br>
        • Tidak ada koneksi internet
      </div>
    </div>`;
}

function initFirebaseListeners(){
  db.collection('periods').orderBy('createdAt','asc').onSnapshot(snap=>{
    DB.periods = snap.docs.map(d=>({id:d.id, ...d.data()}));
    dataLoaded.periods = true;
    onDataChanged();
  }, err=>{ console.error('periods listener error', err); toast('Gagal memuat data periode'); showBootError('periods', err); });

  db.collection('questions').onSnapshot(snap=>{
    const map = {};
    snap.docs.forEach(d=>{ map[d.id] = (d.data().items)||[]; });
    DB.questions = map;
    dataLoaded.questions = true;
    onDataChanged();
  }, err=>{ console.error('questions listener error', err); toast('Gagal memuat data soal'); showBootError('questions', err); });

  db.collection('results').orderBy('ts','desc').onSnapshot(snap=>{
    DB.results = snap.docs.map(d=>({id:d.id, ...d.data()}));
    dataLoaded.results = true;
    onDataChanged();
  }, err=>{ console.error('results listener error', err); toast('Gagal memuat data hasil'); showBootError('results', err); });

  auth.onAuthStateChanged(user=>{
    state.isAdmin = !!user;
    state.adminEmail = user ? user.email : null;
    if(isDataReady()) render();
  });

  // Kalau setelah 10 detik masih belum ready & belum ada error spesifik, kasih tahu juga
  setTimeout(()=>{
    if(!firstRenderDone){
      showBootError('koneksi ke Firestore', {message:'Tidak ada respon setelah 10 detik. Cek console.firebase.google.com → pastikan Firestore Database sudah dibuat & Rules sudah di-Publish.'});
    }
  }, 10000);
}

let firstRenderDone = false;
function onDataChanged(){
  if(!isDataReady()) return;
  // Jangan render ulang kalau ada modal terbuka (misal admin lagi ngetik form),
  // biar tidak keganggu update real-time dari device lain.
  const modalOpen = !document.getElementById('modalOverlay').classList.contains('hidden');
  if(modalOpen || state.view === 'quiz') return;
  render();
  if(!firstRenderDone){ firstRenderDone = true; hideBootLoader(); }
}
function hideBootLoader(){
  const el = document.getElementById('bootLoader');
  if(el) el.remove();
}

/* ---- Firestore write helpers (dipanggil dari fungsi UI di bawah) ---- */
async function fbCreatePeriod(name, active){
  const id = uid();
  if(active){
    const batch = db.batch();
    DB.periods.forEach(p=> batch.update(db.collection('periods').doc(p.id), {active:false}));
    batch.set(db.collection('periods').doc(id), {name, createdAt:Date.now(), active:true});
    await batch.commit();
  } else {
    await db.collection('periods').doc(id).set({name, createdAt:Date.now(), active:false});
  }
  await db.collection('questions').doc(id).set({items:[]});
  return id;
}
async function fbSetActivePeriod(periodId){
  const batch = db.batch();
  DB.periods.forEach(p=> batch.update(db.collection('periods').doc(p.id), {active: p.id===periodId}));
  await batch.commit();
}
async function fbSaveQuestions(periodId, items){
  await db.collection('questions').doc(periodId).set({items});
}
async function fbAddResult(result){
  await db.collection('results').doc(result.id).set(result);
}
async function fbDeleteResult(resultId){
  await db.collection('results').doc(resultId).delete();
}

/* =========================================================
   APP STATE / ROUTER
   ========================================================= */
const state = {
  view:'home',
  agent:null,          // {name, team}
  isAdmin:false,
  quiz:null,           // active quiz session
  lastResult:null,
  viewStack:[],
  manageState:{periodId:null},
  lbFilter:'Semua', lbPeriod:null,
  dashPeriod:'all'
};

const $app = document.getElementById('app');
const $title = document.getElementById('pageTitle');
const $sub = document.getElementById('pageSub');
const $back = document.getElementById('backBtn');

function go(view, opts){
  opts = opts||{};
  if(opts.push !== false) state.viewStack.push(state.view);
  state.view = view;
  render();
}
function goBack(){
  const prev = state.viewStack.pop();
  state.view = prev || 'home';
  render();
}
$back.addEventListener('click', goBack);

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(()=>t.classList.remove('show'), 2200);
}
function closeModal(){ document.getElementById('modalOverlay').classList.add('hidden'); document.getElementById('modalBox').innerHTML=''; }
function openModal(html){
  document.getElementById('modalBox').innerHTML = html;
  document.getElementById('modalOverlay').classList.remove('hidden');
}
document.getElementById('modalOverlay').addEventListener('click', e=>{
  if(e.target.id==='modalOverlay') closeModal();
});

function confirmModal(message, onYes){
  openModal(`
    <h3 style="margin-bottom:8px;">Konfirmasi</h3>
    <p style="color:var(--ink-soft); font-size:13.5px; margin-bottom:18px;">${escapeHtml(message)}</p>
    <div class="row-btns">
      <button class="btn secondary" id="cfNo">Batal</button>
      <button class="btn danger" id="cfYes">Ya, Lanjutkan</button>
    </div>
  `);
  document.getElementById('cfNo').onclick = closeModal;
  document.getElementById('cfYes').onclick = ()=>{ closeModal(); onYes(); };
}
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* =========================================================
   THEME
   ========================================================= */
function initTheme(){
  const saved = localStorage.getItem('csaq_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('themeBtn').textContent = saved==='dark' ? '☀️' : '🌙';
}
document.getElementById('themeBtn').addEventListener('click', ()=>{
  const cur = document.documentElement.getAttribute('data-theme')==='dark' ? 'light':'dark';
  document.documentElement.setAttribute('data-theme', cur);
  localStorage.setItem('csaq_theme', cur);
  document.getElementById('themeBtn').textContent = cur==='dark' ? '☀️' : '🌙';
});
initTheme();

/* =========================================================
   HELPERS
   ========================================================= */
function getActivePeriod(){ return DB.periods.find(p=>p.active) || DB.periods[0] || null; }
function periodName(id){ const p = DB.periods.find(p=>p.id===id); return p ? p.name : '-'; }
function fmtDate(ts){ const d = new Date(ts); return d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtTime(ts){ const d = new Date(ts); return d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'}); }
function fmtDuration(sec){ const m=Math.floor(sec/60), s=sec%60; return `${m}:${s.toString().padStart(2,'0')}`; }
function hasAttempted(name, team, periodId){
  return DB.results.some(r=> r.periodId===periodId && r.name.trim().toLowerCase()===name.trim().toLowerCase() && r.team===team);
}

/* =========================================================
   RENDER: HOME
   ========================================================= */
function renderHome(){
  $title.textContent = 'CS Audit Quiz'; $sub.textContent = 'Media belajar mingguan tim CS'; $back.classList.add('hidden');
  const active = getActivePeriod();
  $app.innerHTML = `
    <div class="card" style="background:linear-gradient(135deg,var(--blue-600),var(--blue-900)); color:#fff; border:none;">
      <span class="badge-pill" style="background:rgba(255,255,255,.18); color:#fff;">Periode Aktif</span>
      <h2 style="color:#fff; margin-top:8px;">${active ? escapeHtml(active.name) : 'Belum ada periode'}</h2>
      <p style="color:rgba(255,255,255,.85); font-size:12.5px; margin-top:4px;">${DB.results.length} pengerjaan tercatat &middot; ${DB.periods.length} periode</p>
    </div>
    <div class="menu-grid">
      <button class="menu-item" data-go="startQuiz"><span class="emoji">📝</span><b>Mulai Quiz</b><small>Kerjakan quiz minggu ini</small></button>
      <button class="menu-item" data-go="leaderboard"><span class="emoji">🏆</span><b>Leaderboard</b><small>Papan skor semua agent</small></button>
      <button class="menu-item" data-go="historyLogin"><span class="emoji">📂</span><b>Riwayat Saya</b><small>Lihat hasil quiz kamu</small></button>
      <button class="menu-item" data-go="adminGate:manage"><span class="emoji">🗂️</span><b>Kelola Soal</b><small>Khusus Admin</small></button>
    </div>
    <button class="menu-item" data-go="adminGate:dashboard" style="width:100%; margin-top:12px; flex-direction:row; align-items:center;">
      <span class="emoji">📊</span>
      <div><b>Dashboard Admin</b><br><small>Statistik & hasil lengkap</small></div>
    </button>
  `;
  $app.querySelectorAll('[data-go]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const target = el.dataset.go;
      if(target.startsWith('adminGate:')){
        const dest = target.split(':')[1];
        adminGate(dest);
      } else go(target);
    });
  });
}

/* =========================================================
   ADMIN LOGIN
   ========================================================= */
function adminGate(dest){
  if(state.isAdmin){ go(dest); return; }
  openModal(`
    <h3>Login Admin</h3>
    <p style="color:var(--ink-soft); font-size:12.5px; margin-bottom:14px;">Masuk untuk mengelola soal & dashboard. Akun dibuat lewat Firebase Console.</p>
    <label>Email</label>
    <input type="text" id="admUser" placeholder="admin@perusahaan.com">
    <label>Password</label>
    <input type="password" id="admPass" placeholder="Password admin">
    <div class="row-btns" style="margin-top:18px;">
      <button class="btn secondary" id="admCancel">Batal</button>
      <button class="btn" id="admSubmit">Masuk</button>
    </div>
  `);
  document.getElementById('admCancel').onclick = closeModal;
  document.getElementById('admSubmit').onclick = async ()=>{
    const u = document.getElementById('admUser').value.trim();
    const p = document.getElementById('admPass').value;
    const btn = document.getElementById('admSubmit');
    btn.disabled = true; btn.textContent = 'Memproses...';
    try{
      await auth.signInWithEmailAndPassword(u, p);
      closeModal(); toast('Login admin berhasil'); go(dest);
    }catch(err){
      btn.disabled = false; btn.textContent = 'Masuk';
      toast('Email atau password salah');
    }
  };
}
function adminLogout(){
  confirmModal('Keluar dari akun admin?', async ()=>{
    await auth.signOut();
    toast('Berhasil logout');
    go('home', {push:false});
  });
}

/* =========================================================
   AGENT LOGIN → START QUIZ
   ========================================================= */
function renderStartQuiz(){
  $title.textContent = 'Mulai Quiz'; $sub.textContent = 'Isi data kamu dulu'; $back.classList.remove('hidden');
  const active = getActivePeriod();
  if(!active){
    $app.innerHTML = `<div class="empty-state"><span class="emoji">📭</span>Belum ada periode quiz aktif.<br>Hubungi Admin.</div>`;
    return;
  }
  $app.innerHTML = `
    <div class="card">
      <h3 style="margin-bottom:2px;">${escapeHtml(active.name)}</h3>
      <p style="color:var(--ink-soft); font-size:12.5px;">${(DB.questions[active.id]||[]).length} soal &middot; jawab jujur ya!</p>
      <label>Nama Lengkap</label>
      <input type="text" id="agName" placeholder="Contoh: Dewi Lestari">
      <label>Team</label>
      <select id="agTeam">
        <option value="Resolution">Resolution</option>
        <option value="Merchant">Merchant</option>
        <option value="Partner">Partner</option>
      </select>
      <button class="btn" id="agSubmit" style="margin-top:18px;">Mulai Mengerjakan</button>
    </div>
  `;
  document.getElementById('agSubmit').onclick = ()=>{
    const name = document.getElementById('agName').value.trim();
    const team = document.getElementById('agTeam').value;
    if(!name){ toast('Nama wajib diisi'); return; }
    if(hasAttempted(name, team, active.id)){
      state.agent = {name, team};
      go('alreadyDone');
      return;
    }
    state.agent = {name, team};
    startQuiz(active);
  };
}

function renderAlreadyDone(){
  $title.textContent='Quiz Selesai'; $sub.textContent=''; $back.classList.remove('hidden');
  $app.innerHTML = `
    <div class="locked-msg card">
      <span class="emoji">✅</span>
      <h3 style="margin-top:10px;">Kamu sudah mengerjakan quiz periode ini</h3>
      <p style="color:var(--ink-soft); font-size:13px; margin-top:6px;">Satu nama hanya bisa mengerjakan 1x per periode. Minta Admin untuk reset jika ingin mengulang.</p>
      <button class="btn secondary" style="margin-top:16px;" id="goHomeBtn">Kembali ke Home</button>
    </div>
  `;
  document.getElementById('goHomeBtn').onclick = ()=>go('home', {push:false});
}

/* =========================================================
   QUIZ ENGINE
   ========================================================= */
function startQuiz(period){
  const questions = shuffle([...(DB.questions[period.id]||[])]);
  state.quiz = {
    period, questions, index:0,
    answers: new Array(questions.length).fill(null),
    startTime: Date.now(),
  };
  go('quiz');
  startTimer();
}
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

let timerInt = null;
function startTimer(){
  clearInterval(timerInt);
  timerInt = setInterval(()=>{
    const el = document.getElementById('quizTimer');
    if(!el || !state.quiz) { clearInterval(timerInt); return; }
    const sec = Math.floor((Date.now()-state.quiz.startTime)/1000);
    el.textContent = fmtDuration(sec);
  },1000);
}

function renderQuiz(){
  const q = state.quiz;
  $title.textContent = q.period.name; $sub.textContent = `${state.agent.name} · ${state.agent.team}`; $back.classList.add('hidden');
  const cur = q.questions[q.index];
  const letters = ['A','B','C','D'];
  const selected = q.answers[q.index];
  $app.innerHTML = `
    <div class="card">
      <div class="quiz-meta">
        <span>Soal ${q.index+1} / ${q.questions.length}</span>
        <span class="timer" id="quizTimer">0:00</span>
      </div>
      <div class="progressbar"><div style="width:${((q.index+1)/q.questions.length)*100}%"></div></div>
      <div class="q-text">${escapeHtml(cur.question)}</div>
      <div id="optList">
        ${cur.options.map((opt,i)=>`
          <div class="option ${selected===i?'selected':''}" data-i="${i}">
            <div class="opt-letter">${letters[i]}</div>
            <div>${escapeHtml(opt)}</div>
          </div>
        `).join('')}
      </div>
      <div class="row-btns" style="margin-top:18px;">
        <button class="btn secondary" id="prevBtn" ${q.index===0?'disabled':''}>Previous</button>
        <button class="btn" id="nextBtn">${q.index===q.questions.length-1 ? 'Selesai' : 'Next'}</button>
      </div>
    </div>
  `;
  startTimer();
  $app.querySelectorAll('.option').forEach(el=>{
    el.addEventListener('click', ()=>{
      q.answers[q.index] = parseInt(el.dataset.i);
      renderQuiz();
    });
  });
  document.getElementById('prevBtn').onclick = ()=>{ q.index--; renderQuiz(); };
  document.getElementById('nextBtn').onclick = ()=>{
    if(q.index < q.questions.length-1){ q.index++; renderQuiz(); }
    else{
      if(q.answers.includes(null)){
        confirmModal('Masih ada soal yang belum dijawab. Tetap submit?', submitQuiz);
      } else {
        confirmModal('Yakin ingin submit jawaban sekarang?', submitQuiz);
      }
    }
  };
}

async function submitQuiz(){
  clearInterval(timerInt);
  const q = state.quiz;
  const durationSec = Math.floor((Date.now()-q.startTime)/1000);
  let correct=0;
  const answers = q.questions.map((qq,i)=>{
    const sel = q.answers[i];
    const isCorrect = sel === qq.answer;
    if(isCorrect) correct++;
    return {qId:qq.id, question:qq.question, options:qq.options, selected:sel, correctIndex:qq.answer, explanation:qq.explanation, isCorrect};
  });
  const wrong = q.questions.length - correct;
  const score = Math.round((correct / q.questions.length) * 100);
  const result = {
    id:uid(), name:state.agent.name, team:state.agent.team,
    periodId:q.period.id, periodName:q.period.name,
    ts:Date.now(), durationSec, score, correct, wrong, answers
  };
  toast('Menyimpan hasil...');
  try{
    await fbAddResult(result);
  }catch(err){
    console.error(err);
    toast('Gagal menyimpan, cek koneksi internet');
  }
  DB.results.unshift(result); // tampilkan langsung, listener akan menyamakan nanti
  state.lastResult = result;
  state.quiz = null;
  go('quizResult', {push:false});
}

function renderQuizResult(){
  const r = state.lastResult;
  $title.textContent = 'Hasil Quiz'; $sub.textContent = r.periodName; $back.classList.add('hidden');
  $app.innerHTML = `
    <div class="card">
      <div class="score-hero">
        <div class="num">${r.score}</div>
        <div class="lbl">Nilai Kamu</div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><div class="v" style="color:var(--good)">${r.correct}</div><div class="k">Benar</div></div>
        <div class="stat-box"><div class="v" style="color:var(--bad)">${r.wrong}</div><div class="k">Salah</div></div>
        <div class="stat-box"><div class="v">${fmtDuration(r.durationSec)}</div><div class="k">Durasi</div></div>
      </div>
      <button class="btn" style="margin-top:18px;" id="goHomeBtn2">Kembali ke Home</button>
    </div>
    <div class="section-title"><h3>Pembahasan</h3></div>
    ${r.answers.map((a,i)=>{
      const letters=['A','B','C','D'];
      return `
      <div class="card review-card ${a.isCorrect?'ok':'no'}">
        <p style="font-size:12px; color:var(--ink-soft); margin-bottom:4px;">Soal ${i+1} · ${a.isCorrect?'✅ Benar':'❌ Salah'}</p>
        <p style="font-weight:600; font-size:14px;">${escapeHtml(a.question)}</p>
        <p style="font-size:12.5px; margin-top:8px;">Jawaban kamu: <b style="color:${a.selected===null?'var(--ink-soft)':(a.isCorrect?'var(--good)':'var(--bad)')}">${a.selected===null?'(kosong)':letters[a.selected]+'. '+escapeHtml(a.options[a.selected])}</b></p>
        ${!a.isCorrect ? `<p style="font-size:12.5px; margin-top:2px;">Jawaban benar: <b style="color:var(--good)">${letters[a.correctIndex]}. ${escapeHtml(a.options[a.correctIndex])}</b></p>`:''}
        <div class="review-explain">💡 ${escapeHtml(a.explanation||'-')}</div>
      </div>`;
    }).join('')}
  `;
  document.getElementById('goHomeBtn2').onclick = ()=>go('home', {push:false});
}

/* =========================================================
   RIWAYAT SAYA
   ========================================================= */
function renderHistoryLogin(){
  $title.textContent='Riwayat Saya'; $sub.textContent='Masukkan nama & team'; $back.classList.remove('hidden');
  $app.innerHTML = `
    <div class="card">
      <label>Nama</label>
      <input type="text" id="hName" placeholder="Nama kamu">
      <label>Team</label>
      <select id="hTeam">
        <option value="Resolution">Resolution</option>
        <option value="Merchant">Merchant</option>
        <option value="Partner">Partner</option>
      </select>
      <button class="btn" style="margin-top:16px;" id="hSubmit">Lihat Riwayat</button>
    </div>
  `;
  document.getElementById('hSubmit').onclick = ()=>{
    const name = document.getElementById('hName').value.trim();
    const team = document.getElementById('hTeam').value;
    if(!name){ toast('Nama wajib diisi'); return; }
    state.historyQuery = {name, team};
    go('historyList');
  };
}
function renderHistoryList(){
  const {name, team} = state.historyQuery;
  $title.textContent='Riwayat Saya'; $sub.textContent=`${name} · ${team}`; $back.classList.remove('hidden');
  const rows = DB.results.filter(r=>r.name.trim().toLowerCase()===name.toLowerCase() && r.team===team).sort((a,b)=>b.ts-a.ts);
  if(rows.length===0){
    $app.innerHTML = `<div class="empty-state"><span class="emoji">🗒️</span>Belum ada riwayat quiz untuk data ini.</div>`;
    return;
  }
  $app.innerHTML = rows.map(r=>`
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <b>${escapeHtml(r.periodName)}</b>
        <span class="badge-pill">${r.score}</span>
      </div>
      <p style="font-size:12px; color:var(--ink-soft); margin-top:6px;">${fmtDate(r.ts)} · ${fmtTime(r.ts)} · Durasi ${fmtDuration(r.durationSec)}</p>
      <p style="font-size:12.5px; margin-top:6px;">✅ ${r.correct} benar &nbsp; ❌ ${r.wrong} salah</p>
    </div>
  `).join('');
}

/* =========================================================
   LEADERBOARD
   ========================================================= */
function computeBadges(rows){
  // rows already sorted by rank
  const fastestSec = Math.min(...rows.map(r=>r.durationSec));
  return rows.map((r,i)=>{
    let badges=[];
    if(i===0) badges.push('🥇'); else if(i===1) badges.push('🥈'); else if(i===2) badges.push('🥉');
    if(r.score===100) badges.push('⭐');
    if(r.durationSec===fastestSec) badges.push('⚡');
    return {...r, badges};
  });
}
function renderLeaderboard(){
  $title.textContent='Leaderboard'; $sub.textContent='Ranking seluruh agent'; $back.classList.remove('hidden');
  if(!state.lbPeriod) state.lbPeriod = getActivePeriod()?.id || 'all';
  const teams = ['Semua','Resolution','Merchant','Partner'];
  let rows = DB.results.filter(r => state.lbPeriod==='all' ? true : r.periodId===state.lbPeriod);
  if(state.lbFilter !== 'Semua') rows = rows.filter(r=>r.team===state.lbFilter);
  rows = rows.slice().sort((a,b)=> b.score-a.score || a.durationSec-b.durationSec || a.ts-b.ts);
  const ranked = rows.length ? computeBadges(rows) : [];
  $app.innerHTML = `
    <div class="card">
      <label style="margin-top:0;">Periode</label>
      <select id="lbPeriodSel">
        <option value="all">Semua Periode</option>
        ${DB.periods.map(p=>`<option value="${p.id}" ${state.lbPeriod===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
      <div class="chip-tabs" style="margin-top:14px;">
        ${teams.map(t=>`<div class="chip ${state.lbFilter===t?'active':''}" data-team="${t}">${t}</div>`).join('')}
      </div>
    </div>
    <div class="card">
      ${ranked.length===0 ? `<div class="empty-state"><span class="emoji">🏆</span>Belum ada data leaderboard.</div>` :
      ranked.map((r,i)=>`
        <div class="lb-row">
          <div class="lb-rank">${i+1}</div>
          <div class="lb-name"><b>${escapeHtml(r.name)}</b><small>${r.team} · ${fmtDuration(r.durationSec)}</small></div>
          <div class="lb-badges">${r.badges.join(' ')}</div>
          <div class="lb-score">${r.score}</div>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('lbPeriodSel').onchange = (e)=>{ state.lbPeriod = e.target.value; renderLeaderboard(); };
  $app.querySelectorAll('.chip').forEach(c=>{
    c.addEventListener('click', ()=>{ state.lbFilter = c.dataset.team; renderLeaderboard(); });
  });
}

/* =========================================================
   ADMIN: KELOLA SOAL
   ========================================================= */
function renderManage(){
  $title.textContent='Kelola Soal'; $sub.textContent='Khusus Admin'; $back.classList.remove('hidden');
  if(!state.manageState.periodId) state.manageState.periodId = getActivePeriod()?.id;
  const pid = state.manageState.periodId;
  const period = DB.periods.find(p=>p.id===pid);
  const qs = pid ? (DB.questions[pid]||[]) : [];

  $app.innerHTML = `
    <div class="card">
      <label style="margin-top:0;">Periode</label>
      <select id="mgPeriodSel">
        ${DB.periods.map(p=>`<option value="${p.id}" ${p.id===pid?'selected':''}>${escapeHtml(p.name)}${p.active?' (Aktif)':''}</option>`).join('')}
      </select>
      <div class="row-btns" style="margin-top:12px;">
        <button class="btn secondary block-small" id="newPeriodBtn">+ Periode Baru</button>
        ${period && !period.active ? `<button class="btn block-small" id="setActiveBtn">Jadikan Aktif</button>`:''}
      </div>
    </div>

    <div class="card">
      <div class="row-btns">
        <button class="btn block-small" id="addQBtn">+ Tambah Soal</button>
        <button class="btn secondary block-small" id="previewBtn">👁 Preview</button>
      </div>
      <div class="row-btns" style="margin-top:10px;">
        <label class="file-drop" style="flex:1; margin:0;">📤 Upload JSON
          <input type="file" accept="application/json,.json" id="uploadJsonInput">
        </label>
        <button class="btn secondary block-small" id="exportJsonBtn">⬇ Export JSON</button>
      </div>
    </div>

    <div class="section-title"><h3>Daftar Soal (${qs.length})</h3></div>
    ${qs.length===0 ? `<div class="empty-state"><span class="emoji">📄</span>Belum ada soal di periode ini.</div>` :
      qs.map((q,i)=>`
        <div class="q-card">
          <div class="qhead">
            <b>${i+1}. ${escapeHtml(q.question)}</b>
            <div class="qactions">
              <button class="iconbtn" data-edit="${q.id}">✏️</button>
              <button class="iconbtn" data-del="${q.id}">🗑️</button>
            </div>
          </div>
          <p style="font-size:11.5px; color:var(--ink-soft); margin-top:6px;">Jawaban benar: ${['A','B','C','D'][q.answer]}. ${escapeHtml(q.options[q.answer])}</p>
        </div>
      `).join('')
    }
    <div class="section-title"><h3>Akun Admin</h3></div>
    <div class="card">
      <p style="font-size:12.5px; color:var(--ink-soft); margin-bottom:12px;">Masuk sebagai <b>${escapeHtml(state.adminEmail||'-')}</b></p>
      <div class="row-btns">
        <button class="btn secondary" id="changePassBtn">Ganti Password</button>
        <button class="btn secondary" id="logoutBtn">Logout</button>
      </div>
    </div>
  `;

  document.getElementById('mgPeriodSel').onchange = e=>{ state.manageState.periodId = e.target.value; renderManage(); };
  document.getElementById('newPeriodBtn').onclick = openNewPeriodModal;
  const setActiveBtn = document.getElementById('setActiveBtn');
  if(setActiveBtn) setActiveBtn.onclick = async ()=>{
    setActiveBtn.disabled = true; setActiveBtn.textContent = 'Menyimpan...';
    try{ await fbSetActivePeriod(pid); toast('Periode aktif diperbarui'); }
    catch(err){ toast('Gagal menyimpan, cek koneksi'); }
    renderManage();
  };
  document.getElementById('addQBtn').onclick = ()=>openQuestionForm(null, pid);
  document.getElementById('previewBtn').onclick = ()=>openPreview(pid);
  document.getElementById('exportJsonBtn').onclick = ()=>exportQuestionsJson(pid);
  document.getElementById('uploadJsonInput').onchange = (e)=>handleUploadJson(e, pid);
  document.getElementById('logoutBtn').onclick = adminLogout;
  document.getElementById('changePassBtn').onclick = openChangePasswordModal;
  $app.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openQuestionForm(b.dataset.edit, pid));
  $app.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{
    confirmModal('Hapus soal ini?', async ()=>{
      const items = (DB.questions[pid]||[]).filter(q=>q.id!==b.dataset.del);
      try{ await fbSaveQuestions(pid, items); toast('Soal dihapus'); }
      catch(err){ toast('Gagal menghapus, cek koneksi'); }
      renderManage();
    });
  });
}

function openNewPeriodModal(){
  openModal(`
    <h3>Periode Baru</h3>
    <label>Nama Periode</label>
    <input type="text" id="npName" placeholder="Contoh: Week 2">
    <label style="display:flex; align-items:center; gap:8px; margin-top:14px;">
      <input type="checkbox" id="npActive" style="width:auto;" checked> Jadikan periode aktif
    </label>
    <button class="btn" style="margin-top:16px;" id="npSubmit">Buat Periode</button>
  `);
  document.getElementById('npSubmit').onclick = async ()=>{
    const name = document.getElementById('npName').value.trim();
    if(!name){ toast('Nama periode wajib diisi'); return; }
    const active = document.getElementById('npActive').checked;
    const btn = document.getElementById('npSubmit');
    btn.disabled = true; btn.textContent = 'Membuat...';
    try{
      const id = await fbCreatePeriod(name, active);
      state.manageState.periodId = id;
      closeModal(); toast('Periode dibuat'); renderManage();
    }catch(err){ btn.disabled=false; btn.textContent='Buat Periode'; toast('Gagal membuat periode, cek koneksi'); }
  };
}

function openQuestionForm(qid, pid){
  const existing = qid ? (DB.questions[pid]||[]).find(q=>q.id===qid) : null;
  openModal(`
    <h3>${existing?'Edit Soal':'Tambah Soal'}</h3>
    <label>Pertanyaan</label>
    <textarea id="qfQuestion">${escapeHtml(existing?.question||'')}</textarea>
    <label>Pilihan A</label><input type="text" id="qfA" value="${escapeHtml(existing?.options?.[0]||'')}">
    <label>Pilihan B</label><input type="text" id="qfB" value="${escapeHtml(existing?.options?.[1]||'')}">
    <label>Pilihan C</label><input type="text" id="qfC" value="${escapeHtml(existing?.options?.[2]||'')}">
    <label>Pilihan D</label><input type="text" id="qfD" value="${escapeHtml(existing?.options?.[3]||'')}">
    <label>Jawaban Benar</label>
    <select id="qfAnswer">
      ${['A','B','C','D'].map((l,i)=>`<option value="${i}" ${existing?.answer===i?'selected':''}>${l}</option>`).join('')}
    </select>
    <label>Penjelasan Jawaban</label>
    <textarea id="qfExplain">${escapeHtml(existing?.explanation||'')}</textarea>
    <button class="btn" style="margin-top:16px;" id="qfSubmit">Simpan Soal</button>
  `);
  document.getElementById('qfSubmit').onclick = async ()=>{
    const question = document.getElementById('qfQuestion').value.trim();
    const options = ['qfA','qfB','qfC','qfD'].map(id=>document.getElementById(id).value.trim());
    const answer = parseInt(document.getElementById('qfAnswer').value);
    const explanation = document.getElementById('qfExplain').value.trim();
    if(!question || options.some(o=>!o)){ toast('Lengkapi semua field'); return; }
    const btn = document.getElementById('qfSubmit');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    const items = [...(DB.questions[pid]||[])];
    if(existing){
      const idx = items.findIndex(q=>q.id===existing.id);
      items[idx] = {...existing, question, options, answer, explanation};
    } else {
      items.push({id:uid(), question, options, answer, explanation});
    }
    try{ await fbSaveQuestions(pid, items); closeModal(); toast('Soal disimpan'); renderManage(); }
    catch(err){ btn.disabled=false; btn.textContent='Simpan Soal'; toast('Gagal menyimpan, cek koneksi'); }
  };
}

function exportQuestionsJson(pid){
  const data = DB.questions[pid] || [];
  const exportable = data.map(({question,options,answer,explanation})=>({question,options,answer,explanation}));
  downloadFile(`soal-${periodName(pid).replace(/\s+/g,'_')}.json`, JSON.stringify(exportable,null,2), 'application/json');
  toast('Soal berhasil di-export');
}
function handleUploadJson(e, pid){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = async (ev)=>{
    try{
      const arr = JSON.parse(ev.target.result);
      if(!Array.isArray(arr)) throw new Error('bukan array');
      const items = [...(DB.questions[pid]||[])];
      let added = 0;
      arr.forEach(item=>{
        if(item && item.question && Array.isArray(item.options) && item.options.length===4 && typeof item.answer==='number'){
          items.push({id:uid(), question:item.question, options:item.options, answer:item.answer, explanation:item.explanation||''});
          added++;
        }
      });
      await fbSaveQuestions(pid, items);
      toast(`${added} soal berhasil di-upload`);
      renderManage();
    }catch(err){ toast('File JSON tidak valid atau gagal upload'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}
function downloadFile(filename, content, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

function openPreview(pid){
  const qs = DB.questions[pid]||[];
  openModal(`
    <h3>Preview Quiz — ${escapeHtml(periodName(pid))}</h3>
    <div style="max-height:60vh; overflow-y:auto; margin-top:10px;">
      ${qs.map((q,i)=>`
        <div class="q-card">
          <b>${i+1}. ${escapeHtml(q.question)}</b>
          ${q.options.map((o,j)=>`<p style="font-size:12.5px; margin-top:6px; color:${j===q.answer?'var(--good)':'var(--ink-soft)'};">${['A','B','C','D'][j]}. ${escapeHtml(o)} ${j===q.answer?'✓':''}</p>`).join('')}
        </div>
      `).join('') || '<p style="color:var(--ink-soft); font-size:13px;">Belum ada soal.</p>'}
    </div>
    <button class="btn secondary" style="margin-top:14px;" onclick="closeModal()">Tutup</button>
  `);
}

function openChangePasswordModal(){
  openModal(`
    <h3>Ganti Password Admin</h3>
    <p style="color:var(--ink-soft); font-size:12.5px; margin-bottom:14px;">Masukkan password lama untuk verifikasi, lalu password baru.</p>
    <label>Password Lama</label>
    <input type="password" id="cpOld" placeholder="Password saat ini">
    <label>Password Baru</label>
    <input type="password" id="cpNew" placeholder="Minimal 6 karakter">
    <button class="btn" style="margin-top:16px;" id="cpSubmit">Simpan Password Baru</button>
  `);
  document.getElementById('cpSubmit').onclick = async ()=>{
    const oldPass = document.getElementById('cpOld').value;
    const newPass = document.getElementById('cpNew').value;
    if(!oldPass || newPass.length<6){ toast('Password baru minimal 6 karakter'); return; }
    const btn = document.getElementById('cpSubmit');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try{
      const user = auth.currentUser;
      const cred = firebase.auth.EmailAuthProvider.credential(user.email, oldPass);
      await user.reauthenticateWithCredential(cred);
      await user.updatePassword(newPass);
      closeModal(); toast('Password berhasil diubah');
    }catch(err){
      btn.disabled = false; btn.textContent = 'Simpan Password Baru';
      toast('Gagal mengubah password, cek password lama');
    }
  };
}

/* =========================================================
   ADMIN: DASHBOARD
   ========================================================= */
function renderDashboard(){
  $title.textContent='Dashboard Admin'; $sub.textContent=state.adminEmail||'Statistik & hasil'; $back.classList.remove('hidden');
  const pid = state.dashPeriod;
  const results = DB.results.filter(r => pid==='all' ? true : r.periodId===pid);
  const totalPeserta = new Set(DB.results.map(r=>r.name.toLowerCase()+r.team)).size;
  const totalKerjakan = results.length;
  const teams = ['Resolution','Merchant','Partner'];
  const perTeam = teams.map(t=>({team:t, count: results.filter(r=>r.team===t).length}));
  const scores = results.map(r=>r.score);
  const avg = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
  const max = scores.length ? Math.max(...scores) : 0;
  const min = scores.length ? Math.min(...scores) : 0;
  const passRate = scores.length ? Math.round((scores.filter(s=>s>=80).length/scores.length)*100) : 0;

  $app.innerHTML = `
    <div class="card">
      <label style="margin-top:0;">Filter Periode</label>
      <select id="dashPeriodSel">
        <option value="all" ${pid==='all'?'selected':''}>Semua Periode</option>
        ${DB.periods.map(p=>`<option value="${p.id}" ${pid===p.id?'selected':''}>${escapeHtml(p.name)}</option>`).join('')}
      </select>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);">
      <div class="stat-box card" style="margin:0;"><div class="v">${totalPeserta}</div><div class="k">Total Peserta Terdaftar</div></div>
      <div class="stat-box card" style="margin:0;"><div class="v">${totalKerjakan}</div><div class="k">Sudah Mengerjakan</div></div>
      <div class="stat-box card" style="margin:0;"><div class="v">${avg}</div><div class="k">Nilai Rata-rata</div></div>
      <div class="stat-box card" style="margin:0;"><div class="v">${passRate}%</div><div class="k">Kelulusan (≥80)</div></div>
      <div class="stat-box card" style="margin:0;"><div class="v" style="color:var(--good)">${max}</div><div class="k">Nilai Tertinggi</div></div>
      <div class="stat-box card" style="margin:0;"><div class="v" style="color:var(--bad)">${min}</div><div class="k">Nilai Terendah</div></div>
    </div>

    <div class="section-title"><h3>Statistik per Team</h3></div>
    <div class="card">
      ${perTeam.map(t=>`
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span style="font-size:13px;">${t.team}</span>
          <span class="badge-pill">${t.count} pengerjaan</span>
        </div>
      `).join('')}
    </div>

    <div class="section-title"><h3>Nilai Rata-rata per Periode</h3></div>
    <div class="card"><canvas id="chartCanvas" height="160"></canvas></div>

    <div class="section-title">
      <h3>Daftar Hasil (${results.length})</h3>
      <button class="btn block-small" id="exportCsvBtn">⬇ Export CSV</button>
    </div>
    <div class="card tbl-wrap">
      <table>
        <thead><tr><th>Nama</th><th>Team</th><th>Periode</th><th>Nilai</th><th>Benar</th><th>Salah</th><th>Durasi</th><th>Tanggal</th><th></th></tr></thead>
        <tbody>
          ${results.slice().sort((a,b)=>b.ts-a.ts).map(r=>`
            <tr>
              <td>${escapeHtml(r.name)}</td><td>${r.team}</td><td>${escapeHtml(r.periodName)}</td>
              <td><b>${r.score}</b></td><td>${r.correct}</td><td>${r.wrong}</td>
              <td>${fmtDuration(r.durationSec)}</td><td>${fmtDate(r.ts)}</td>
              <td><button class="iconbtn" data-reset="${r.id}" title="Reset agar bisa mengulang">↺</button></td>
            </tr>
          `).join('') || `<tr><td colspan="9" style="text-align:center; color:var(--ink-soft);">Belum ada data</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('dashPeriodSel').onchange = e=>{ state.dashPeriod = e.target.value; renderDashboard(); };
  document.getElementById('exportCsvBtn').onclick = ()=>exportResultsCsv(results);
  $app.querySelectorAll('[data-reset]').forEach(b=>{
    b.onclick = ()=>{
      confirmModal('Reset hasil ini agar agent bisa mengerjakan ulang?', async ()=>{
        try{ await fbDeleteResult(b.dataset.reset); toast('Hasil direset'); }
        catch(err){ toast('Gagal reset, cek koneksi'); }
        renderDashboard();
      });
    };
  });
  drawChart(pid);
}

function exportResultsCsv(results){
  const header = ['Nama','Team','Periode','Nilai','Benar','Salah','Durasi','Tanggal'];
  const lines = [header.join(',')];
  results.forEach(r=>{
    lines.push([r.name, r.team, r.periodName, r.score, r.correct, r.wrong, fmtDuration(r.durationSec), fmtDate(r.ts)+' '+fmtTime(r.ts)]
      .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
  });
  downloadFile('hasil-quiz.csv', lines.join('\n'), 'text/csv');
  toast('CSV berhasil di-export');
}

function drawChart(pid){
  const canvas = document.getElementById('chartCanvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = 160;
  canvas.width = w*dpr; canvas.height = h*dpr; ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,w,h);

  const periodsToShow = pid==='all' ? DB.periods : DB.periods.filter(p=>p.id===pid);
  const data = periodsToShow.map(p=>{
    const rs = DB.results.filter(r=>r.periodId===p.id);
    const avg = rs.length ? Math.round(rs.reduce((a,b)=>a+b.score,0)/rs.length) : 0;
    return {name:p.name, avg};
  });
  if(data.length===0) return;
  const padding = 24, barGap = 14;
  const barW = Math.max(24, (w - padding*2 - barGap*(data.length-1)) / data.length);
  const styles = getComputedStyle(document.documentElement);
  const blue = styles.getPropertyValue('--blue-600').trim() || '#1d63e0';
  const ink = styles.getPropertyValue('--ink-soft').trim() || '#4a5872';

  ctx.font = '11px sans-serif';
  data.forEach((d,i)=>{
    const x = padding + i*(barW+barGap);
    const barH = (d.avg/100) * (h-40);
    const y = h - 24 - barH;
    ctx.fillStyle = blue;
    roundRect(ctx, x, y, barW, barH, 6); ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.fillText(d.avg, x+barW/2, y-6);
    ctx.fillText(d.name.length>8? d.name.slice(0,8)+'…' : d.name, x+barW/2, h-8);
  });
}
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

/* =========================================================
   ROUTER TABLE
   ========================================================= */
function render(){
  closeModal();
  switch(state.view){
    case 'home': renderHome(); break;
    case 'startQuiz': renderStartQuiz(); break;
    case 'alreadyDone': renderAlreadyDone(); break;
    case 'quiz': renderQuiz(); break;
    case 'quizResult': renderQuizResult(); break;
    case 'historyLogin': renderHistoryLogin(); break;
    case 'historyList': renderHistoryList(); break;
    case 'leaderboard': renderLeaderboard(); break;
    case 'manage': renderManage(); break;
    case 'dashboard': renderDashboard(); break;
    default: renderHome();
  }
  window.scrollTo(0,0);
}

if(firebaseInitOk){ initFirebaseListeners(); }

/* =========================================================
   PWA: SERVICE WORKER REGISTRATION + INSTALL PROMPT
   (Ditambahkan khusus untuk PWA — tidak mengubah logika quiz
   di atas sama sekali)
   ========================================================= */
if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('service-worker.js')
      .then(reg => console.log('[PWA] Service worker terdaftar:', reg.scope))
      .catch(err => console.warn('[PWA] Gagal daftar service worker:', err));
  });
}

let deferredInstallPrompt = null;
const installBtn = document.getElementById('installAppBtn');

window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  if(installBtn) installBtn.classList.remove('hidden');
});

if(installBtn){
  installBtn.addEventListener('click', async ()=>{
    if(!deferredInstallPrompt) return;
    installBtn.classList.add('hidden');
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if(choice.outcome === 'accepted'){
      toast('Aplikasi berhasil di-install ke Home Screen');
    }
  });
}

window.addEventListener('appinstalled', ()=>{
  if(installBtn) installBtn.classList.add('hidden');
  toast('CS Audit Quiz sudah terpasang di HP kamu');
});

/* Sembunyikan splash screen — pakai timer tetap (BUKAN menunggu window 'load')
   supaya tidak nyangkut kalau ada resource yang lambat/gagal dimuat. */
(function hideSplashScreen(){
  const splash = document.getElementById('splashScreen');
  if(!splash) return;
  setTimeout(()=>{
    splash.classList.add('splash-hide');
    setTimeout(()=>splash.remove(), 500);
  }, 900);
})();
