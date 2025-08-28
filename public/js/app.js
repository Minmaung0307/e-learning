/* LearnHub — E-Learning (compact build, admin/instructor/student) */
(() => {
  'use strict';

  // ---- DOM ready helper ----
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // ---- Firebase ----
  if (!window.firebase || !window.__FIREBASE_CONFIG) {
    console.error('Firebase SDK or config missing');
    return;
  }
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const stg = firebase.storage();

  // Surface Firestore errors while you test
  try { firebase.firestore.setLogLevel('debug'); } catch {}

  // ---- EmailJS (Contact page) ----
  // Provide keys via window.__EMAILJS_CONFIG = { publicKey, serviceId, templateId, toEmail? }
  function ensureEmailJsInit() {
    try {
      const cfg = window.__EMAILJS_CONFIG || window.__EMAILJS || {};
      if (!window.emailjs || !cfg.publicKey) return false;
      if (!ensureEmailJsInit._did) {
        emailjs.init(cfg.publicKey);
        ensureEmailJsInit._did = true;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ---- State ----
  const state = {
    user: null,
    role: 'student',
    route: 'dashboard',
    theme: { palette: localStorage.getItem('lh.palette') || 'sunrise', font: localStorage.getItem('lh.font') || 'medium' },
    searchQ: '',
    highlightId: null,
    courses: [],
    enrollments: [],
    quizzes: [],
    attempts: [],
    messages: [],
    tasks: [],
    profiles: [],
    notes: [],
    announcements: [],
    myEnrolledIds: new Set(),
    unsub: [],
    _unsubChat: null,
    currentCourseId: null,
detailPrevRoute: null,
mainThemeClass: '',
  };

  // ---- Utils ----
  const $ = (s, r = document) => {
  if ((s === '#mm-title' || s === '#mm-body' || s === '#mm-foot' || s === '#m-modal') && !document.getElementById('m-modal')) {
    // don’t use $ inside ensureModalDOM to avoid loops
    ensureModalDOM();
  }
  return r.querySelector(s);
};
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const notify = (msg, type = 'ok') => {
    const n = $('#notification');
    if (!n) return;
    n.textContent = msg;
    n.className = `notification show ${type}`;
    setTimeout(() => n.className = 'notification', 2200);
  };

  // Global error hooks (surface runtime errors instead of silent "freeze")
window.addEventListener('error', (e) => {
  try { notify(`Error: ${e.message}`, 'danger'); } catch {}
  console.error('Global error:', e.error || e);
});
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || e?.reason || 'Unhandled promise rejection';
  try { notify(msg, 'danger'); } catch {}
  console.error('Unhandled rejection:', e.reason);
});

// Safety wrapper for event handlers (prevents "freeze" on thrown/rejected handlers)
const safe = (fn) => function(...args){
  try{
    const r = fn.apply(this, args);
    if (r && typeof r.then === 'function') r.catch(err => {
      console.error('Async handler error:', err);
      try { notify(err?.message || 'Action failed', 'danger'); } catch {}
    });
    return r;
  }catch(err){
    console.error('Handler error:', err);
    try { notify(err?.message || 'Action failed', 'danger'); } catch {}
  }
};

// --- Safe listener helpers (add once) ---
const on = (el, type, handler, opts) => { if (el) el.addEventListener(type, safe(handler), opts); };

const delegate = (root, selector, type, handler, opts) => {
  if (!root) return;
  root.addEventListener(type, safe((e) => {
    const t = e.target?.closest?.(selector);
    if (t && root.contains(t)) handler(e, t);
  }), opts);
};

  const nowYear = () => new Date().getFullYear();
  const col = (name) => db.collection(name);
  const doc = (name, id) => db.collection(name).doc(id);
  const canTeach = () => ['instructor', 'admin'].includes(state.role);
  const canManageUsers = () => state.role === 'admin';
  const isEnrolled = (courseId) => state.myEnrolledIds.has(courseId);
  const money = x => (x === 0 ? 'Free' : `$${Number(x).toFixed(2)}`);

  // Deterministic gradient class per course id
const GRADIENT_CLASSES = ['bg-grad-1','bg-grad-2','bg-grad-3','bg-grad-4','bg-grad-5','bg-grad-6'];
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=((h<<5)-h)+s.charCodeAt(i); h|=0; } return Math.abs(h); }
function pickGradientClass(courseId){
  const idx = courseId ? hashStr(courseId) % GRADIENT_CLASSES.length : 0;
  return GRADIENT_CLASSES[idx];
}

  // ---- Constants ----
const VALID_ROLES = ['student', 'instructor', 'admin'];
const normalizeRole = (x) => (x || 'student').toString().trim().toLowerCase();

  // Remove undefined/NaN before writes (Firestore rejects undefined)
  const clean = (obj) => Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== undefined && !(typeof v === 'number' && Number.isNaN(v)))
  );

  // ---- JSON fetcher (for outline & lesson quizzes) ----
  async function fetchJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  }

  // ---- Render outline JSON into HTML ----
  function renderOutlineBox(data) {
    if (!data || !Array.isArray(data.chapters)) return `<div class="muted">No chapters found.</div>`;
    return data.chapters.map(ch => {
      const lessons = Array.isArray(ch.lessons) ? `<ul class="list-tight">${
        ch.lessons.map(l => `<li>${(l.title || '').replace(/</g, '&lt;')}${l.duration ? ` <span class="muted">(${l.duration} min)</span>` : ''}</li>`).join('')
      }</ul>` : '';
      return `<details open>
        <summary><strong>${(ch.title || 'Chapter').replace(/</g, '&lt;')}</strong></summary>
        ${lessons}
      </details>`;
    }).join('');
  }

  // ---- Render lesson quizzes JSON into HTML ----
  function renderLessonQuizzesBox(data) {
    if (!data || typeof data !== 'object') return `<div class="muted">No lesson quizzes JSON.</div>`;
    const keys = Object.keys(data);
    if (!keys.length) return `<div class="muted">No quizzes found.</div>`;
    return keys.map(k => {
      const items = Array.isArray(data[k]) ? data[k] : [];
      return `<details>
        <summary><strong>${k.replace(/[-_]/g, ' ')}</strong> <span class="muted">• ${items.length} Q</span></summary>
        ${items.map((it, i) => `
          <div style="margin:6px 0">
            <div><b>Q${i + 1}.</b> ${(it.q || '').replace(/</g, '&lt;')}</div>
            ${Array.isArray(it.choices) ? `<ul class="list-tight">${it.choices.map(c => `<li>${(c || '').replace(/</g, '&lt;')}</li>`).join('')}</ul>` : ''}
          </div>
        `).join('')}
      </details>`;
    }).join('');
  }

  // ---- PayPal setup (client-side capture) ----
  async function setupPayPalForCourse(c) {
    const zone = document.getElementById('paypal-zone');
    const btns = document.getElementById('paypal-buttons');
    if (!zone || !btns) return;
    zone.classList.remove('hidden');
    btns.innerHTML = '';

    if (!window.paypal || !paypal.Buttons) {
      zone.innerHTML = `<div class="card"><div class="card-body">PayPal SDK missing — set your Client ID in <code>index.html</code>.</div></div>`;
      return;
    }

    const price = Number(c.price || 0).toFixed(2);
    paypal.Buttons({
      style: { shape: 'pill', layout: 'vertical', label: 'paypal' },
      createOrder: (data, actions) => actions.order.create({
        purchase_units: [{
          description: c.title || 'Course',
          amount: { value: price }
        }]
      }),
      onApprove: async (data, actions) => {
        try {
          const details = await actions.order.capture();

          // Optional: record a payment doc
          try {
            await col('payments').add({
              uid: auth.currentUser.uid,
              courseId: c.id,
              amount: +price,
              provider: 'paypal',
              orderId: data.orderID,
              captureId: details?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '',
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (_e) { /* ok if rules block or you skip saving */ }

          // Enroll after successful capture
          await col('enrollments').add({
            uid: auth.currentUser.uid,
            courseId: c.id,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            course: { id: c.id, title: c.title, category: c.category, credits: c.credits, coverImage: c.coverImage }
          });
          try {
            await doc('courses', c.id).set(
              { participants: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.uid) },
              { merge: true }
            );
          } catch (_e) {}

          closeModal('m-modal');
          notify('Payment complete — enrolled');
        } catch (e) {
          console.error(e);
          notify('Payment capture failed', 'danger');
        }
      },
      onError: (err) => {
        console.error(err);
        notify('PayPal error', 'danger');
      }
    }).render('#paypal-buttons');
  }

  // ---- Theme palettes (built-ins + new) ----
  const THEME_PALETTES = [
    'sunrise', 'light', 'dark', 'ocean', 'forest', 'grape', 'lavender', 'sunset', 'sand', 'mono', 'midnight'
  ];

  // ---- Chat helpers (DM roster)
  function profileKey(p) { return p.uid || p.id; }

  function getCourseRecipients(cid) {
    const me = auth.currentUser?.uid;
    const course = state.courses?.find(c => c.id === cid);
    const byId = new Map((state.profiles || []).map(p => [profileKey(p), p]));

    let ids = Array.isArray(course?.participants) && course.participants.length
      ? course.participants
      : (state.profiles || []).map(profileKey);

    const list = ids
      .filter(id => id && id !== me)
      .map(id => byId.get(id))
      .filter(Boolean)
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));

    return list;
  }

  function populateDmUserSelect() {
    const sel = document.getElementById('chat-dm');
    if (!sel) return;
    const cid = document.getElementById('chat-course')?.value || '';
    const users = getCourseRecipients(cid);

    sel.innerHTML = '<option value="">Select user…</option>' +
      users.map(p => `<option value="${profileKey(p)}">${p.name || p.email}</option>`).join('');
  }

  function isLightPaneRoute(route){
  return route === 'courses' || route === 'learning' || route === 'course-detail';
  // If you later want the detail page to be light too, add: || route === 'course-detail'
}

  // ---- Theme (instant) ----
  function applyTheme() {
    if (!document.body) return;
    Array.from(document.body.classList).filter(c => c.startsWith('theme-')).forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`theme-${state.theme.palette}`);
    document.body.classList.remove('font-small', 'font-medium', 'font-large');
    document.body.classList.add(`font-${state.theme.font}`);
  }
  onReady(applyTheme);

  // ---- Page hero (route-aware header) ----
  function heroForRoute(route) {
    switch (route) {
      case 'dashboard': return { icon: 'ri-dashboard-line', klass: 'dashboard', title: 'Dashboard', sub: 'Your hub of activity' };
      case 'courses': return { icon: 'ri-book-2-line', klass: 'courses', title: 'Courses', sub: 'Create, browse, enroll' };
      case 'learning': return { icon: 'ri-graduation-cap-line', klass: 'learning', title: 'My Learning', sub: 'Enrolled courses' };
      case 'assessments': return { icon: 'ri-file-list-3-line', klass: 'assess', title: 'Final Exams', sub: 'Take and track results' };
      case 'chat': return { icon: 'ri-chat-3-line', klass: 'chat', title: 'Chat', sub: 'Course, DM, and group' };
      case 'tasks': return { icon: 'ri-list-check-2', klass: 'tasks', title: 'Tasks', sub: 'Personal kanban' };
      case 'profile': return { icon: 'ri-user-3-line', klass: 'profile', title: 'Profile', sub: 'Bio, avatar & certificates' };
      case 'admin': return { icon: 'ri-shield-star-line', klass: 'admin', title: 'Admin', sub: 'Users, roles & rosters' };
      case 'guide': return { icon: 'ri-compass-3-line', klass: 'guide', title: 'Guide', sub: 'All features explained' };
      case 'settings': return { icon: 'ri-settings-3-line', klass: 'settings', title: 'Settings', sub: 'Theme & preferences' };
      case 'search': return { icon: 'ri-search-line', klass: 'search', title: 'Search', sub: 'Global search' };
      case 'contact': return { icon: 'ri-mail-send-line', klass: 'contact', title: 'Contact', sub: 'Get in touch' };
      case 'course-detail': return { icon: 'ri-book-open-line', klass: 'course-detail', title: 'Course Detail', sub: 'Overview & materials' };
      default: return { icon: 'ri-compass-3-line', klass: 'guide', title: 'LearnHub', sub: 'Smart learning platform' };

    }
  }

  function listenToMyRole(uid) {
  const unsub = doc('roles', uid).onSnapshot(
    snap => {
      const role = normalizeRole(snap.data()?.role);
      const resolved = VALID_ROLES.includes(role) ? role : 'student';
      if (resolved !== state.role) {
        state.role = resolved;
        // keep profile.role in sync (best effort)
        try { doc('profiles', uid).set({ role: resolved }, { merge: true }); } catch {}
        render(); // sidebar/menu updates instantly
      }
    },
    err => console.warn('roles listener error:', err)
  );
  state.unsub.push(unsub); // will be cleaned on sign-out by clearUnsubs()
}

function drawCertificate(ctx, {name, courseTitle, dateText, certId}) {
  const W = 2550, H = 3300;
  // Background
  ctx.fillStyle = '#fafafa'; ctx.fillRect(0,0,W,H);

  // Ornate border
  ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 12; ctx.strokeRect(80, 80, W-160, H-160);
  ctx.strokeStyle = '#7ad3ff'; ctx.lineWidth = 4; ctx.strokeRect(120, 120, W-240, H-240);

  // LearnHub logo mark
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#0b1220';
  ctx.beginPath();
  ctx.arc(W/2, H/2, 500, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // Title
  ctx.fillStyle = '#0b1220';
  ctx.font = 'bold 120px Georgia, "Times New Roman", serif';
  ctx.textAlign = 'center';
  ctx.fillText('Certificate of Completion', W/2, 520);

  // Subtitle
  ctx.font = '28px "Segoe UI", Inter, system-ui, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('This certifies that', W/2, 680);

  // Name
  ctx.font = 'bold 96px Georgia, "Times New Roman", serif';
  ctx.fillStyle = '#0b1220';
  ctx.fillText(name, W/2, 820);

  // Course line
  ctx.font = '28px "Segoe UI", Inter, system-ui, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText('has successfully completed the course', W/2, 930);

  // Course title
  wrapCenter(ctx, courseTitle, W/2, 1020, 42, 1600, 'bold 64px "Times New Roman", Georgia, serif', '#0b1220');

  // Meta row
  ctx.font = '28px "Segoe UI", Inter, system-ui, sans-serif';
  ctx.fillStyle = '#0b1220';
  ctx.textAlign = 'left';
  ctx.fillText(`Date: ${dateText}`, 420, 1380);
  ctx.fillText(`Certificate ID: ${certId}`, 420, 1440);
  ctx.fillText('Organization: LearnHub', 420, 1500);

  // Signature line + label
  ctx.beginPath();
  ctx.moveTo(W-1000, 1420); ctx.lineTo(W-400, 1420); ctx.strokeStyle = '#0b1220'; ctx.lineWidth = 3; ctx.stroke();
  ctx.font = '24px "Segoe UI", Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#334155';
  ctx.fillText('Authorized Signature', W-700, 1460);

  // Seal
  drawSeal(ctx, W-600, 1000, 120);
}

function drawSeal(ctx, x, y, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI*2);
  ctx.fillStyle = '#0b1220'; ctx.fill();
  ctx.lineWidth = 8; ctx.strokeStyle = '#7ad3ff'; ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('LEARN', x, y-8);
  ctx.fillText('HUB', x, y+38);
  ctx.restore();
}

function wrapCenter(ctx, text, cx, startY, lineHeight, maxWidth, font, fillStyle){
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = fillStyle;
  ctx.textAlign = 'center';
  const words = (text||'').split(/\s+/);
  let line = '', y = startY, lines = [];
  for (const w of words){
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth){
      if (line) lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  lines.forEach((ln,i) => ctx.fillText(ln, cx, y + i*lineHeight));
  ctx.restore();
}

// ---- Modal + Sidebar helpers ----
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add('active');
  const bd = m.nextElementSibling;
  if (bd && bd.classList.contains('modal-backdrop')) bd.style.display = 'block';
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('active');
  const bd = m.nextElementSibling;
  if (bd && bd.classList.contains('modal-backdrop')) bd.style.display = 'none';
}
const closeSidebar = () => { document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };

