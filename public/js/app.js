/* LearnHub — E-Learning (Refactored for Modern UI/UX) */
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
  try { firebase.firestore.setLogLevel('debug'); } catch {}

  // ---- EmailJS (Contact page) ----
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
    user: null, role: 'student', route: 'dashboard',
    theme: { palette: localStorage.getItem('lh.palette') || 'sunrise', font: localStorage.getItem('lh.font') || 'medium' },
    searchQ: '', highlightId: null, courses: [], enrollments: [], quizzes: [],
    attempts: [], messages: [], tasks: [], profiles: [], notes: [], announcements: [],
    myEnrolledIds: new Set(), unsub: [], _unsubChat: null
  };

  // ---- Utils ----
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const notify = (msg, type = 'ok') => {
    const n = $('#notification'); if (!n) return;
    n.textContent = msg; n.className = `notification show ${type}`;
    setTimeout(() => n.className = 'notification', 2200);
  };
  const nowYear = () => new Date().getFullYear();
  const col = (name) => db.collection(name);
  const doc = (name, id) => db.collection(name).doc(id);
  const canTeach = () => ['instructor', 'admin'].includes(state.role);
  const canManageUsers = () => state.role === 'admin';
  const isEnrolled = (courseId) => state.myEnrolledIds.has(courseId);
  const money = x => (x === 0 ? 'Free' : `$${Number(x).toFixed(2)}`);
  const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined && !(typeof v === 'number' && Number.isNaN(v))));

  // ---- Constants ----
  const VALID_ROLES = ['student', 'instructor', 'admin'];
  const normalizeRole = (x) => (x || 'student').toString().trim().toLowerCase();

  // ---- Dynamic Card Styling Helpers ----
  const GRAD_CLASSES = ['bg-grad-1','bg-grad-2','bg-grad-3','bg-grad-4','bg-grad-5','bg-grad-6'];
  function hashId(id=''){
    let h = 0;
    for (let i=0; i < id.length; i++){ h = ((h << 5) - h) + id.charCodeAt(i); h |= 0; }
    return Math.abs(h);
  }
  function pickGradientClass(id){ return GRAD_CLASSES[ hashId(id) % GRAD_CLASSES.length ]; }


  // ---- JSON fetcher & renderers ----
  async function fetchJSON(url) { /* (No changes) */ }
  function renderOutlineBox(data) { /* (No changes) */ }
  function renderLessonQuizzesBox(data) { /* (No changes) */ }

  // ---- PayPal setup ----
  async function setupPayPalForCourse(c) { /* (No changes) */ }

  // ---- Theme palettes ----
  const THEME_PALETTES = [
    'sunrise', 'light', 'dark', 'ocean', 'forest', 'grape', 'lavender', 'sunset', 'sand', 'mono', 'midnight'
  ];

  // ---- Chat helpers ----
  function profileKey(p) { return p.uid || p.id; }
  function getCourseRecipients(cid) { /* (No changes) */ }
  function populateDmUserSelect() { /* (No changes) */ }

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
  function heroForRoute(route) { /* (No changes) */ }
  function listenToMyRole(uid) { /* (No changes) */ }

  // ---- Modal + Sidebar helpers ----
  function openModal(id) { $('#' + id)?.classList.add('active'); }
  function closeModal(id) { $('#' + id)?.classList.remove('active'); }
  const closeSidebar = () => { document.body.classList.remove('sidebar-open'); };

  // ---- Router / Layout ----
  const routes = ['dashboard', 'courses', 'learning', 'assessments', 'chat', 'tasks', 'profile', 'admin', 'guide', 'settings', 'search', 'contact'];
  function go(route) {
    const prev = state.route;
    state.route = routes.includes(route) ? route : 'dashboard';
    if (prev === 'chat' && state._unsubChat) { try { state._unsubChat(); } catch { } state._unsubChat = null; }
    closeSidebar();
    render();
  }

  function layout(content) {
    const hero = heroForRoute(state.route);
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
      <div id="backdrop"></div>

      <div class="main-wrapper">
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
        
        <div class="page-hero ${hero.klass}">
          <i class="${hero.icon}"></i>
          <div>
            <div class="t">${hero.title}</div>
            <div class="s">${hero.sub}</div>
          </div>
        </div>

        <div class="main" id="main">${content}</div>
      </div>
    </div>

    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop"></div>`;
  }

  // ---- Views ----
  const vLogin = () => `<!-- (No changes to vLogin) -->`;
  const dashCard = (label, value, route, icon) => `<!-- (No changes to dashCard) -->`;
  function vDashboard() { /* (No changes) */ }

  // REFACTORED courseCard() function
  function courseCard(c) {
    const img = c.coverImage || '/icons/learnhub-cap.svg';
    const isLong = (c.short || '').length > 160;
    const gradClass = pickGradientClass(c.id);

    return `
    <div class="card course-card ${gradClass}" id="${c.id}" data-course-id="${c.id}">
      <div class="img"><img src="${img}" alt="${c.title || ''}"/></div>
      <div class="card-body">
        <div class="header">
          <div class="title">${c.title || ''}</div>
          <span class="badge">${c.category || 'General'}</span>
        </div>
        <div class="summary">
          <div class="short ${isLong ? 'clamp' : ''}">${(c.short || '').replace(/</g, '&lt;')}</div>
          ${isLong ? `<button class="short-toggle" data-short-toggle>Read more</button>` : ''}
        </div>
        <div class="meta">
          <div class="price">${money(c.price || 0)}</div>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn cta" data-open="${c.id}">
              ${c.price > 0 ? 'Buy Now' : 'View Course'}
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

  // REFACTORED vCourses() view
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
        <div class="courses-grid" data-sec="courses">
          ${state.courses.map(courseCard).join('')}
          ${!state.courses.length ? `<div class="muted" style="padding:10px">No courses yet.</div>` : ''}
        </div>
      </div></div>
    `;
  }

  function vLearning() { /* (No changes) */ }
  function vAssessments() { /* (No changes) */ }
  const vChat = () => `<!-- (No changes to vChat) -->`;
  function vContact() { /* (No changes) */ }
  function vTasks() { /* (No changes) */ }
  function vProfile() { /* (No changes) */ }
  function vGuide(){ /* (No changes) */ }
  function vAdmin() { /* (No changes) */ }
  function vSettings() { /* (No changes) */ }
  const vSearch = () => `<div class="card"><div class="card-body"><h3>Search</h3><div class="muted">Type in the top bar.</div></div></div>`;

  function safeView(r) {
    switch (r) {
      case 'dashboard': return vDashboard(); case 'courses': return vCourses(); case 'learning': return vLearning();
      case 'assessments': return vAssessments(); case 'chat': return vChat(); case 'tasks': return vTasks();
      case 'profile': return vProfile(); case 'admin': return vAdmin(); case 'guide': return vGuide();
      case 'settings': return vSettings(); case 'search': return vSearch(); case 'contact': return vContact();
      default: return vDashboard();
    }
  }

  // ---- Main Render Function (wrapped) ----
  let __originalRender = () => {
    if (!document.body) { onReady(__originalRender); return; }
    let root = document.getElementById('root');
    if (!root) { root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root); }
    if (!auth.currentUser) {
      root.innerHTML = vLogin(); wireLogin(); return;
    }
    root.innerHTML = layout(safeView(state.route));
    wireShell(); wireRoute();
    if (state.route === 'chat') populateDmUserSelect();
    if (state.highlightId) {
      const el = document.getElementById(state.highlightId);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      state.highlightId = null;
    }
  };

  // ---- Wiring ----
  function wireShell() {
    $('#burger')?.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#side-nav')?.addEventListener('click', e => { const it = e.target.closest?.('.item[data-route]'); if (it) { go(it.getAttribute('data-route')); } });
    $('#side-nav')?.addEventListener('keydown', e => { const it = e.target.closest?.('.item[data-route]'); if (!it) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(it.getAttribute('data-route')); } });
    $('#main')?.addEventListener('click', (e) => { const goEl = e.target.closest?.('[data-go]'); if (goEl) { go(goEl.getAttribute('data-go')); return; } closeSidebar(); });
    $('#btnLogout')?.addEventListener('click', () => auth.signOut());
    
    const input = $('#globalSearch'), results = $('#searchResults');
    if (input && results) { /* (No changes to search logic) */ }
    
    $('#theme-palette')?.addEventListener('change', (e) => { state.theme.palette = e.target.value; localStorage.setItem('lh.palette', state.theme.palette); applyTheme(); });
    $('#theme-font')?.addEventListener('change', (e) => { state.theme.font = e.target.value; localStorage.setItem('lh.font', state.theme.font); applyTheme(); });
    $('#mm-close')?.addEventListener('click', () => closeModal('m-modal'));
  }

  function wireRoute() {
    switch (state.route) {
      case 'courses': wireCourses(); break; case 'learning': wireLearning(); break; case 'assessments': wireAssessments(); break;
      case 'chat': wireChat(); break; case 'tasks': wireTasks(); break; case 'profile': wireProfile(); break;
      case 'admin': wireAdmin(); break; case 'guide': wireGuide(); break; case 'contact': wireContact(); break;
      case 'dashboard': wireAnnouncements(); break;
    }
  }
  
  // ---- Wiring for specific pages ----
  function wireLogin() { /* (No changes) */ }
  function wireCourses() { /* (No changes) */ }
  function wireLearning() { /* (No changes) */ }
  function wireAssessments() { /* (No changes) */ }
  function wireChat() { /* (No changes) */ }
  function wireContact() { /* (No changes) */ }
  function wireTasks() { /* (No changes) */ }
  function wireProfile() { /* (No changes) */ }
  function wireAdmin() { /* (No changes) */ }
  function wireAnnouncements() { /* (No changes) */ }
  function wireGuide() { /* (No changes) */ }

  // ---- NEW: Modern UI Interaction Logic ----
  function setupModernInteractions() {
    let nextModalConfig = { isCourseDetail: false, themeClass: null };
  
    document.body.addEventListener('click', (e) => {
      const trigger = e.target.closest('button[data-open], button[data-open-course]');
      if (!trigger) return;
      
      const card = trigger.closest('.course-card');
      const courseId = card?.dataset.courseId;
      
      if (courseId) {
        nextModalConfig = {
          isCourseDetail: true,
          themeClass: pickGradientClass(courseId)
        };
      }
    }, true);

    const modal = document.getElementById('m-modal');
    if (!modal || modal._modernObs) return;

    const observer = new MutationObserver(() => {
      const dialog = modal.querySelector('.dialog');
      if (!dialog) return;

      if (modal.classList.contains('active')) {
        if (nextModalConfig.isCourseDetail) {
          modal.classList.add('sheet-mode');
          dialog.classList.add(nextModalConfig.themeClass);
          dialog.classList.add('theme-text-dark');
          const closeBtn = $('#mm-close');
          if(closeBtn) closeBtn.innerHTML = `<i class="ri-arrow-left-line"></i> Back`;
        }
      } else {
        modal.classList.remove('sheet-mode');
        GRAD_CLASSES.forEach(c => dialog.classList.remove(c));
        dialog.classList.remove('theme-text-dark', 'theme-text-light');
        const closeBtn = $('#mm-close');
        if(closeBtn) closeBtn.innerHTML = `Close`;
        nextModalConfig = { isCourseDetail: false, themeClass: null };
      }
    });

    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    modal._modernObs = true;
  }

  // ---- Wrap original render function to apply new interactions ----
  const render = function() {
    __originalRender.apply(this, arguments);
    try {
      setupModernInteractions();
    } catch (e) {
      console.error("Failed to setup modern interactions:", e);
    }
  };

  // ---- Transcript Builder ----
  function buildTranscript(uid) { /* (No changes) */ }

  // ---- Firestore sync ----
  function clearUnsubs() { state.unsub.forEach(u => { try { u() } catch { } }); state.unsub = []; }
  function sync() { /* (No changes) */ }
  async function resolveRole(uid) { /* (No changes) */ }

  // ---- Auth State Change ----
  auth.onAuthStateChanged(async (user) => { /* (No changes) */ });

  // ---- Boot ----
  onReady(render);

  // ---- Seed demo courses (optional) ----
  window.seedDemoCourses = async function () { /* (No changes) */ };

})();