// Ensure modal DOM exists (defensive)
function ensureModalDOM() {
  if (document.getElementById('m-modal')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop"></div>`;
  // append both siblings in correct order
  const frag = document.createDocumentFragment();
  frag.appendChild(wrap.firstElementChild);
  frag.appendChild(wrap.lastChild);
  document.body.appendChild(frag);
  // wire the close button safely
  document.getElementById('mm-close')?.addEventListener('click', safe(() => closeModal('m-modal')));
}

// Call the guard inside openModal so every open is safe
const _openModal = openModal;
openModal = function(id) { ensureModalDOM(); _openModal(id); };

  // ---- Router / Layout ----
  const routes = ['dashboard','courses','course-detail','learning','assessments','chat','tasks','profile','admin','guide','settings','search','contact'];
  function go(route) {
    const prev = state.route;
    state.route = routes.includes(route) ? route : 'dashboard';
    if (prev === 'chat' && state._unsubChat) { try { state._unsubChat(); } catch { } state._unsubChat = null; }
    closeSidebar();
    render();
  }

  function layout(content) {
  const hero = heroForRoute(state.route);
  const lightRoutes = new Set(['courses','learning','course-detail']);
  const mainClass = lightRoutes.has(state.route) ? 'main light-content' : 'main';

  return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand" id="brand">
          <div class="logo"><img src="/icons/learnhub-cap.svg" alt="LearnHub"/></div>
          <div class="title">LearnHub</div>
        </div>
        <div class="nav" id="side-nav">
          ${[
            ['dashboard', 'Dashboard', 'ri-dashboard-line'],
            ['courses', 'Courses', 'ri-book-2-line'],
            ['learning', 'My Learning', 'ri-graduation-cap-line'],
            ['assessments', 'Finals', 'ri-file-list-3-line'],
            ['chat', 'Course Chat', 'ri-chat-3-line'],
            ['tasks', 'Tasks', 'ri-list-check-2'],
            ['profile', 'Profile', 'ri-user-3-line'],
            ['admin', 'Admin', 'ri-shield-star-line'],
            ['guide', 'Guide', 'ri-compass-3-line'],
            ['contact', 'Contact', 'ri-mail-send-line'],
            ['settings', 'Settings', 'ri-settings-3-line']
          ].map(([r, label, ic]) => `
            <div class="item ${state.route === r ? 'active' : ''} ${r === 'admin' && !canManageUsers() ? 'hidden' : ''}"
                 role="button" tabindex="0" data-route="${r}">
              <i class="${ic}"></i><span>${label}</span>
            </div>`).join('')}
        </div>
        <div class="footer"><div class="muted" id="copyright" style="font-size:12px">© ${nowYear()}</div></div>
      </aside>

      <div>
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn ghost" id="burger" title="Menu"><i class="ri-menu-line"></i></button>
            <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
          </div>
          <div class="search-inline">
            <input id="globalSearch" class="input" placeholder="Search courses, quizzes, profiles…" autocomplete="off"/>
            <div id="searchResults" class="search-results"></div>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
          </div>
        </div>
        <div id="backdrop"></div>

        <div class="page-hero ${hero.klass}">
          <i class="${hero.icon}"></i>
          <div>
            <div class="t">${hero.title}</div>
            <div class="s">${hero.sub}</div>
          </div>
        </div>

        <div class="${mainClass}" id="main">${content}</div>
      </div>
    </div>

    <!-- Toasts -->
    <div id="notification" class="notification"></div>

    <!-- Persistent modal skeleton -->
    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop"></div>`;
}

  // ---- Views ----
  const vLogin = () => `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="card-body">
          <div style="display:grid;place-items:center;margin-bottom:8px">
            <img src="/icons/learnhub-cap.svg" alt="LearnHub" width="52" height="52"/>
            <div style="font-size:20px;font-weight:800;margin-top:6px">LearnHub</div>
            <div class="muted">Sign in to continue</div>
          </div>
          <div class="grid">
            <label>Email</label><input id="li-email" class="input" type="email" placeholder="you@example.com" autocomplete="username"/>
            <label>Password</label><input id="li-pass" class="input" type="password" placeholder="••••••••" autocomplete="current-password"/>
            <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
            <div style="display:flex;justify-content:space-between;gap:8px">
              <button id="link-forgot" class="btn ghost" style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot</button>
              <button id="link-register" class="btn secondary" style="padding:6px 10px;font-size:12px"><i class="ri-user-add-line"></i> Sign up</button>
            </div>
            <div class="muted" style="font-size:12px;margin-top:6px">Default admin: create roles/{yourUid}.role="admin"</div>
          </div>
        </div>
      </div>
    </div>`;

  const dashCard = (label, value, route, icon) => `
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="muted">${label}</div>
          <div style="font-size:22px;font-weight:800">${value}</div>
        </div>
        <i class="${icon}" style="font-size:24px;opacity:.8"></i>
      </div>
    </div>`;

  function vDashboard() {
    const my = auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e => e.uid === my).length;
    const myAttempts = state.attempts.filter(a => a.uid === my).length;
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length, 'courses', 'ri-book-2-line')}
        ${dashCard('My Learning', myEnroll, 'learning', 'ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.filter(q => q.isFinal).length, 'assessments', 'ri-file-list-3-line')}
        ${dashCard('My Attempts', myAttempts, 'assessments', 'ri-checkbox-circle-line')}
      </div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Announcements</h3>
        <div id="ann-list">
          ${state.announcements.map(a => `
            <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;gap:10px">
              <div>
                <div style="font-weight:700">${a.title || '—'}</div>
                <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.() || a.createdAt || Date.now()).toLocaleString()}</div>
                <div style="margin-top:6px">${(a.body || '').replace(/</g, '&lt;')}</div>
              </div>
              ${canManageUsers() ? `<div style="display:flex;gap:6px">
                <button class="btn ghost" data-edit-ann="${a.id}"><i class="ri-edit-line"></i></button>
                <button class="btn danger" data-del-ann="${a.id}"><i class="ri-delete-bin-6-line"></i></button>
              </div>` : ''}
            </div></div>
          `).join('')}
          ${!state.announcements.length ? `<div class="muted">No announcements.</div>` : ''}
        </div>
        ${canManageUsers() ? `<div style="margin-top:10px"><button class="btn" id="add-ann"><i class="ri-megaphone-line"></i> New Announcement</button></div>` : ''}
      </div></div>
    `;
  }

  function courseCard(c) {
  const img = c.coverImage || '/icons/learnhub-cap.svg';
  const benefitsArr = (c.goals || c.benefits || []).slice(0, 3);
  const isLong = (c.short || '').length > 160;

  // optional per-course style
  const st = c.style || {};
  const styleStr = [
    st.bg ? `--card-bg:${st.bg}` : '',
    st.text ? `--card-text:${st.text}` : '',
    st.font ? `--card-font:${st.font}` : '',
    st.imgFilter ? `--card-img-filter:${st.imgFilter}` : '',
    st.badgeBg ? `--cc-badge-bg:${st.badgeBg}` : '',
    st.badgeText ? `--cc-badge-text:${st.badgeText}` : '',
  ].filter(Boolean).join(';');

  return `
    <div class="card course-card ${st.cardClass || ''} ${pickGradientClass(c.id)} ${state.highlightId === c.id ? 'highlight' : ''}" id="${c.id}" style="${styleStr}">
      <div class="img">
        <img src="${img}" alt="${c.title}"/>
      </div>
      <div class="card-body">
        <div class="header">
          <div class="title">${c.title}</div>
          <span class="badge">${c.category || 'General'}</span>
        </div>

        <div class="summary">
          <div class="short ${isLong ? 'clamp' : ''}">${(c.short || '').replace(/</g, '&lt;')}</div>
          ${isLong ? `<button class="short-toggle" data-short-toggle>Read more</button>` : ''}
        </div>

        ${benefitsArr.length ? `
          <ul class="benefits">
            ${benefitsArr.map(b => `<li><i class="ri-checkbox-circle-line"></i><span>${(b || '').replace(/</g, '&lt;')}</span></li>`).join('')}
          </ul>` : ''}

        <div class="meta">
          <div class="price">${money(c.price || 0)}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn cta" data-open="${c.id}">
              <i class="ri-external-link-line"></i> ${c.price > 0 ? 'Buy Now' : 'View Course'}
            </button>
            ${canTeach() ? `
              <button class="btn ghost" data-edit="${c.id}" title="Edit"><i class="ri-edit-line"></i></button>
              <button class="btn danger" data-del="${c.id}" title="Delete"><i class="ri-delete-bin-6-line"></i></button>
            ` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

  function vCourses() {
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">Courses</h3>
          ${canTeach() ? `
            <div style="display:flex;gap:8px">
              <button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>
              ${state.courses.length ? '' : `<button class="btn ghost" id="seed-demo"><i class="ri-sparkling-2-line"></i> Add Demo Courses</button>`}
            </div>` : ''
          }
        </div>
        <div class="grid cols-2" data-sec="courses">
          ${state.courses.map(courseCard).join('')}
          ${!state.courses.length ? `<div class="muted" style="padding:10px">No courses yet.</div>` : ''}
        </div>
      </div></div>
    `;
  }

  function vCourseDetail(id){
  const c = state.courses.find(x => x.id === id) || {};
  const enrolled = isEnrolled(id);

  return `
    <div class="card" style="margin:12px 0">
      <div class="card-body">
        <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn ghost" id="cd-back"><i class="ri-arrow-left-line"></i> Back</button>
            <div class="badge"><i class="ri-book-2-line"></i> ${c.category || 'General'} • Credits ${c.credits || 0}</div>
          </div>
          <div style="font-weight:800">${c.price > 0 ? money(c.price) : 'Free'}</div>
        </div>

        <h2 style="margin:8px 0 6px 0">${c.title || ''}</h2>

        <!-- No big thumbnail on detail page (as requested) -->
        <p class="muted" style="margin-top:6px">${(c.short || '').replace(/</g, '&lt;')}</p>
        ${c.goals?.length ? `<ul class="list-tight" style="margin-top:6px">${c.goals.map(g => `<li>${g}</li>`).join('')}</ul>` : ''}

        <div class="section-box" style="margin-top:12px">
          <h4><i class="ri-layout-2-line"></i> Outline</h4>
          <div id="cd-outline"><div class="muted">Loading…</div></div>
        </div>

        <div class="section-box" style="margin-top:12px">
          <h4><i class="ri-question-answer-line"></i> Lesson Quizzes</h4>
          <div id="cd-lesson-quizzes"><div class="muted">Loading…</div></div>
        </div>

        <!-- PayPal zone (rendered on demand) -->
        <div id="paypal-zone" class="paypal-zone hidden" style="margin-top:14px">
          <div id="paypal-buttons"></div>
        </div>
      </div>
    </div>

    <!-- Sticky action bar -->
    <div class="detail-actions">
      <div class="detail-actions-inner">
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end">
          ${
            enrolled
              ? `<button class="btn ok" disabled><i class="ri-check-line"></i> Enrolled</button>`
              : (c.price > 0
                  ? `<button class="btn" id="cd-show-pay"><i class="ri-bank-card-line"></i> Pay &amp; Enroll (${money(c.price)})</button>`
                  : `<button class="btn" id="cd-enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>`
                )
          }
          <button class="btn ghost" id="cd-finals"><i class="ri-question-line"></i> Finals</button>
        </div>
      </div>
    </div>
  `;
}

  function vLearning() {
    const my = auth.currentUser?.uid;
    const list = state.enrollments.filter(e => e.uid === my).map(e => state.courses.find(c => c.id === e.courseId) || {});
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2" data-sec="learning">
          ${list.map(c => `
            <div class="card course-card ${pickGradientClass(c.id)}">
              <div class="img"><img src="${c.coverImage || '/icons/learnhub-cap.svg'}" alt="${c.title || ''}"/></div>
              <div class="card-body">
                <div style="font-weight:800">${c.title || '(deleted course)'}</div>
                ${(() => {
                  const isLong = (c.short || '').length > 160;
                  const txt = (c.short || '').replace(/</g, '&lt;');
                  return `<div class="short-wrap">
                    <div class="muted short ${isLong ? 'clamp' : ''}">${txt}</div>
                    ${isLong ? `<button class="short-toggle" data-short-toggle>Read more</button>` : ''}
                  </div>`;
                })()}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                  <div class="muted">Credits: <strong>${c.credits || 0}</strong></div>
                  <button class="btn" data-open-course="${c.id}">Open</button>
                </div>
              </div>
            </div>`).join('')}
          ${!list.length ? `<div class="muted" style="padding:10px">You’re not enrolled yet.</div>` : ''}
        </div>
      </div></div>`;
  }

  function vAssessments() {
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Final Exams</h3>
          ${canTeach() ? `<button class="btn" id="new-quiz"><i class="ri-add-line"></i> New Final</button>` : ''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${state.quizzes.filter(q => q.isFinal).map(q => `
            <div class="card ${state.highlightId === q.id ? 'highlight' : ''}" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle || '—'} • pass ≥ ${q.passScore || 70}%</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${canTeach() || q.ownerUid === auth.currentUser?.uid ? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>` : ''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.quizzes.filter(q => q.isFinal).length ? `<div class="muted" style="padding:10px">No finals yet.</div>` : ''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Quiz</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts || []).filter(a => a.uid === auth.currentUser?.uid).map(a => `
                <tr>
                  <td>${a.quizTitle}</td>
                  <td class="num">${a.score}%</td>
                  <td>${new Date(a.createdAt?.toDate?.() || a.createdAt || Date.now()).toLocaleString()}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }

  const vChat = () => `
  <div class="card"><div class="card-body">
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between">
      <h3 style="margin:0">Chat</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <select id="chat-mode" class="input">
          <option value="course">Course-wide</option>
          <option value="dm">Direct</option>
          <option value="group">Group/Batch</option>
        </select>
        <select id="chat-course" class="input">
          <option value="">Select course…</option>
          ${state.courses.map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
        </select>
        <select id="chat-dm" class="input hidden">
          <option value="">Select user…</option>
          ${state.profiles.filter(p => p.uid !== auth.currentUser?.uid).map(p => `<option value="${p.uid}">${p.name || p.email}</option>`).join('')}
        </select>
        <input id="chat-group" class="input hidden" placeholder="Batch/Group id e.g. Diploma-2025"/>
      </div>
    </div>

    <div id="chat-box" style="margin-top:10px;max-height:55vh;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:10px"></div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input id="chat-input" class="input" placeholder="Message…"/>
      <button class="btn" id="chat-send"><i class="ri-send-plane-2-line"></i></button>
    </div>
    <div class="muted" style="font-size:12px;margin-top:6px">
      Modes: Course-wide, Direct (1:1), Group/Batch (e.g., “Diploma-2025”). Admins may still use Announcements for broadcast.
    </div>
  </div></div>`;

  // ---- Contact (EmailJS) ----
  function vContact() {
    const me = state.profiles.find(p => p.uid === auth.currentUser?.uid) || {};
    const myName = me.name || '';
    const myEmail = auth.currentUser?.email || '';
    const sdkOk = !!window.emailjs;
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Contact us</h3>
        <div class="grid">
          <input id="ct-name" class="input" placeholder="Your name" value="${myName}"/>
          <input id="ct-email" class="input" type="email" placeholder="Your email" value="${myEmail}"/>
          <input id="ct-subject" class="input" placeholder="Subject"/>
          <textarea id="ct-message" class="input" placeholder="Your message"></textarea>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn" id="ct-send"><i class="ri-mail-send-line"></i> Send</button>
            <span id="ct-hint" class="muted" style="font-size:12px">${sdkOk ? '' : 'EmailJS SDK not found — add it in index.html (see app.js)'}</span>
          </div>
        </div>
        <div class="muted" style="font-size:12px;margin-top:8px">
          We’ll deliver your message via EmailJS using your subject and text above.
        </div>
      </div></div>
    `;
  }

  function vTasks() {
    const my = auth.currentUser?.uid;
    const lane = (key, label, color) => {
      const cards = (state.tasks || []).filter(t => t.uid === my && t.status === key);
      return `
        <div class="card lane-row" data-lane="${key}"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;color:${color}">${label}</h3>
            ${key === 'todo' ? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>` : ''}
          </div>
          <div class="grid lane-grid" id="lane-${key}">
            ${cards.map(t => `
              <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
                <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                  <div>${t.title}</div>
                  <div class="actions">
                    <button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-6-line"></i></button>
                  </div>
                </div>
              </div>`).join('')}
            ${cards.length ? '' : `<div class="muted" style="padding:10px">Drop tasks here…</div>`}
          </div>
        </div></div>`;
    };
    return `<div data-sec="tasks">${lane('todo', 'To do', '#f59e0b')}${lane('inprogress', 'In progress', '#3b82f6')}${lane('done', 'Done', '#10b981')}</div>`;
  }

  function vProfile() {
  const me = state.profiles.find(p => p.uid === auth.currentUser?.uid) || { name: '', bio: '', portfolio: '', avatar: '', signature: '' };
  return `
    <div class="grid" style="grid-template-columns:1fr; gap:10px">
      <!-- My Profile -->
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Profile</h3>
        <div class="grid">
          <input id="pf-name" class="input" placeholder="Name" value="${me.name || ''}"/>
          <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio || ''}"/>
          <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio || ''}</textarea>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
            <input id="pf-sign" type="file" accept="image/*" style="display:none"/>
            <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
            <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Avatar</button>
            <button class="btn ghost" id="pf-pick-sign"><i class="ri-pen-nib-line"></i> Signature</button>
            <button class="btn secondary" id="pf-view"><i class="ri-id-card-line"></i> View Card</button>
            <button class="btn danger" id="pf-delete"><i class="ri-delete-bin-6-line"></i> Delete profile</button>
          </div>
        </div>
      </div></div>

      <!-- Transcript -->
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Transcript</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Course</th><th>Best Score</th><th>Certificate</th></tr></thead>
            <tbody>
              ${buildTranscript(auth.currentUser?.uid).map(r => `
                <tr>
                  <td>${r.courseTitle}</td>
                  <td class="num">${r.best}%</td>
                  <td>${r.completed ? `<button class="btn" data-cert="${r.courseId}"><i class="ri-award-line"></i> Download</button>` : '—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    </div>
  `;
}

  // --- Guide view (compact) ---
  function vGuide(){
  return `
  <section class="guide">
    <style>
      /* compact, readable styles for the Guide page only */
      .guide{
        --g-bg: linear-gradient(135deg,#0ea5e9 0%, #22c55e 100%);
        --g-text: var(--text);
        --g-muted: var(--muted);
        --g-border: var(--border);
        --g-surface: var(--panel);
        --g-surface-2: color-mix(in srgb, var(--panel) 90%, #fff 10%);
        --g-link: var(--primary);
        --g-code-bg:#0b1220; --g-code-text:#e5e7eb;
      }
      .theme-light .guide{ --g-code-bg:#0f172a; --g-code-text:#e5e7eb; }

      .guide, .guide *{ color:var(--g-text) }
      .guide a{ color:var(--g-link); text-underline-offset:2px }
      .guide .muted{ color:var(--g-muted) }

      .guide .hero{ background:var(--g-bg); color:#fff; border-radius:16px; padding:24px 18px; box-shadow:0 6px 24px rgba(0,0,0,.15); }
      .guide .hero .title{ font-size:22px; font-weight:800 }
      .guide .hero .subtitle{ opacity:.95; font-size:13px }
      .guide .nav{ display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 0 }
      .guide .nav a{ text-decoration:none; background:rgba(0,0,0,.18); color:#fff; padding:7px 10px; border-radius:999px; font-size:12px; border:1px solid rgba(255,255,255,.25); }

      .guide .section{ margin-top:14px }
      .guide .h{ display:flex; align-items:center; gap:8px; margin:0 0 6px 0; font-size:16px; font-weight:800 }
      .guide .gcard{ border:1px solid var(--g-border); border-radius:14px; background:var(--g-surface); padding:12px; display:grid; gap:10px }
      .guide .grid2{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px }
      .guide .grid3{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px }
      .guide .step{ display:flex; gap:10px; align-items:flex-start; padding:10px; border-radius:12px; border:1px dashed var(--g-border); background:var(--g-surface-2); }
      .guide .badge{ display:inline-flex; align-items:center; gap:6px; padding:5px 8px; border-radius:999px; font-size:12px; background:var(--g-surface-2); border:1px solid var(--g-border); }
      .guide pre{ background:var(--g-code-bg)!important; color:var(--g-code-text)!important; padding:10px 12px; border-radius:12px; overflow:auto; border:1px solid #1f2937; white-space:pre; tab-size:2; }
      .guide code{ font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace }
      .guide ul{ margin:6px 0 0 18px }
      @media(max-width:840px){ .guide .grid2,.guide .grid3{ grid-template-columns:1fr } }
    </style>

    <div class="hero">
      <div class="title"><i class="ri-compass-3-line"></i> LearnHub — Complete Guide</div>
      <div class="subtitle">Everything in the left sidebar, plus payments, styling, hosted JSON, and fixes.</div>
      <div class="nav">
        <a href="#menus">Menus</a>
        <a href="#dashboard">Dashboard</a>
        <a href="#courses">Courses</a>
        <a href="#learning">My&nbsp;Learning</a>
        <a href="#assessments">Finals</a>
        <a href="#chat">Chat</a>
        <a href="#tasks">Tasks</a>
        <a href="#profile">Profile</a>
        <a href="#admin">Admin</a>
        <a href="#settings">Settings</a>
        <a href="#search">Search</a>
        <a href="#payments">Payments</a>
        <a href="#styling">Styling</a>
        <a href="#datajson">Hosting JSON</a>
        <a href="#troubleshoot">Troubleshooting</a>
        <a href="#guide">About&nbsp;Guide</a>
      </div>
    </div>

    <!-- MENUS OVERVIEW -->
    <div id="menus" class="section">
      <div class="h"><i class="ri-layout-2-line"></i> Sidebar Menus (at a glance)</div>
      <div class="gcard grid3">
        <div class="gcard"><div class="badge"><i class="ri-dashboard-line"></i> Dashboard</div><div class="muted">KPIs + Announcements</div></div>
        <div class="gcard"><div class="badge"><i class="ri-book-2-line"></i> Courses</div><div class="muted">Create, style, JSON outline & lesson quizzes, enroll/pay</div></div>
        <div class="gcard"><div class="badge"><i class="ri-graduation-cap-line"></i> My Learning</div><div class="muted">Open enrolled course, inline outline/quizzes</div></div>
        <div class="gcard"><div class="badge"><i class="ri-file-list-3-line"></i> Finals</div><div class="muted">Create/Take final exams; attempts</div></div>
        <div class="gcard"><div class="badge"><i class="ri-chat-3-line"></i> Chat</div><div class="muted">Course / DM / Group channels</div></div>
        <div class="gcard"><div class="badge"><i class="ri-list-check-2"></i> Tasks</div><div class="muted">Personal kanban</div></div>
        <div class="gcard"><div class="badge"><i class="ri-user-3-line"></i> Profile</div><div class="muted">Bio, avatar, signature, certificate</div></div>
        <div class="gcard"><div class="badge"><i class="ri-shield-star-line"></i> Admin</div><div class="muted">Roles, Users, Roster, Announcements</div></div>
        <div class="gcard"><div class="badge"><i class="ri-settings-3-line"></i> Settings</div><div class="muted">Theme palette & font size</div></div>
        <div class="gcard"><div class="badge"><i class="ri-search-line"></i> Search</div><div class="muted">Global search with live suggestions</div></div>
        <div class="gcard"><div class="badge"><i class="ri-compass-3-line"></i> Guide</div><div class="muted">You’re here</div></div>
      </div>
    </div>

    <!-- DASHBOARD -->
    <div id="dashboard" class="section">
      <div class="h"><i class="ri-dashboard-line"></i> Dashboard</div>
      <div class="gcard grid2">
        <div class="step"><i class="ri-megaphone-line"></i><div><b>Announcements</b>: Admins can post/edit/delete. Everyone sees the feed.</div></div>
        <div class="step"><i class="ri-pie-chart-2-line"></i><div><b>KPIs</b>: Courses, your enrollments, finals count, attempts.</div></div>
      </div>
    </div>

    <!-- COURSES -->
    <div id="courses" class="section">
      <div class="h"><i class="ri-book-2-line"></i> Courses</div>
      <div class="gcard">
        <div class="grid2">
          <div class="step"><i class="ri-add-line"></i><div><b>New Course</b>: Fill Title, Category, Credits, Price, Short; optional Goals, Cover, Outline JSON URL, Lesson Quizzes JSON URL.</div></div>
          <div class="step"><i class="ri-brush-line"></i><div><b>Per-course Style</b>: Add a <code>style</code> map (Firestore or JSON import) — see <a href="#styling">Styling</a>.</div></div>
          <div class="step"><i class="ri-image-line"></i><div><b>Cover</b>: Use a full HTTPS image URL or a deployed path (e.g. <code>/images/cover.jpg</code>).</div></div>
          <div class="step"><i class="ri-external-link-line"></i><div><b>Details</b>: Opens a full-width sheet. Cover image is shown at ~250px wide; Outline & Lesson Quizzes are rendered inline (no extra “view” clicks).</div></div>
          <div class="step"><i class="ri-bank-card-line"></i><div><b>Pay & Enroll</b>: If <code>price&gt;0</code>, PayPal button appears — see <a href="#payments">Payments</a>.</div></div>
        </div>
      </div>
    </div>

    <!-- MY LEARNING -->
    <div id="learning" class="section">
      <div class="h"><i class="ri-graduation-cap-line"></i> My Learning</div>
      <div class="gcard">
        <div class="step"><i class="ri-open-arm-line"></i><div>Shows your enrolled courses. Click <b>Open</b> to view the same inline outline/quizzes layout.</div></div>
      </div>
    </div>

    <!-- FINALS -->
    <div id="assessments" class="section">
      <div class="h"><i class="ri-file-list-3-line"></i> Finals (Assessments)</div>
      <div class="gcard grid2">
        <div class="step"><i class="ri-add-box-line"></i><div><b>Create Final</b>: Choose course, set pass score, paste Items JSON (array of {q, choices, answer, feedbackOk, feedbackNo}).</div></div>
        <div class="step"><i class="ri-play-line"></i><div><b>Take Final</b>: Students must be enrolled. Live per-answer feedback; score saved to <code>attempts</code>.</div></div>
      </div>
    </div>

    <!-- CHAT -->
    <div id="chat" class="section">
      <div class="h"><i class="ri-chat-3-line"></i> Chat</div>
      <div class="gcard grid3">
        <div class="gcard"><div class="badge"><i class="ri-megaphone-line"></i> Course</div><div class="muted">Channel <code>course_{courseId}</code></div></div>
        <div class="gcard"><div class="badge"><i class="ri-user-3-line"></i> Direct</div><div class="muted">Channel <code>dm_{minUid}_{maxUid}</code></div></div>
        <div class="gcard"><div class="badge"><i class="ri-group-line"></i> Group/Batch</div><div class="muted">Channel <code>group_{id}</code></div></div>
      </div>
    </div>

    <!-- TASKS -->
    <div id="tasks" class="section">
      <div class="h"><i class="ri-list-check-2"></i> Tasks</div>
      <div class="gcard grid2">
        <div class="step"><i class="ri-add-line"></i><div><b>Add Task</b> in “To do”.</div></div>
        <div class="step"><i class="ri-drag-move-2-line"></i><div>Drag cards to “In progress” / “Done”.</div></div>
      </div>
    </div>

    <!-- PROFILE -->
    <div id="profile" class="section">
      <div class="h"><i class="ri-user-3-line"></i> Profile</div>
      <div class="gcard grid2">
        <div class="step"><i class="ri-image-add-line"></i><div>Update Name, Portfolio, Bio; upload Avatar & Signature.</div></div>
        <div class="step"><i class="ri-award-line"></i><div>Certificates: after you pass a course final, download from Transcript.</div></div>
      </div>
    </div>

    <!-- ADMIN -->
    <div id="admin" class="section">
      <div class="h"><i class="ri-shield-star-line"></i> Admin</div>
      <div class="gcard grid2">
        <div class="step"><i class="ri-shield-user-line"></i><div><b>Roles</b>: write <code>roles/{uid}.role</code> as <code>student</code>|<code>instructor</code>|<code>admin</code> <b>(lowercase)</b>.</div></div>
        <div class="step"><i class="ri-team-line"></i><div><b>Users</b>: edit/delete profiles.</div></div>
        <div class="step"><i class="ri-user-add-line"></i><div><b>Roster</b>: select course → <b>Sync from Enrollments</b> (fills <code>courses/{id}.participants</code>), or <b>View</b>.</div></div>
        <div class="step"><i class="ri-megaphone-line"></i><div><b>Announcements</b>: post site-wide messages.</div></div>
      </div>
    </div>

    <!-- SETTINGS -->
    <div id="settings" class="section">
      <div class="h"><i class="ri-settings-3-line"></i> Settings</div>
      <div class="gcard">
        <div class="step"><i class="ri-brush-line"></i><div>Change color palette and font size instantly (saved in localStorage).</div></div>
      </div>
    </div>

    <!-- SEARCH -->
    <div id="search" class="section">
      <div class="h"><i class="ri-search-line"></i> Search</div>
      <div class="gcard">
        <div class="step"><i class="ri-keyboard-line"></i><div>Use the top bar. Live results show Courses, Finals, Profiles. Press Enter to open the Search view.</div></div>
      </div>
    </div>

    <!-- PAYMENTS -->
    <div id="payments" class="section">
      <div class="h"><i class="ri-bank-card-line"></i> Payments (PayPal)</div>
      <div class="gcard">
        <div class="step"><i class="ri-code-box-line"></i><div>Add the PayPal SDK in <code>index.html</code> (replace client id & currency):</div></div>
        <pre><code>&lt;script src="https://www.paypal.com/sdk/js?client-id=YOUR_PAYPAL_CLIENT_ID&amp;currency=USD"&gt;&lt;/script&gt;</code></pre>
        <div class="muted">Find your Client ID in PayPal Developer &gt; <b>Apps &amp; Credentials</b> &gt; Create app &gt; Copy <b>Client ID</b>.</div>
        <div class="muted">When a paid course is opened, click <b>Pay &amp; Enroll</b> to render PayPal buttons; on capture we save to <code>payments</code> (optional) then create an enrollment.</div>
      </div>
    </div>

    <!-- STYLING -->
    <div id="styling" class="section">
      <div class="h"><i class="ri-palette-line"></i> Styling (Per-course card)</div>
      <div class="gcard">
        <div class="step"><i class="ri-paint-fill"></i><div>Add a <code>style</code> map on the course doc (Firestore) or in your JSON import:</div></div>
        <pre><code>"style": {
  "bg": "linear-gradient(135deg,#0ea5e9,#22c55e)",
  "text": "#0b1220",
  "badgeBg": "rgba(255,255,255,.4)",
  "badgeText": "#0b1220",
  "font": "Georgia, serif",
  "imgFilter": "saturate(1.05)",
  "cardClass": "theme-gold"   // optional, uses CSS preset
}</code></pre>
        <div class="muted">These map to CSS custom properties on the card (fallbacks are defined in <code>styles.css</code>):</div>
        <ul class="muted">
          <li><code>bg</code> → <code>--card-bg</code>/<code>--cc-bg</code></li>
          <li><code>text</code> → <code>--card-text</code>/<code>--cc-text</code></li>
          <li><code>badgeBg</code>/<code>badgeText</code> → badge colors</li>
          <li><code>font</code> → <code>--card-font</code>/<code>--cc-font</code></li>
          <li><code>imgFilter</code> → <code>--card-img-filter</code>/<code>--cc-img-filter</code></li>
          <li><code>cardClass</code> → adds preset look (e.g. <code>theme-gold</code>)</li>
        </ul>
      </div>
    </div>

    <!-- HOSTED JSON -->
    <div id="datajson" class="section">
      <div class="h"><i class="ri-file-json-line"></i> Hosting course JSON</div>
      <div class="gcard">
        <div class="step"><i class="ri-folder-2-line"></i><div>Place files under Hosting root, e.g. <code>/public/data/outlines/*.json</code>, <code>/public/data/lesson-quizzes/*.json</code>.</div></div>
        <div class="step"><i class="ri-link-m"></i><div>Use URLs like <code>/data/outlines/your-course.json</code> in the course form (Outline JSON URL / Lesson Quizzes JSON URL).</div></div>
        <div class="step"><i class="ri-checkbox-circle-line"></i><div>Open the URL in your browser — you must see raw JSON (not HTML).</div></div>
      </div>
    </div>

    <!-- TROUBLESHOOTING -->
    <div id="troubleshoot" class="section">
      <div class="h"><i class="ri-tools-line"></i> Troubleshooting</div>
      <div class="gcard">
        <div class="step"><i class="ri-error-warning-line"></i><div><b>“Unexpected token &lt;”</b>: URL returns HTML (404). Fix the path to your JSON or JS.</div></div>
        <div class="step"><i class="ri-lock-2-line"></i><div><b>Permissions</b>: roles must be lowercase; check Firestore rules for writes to <code>courses</code>, <code>payments</code>, <code>enrollments</code>, etc.</div></div>
        <div class="step"><i class="ri-image-line"></i><div><b>Cover too large</b>: we force ~250px width in the Details sheet; confirm you didn’t override with custom CSS.</div></div>
      </div>
    </div>

    <!-- ABOUT GUIDE -->
    <div id="guide" class="section">
      <div class="h"><i class="ri-compass-3-line"></i> About this Guide</div>
      <div class="gcard">
        <div class="muted">This page mirrors every left-sidebar menu and the extra flows (payments, styling, hosting). Use the chip nav at the top to jump around.</div>
      </div>
    </div>
  </section>`;
}

  function vAdmin() {
    if (!canManageUsers()) return `<div class="card"><div class="card-body">Admins only.</div></div>`;
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Role Manager</h3>
          <div class="grid">
            <input id="rm-uid" class="input" placeholder="User UID"/>
            <select id="rm-role" class="input">${VALID_ROLES.map(r => `<option value="${r}">${r}</option>`).join('')}</select>
            <button class="btn" id="rm-save"><i class="ri-save-3-line"></i> Save Role</button>
            <div class="muted" style="font-size:12px">Tip: Create your own admin doc once in roles/{yourUid} via console.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>
            ${state.profiles.map(p => `<tr>
              <td>${p.name || '—'}</td><td>${p.email || '—'}</td><td>${p.role || 'student'}</td>
              <td>
                <button class="btn ghost" data-admin-edit="${p.uid}"><i class="ri-edit-line"></i></button>
                <button class="btn danger" data-admin-del="${p.uid}"><i class="ri-delete-bin-6-line"></i></button>
              </td></tr>`).join('')}
            </tbody></table>
          </div>
        </div></div>

        <div class="card" style="grid-column:1/-1"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Course Roster Tools</h3>
          <div class="grid cols-3">
            <div>
              <label class="muted">Course</label>
              <select id="roster-course" class="input">
                <option value="">Select course…</option>
                ${state.courses.map(c => `<option value="${c.id}">${c.title}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="muted">Actions</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn" id="btn-roster-sync"><i class="ri-user-add-line"></i> Sync from Enrollments</button>
                <button class="btn ghost" id="btn-roster-view"><i class="ri-team-line"></i> View Roster</button>
              </div>
            </div>
          </div>
          <div id="roster-out" class="muted" style="margin-top:8px"></div>
        </div></div>
        <div class="card" style="grid-column:1/-1"><div class="card-body">
  <h3 style="margin:0 0 8px 0">Design Previews</h3>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="btn" id="preview-cert"><i class="ri-award-line"></i> Preview Certificate</button>
    <button class="btn ghost" id="preview-transcript"><i class="ri-file-text-line"></i> Preview Transcript</button>
  </div>
</div></div>
      </div>
    `;
  }

  function vSettings() {
    const opts = THEME_PALETTES
      .map(p => `<option value="${p}" ${state.theme.palette === p ? 'selected' : ''}>${p}</option>`)
      .join('');
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div><label>Palette</label>
            <select id="theme-palette" class="input">${opts}</select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              <option value="small" ${state.theme.font === 'small' ? 'selected' : ''}>small</option>
              <option value="medium" ${state.theme.font === 'medium' ? 'selected' : ''}>medium</option>
              <option value="large" ${state.theme.font === 'large' ? 'selected' : ''}>large</option>
            </select>
          </div>
        </div>
        <div class="muted" style="margin-top:8px">Changes apply instantly.</div>
      </div></div>
    `;
  }

  const vSearch = () => `<div class="card"><div class="card-body"><h3>Search</h3><div class="muted">Type in the top bar.</div></div></div>`;

  function safeView(r) {
    switch (r) {
      case 'dashboard': return vDashboard();
      case 'courses': return vCourses();
      case 'learning': return vLearning();
      case 'assessments': return vAssessments();
      case 'chat': return vChat();
      case 'tasks': return vTasks();
      case 'profile': return vProfile();
      case 'admin': return vAdmin();
      case 'guide': return vGuide();
      case 'settings': return vSettings();
      case 'search': return vSearch();
      case 'contact': return vContact();
      case 'course-detail': return vCourseDetail(state.currentCourseId);
      default: return vDashboard();
    }
  }

  // ---- Render / Shell ----
  function render() {
    if (!document.body) { onReady(render); return; }

    let root = document.getElementById('root');
    if (!root) { root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root); }

    if (!auth.currentUser) {
      root.innerHTML = vLogin();
      wireLogin();
      return;
    }

    root.innerHTML = layout(safeView(state.route));
    wireShell(); wireRoute();
    if (state.route === 'chat') populateDmUserSelect();
    if (state.highlightId) {
      const el = document.getElementById(state.highlightId);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      state.highlightId = null;
    }
  }

  function wireShell() {
  on($('#burger'), 'click', () => {
    const open = document.body.classList.contains('sidebar-open');
    if (open) {
      closeSidebar();
    } else {
      document.body.classList.add('sidebar-open');
      $('#backdrop')?.classList.add('active');
    }
  });
  on($('#backdrop'), 'click', closeSidebar);
  on($('#brand'), 'click', closeSidebar);

  on($('#side-nav'), 'click', (e) => {
    const it = e.target.closest?.('.item[data-route]');
    if (it) go(it.getAttribute('data-route'));
  });
  on($('#side-nav'), 'keydown', (e) => {
    const it = e.target.closest?.('.item[data-route]'); if (!it) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(it.getAttribute('data-route')); }
  });

  on($('#main'), 'click', (e) => {
    const goEl = e.target.closest?.('[data-go]');
    if (goEl) { go(goEl.getAttribute('data-go')); return; }
    closeSidebar();
  });

  on($('#btnLogout'), 'click', () => auth.signOut());
  on($('#mm-close'), 'click', () => closeModal('m-modal'));

  // Search live
  const input = $('#globalSearch'), results = $('#searchResults');
  if (input && results) {
    let t;
    input.addEventListener('keydown', safe((e) => {
      if (e.key === 'Enter') {
        state.searchQ = input.value.trim();
        go('search');
        results.classList.remove('active');
      }
    }));
    input.addEventListener('input', safe(() => {
      clearTimeout(t);
      const q = input.value.trim();
      if (!q) { results.classList.remove('active'); results.innerHTML = ''; return; }
      t = setTimeout(() => {
        const ix = [];
        state.courses.forEach(c => ix.push({ label: c.title, section: 'Courses', route: 'courses', id: c.id, text: `${c.title} ${c.category || ''}` }));
        state.quizzes.forEach(qz => ix.push({ label: qz.title, section: 'Finals', route: 'assessments', id: qz.id, text: qz.courseTitle || '' }));
        state.profiles.forEach(p => ix.push({ label: p.name || p.email, section: 'Profiles', route: 'profile', id: p.uid, text: (p.bio || '') }));
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        const out = ix.map(item => {
          const l = item.label.toLowerCase(), t = (item.text || '').toLowerCase();
          const ok = tokens.every(tok => l.includes(tok) || t.includes(tok));
          return ok ? { item, score: tokens.length + (l.includes(tokens[0]) ? 1 : 0) } : null;
        }).filter(Boolean).sort((a, b) => b.score - a.score).map(x => x.item).slice(0, 12);

        results.innerHTML = out.map(r => `<div class="row" data-route="${r.route}" data-id="${r.id || ''}"><strong>${r.label}</strong> <span class="muted">— ${r.section}</span></div>`).join('');
        results.classList.add('active');
        $$('#searchResults .row').forEach(row => {
          row.onclick = safe(() => { const r = row.getAttribute('data-route'); const id = row.getAttribute('data-id'); state.searchQ = q; state.highlightId = id; go(r); results.classList.remove('active'); });
        });
      }, 120);
    }));

    document.addEventListener('click', safe((e) => {
      if (results && typeof results.contains === 'function' && e.target !== input && !results.contains(e.target)) {
        results.classList.remove('active');
      }
    }), { capture: true });
  }

  // Theme instant
  on($('#theme-palette'), 'change', (e) => { state.theme.palette = e.target.value; localStorage.setItem('lh.palette', state.theme.palette); applyTheme(); });
  on($('#theme-font'), 'change', (e) => { state.theme.font = e.target.value; localStorage.setItem('lh.font', state.theme.font); applyTheme(); });

  // Escape closes modal
  on(document, 'keydown', (e) => { if (e.key === 'Escape') closeModal('m-modal'); });
}

  function wireRoute() {
    switch (state.route) {
      case 'courses': wireCourses(); break;
      case 'course-detail': wireCourseDetail(); break;
      case 'learning': wireLearning(); break;
      case 'assessments': wireAssessments(); break;
      case 'chat': wireChat(); break;
      case 'tasks': wireTasks(); break;
      case 'profile': wireProfile(); break;
      case 'admin': wireAdmin(); break;
      case 'guide': wireGuide(); break;
      case 'contact': wireContact(); break;
      case 'settings': break;
      case 'dashboard': wireAnnouncements(); break;
    }
  }

  // ---- Login
  function wireLogin() {
    const doLogin = async () => {
      const email = $('#li-email')?.value.trim(), pass = $('#li-pass')?.value.trim();
      if (!email || !pass) return notify('Enter email & password', 'warn');
      try { await auth.signInWithEmailAndPassword(email, pass); } catch (e) { notify(e?.message || 'Login failed', 'danger'); }
    };
    $('#btnLogin')?.addEventListener('click', doLogin);
    $('#li-pass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

    $('#link-forgot')?.addEventListener('click', async () => {
      const email = $('#li-email')?.value.trim(); if (!email) return notify('Enter your email first', 'warn');
      try { await auth.sendPasswordResetEmail(email); notify('Reset email sent', 'ok'); } catch (e) { notify(e?.message || 'Failed', 'danger'); }
    });

    $('#link-register')?.addEventListener('click', async () => {
      const email = $('#li-email')?.value.trim(); const pass = $('#li-pass')?.value.trim() || 'admin123';
      if (!email) return notify('Enter email, then click Sign up again', 'warn');
      try {
        const cred = await auth.createUserWithEmailAndPassword(email, pass);
        const uid = cred.user.uid;
        await Promise.all([
          doc('roles', uid).set({ uid, email, role: 'student', createdAt: firebase.firestore.FieldValue.serverTimestamp() }),
          doc('profiles', uid).set({ uid, email, name: '', bio: '', portfolio: '', role: 'student', createdAt: firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      } catch (e) { notify(e?.message || 'Signup failed', 'danger'); }
    });
  }

  // ---- Courses
  function wireCourses() {function wireCourses() {
  on($('#seed-demo'), 'click', async () => {
    await window.seedDemoCourses().then(() => notify('Demo courses added')).catch(e => {
      console.error(e);
      notify((e && (e.code + ': ' + e.message)) || 'Failed to seed', 'danger');
    });
  });

  on($('#add-course'), 'click', () => {
    if (!canTeach()) return notify('Instructors/Admins only', 'warn');
    $('#mm-title').textContent = 'New Course';
    $('#mm-body').innerHTML = `
      <div class="grid">
        <input id="c-title" class="input" placeholder="Title"/>
        <input id="c-category" class="input" placeholder="Category"/>
        <input id="c-credits" class="input" type="number" placeholder="Credits" value="0"/>
        <input id="c-price" class="input" type="number" placeholder="Price" value="0"/>
        <textarea id="c-short" class="input" placeholder="Short description"></textarea>
        <textarea id="c-goals" class="input" placeholder="Goals (one per line)"></textarea>
        <input id="c-cover" class="input" placeholder="Cover image URL (https://…)"/>
        <input id="c-outlineUrl" class="input" placeholder="/data/outlines/your-course.json"/>
        <input id="c-quizzesUrl" class="input" placeholder="/data/lesson-quizzes/your-course.json"/>
      </div>`;
    $('#mm-foot').innerHTML = `<button class="btn" id="c-save">Save</button>`;
    openModal('m-modal');

    on($('#c-save'), 'click', async () => {
      const t = $('#c-title')?.value.trim(); if (!t) return notify('Title required', 'warn');
      const goals = ($('#c-goals')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      const obj = {
        title: t,
        category: $('#c-category')?.value.trim(),
        credits: +($('#c-credits')?.value || 0),
        price: +($('#c-price')?.value || 0),
        short: $('#c-short')?.value.trim(),
        goals,
        coverImage: $('#c-cover')?.value.trim(),
        outlineUrl: $('#c-outlineUrl')?.value.trim(),
        quizzesUrl: $('#c-quizzesUrl')?.value.trim(),
        ownerUid: auth.currentUser.uid,
        ownerEmail: auth.currentUser.email,
        participants: [auth.currentUser.uid],
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      await col('courses').add(obj).then(() => { closeModal('m-modal'); notify('Saved'); })
        .catch(e => { console.error('Failed to create course:', e); notify((e && (e.code + ': ' + e.message)) || 'Failed to create course', 'danger'); });
    });
  });

  const sec = $('[data-sec="courses"]'); if (!sec || sec.__wired) return; sec.__wired = true;

  // Toggle clamped summary
  delegate(sec, '[data-short-toggle]', 'click', (_e, btn) => {
    const wrap = btn.closest('.card-body') || btn.parentElement;
    const block = wrap?.querySelector('.short');
    if (!block) return;
    const clamped = block.classList.toggle('clamp');
    btn.textContent = clamped ? 'Read more' : 'Read less';
  });

  // Open detail (SPA)
  delegate(sec, 'button[data-open]', 'click', (_e, btn) => {
    const id = btn.getAttribute('data-open');
    state.currentCourseId = id;
    state.detailPrevRoute = 'courses';
    state.mainThemeClass = pickGradientClass(id);
    go('course-detail');
  });

  // Edit course
  delegate(sec, 'button[data-edit]', 'click', async (_e, btn) => {
    if (!canTeach()) return notify('No permission', 'warn');
    const id = btn.getAttribute('data-edit');
    const snap = await doc('courses', id).get(); if (!snap.exists) return;
    const c = { id: snap.id, ...snap.data() };
    $('#mm-title').textContent = 'Edit Course';
    $('#mm-body').innerHTML = `
      <div class="grid">
        <input id="c-title" class="input" value="${c.title || ''}"/>
        <input id="c-category" class="input" value="${c.category || ''}"/>
        <input id="c-credits" class="input" type="number" value="${c.credits || 0}"/>
        <input id="c-price" class="input" type="number" value="${c.price || 0}"/>
        <textarea id="c-short" class="input">${c.short || ''}</textarea>
        <textarea id="c-goals" class="input">${(c.goals || []).join('\n')}</textarea>
        <input id="c-cover" class="input" value="${c.coverImage || ''}"/>
        <input id="c-outlineUrl" class="input" value="${c.outlineUrl || ''}"/>
        <input id="c-quizzesUrl" class="input" value="${c.quizzesUrl || ''}"/>
      </div>`;
    $('#mm-foot').innerHTML = `<button class="btn" id="c-save">Save</button>`;
    openModal('m-modal');
    on($('#c-save'), 'click', async () => {
      const goals = ($('#c-goals')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
      await doc('courses', id).set(clean({
        title: $('#c-title')?.value.trim(), category: $('#c-category')?.value.trim(),
        credits: +($('#c-credits')?.value || 0), price: +($('#c-price')?.value || 0),
        short: $('#c-short')?.value.trim(), goals,
        coverImage: $('#c-cover')?.value.trim(), outlineUrl: $('#c-outlineUrl')?.value.trim(), quizzesUrl: $('#c-quizzesUrl')?.value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true });
      closeModal('m-modal'); notify('Saved');
    });
  });

  // Delete course
  delegate(sec, 'button[data-del]', 'click', async (_e, btn) => {
    if (!canTeach()) return notify('No permission', 'warn');
    const id = btn.getAttribute('data-del');
    await doc('courses', id).delete();
    notify('Course deleted');
  });
}

  function wireCourseDetail(){
  const id = state.currentCourseId;
  const c = state.courses.find(x => x.id === id) || {};

  // Back to where we came from
  $('#cd-back')?.addEventListener('click', () => {
    go(state.detailPrevRoute || 'courses');
  });

  // Finals
  $('#cd-finals')?.addEventListener('click', () => {
    state.searchQ = c.title || '';
    go('assessments');
  });

  // Enroll (free)
  $('#cd-enroll')?.addEventListener('click', async () => {
    await col('enrollments').add({
      uid: auth.currentUser.uid, courseId: c.id,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      course: { id: c.id, title: c.title, category: c.category, credits: c.credits, coverImage: c.coverImage }
    });
    try {
      await doc('courses', c.id).set({ participants: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.uid) }, { merge: true });
    } catch {}
    notify('Enrolled');
    // Refresh detail view to reflect status
    render();
  });

  // Pay & Enroll (lazy-mount PayPal)
  $('#cd-show-pay')?.addEventListener('click', () => {
    setupPayPalForCourse(c);
    document.getElementById('paypal-zone')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Load Outline JSON
  const outlineBox = document.getElementById('cd-outline');
  if (c.outlineUrl) {
    fetchJSON(c.outlineUrl)
      .then(d => outlineBox.innerHTML = renderOutlineBox(d))
      .catch(err => outlineBox.innerHTML = `<div class="muted">Could not load outline (${err?.message || 'error'}).</div>`);
  } else {
    outlineBox.innerHTML = `<div class="muted">No outline URL for this course.</div>`;
  }

  // Load Lesson Quizzes JSON
  const quizBox = document.getElementById('cd-lesson-quizzes');
  if (c.quizzesUrl) {
    fetchJSON(c.quizzesUrl)
      .then(d => quizBox.innerHTML = renderLessonQuizzesBox(d))
      .catch(err => quizBox.innerHTML = `<div class="muted">Could not load lesson quizzes (${err?.message || 'error'}).</div>`);
  } else {
    quizBox.innerHTML = `<div class="muted">No lesson quizzes URL for this course.</div>`;
  }
}

  // ---- Learning
  function wireLearning() {
  const sec = $('[data-sec="learning"]'); if (!sec || sec.__wired) return; sec.__wired = true;

  // Toggle clamp
  delegate(sec, '[data-short-toggle]', 'click', (_e, btn) => {
    const wrap = btn.closest('.card-body') || btn.parentElement;
    const block = wrap?.querySelector('.short');
    if (!block) return;
    const clamped = block.classList.toggle('clamp');
    btn.textContent = clamped ? 'Read more' : 'Read less';
  });

  // Open detail (SPA)
  delegate(sec, 'button[data-open-course]', 'click', (_e, btn) => {
    const id = btn.getAttribute('data-open-course');
    state.currentCourseId = id;
    state.detailPrevRoute = 'learning';
    state.mainThemeClass = pickGradientClass(id);
    go('course-detail');
  });
}

  // ---- Finals
  function wireAssessments() {
  on($('#new-quiz'), 'click', () => {
    if (!canTeach()) return notify('Instructors/Admins only', 'warn');
    $('#mm-title').textContent = 'New Final';
    $('#mm-body').innerHTML = `
      <div class="grid">
        <input id="q-title" class="input" placeholder="Final title"/>
        <select id="q-course" class="input">${state.courses.map(c => `<option value="${c.id}">${c.title}</option>`).join('')}</select>
        <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
        <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":1,"feedbackOk":"Correct!","feedbackNo":"Try again"}]'></textarea>
      </div>`;
    $('#mm-foot').innerHTML = `<button class="btn" id="q-save">Save</button>`;
    openModal('m-modal');
    on($('#q-save'), 'click', async () => {
      const t = $('#q-title')?.value.trim(); const courseId = $('#q-course')?.value; const pass = +($('#q-pass')?.value || 70);
      if (!t || !courseId) return notify('Fill title & course', 'warn');
      let items = []; try { items = JSON.parse($('#q-json')?.value || '[]'); } catch { return notify('Invalid JSON', 'danger'); }
      const course = state.courses.find(c => c.id === courseId) || {};
      await col('quizzes').add(clean({ title: t, courseId, courseTitle: course.title, passScore: pass, items, isFinal: true, ownerUid: auth.currentUser.uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
      closeModal('m-modal'); notify('Final saved');
    });
  });

  const sec = $('[data-sec="quizzes"]'); if (!sec || sec.__wired) return; sec.__wired = true;

  // Take quiz
  delegate(sec, 'button[data-take]', 'click', async (_e, btn) => {
    const id = btn.getAttribute('data-take'); const snap = await doc('quizzes', id).get(); if (!snap.exists) return;
    const q = { id: snap.id, ...snap.data() };
    if (!isEnrolled(q.courseId) && state.role === 'student') return notify('Enroll first', 'warn');

    $('#mm-title').textContent = q.title;
    $('#mm-body').innerHTML = (q.items || []).map((it, idx) => `
      <div class="card"><div class="card-body">
        <div style="font-weight:700">Q${idx + 1}. ${it.q}</div>
        <div style="margin-top:6px;display:grid;gap:6px">
          ${(it.choices || []).map((c, i) => `
            <label style="display:flex;gap:8px;align-items:center">
              <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
            </label>`).join('')}
        </div>
        <div class="muted" id="fb-${idx}" style="margin-top:6px"></div>
      </div></div>`).join('');
    $('#mm-foot').innerHTML = `<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
    openModal('m-modal');

    const bodyEl = $('#mm-body');
    bodyEl.addEventListener('change', safe((ev) => {
      const t = ev.target;
      if (!t?.name?.startsWith('q')) return;
      const idx = Number(t.name.slice(1));
      const it = (q.items || [])[idx];
      if (!it) return;
      const val = +t.value;
      const fb = $(`#fb-${idx}`);
      if (!fb) return;
      if (val === +it.answer) { fb.textContent = it.feedbackOk || 'Correct'; fb.style.color = 'var(--ok)'; }
      else { fb.textContent = it.feedbackNo || 'Incorrect'; fb.style.color = 'var(--danger)'; }
    }));

    bodyEl.scrollTop = 0;

    on($('#q-submit'), 'click', async () => {
      let correct = 0;
      (q.items || []).forEach((it, idx) => {
        const v = (document.querySelector(`input[name="q${idx}"]:checked`)?.value) || '-1';
        if (+v === +it.answer) correct++;
      });
      const total = (q.items || []).length || 1;
      const score = Math.round((correct / total) * 100);
      await col('attempts').add({
        uid: auth.currentUser.uid, email: auth.currentUser.email, quizId: q.id, quizTitle: q.title, courseId: q.courseId, score,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal('m-modal'); notify(`Your score: ${score}%`);
    });
  });

  // Edit quiz
  delegate(sec, 'button[data-edit]', 'click', async (_e, btn) => {
    const id = btn.getAttribute('data-edit'); const snap = await doc('quizzes', id).get(); if (!snap.exists) return;
    const q = { id: snap.id, ...snap.data() }; if (!(canTeach() || q.ownerUid === auth.currentUser?.uid)) return notify('No permission', 'warn');

    $('#mm-title').textContent = 'Edit Final';
    $('#mm-body').innerHTML = `
      <div class="grid">
        <input id="q-title" class="input" value="${q.title || ''}"/>
        <input id="q-pass" class="input" type="number" value="${q.passScore || 70}"/>
        <textarea id="q-json" class="input">${JSON.stringify(q.items || [], null, 2)}</textarea>
      </div>`;
    $('#mm-foot').innerHTML = `<button class="btn" id="q-save">Save</button>`;
    openModal('m-modal');
    on($('#q-save'), 'click', async () => {
      let items = []; try { items = JSON.parse($('#q-json')?.value || '[]'); } catch { return notify('Invalid JSON', 'danger'); }
      await doc('quizzes', id).set(clean({ title: $('#q-title')?.value.trim(), passScore: +($('#q-pass')?.value || 70), items, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }), { merge: true });
      closeModal('m-modal'); notify('Saved');
    });
  });
}

  // ---- Chat
  function wireChat() {
    const box = $('#chat-box');
    const modeSel = $('#chat-mode');
    const courseSel = $('#chat-course');
    const dmSel = $('#chat-dm');
    const groupInp = $('#chat-group');
    const input = $('#chat-input');
    const send = $('#chat-send');

    populateDmUserSelect();

    let unsub = null;

    const uiByMode = () => {
      const m = modeSel.value;
      courseSel.classList.toggle('hidden', m !== 'course');
      dmSel.classList.toggle('hidden', m !== 'dm');
      groupInp.classList.toggle('hidden', m !== 'group');
      if (m === 'dm') populateDmUserSelect();
    };
    uiByMode();
    modeSel?.addEventListener('change', () => { uiByMode(); sub(); });

    function channelKey() {
      const m = modeSel.value;
      if (m === 'course') {
        const c = courseSel.value; return c ? `course_${c}` : '';
      } else if (m === 'dm') {
        const peer = dmSel.value; if (!peer) return '';
        const pair = [auth.currentUser.uid, peer].sort(); return `dm_${pair[0]}_${pair[1]}`;
      } else {
        const gid = (groupInp.value || '').trim(); return gid ? `group_${gid}` : '';
      }
    }

    function paint(msgs) {
      box.innerHTML = msgs.sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
        .map(m => `
          <div style="margin-bottom:8px">
            <div style="font-weight:600">${m.name || m.email || 'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.() || m.createdAt || Date.now()).toLocaleTimeString()}</span></div>
            <div>${(m.text || '').replace(/</g, '&lt;')}</div>
          </div>`).join('');
      box.scrollTop = box.scrollHeight;
    }

    function sub() {
      if (unsub) { try { unsub() } catch { } unsub = null; }
      if (state._unsubChat) { try { state._unsubChat(); } catch { } state._unsubChat = null; }
      const ch = channelKey(); if (!ch) { box.innerHTML = '<div class="muted">Pick a channel…</div>'; return; }
      unsub = col('messages').where('channel', '==', ch).onSnapshot(
        s => paint(s.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => console.warn('chat listener error:', err)
      );
      state._unsubChat = unsub;
    }

    courseSel?.addEventListener('change', () => { populateDmUserSelect(); sub(); });
    dmSel?.addEventListener('change', sub);
    groupInp?.addEventListener('input', sub);
    groupInp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sub(); });

    send?.addEventListener('click', async () => {
      const ch = channelKey(); const text = input.value.trim(); if (!ch || !text) return;
      const me = state.profiles.find(p => p.uid === auth.currentUser?.uid) || {};
      const payload = clean({
        channel: ch,
        type: modeSel.value,
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        name: me.name || '',
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        courseId: modeSel.value === 'course' ? courseSel.value : undefined,
        peerUid: modeSel.value === 'dm' ? dmSel.value : undefined,
        groupId: modeSel.value === 'group' ? groupInp.value.trim() : undefined
      });
      await col('messages').add(payload);
      input.value = '';
    });

    sub();
  }

  // ---- Contact wiring (EmailJS send) ----
  function wireContact() {
    const sendBtn = $('#ct-send');
    if (!sendBtn) return;

    // init SDK if available
    ensureEmailJsInit();

    sendBtn.addEventListener('click', async () => {
      const name = $('#ct-name')?.value.trim();
      const email = $('#ct-email')?.value.trim();
      const subject = $('#ct-subject')?.value.trim();
      const message = $('#ct-message')?.value.trim();
      const cfg = window.__EMAILJS_CONFIG || window.__EMAILJS || {};

      if (!name || !email || !subject || !message) { notify('Fill all fields', 'warn'); return; }
      if (!window.emailjs) { notify('EmailJS SDK missing (see index.html snippet)', 'danger'); return; }
      if (!cfg.serviceId || !cfg.templateId) { notify('EmailJS serviceId/templateId missing', 'danger'); return; }

      // UI busy
      const prev = sendBtn.innerHTML;
      sendBtn.disabled = true;
      sendBtn.innerHTML = '<i class="ri-loader-4-line" style="animation:spin 1s linear infinite"></i> Sending…';

      try {
        // Optional: persist to Firestore for audit/helpdesk
        try {
          await col('contact').add({
            uid: auth.currentUser?.uid || null,
            name, email, subject, message,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        } catch (_) {}

        const params = {
          from_name: name,
          from_email: email,
          subject,
          message,
          reply_to: email,
          to_email: cfg.toEmail || undefined,
          user_uid: auth.currentUser?.uid || '',
          app_name: 'LearnHub'
        };

        ensureEmailJsInit(); // in case route changed before init
        await emailjs.send(cfg.serviceId, cfg.templateId, params);
        notify('Message sent — thank you!');
        $('#ct-subject').value = '';
        $('#ct-message').value = '';
      } catch (e) {
        console.error('EmailJS send failed:', e);
        notify(e?.text || e?.message || 'Send failed', 'danger');
      } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = prev;
      }
    });
  }

  // ---- Tasks
  function wireTasks() {
    const root = $('[data-sec="tasks"]'); if (!root) return;

    $('#addTask')?.addEventListener('click', () => {
      $('#mm-title').textContent = 'Task';
      $('#mm-body').innerHTML = `<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
      $('#t-save').onclick = async () => {
        const t = $('#t-title')?.value.trim(); if (!t) return notify('Title required', 'warn');
        await col('tasks').add({ uid: auth.currentUser.uid, title: t, status: 'todo', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        closeModal('m-modal'); notify('Saved');
      };
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest?.('button'); if (!btn) return;
      const id = btn.getAttribute('data-edit') || btn.getAttribute('data-del'); if (!id) return;
      if (btn.hasAttribute('data-edit')) {
        const snap = await doc('tasks', id).get(); if (!snap.exists) return;
        const t = { id: snap.id, ...snap.data() };
        $('#mm-title').textContent = 'Edit Task';
        $('#mm-body').innerHTML = `<div class="grid">
          <input id="t-title" class="input" value="${t.title || ''}"/>
          <select id="t-status" class="input">${['todo', 'inprogress', 'done'].map(x => `<option ${t.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
        </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
        $('#t-save').onclick = async () => {
          await doc('tasks', id).set({ title: $('#t-title')?.value.trim(), status: $('#t-status')?.value || 'todo', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        await doc('tasks', id).delete(); notify('Deleted');
      }
    });

    root.querySelectorAll('.task-card').forEach(card => {
      card.setAttribute('draggable', 'true'); card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
    root.querySelectorAll('.lane-grid').forEach(grid => {
      const row = grid.closest('.lane-row'); const lane = row?.getAttribute('data-lane');
      const show = e => { e.preventDefault(); row?.classList.add('highlight'); };
      const hide = () => row?.classList.remove('highlight');
      grid.addEventListener('dragenter', show); grid.addEventListener('dragover', show); grid.addEventListener('dragleave', hide);
      grid.addEventListener('drop', async (e) => { e.preventDefault(); hide(); const id = e.dataTransfer.getData('text/plain'); if (!id) return;
        await doc('tasks', id).set({ status: lane, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    });
  }

  function renderCertificatePNG({ name, courseTitle, dateText, certId, logoUrl }) {
  // US Letter 8.5x11 at 300dpi = 2550x3300
  const W = 2550, H = 3300;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#fafaf9'; ctx.fillRect(0,0,W,H);

  // Ornamental border
  ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 8; ctx.strokeRect(80,80,W-160,H-160);
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.strokeRect(120,120,W-240,H-240);

  // Seal (simple rosette)
  ctx.save();
  ctx.translate(W-420, H-520);
  ctx.fillStyle = '#0ea5e9';
  for (let i=0;i<36;i++){ ctx.rotate(Math.PI/18); ctx.beginPath(); ctx.moveTo(0,0); ctx.arc(0,0,140,0,Math.PI/12); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(W-420, H-520, 100, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#0ea5e9'; ctx.font = 'bold 44px Inter'; ctx.textAlign = 'center'; ctx.fillText('LEARNHUB', W-420, H-512);
  ctx.font = '24px Inter'; ctx.fillText('Seal of Excellence', W-420, H-470);

  // Title
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 96px "Georgia", serif';
  ctx.textAlign = 'center';
  ctx.fillText('Certificate of Completion', W/2, 580);

  // Student name
  ctx.font = 'bold 72px "Georgia", serif';
  ctx.fillText(name || 'Student Name', W/2, 860);

  // Subtitle
  ctx.font = '28px Inter';
  ctx.fillStyle = '#334155';
  ctx.fillText('This certifies that', W/2, 800);
  ctx.fillText('has successfully completed the course', W/2, 920);

  // Course
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 48px Inter';
  ctx.fillText(courseTitle || 'Course Title', W/2, 1000);

  // Date + ID
  ctx.fillStyle = '#334155';
  ctx.font = '26px Inter';
  ctx.fillText(`Date: ${dateText || new Date().toLocaleDateString()}`, W/2, 1080);
  ctx.fillText(`Certificate ID: ${certId || 'LH-XXXX-XXXX'}`, W/2, 1120);

  // Signature line
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W/2-300, 1320); ctx.lineTo(W/2+300, 1320); ctx.stroke();
  ctx.fillStyle = '#111827'; ctx.font = '24px Inter';
  ctx.fillText('Authorized Signature', W/2, 1360);

  // Logo (optional)
  if (logoUrl) {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => {
      ctx.drawImage(img, 200, 210, 240, 240);
      finish();
    }; img.src = logoUrl;
  } else finish();

  function finish(){
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url; a.download = `certificate_${(courseTitle||'course').replace(/\s+/g,'_')}.png`; a.click();
  }
}

  // ---- Profile
  function wireProfile() {
    $('#pf-pick')?.addEventListener('click', () => $('#pf-avatar')?.click());
    $('#pf-pick-sign')?.addEventListener('click', () => $('#pf-sign')?.click());

    $('#pf-save')?.addEventListener('click', async () => {
      const uid = auth.currentUser.uid;
      await doc('profiles', uid).set({
        name: $('#pf-name')?.value.trim(), portfolio: $('#pf-portfolio')?.value.trim(), bio: $('#pf-bio')?.value.trim(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const fileA = $('#pf-avatar')?.files?.[0];
      if (fileA) {
        const ref = stg.ref().child(`avatars/${uid}/${Date.now()}_${fileA.name}`);
        await ref.put(fileA); const url = await ref.getDownloadURL();
        await doc('profiles', uid).set({ avatar: url }, { merge: true });
      }
      const fileS = $('#pf-sign')?.files?.[0];
      if (fileS) {
        const ref = stg.ref().child(`signatures/${uid}/${Date.now()}_${fileS.name}`);
        await ref.put(fileS); const url = await ref.getDownloadURL();
        await doc('profiles', uid).set({ signature: url }, { merge: true });
      }
      notify('Profile saved');
    });

    $('#pf-delete')?.addEventListener('click', async () => {
      const uid = auth.currentUser.uid;
      await doc('profiles', uid).delete();
      notify('Profile deleted');
    });

    $('#pf-view')?.addEventListener('click', () => {
  const me = state.profiles.find(p => p.uid === auth.currentUser?.uid) || {};
  $('#mm-title').textContent = 'Profile Card';
$('#mm-body').innerHTML = `
  <div style="
    background:linear-gradient(135deg,#f8fafc,#eef2ff);
    color:#0b1220; border:1px solid var(--border);
    border-radius:14px; padding:16px; display:grid; gap:12px">
    <div style="display:flex;gap:12px;align-items:center">
      <img src="${me.avatar || '/icons/learnhub-cap.svg'}" alt="avatar"
           style="width:84px;height:84px;border-radius:50%;object-fit:cover;border:1px solid var(--border); background:#fff"/>
      <div>
        <div style="font-weight:800;font-size:18px">${me.name || me.email || '—'}</div>
        <div class="muted" style="color:#334155">${me.email || ''}</div>
      </div>
    </div>
    <div style="white-space:pre-wrap; line-height:1.5">${(me.bio || '').replace(/</g, '&lt;')}</div>
    ${me.signature ? `
      <div>
        <div class="muted" style="color:#475569;margin-bottom:4px">Signature</div>
        <img src="${me.signature}" alt="signature" style="max-height:60px; background:#fff; border:1px solid var(--border); border-radius:8px; padding:6px">
      </div>` : ''}
  </div>`;
$('#mm-foot').innerHTML = `<button class="btn" id="mm-ok">Close</button>`;
openModal('m-modal');
$('#mm-ok').onclick = () => closeModal('m-modal');
});

    $('#main').addEventListener('click', safe(async (e) => {
  const b = e.target.closest?.('button[data-cert]'); if (!b) return;
  const courseId = b.getAttribute('data-cert');
  const course = state.courses.find(c => c.id === courseId) || {};
  const p = state.profiles.find(x => x.uid === auth.currentUser?.uid) || { name: auth.currentUser.email };
  const certId = 'LH-' + (courseId || 'xxxx').slice(0,6).toUpperCase() + '-' + (auth.currentUser.uid || 'user').slice(0,6).toUpperCase();
  renderCertificatePNG({
    name: p.name || p.email,
    courseTitle: course.title || courseId,
    dateText: new Date().toLocaleDateString(),
    certId,
    logoUrl: '/icons/learnhub-cap.svg'
  });
}));
  }

  // ---- Admin
  function wireAdmin() {
    $('#rm-save')?.addEventListener('click', async () => {
      const uid = $('#rm-uid')?.value.trim();
      const raw = $('#rm-role')?.value || 'student';
      const role = (raw + '').toLowerCase(); // normalize
      if (!uid) return notify('Enter UID + valid role', 'warn');
      await doc('roles', uid).set({
        uid, role,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      notify('Role saved');
    });

    $('#main')?.addEventListener('click', async (e) => {
      const ed = e.target.closest?.('button[data-admin-edit]'); const del = e.target.closest?.('button[data-admin-del]');
      if (ed) {
        const uid = ed.getAttribute('data-admin-edit'); const snap = await doc('profiles', uid).get(); if (!snap.exists) return;
        const p = { id: snap.id, ...snap.data() };
        $('#mm-title').textContent = 'Edit Profile (admin)';
        $('#mm-body').innerHTML = `<div class="grid">
          <input id="ap-name" class="input" value="${p.name || ''}"/>
          <input id="ap-portfolio" class="input" value="${p.portfolio || ''}"/>
          <textarea id="ap-bio" class="input">${p.bio || ''}</textarea>
        </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="ap-save">Save</button>`; openModal('m-modal');
        $('#ap-save').onclick = async () => {
          await doc('profiles', uid).set({ name: $('#ap-name')?.value.trim(), portfolio: $('#ap-portfolio')?.value.trim(), bio: $('#ap-bio')?.value.trim(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
          closeModal('m-modal'); notify('Saved');
        };
      }
      if (del) {
        const uid = del.getAttribute('data-admin-del');
        await doc('profiles', uid).delete();
        notify('Profile deleted');
      }
    });

    // ---- Roster tools
    $('#btn-roster-sync')?.addEventListener('click', async () => {
      const cid = $('#roster-course')?.value;
      if (!cid) return notify('Pick a course', 'warn');
      try {
        const [enrSnap, cSnap] = await Promise.all([
          col('enrollments').where('courseId', '==', cid).get(),
          doc('courses', cid).get()
        ]);
        const uids = new Set(enrSnap.docs.map(d => d.data().uid));
        const c = cSnap.data() || {};
        if (c.ownerUid) uids.add(c.ownerUid);
        await doc('courses', cid).set({ participants: Array.from(uids) }, { merge: true });
        notify('Roster synced');
        $('#roster-out').textContent = `Participants: ${Array.from(uids).join(', ')}`;
      } catch (e) {
        notify(e?.message || 'Sync failed', 'danger');
      }
    });

    $('#btn-roster-view')?.addEventListener('click', async () => {
      const cid = $('#roster-course')?.value;
      if (!cid) return notify('Pick a course', 'warn');
      const s = await doc('courses', cid).get();
      const arr = s.data()?.participants || [];
      $('#roster-out').textContent = `Participants: ${arr.join(', ') || '—'}`;
    });

    $('#preview-cert')?.addEventListener('click', () => {
  $('#mm-title').textContent = 'Certificate Preview';
  $('#mm-body').innerHTML = `<canvas id="cert-preview" width="2550" height="3300" style="width:min(100%,800px);height:auto;display:block;margin:auto;border:1px solid var(--border);border-radius:12px;background:#fff"></canvas>`;
  $('#mm-foot').innerHTML = `<button class="btn" id="mm-close-prev">Close</button>`;
  openModal('m-modal');
  $('#mm-close-prev').onclick = () => closeModal('m-modal');

  const ctx = document.getElementById('cert-preview').getContext('2d');
  drawCertificate(ctx, {
    name: 'Student Name',
    courseTitle: 'Sample Course for Design Approval',
    certId: 'LH-SAMPLE-000001',
    dateText: new Date().toLocaleDateString()
  });
});

$('#preview-transcript')?.addEventListener('click', () => {
  $('#mm-title').textContent = 'Transcript Preview';
  $('#mm-body').innerHTML = `
    <div style="background:#fff;border:1px solid var(--border);border-radius:12px;padding:12px;max-width:900px;margin:auto;color:#0b1220">
      <div style="text-align:center;font-weight:800;font-size:22px;margin-bottom:6px">LearnHub — Official Transcript</div>
      <div class="muted" style="text-align:center;margin-bottom:10px">This is a design preview.</div>
      <table class="table" style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr><th style="text-align:left;border-bottom:1px solid #e5eaf0;padding:6px 8px">Course</th>
              <th style="text-align:right;border-bottom:1px solid #e5eaf0;padding:6px 8px">Best Score</th>
              <th style="text-align:left;border-bottom:1px solid #e5eaf0;padding:6px 8px">Status</th></tr>
        </thead>
        <tbody>
          <tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">Foundations of Cloud</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f1f5f9">92%</td><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">Completed</td></tr>
          <tr><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">Data Analysis Basics</td><td style="text-align:right;padding:6px 8px;border-bottom:1px solid #f1f5f9">84%</td><td style="padding:6px 8px;border-bottom:1px solid #f1f5f9">Completed</td></tr>
          <tr><td style="padding:6px 8px">Intro to Web Development</td><td style="text-align:right;padding:6px 8px">—</td><td style="padding:6px 8px">In Progress</td></tr>
        </tbody>
      </table>
      <div style="display:flex;justify-content:space-between;margin-top:12px">
        <div>Printed on: ${new Date().toLocaleDateString()}</div>
        <div>Registrar • LearnHub</div>
      </div>
    </div>`;
  $('#mm-foot').innerHTML = `<button class="btn" id="mm-close-prev2">Close</button>`;
  openModal('m-modal');
  $('#mm-close-prev2').onclick = () => closeModal('m-modal');
});
  }

  // ---- Announcements (Dashboard)
  function wireAnnouncements() {
    if (!canManageUsers()) return;
    $('#add-ann')?.addEventListener('click', () => {
      $('#mm-title').textContent = 'Announcement';
      $('#mm-body').innerHTML = `<div class="grid">
        <input id="an-title" class="input" placeholder="Title"/>
        <textarea id="an-body" class="input" placeholder="Body"></textarea>
      </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="an-save">Save</button>`; openModal('m-modal');
      $('#an-save').onclick = async () => {
        await col('announcements').add({ title: $('#an-title')?.value.trim(), body: $('#an-body')?.value.trim(), createdAt: firebase.firestore.FieldValue.serverTimestamp(), uid: auth.currentUser.uid });
        closeModal('m-modal'); notify('Announcement posted');
      };
    });

    $('#ann-list')?.addEventListener('click', async (e) => {
      const ed = e.target.closest?.('button[data-edit-ann]'); const del = e.target.closest?.('button[data-del-ann]');
      if (ed) {
        const id = ed.getAttribute('data-edit-ann'); const s = await doc('announcements', id).get(); if (!s.exists) return;
        const a = { id: s.id, ...s.data() };
        $('#mm-title').textContent = 'Edit Announcement';
        $('#mm-body').innerHTML = `<div class="grid">
          <input id="an-title" class="input" value="${a.title || ''}"/>
          <textarea id="an-body" class="input">${a.body || ''}</textarea>
        </div>`;
        $('#mm-foot').innerHTML = `<button class="btn" id="an-save">Save</button>`; openModal('m-modal');
        $('#an-save').onclick = async () => { await doc('announcements', id).set({ title: $('#an-title')?.value.trim(), body: $('#an-body')?.value.trim(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }); closeModal('m-modal'); notify('Saved'); };
      }
      if (del) {
        const id = del.getAttribute('data-del-ann'); await doc('announcements', id).delete(); notify('Deleted');
      }
    });
  }

  // ---- Guide wiring (minor helpers)
  function wireGuide() {
    const root = document.querySelector('.guide');
    if (!root || root.__wired) return;
    root.__wired = true;

    // smooth-scroll for in-page anchors
    root.querySelectorAll('.nav a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const id = a.getAttribute('href').slice(1);
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // copy buttons for code samples
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.copy-btn');
      if (!btn) return;
      const targetId = btn.getAttribute('data-copy');
      const pre = targetId ? document.getElementById(targetId) : btn.closest('.code-card')?.querySelector('pre');
      const text = pre ? pre.innerText : '';
      if (!text) return;
      (navigator.clipboard?.writeText(text) || Promise.reject()).then(() => {
        const old = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = old || 'Copy', 1200);
        try { notify('Copied to clipboard'); } catch { }
      }).catch(() => { /* ignore */ });
    });
  }

  // drop-in: replace previous injector and keep onReady(injectCourseCardStyles)
// drop-in: replace previous injector and keep onReady(injectCourseCardStyles)
function injectCourseCardStyles() {
  const ID = 'lh-course-card-styles';
  if (document.getElementById(ID)) return;

  const css = `
  /* ============ 1) COURSES GRID: 3 / 2 / 1 columns ============ */
  [data-sec="courses"].grid{
    display:grid;
    grid-template-columns: repeat(3, minmax(0,1fr)) !important; /* desktop */
    gap:12px;
  }
  @media (max-width: 1024px){
    [data-sec="courses"].grid{ grid-template-columns: repeat(2, minmax(0,1fr)) !important; } /* tablet */
  }
  @media (max-width: 640px){
    [data-sec="courses"].grid{ grid-template-columns: 1fr !important; } /* mobile */
  }

  /* ============ 2) CARD LAYOUT (uniform height + bottom CTA) ============ */
  .card.course-card{
    display:flex; flex-direction:column;
    min-height:460px;
    border-radius:16px; overflow:hidden;
    transition:transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease;
    background: var(--card-bg, #fff); /* will be overridden by gradients below */
    box-shadow:0 6px 16px rgba(0,0,0,.08);
  }
  .card.course-card:hover{ transform: translateY(-2px); }

  /* ============ 3) IMAGE: show entire image (no cropping) ============ */
  .course-card .img{ width:100%; height:200px; background:#f0f2f5; display:flex; align-items:center; justify-content:center; }
  @media (max-width:720px){ .course-card .img{ height:170px; } }
  .course-card .img img{ width:100%; height:100%; object-fit:contain; filter: var(--card-img-filter, none); display:block; }

  /* ============ 4) CONTENT AREA (readable text + bottom meta) ============ */
  .course-card .card-body{
    display:flex; flex-direction:column; flex:1;
    padding:12px;
    color:#1f2937; /* slate-800 for readability on gradients */
    background: transparent;
    font-family: var(--card-font, inherit);
  }
  .course-card .header{ display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .course-card .title{ font-weight:800; font-size:16px; line-height:1.3; color:#111827; }
  .course-card .muted{ color:rgba(17,24,39,.7); }
  .course-card .short{ font-size:13px; color:rgba(17,24,39,.85); }
  .course-card .short.clamp{ display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .course-card .short-toggle{ margin-top:4px; background:none; border:0; color:var(--primary,#0ea5e9); cursor:pointer; font-size:12px; padding:0; }
  .course-card .benefits{ list-style:none; margin:10px 0 0 0; padding:0; display:grid; gap:6px; }
  .course-card .benefits li{ display:flex; gap:8px; align-items:flex-start; font-size:13px; color:#1f2937; }
  .course-card .benefits i{ font-size:16px; opacity:.85; margin-top:1px; }

  /* Badge stays readable on gradients */
  .course-card .badge{
    background: rgba(255,255,255,.6);
    color:#111827;
    border:1px solid rgba(0,0,0,.06);
    padding:3px 8px; border-radius:999px; font-size:12px;
  }

  /* Bottom row (price + CTA) pinned to bottom via margin-top:auto on meta */
  .course-card .meta{
    margin-top:auto;
    display:flex; justify-content:space-between; align-items:center; gap:8px; padding-top:8px;
  }
  .course-card .price{ font-weight:800; font-size:16px; color:#111827; }
  .course-card .cta.btn{ padding:8px 12px; border-radius:10px; background:#111827; color:#fff; }

  /* ============ 5) Varied shadows for depth (already present, kept/expanded) ============ */
  .grid[data-sec="courses"] > .card.course-card:nth-child(3n+1){ box-shadow: 0 6px 18px rgba(14,165,233,.18); }     /* soft blue */
  .grid[data-sec="courses"] > .card.course-card:nth-child(3n+2){ box-shadow: 0 8px 22px rgba(17,24,39,.16), 0 2px 6px rgba(0,0,0,.06); } /* layered gray */
  .grid[data-sec="courses"] > .card.course-card:nth-child(3n+3){ box-shadow: 0 6px 18px rgba(244,114,182,.18); }     /* warm pink */
  .grid[data-sec="courses"] > .card.course-card:nth-child(3n+1):hover{ box-shadow: 0 12px 30px rgba(14,165,233,.28); }
  .grid[data-sec="courses"] > .card.course-card:nth-child(3n+2):hover{ box-shadow: 0 14px 34px rgba(17,24,39,.22), 0 3px 10px rgba(0,0,0,.08); }
  .grid[data-sec="courses"] > .card.course-card:nth-child(3n+3):hover{ box-shadow: 0 12px 30px rgba(244,114,182,.28); }

  /* ============ 6) Subtle two-tone gradients (Option A: CSS-only) ============ */
  /* We assign a gradient to --card-bg per position; cards with explicit inline --card-bg keep their own style. */
  [data-sec="courses"] > .card.course-card:nth-child(6n+1){ --card-bg: linear-gradient(135deg,#a1c4fd,#c2e9fb); } /* sky */
  [data-sec="courses"] > .card.course-card:nth-child(6n+2){ --card-bg: linear-gradient(135deg,#d4fc79,#96e6a1); } /* mint */
  [data-sec="courses"] > .card.course-card:nth-child(6n+3){ --card-bg: linear-gradient(135deg,#ffecd2,#fcb69f); } /* peach */
  [data-sec="courses"] > .card.course-card:nth-child(6n+4){ --card-bg: linear-gradient(135deg,#fbc2eb,#a6c1ee); } /* lavender */
  [data-sec="courses"] > .card.course-card:nth-child(6n+5){ --card-bg: linear-gradient(135deg,#e0c3fc,#8ec5fc); } /* lilac-blue */
  [data-sec="courses"] > .card.course-card:nth-child(6n+6){ --card-bg: linear-gradient(135deg,#fdfbfb,#ebedee); } /* soft gray */

  /* In case a theme class sets text, keep it dark for readability on all gradients */
  .card.course-card, .card.course-card *{ color: inherit; }
  `;

  const style = document.createElement('style');
  style.id = ID;
  style.textContent = css;
  document.head.appendChild(style);
}

// Add after your previous injectCourseCardStyles()
function enforceReadableCardText() {
  const ID = 'lh-course-card-text-fix';
  const css = `
  /* Root text color for all course cards (strong, readable on light gradients) */
  .card.course-card{ color:#0b1220 !important; }

  /* Make sure typical content is dark and legible */
  .card.course-card .card-body,
  .card.course-card .title,
  .card.course-card .short,
  .card.course-card .muted,
  .card.course-card .benefits li,
  .card.course-card .price,
  .card.course-card .badge{
    color:#0b1220 !important;
  }

  /* Subtle secondary (muted) tone */
  .card.course-card .muted{
    color:rgba(11,18,32,.65) !important;
  }

  /* Paragraph/summary tone a touch stronger than muted */
  .card.course-card .short{
    color:rgba(11,18,32,.90) !important;
  }

  /* Badge stays readable on gradients */
  .card.course-card .badge{
    background:rgba(255,255,255,.70);
    border:1px solid rgba(0,0,0,.06);
  }

  /* Links / ghost buttons inside the card read as dark by default */
  .card.course-card a,
  .card.course-card .btn.ghost{
    color:#0b1220 !important;
  }

  /* CTA on dark button: keep white text for contrast on the dark background */
  .card.course-card .cta.btn{
    background:#0b1220 !important;
    color:#ffffff !important;
  }
  `;

  const el = document.getElementById(ID) || Object.assign(document.createElement('style'), { id: ID });
  el.textContent = css;
  if (!el.parentNode) document.head.appendChild(el);
}

// Courses + My Learning: parity & readability
(function applyCourseAndLearningCardParity(){
  const ID = 'lh-cards-courses-learning-parity';
  const css = `
  /* 3 / 2 / 1 responsive grid, only when a grid actually contains course cards */
  .grid.cols-2:has(.card.course-card){
    display:grid;
    grid-template-columns:repeat(3,minmax(0,1fr));
    gap:12px;
  }
  @media (max-width: 1100px){
    .grid.cols-2:has(.card.course-card){ grid-template-columns:repeat(2,minmax(0,1fr)); }
  }
  @media (max-width: 680px){
    .grid.cols-2:has(.card.course-card){ grid-template-columns:1fr; }
  }

  /* Card base (applies to both pages) */
  .card.course-card{
    display:flex; flex-direction:column;
    min-height:460px; border-radius:12px; overflow:hidden;
  }

  /* Prevent thumbnail cropping (contain + letterbox bg) */
  .card.course-card .img{
    width:100%; height:200px;
    background:#f0f2f5; /* subtle letterbox */
    display:flex; align-items:center; justify-content:center;
  }
  .card.course-card .img img{
    width:100%; height:100%; object-fit:contain;
  }

  /* Push the last row (CTA/controls) to the bottom uniformly */
  .card.course-card .card-body{ display:flex; flex-direction:column; flex:1 1 auto; }
  .card.course-card .card-body > :last-child{ margin-top:auto !important; }

  /* Gradient variety (automatic, cohesive, light backgrounds) */
  .card.course-card:nth-child(6n+1){ background-image:linear-gradient(135deg,#eef2ff,#e0f2fe); }
  .card.course-card:nth-child(6n+2){ background-image:linear-gradient(135deg,#fff7ed,#fef3c7); }
  .card.course-card:nth-child(6n+3){ background-image:linear-gradient(135deg,#fdf2f8,#e9d5ff); }
  .card.course-card:nth-child(6n+4){ background-image:linear-gradient(135deg,#ecfeff,#f0fdf4); }
  .card.course-card:nth-child(6n+5){ background-image:linear-gradient(135deg,#faf5ff,#eef2ff); }
  .card.course-card:nth-child(6n+6){ background-image:linear-gradient(135deg,#fffbeb,#fef2f2); }

  /* High-contrast, dark text for readability on all gradients */
  .card.course-card,
  .card.course-card .card-body,
  .card.course-card .short,
  .card.course-card .muted,
  .card.course-card .badge{
    color:#0b1220 !important;
  }
  .card.course-card .muted{ color:rgba(11,18,32,.65) !important; }
  .card.course-card .short{ color:rgba(11,18,32,.90) !important; }

  /* Keep badges readable on gradients */
  .card.course-card .badge{
    background:rgba(255,255,255,.70);
    border:1px solid rgba(0,0,0,.06);
  }

  /* Optional: stronger CTA contrast if you use a dark primary button */
  .card.course-card .btn.primary,
  .card.course-card .btn.ok{
    color:#ffffff !important;
  }
  `;

  let el = document.getElementById(ID);
  if (!el) { el = document.createElement('style'); el.id = ID; document.head.appendChild(el); }
  el.textContent = css;
})();

// Fix: solid, readable course detail modal (no transparency) + non-cropping cover
// Fix: solid, readable course detail modal (no transparency) + non-cropping cover
(function fixCourseDetailReadability(){
  const ID = 'lh-course-detail-solid';
  if (document.getElementById(ID)) return;
  const css = `
  .modal { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 100; }
  .modal.active { display: flex; }
  .modal .dialog{
    width: min(1400px, 98vw);
    max-height: 96vh;
    display: flex;
    flex-direction: column;
    background: var(--panel, #ffffff) !important;
    border: 1px solid var(--border, #e5eaf0);
    border-radius: 14px;
    box-shadow: 0 24px 60px rgba(0,0,0,.25);
    overflow: hidden;
  }
  .modal .head, .modal .foot{
    position: sticky;
    left: 0; right: 0;
    z-index: 2;
    background: linear-gradient(180deg, rgba(255,255,255,.06), transparent 60%), var(--panel);
  }
  .modal .body{
    flex: 1 1 auto;
    overflow: auto;
    background: var(--panel, #ffffff);
  }
  /* Thumb in detail view must never crop */
  .course-cover-thumb{
    width: 100%;
    height: clamp(220px, 30vh, 320px);
    object-fit: contain !important;
    background: rgba(255,255,255,.05);
    border: 1px solid var(--border);
    border-radius: 12px;
  }`;
  const el = document.createElement('style');
  el.id = ID; el.textContent = css;
  document.head.appendChild(el);
})();

  // ---- Transcript
  function buildTranscript(uid) {
    const byCourse = {};
    (state.attempts || []).filter(a => a.uid === uid).forEach(a => {
      byCourse[a.courseId] = byCourse[a.courseId] || { courseId: a.courseId, courseTitle: (state.courses.find(c => c.id === a.courseId) || {}).title || a.courseId, best: 0, completed: false };
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score || 0);
      const q = state.quizzes.find(q => q.courseId === a.courseId && q.isFinal);
      byCourse[a.courseId].completed = q ? (byCourse[a.courseId].best >= (q.passScore || 70)) : false;
    });
    return Object.values(byCourse).sort((a, b) => a.courseTitle.localeCompare(b.courseTitle));
  }

  // ---- Firestore sync
  function clearUnsubs() { state.unsub.forEach(u => { try { u() } catch { } }); state.unsub = []; }
  function sync() {
    clearUnsubs();
    const uid = auth.currentUser.uid;

    state.unsub.push(
      col('profiles').onSnapshot(
        s => {
          state.profiles = s.docs.map(d => ({ id: d.id, ...d.data() }));
          if (state.route === 'chat') populateDmUserSelect();
          if (['profile', 'admin', 'chat'].includes(state.route)) render();
        },
        err => console.warn('profiles listener error:', err)
      )
    );

    state.unsub.push(
      col('enrollments').where('uid', '==', uid).onSnapshot(s => {
        state.enrollments = s.docs.map(d => ({ id: d.id, ...d.data() }));
        state.myEnrolledIds = new Set(state.enrollments.map(e => e.courseId));
        if (['dashboard', 'learning', 'assessments', 'chat'].includes(state.route)) render();
      })
    );

    state.unsub.push(
      col('courses').orderBy('createdAt', 'desc').onSnapshot(
        s => {
          state.courses = s.docs.map(d => ({ id: d.id, ...d.data() }));
          if (state.route === 'chat') populateDmUserSelect();
          if (['dashboard', 'courses', 'learning', 'assessments', 'chat'].includes(state.route)) render();
        },
        err => console.warn('courses listener error:', err)
      )
    );

    state.unsub.push(
      col('quizzes').orderBy('createdAt', 'desc').onSnapshot(
        s => { state.quizzes = s.docs.map(d => ({ id: d.id, ...d.data() })); if (['assessments', 'dashboard', 'profile'].includes(state.route)) render(); },
        err => console.warn('quizzes listener error:', err)
      )
    );

    state.unsub.push(
      col('attempts').where('uid', '==', uid).onSnapshot(
        s => {
          state.attempts = s.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          if (['assessments', 'profile', 'dashboard'].includes(state.route)) render();
        },
        err => console.warn('attempts listener error:', err)
      )
    );

    state.unsub.push(
      col('tasks').where('uid', '==', uid).onSnapshot(
        s => { state.tasks = s.docs.map(d => ({ id: d.id, ...d.data() })); if (['tasks', 'dashboard'].includes(state.route)) render(); },
        err => console.warn('tasks listener error:', err)
      )
    );

    state.unsub.push(
      col('announcements').orderBy('createdAt', 'desc').limit(25).onSnapshot(s => {
        state.announcements = s.docs.map(d => ({ id: d.id, ...d.data() })); if (['dashboard'].includes(state.route)) render();
      })
    );
  }

  async function resolveRole(uid) {
    try {
      const r = await doc('roles', uid).get(); const role = (r.data()?.role || 'student').toLowerCase();
      return VALID_ROLES.includes(role) ? role : 'student';
    } catch { return 'student'; }
  }

  /* === Card → Detail Theme Bridge + Adaptive Text (Courses & My Learning) === */
(function cardToDetailThemePatch(){
  const STYLE_ID = 'lh-card-theme-bridge';
  const GRAD_CLASSES = ['bg-grad-1','bg-grad-2','bg-grad-3','bg-grad-4','bg-grad-5','bg-grad-6'];

  // Map each gradient to the preferred text theme for accessibility.
  // (All below gradients are light → dark text; if you add darker gradients, map them to 'light'.)
  const TEXT_THEME = {
    'bg-grad-1':'dark', 'bg-grad-2':'dark', 'bg-grad-3':'dark',
    'bg-grad-4':'dark', 'bg-grad-5':'dark', 'bg-grad-6':'dark'
  };

  // Inject styles (gradients, text themes, modal readability, hide thumbnail column)
  (function injectCSS(){
    const css = `
    /* Pastel / soft two-tone gradients (cohesive + readable) */
    .bg-grad-1{ background-image: linear-gradient(135deg,#d4fc79,#96e6a1) !important; }
    .bg-grad-2{ background-image: linear-gradient(135deg,#a1c4fd,#c2e9fb) !important; }
    .bg-grad-3{ background-image: linear-gradient(135deg,#fbc2eb,#a6c1ee) !important; }
    .bg-grad-4{ background-image: linear-gradient(135deg,#ffecd2,#fcb69f) !important; }
    .bg-grad-5{ background-image: linear-gradient(135deg,#f6d365,#fda085) !important; }
    .bg-grad-6{ background-image: linear-gradient(135deg,#e0c3fc,#8ec5fc) !important; }

    /* Make gradients show on cards even if a default card background exists */
    .card.course-card{ background-color: transparent !important; }

    /* Readable text themes (used for both cards and modal content) */
    .theme-text-dark, .theme-text-dark :where(h1,h2,h3,h4,h5,h6,p,div,span,li,td,th,small,strong,em,label,button){
      color:#0b1220 !important;
    }
    .theme-text-dark .muted{ color: rgba(11,18,32,.66) !important; }
    .theme-text-light, .theme-text-light :where(h1,h2,h3,h4,h5,h6,p,div,span,li,td,th,small,strong,em,label,button){
      color:#ffffff !important;
    }
    .theme-text-light .muted{ color: rgba(255,255,255,.85) !important; }

    /* Solid, non-transparent modal with inherited gradient */
    #m-modal.active .dialog{
      background-color: #fff;            /* fallback if no gradient class is set */
      background-image: none;
      box-shadow: 0 24px 60px rgba(0,0,0,.25);
      backdrop-filter: none !important;
    }
    /* When a gradient class is applied to the dialog, use it as the background */
    #m-modal.active .dialog.bg-grad-1,
    #m-modal.active .dialog.bg-grad-2,
    #m-modal.active .dialog.bg-grad-3,
    #m-modal.active .dialog.bg-grad-4,
    #m-modal.active .dialog.bg-grad-5,
    #m-modal.active .dialog.bg-grad-6{
      background-color: transparent;
      background-repeat: no-repeat;
      background-size: cover;
    }

    /* Hide the left thumbnail column inside the detail view and give content full width */
    #mm-body .course-full{ grid-template-columns: 1fr !important; }
    #mm-body .course-full > div:first-child{ display:none !important; }

    /* Keep inner sections (Outline / Lesson Quizzes / PayPal) on solid panels for highest legibility */
    #mm-body .section-box{
      background: rgba(255,255,255,.92) !important;
      border:1px solid var(--border, rgba(0,0,0,.08));
      border-radius:12px;
      padding:12px;
    }
    #paypal-zone{
      background: rgba(255,255,255,.92) !important;
      border:1px solid var(--border, rgba(0,0,0,.08));
      border-radius:12px;
      padding:10px;
    }

    /* Ensure card text stays readable on gradients as well */
    .course-card.theme-text-dark .short,
    .course-card.theme-text-light .short{ opacity:.95; }
    `;
    let s = document.getElementById(STYLE_ID);
    if (!s){ s = document.createElement('style'); s.id = STYLE_ID; document.head.appendChild(s); }
    s.textContent = css;
  })();

  // Deterministic assignment: same course id → same gradient every render.
  function hashId(id=''){
    let h = 0;
    for (let i=0;i<id.length;i++){ h = ((h<<5)-h) + id.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  function pickGradient(id){ return GRAD_CLASSES[ hashId(id) % GRAD_CLASSES.length ]; }

  function applyCardSkins(){
    document.querySelectorAll('.course-card').forEach(card => {
      // Try to get a stable id (prefers element id; else look for embedded buttons carrying ids)
      const id = card.getAttribute('id')
        || card.querySelector('[data-open]')?.getAttribute('data-open')
        || card.querySelector('[data-open-course]')?.getAttribute('data-open-course')
        || '';
      if (!id) return;

      // remove old classes, then add the new gradient and text theme
      GRAD_CLASSES.forEach(c => card.classList.remove(c));
      card.classList.remove('theme-text-dark','theme-text-light');

      const g = pickGradient(id);
      card.classList.add(g);
      const theme = TEXT_THEME[g] || 'dark';
      card.classList.add(theme === 'light' ? 'theme-text-light' : 'theme-text-dark');
    });
  }

  // Capture which card theme was clicked, then apply it when the modal is shown.
  let nextThemeClass = null;

  // Listen for clicks on "Details" (Courses) and "Open" (My Learning)
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('button[data-open], button[data-open-course]');
    if (!trigger) return;
    const card = trigger.closest('.course-card');
    if (!card) return;

    // Find the gradient class on the card
    const g = Array.from(card.classList).find(c => c.startsWith('bg-grad-'));
    nextThemeClass = g || null;
  }, true);

  function clearModalTheme(dialog){
    if (!dialog) return;
    GRAD_CLASSES.forEach(c => dialog.classList.remove(c));
    dialog.classList.remove('theme-text-dark','theme-text-light');
  }
  function applyModalTheme(){
    const modal = document.getElementById('m-modal');
    if (!modal || !modal.classList.contains('active')) return;
    const dialog = modal.querySelector('.dialog'); if (!dialog) return;

    clearModalTheme(dialog);

    const g = nextThemeClass;
    if (!g){ return; }

    dialog.classList.add(g);
    const theme = TEXT_THEME[g] || 'dark';
    dialog.classList.add(theme === 'light' ? 'theme-text-light' : 'theme-text-dark');
  }

  // Re-apply skins after every render and watch modal open/close to set theme
  function postRenderEnhancements(){
    try { applyCardSkins(); } catch {}
    try {
      const modal = document.getElementById('m-modal');
      if (!modal) return;
      // Observe class changes to know when modal opens/closes
      if (modal.__themeObs) return; // only once per modal instance
      const obs = new MutationObserver((muts) => {
        for (const m of muts){
          if (m.attributeName === 'class'){
            if (modal.classList.contains('active')) applyModalTheme();
            else { clearModalTheme(modal.querySelector('.dialog')); nextThemeClass = null; }
          }
        }
      });
      obs.observe(modal, { attributes:true });
      modal.__themeObs = obs;
    } catch {}
  }

  // Wrap the existing render() so our enhancements run every time the UI re-renders.
  const __origRender = render;
  render = function(){
    __origRender.apply(this, arguments);
    postRenderEnhancements();
  };

  // Also run once now (in case we're already rendered)
  try { postRenderEnhancements(); } catch {}
})();

/* === In-page Course Detail (Full-screen Overlay) + Hover Sidebar (Desktop/Tablet) === */
(function overlayAndSidebarPatch(){
  const STYLE_ID = 'lh-overlay-and-sidebar';
  const css = `
  :root{
    --sb-collapsed: 76px;
    --sb-expanded: 256px;
  }

  /* ---------------------- FULL-SCREEN COURSE DETAIL OVERLAY ---------------------- */
  /* Toggle by adding .sheet-mode on #m-modal (done by JS below when opening a course) */
  #m-modal.sheet-mode .dialog{
    position: fixed;
    inset: 0;                  /* full screen */
    max-width: none;
    width: 100vw;
    height: 100vh;
    border-radius: 0;
    padding: 16px clamp(12px, 3vw, 28px);
    transform: translateY(18px);
    opacity: 0;
    transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .28s ease;
    overflow: auto;
  }
  #m-modal.active.sheet-mode .dialog{
    transform: translateY(0);
    opacity: 1;
  }
  /* Sticky header with a clear Back control */
  #m-modal.sheet-mode .head{
    position: sticky; top: 0; z-index: 2;
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 0 12px 0;
    background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(255,255,255,.86));
    border-bottom: 1px solid var(--border, rgba(0,0,0,.08));
    backdrop-filter: blur(6px);
  }
  #m-modal.sheet-mode .head #mm-close{
    display: inline-flex; gap: 6px; align-items: center;
  }
  /* Detail body panels remain readable on any background */
  #m-modal.sheet-mode #mm-body .section-box{
    background: rgba(255,255,255,.96) !important;
    border: 1px solid var(--border, rgba(0,0,0,.08));
    border-radius: 12px; padding: 12px;
  }
  #m-modal.sheet-mode #paypal-zone{
    background: rgba(255,255,255,.96) !important;
    border: 1px solid var(--border, rgba(0,0,0,.08));
    border-radius: 12px; padding: 10px;
  }
  /* Hide the thumbnail column on the detail page and use full width for info */
  #m-modal.sheet-mode #mm-body .course-full{ grid-template-columns: 1fr !important; }
  #m-modal.sheet-mode #mm-body .course-full > div:first-child{ display:none !important; }

  /* ---------------------- DESKTOP/TABLET HOVER SIDEBAR ---------------------- */
  @media (min-width: 768px){
    .app .sidebar{
      position: fixed; left: 0; top: 0; bottom: 0;
      width: var(--sb-collapsed);
      z-index: 1000;                     /* overlays content on expand */
      transition: width .25s ease;
      will-change: width;
    }
    /* Keep main content margin fixed to collapsed width → no content shift */
    .app > div{ margin-left: var(--sb-collapsed); }

    /* Expand on hover (icons → labels reveal) */
    .app .sidebar:hover{ width: var(--sb-expanded); }
    .app .sidebar .title,
    .app .sidebar .nav .item span{
      opacity: 0; pointer-events: none;
      transition: opacity .18s ease;
      white-space: nowrap;
    }
    .app .sidebar:hover .title,
    .app .sidebar:hover .nav .item span{
      opacity: 1; pointer-events: auto;
    }
    .app .sidebar .nav .item{
      padding: 10px 12px;
      transition: background-color .15s ease, transform .15s ease;
    }
    .app .sidebar .nav .item:hover{
      background: rgba(0,0,0,.05);
      transform: translateX(2px);
    }
    /* Ensure the backdrop used for mobile doesn't interfere on desktop */
    #backdrop{ display: none !important; }
  }

  /* Mobile stays as-is (hamburger / drawer) — no hover behavior applied */
  `;

  // inject CSS once
  (function injectCSS(){
    let s = document.getElementById(STYLE_ID);
    if (!s){ s = document.createElement('style'); s.id = STYLE_ID; document.head.appendChild(s); }
    s.textContent = css;
  })();

  /* ---------------------- JS: open course detail as in-page overlay ---------------------- */
  // We tag the next modal open as a "course detail" when the user clicks a course card action.
  let nextIsCourseDetail = false;
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('button[data-open], button[data-open-course]');
    if (!trigger) return;
    nextIsCourseDetail = true;
  }, true);

  function onModalOpenIfCourse(){
    const modal = document.getElementById('m-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (nextIsCourseDetail){
      modal.classList.add('sheet-mode');        // make it full-screen overlay
      // Make the close button read “Back”
      const closeBtn = document.getElementById('mm-close');
      if (closeBtn) closeBtn.innerHTML = '<i class="ri-arrow-left-line"></i> Back';
    }
    nextIsCourseDetail = false;
  }

  // Observe #m-modal to toggle sheet-mode cleanly on open/close.
  function attachModalObserver(){
    const modal = document.getElementById('m-modal');
    if (!modal || modal.__overlayObserver) return;
    const obs = new MutationObserver(() => {
      if (modal.classList.contains('active')) onModalOpenIfCourse();
      else modal.classList.remove('sheet-mode');
    });
    obs.observe(modal, { attributes:true, attributeFilter:['class'] });
    modal.__overlayObserver = obs;
  }

  // Run after every render
  const __render = render;
  render = function(){
    __render.apply(this, arguments);
    attachModalObserver();
  };
  // And attempt immediately (in case we’re already on an app view)
  attachModalObserver();
})();
  
  // ---- Auth
auth.onAuthStateChanged(async (user) => {
  state.user = user || null;
  if (!user) {
    clearUnsubs();
    if (state._unsubChat) { try { state._unsubChat(); } catch {} state._unsubChat = null; }
    onReady(render);
    return;
  }

  // Resolve once, then keep it live
  state.role = await resolveRole(user.uid);
  listenToMyRole(user.uid); // <— NEW: live updates for Admin menu

  try {
    const p = await doc('profiles', user.uid).get();
    if (!p.exists) {
      await doc('profiles', user.uid).set({
        uid: user.uid, email: user.email, name: '', bio: '', portfolio: '',
        role: state.role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      await doc('profiles', user.uid).set({ role: state.role }, { merge: true });
    }
  } catch {}

  onReady(applyTheme);
  sync();
  onReady(render);
});

/* === Sidebar layout fix: content should fill remaining width === */
(function sidebarLayoutFix(){
  const ID = 'lh-sidebar-layout-fix';
  const css = `
  :root{
    --sb-collapsed: 76px; /* keep in sync with your sidebar */
  }

  /* Desktop / tablet: content is offset by collapsed width and fills remainder */
  @media (min-width: 768px){
    .app{ position: relative; }

    /* This is the wrapper that contains topbar + hero + main (second child of .app) */
    .app > div{
      box-sizing: border-box;
      margin-left: var(--sb-collapsed) !important;              /* push past fixed sidebar */
      width: calc(100% - var(--sb-collapsed)) !important;       /* fill remaining width */
      min-width: 0;                                             /* prevent accidental shrink */
    }

    /* Ensure inner sections fully span the wrapper width */
    .app .topbar,
    .app .page-hero,
    .app .main{
      width: 100%;
      max-width: none;
    }
  }

  /* Mobile: sidebar is drawer; content should start at 0 and use full width */
  @media (max-width: 767.98px){
    .app > div{
      margin-left: 0 !important;
      width: 100% !important;
    }
  }
  `;
  let s = document.getElementById(ID);
  if (!s){ s = document.createElement('style'); s.id = ID; document.head.appendChild(s); }
  s.textContent = css;
})();

  // ---- Boot
  onReady(render);
  onReady(injectCourseCardStyles);
  onReady(enforceReadableCardText);

  // ---- Seed demo courses (optional) ----
  window.seedDemoCourses = async function () {
    const u = auth.currentUser; if (!u) return alert('Sign in first');
    const list = [
      {
        title: 'Advanced Digital Marketing', category: 'Marketing', credits: 4, price: 250,
        short: 'Master SEO, social media, content strategy.',
        goals: ['Get certified', 'Hands-on project', 'Career guidance'],
        coverImage: 'https://images.unsplash.com/photo-1554774853-b415df9eeb92?w=1200&q=80',
        style: { cardClass: 'theme-gold' }
      },
      {
        title: 'Modern Web Bootcamp',
        category: 'CS', credits: 5, price: 0,
        short: 'HTML, CSS, JS, and tooling.',
        goals: ['Responsive sites', 'Deploy to Hosting', 'APIs basics'],
        coverImage: 'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&q=80',
        style: {
          bg: 'linear-gradient(135deg,#0ea5e9,#22c55e)',
          text: '#0b1220',
          badgeBg: 'rgba(255,255,255,.4)',
          badgeText: '#0b1220',
          imgFilter: 'saturate(1.05)'
        }
      },
      {
        title: 'Data Visualization Basics',
        category: 'Analytics', credits: 3, price: 99,
        short: 'Tell stories with charts and dashboards.',
        goals: ['Chart literacy', 'D3/Chart.js basics', 'Dashboard thinking'],
        coverImage: 'https://images.unsplash.com/photo-1551281044-8d8d0fdc864b?w=1200&q=80'
      }
    ];
    for (const c of list) {
      await col('courses').add({ ...c, ownerUid: u.uid, ownerEmail: u.email, participants: [u.uid], createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
    alert('Demo courses added');
  };
}})();