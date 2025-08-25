/* LearnHub — E-Learning (compact build, admin/instructor/student) */
(() => {
  'use strict';

  // ---- DOM ready helper ----
  function onReady(fn){
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
  const db   = firebase.firestore();
  const stg  = firebase.storage();
  try { firebase.firestore.setLogLevel('debug'); } catch {}

  // ---- Constants ----
  const VALID_ROLES = ['student','instructor','admin'];
  const THEME_PALETTES = ['sunrise','light','dark','ocean','forest','grape','lavender','sunset','sand','mono','midnight'];

  // ---- State ----
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette: localStorage.getItem('lh.palette') || 'sunrise', font: localStorage.getItem('lh.font') || 'medium' },
    searchQ:'', highlightId:null,
    courses:[], enrollments:[], quizzes:[], attempts:[], messages:[], tasks:[], profiles:[], notes:[], announcements:[],
    progress:[],
    myEnrolledIds:new Set(), unsub:[], _unsubChat:null
  };

  // ---- Utils ----
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const notify=(msg,type='ok')=>{ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200); };
  const nowYear=()=> new Date().getFullYear();
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);
  const canTeach = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const isEnrolled = (courseId)=> state.myEnrolledIds.has(courseId);
  const money = x => (x===0 ? 'Free' : `$${Number(x).toFixed(2)}`);

  // ---- JSON fetcher ----
  async function fetchJSON(url){ const r = await fetch(url, { cache: 'no-store' }); if(!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }

  // ---- Progress helpers ----
  const slug = s => (s||'').toString().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
  function lessonId(chIdx, chTitle, lIdx, lTitle){
    return `${String(chIdx+1).padStart(2,'0')}-${slug(chTitle||`chapter-${chIdx+1}`)}__${String(lIdx+1).padStart(2,'0')}-${slug(lTitle||`lesson-${lIdx+1}`)}`;
  }
  function countLessons(outline){
    let n=0; (outline?.chapters||[]).forEach(ch=>{ n += Array.isArray(ch.lessons) ? ch.lessons.length : 0; });
    return n;
  }
  async function getProgressLessons(courseId){
    const uid = auth.currentUser.uid;
    const snap = await doc('progress', `${uid}_${courseId}`).get();
    return snap.exists ? (snap.data().lessons||{}) : {};
  }
  async function ensureProgressTotal(courseId, total){
    if(!total) return;
    const uid = auth.currentUser.uid;
    await doc('progress', `${uid}_${courseId}`).set({ uid, courseId, total }, { merge:true });
  }
  async function toggleLessonProgress(courseId, id, checked){
    const uid = auth.currentUser.uid;
    const ref = doc('progress', `${uid}_${courseId}`);
    const payload = checked ? { [`lessons.${id}`]: true } : { [`lessons.${id}`]: firebase.firestore.FieldValue.delete() };
    await ref.set({ uid, courseId, updatedAt: firebase.firestore.FieldValue.serverTimestamp(), ...payload }, { merge:true });
  }
  function renderCourseProgressHeader(course, outline, progressLessons){
    const total = countLessons(outline);
    const done = Object.keys(progressLessons||{}).length;
    const pct = total ? Math.round((done/total)*100) : 0;

    const best = (state.attempts||[])
      .filter(a=>a.courseId===course.id && a.uid===auth.currentUser?.uid)
      .reduce((m,a)=> Math.max(m, a.score||0), 0);
    const final = (state.quizzes||[]).find(q=>q.courseId===course.id && q.isFinal);
    const pass = final ? (best >= (final.passScore||70)) : false;
    const earned = pass ? (course.credits||0) : 0;

    return `
      <div class="course-progress" id="course-progress">
        <div class="progress-bar"><span style="width:${pct}%"></span></div>
        <div class="progress-stats">
          <div><strong>${pct}%</strong> complete • ${done}/${total} lessons</div>
          <div>Best score: <strong>${best}%</strong>${final?` • Pass ≥ ${final.passScore||70}%`:''} • Credits earned: <strong>${earned}/${course.credits||0}</strong></div>
        </div>
      </div>`;
  }
  function renderOutlineBox(data){
    if(!data || !Array.isArray(data.chapters)) return `<div class="muted">No chapters found.</div>`;
    return data.chapters.map(ch=>{
      const lessons = Array.isArray(ch.lessons) ? `<ul class="list-tight">${
        ch.lessons.map(l=>`<li>${(l.title||'').replace(/</g,'&lt;')}${l.duration?` <span class="muted">(${l.duration} min)</span>`:''}</li>`).join('')
      }</ul>` : '';
      return `<details open>
        <summary><strong>${(ch.title||'Chapter').replace(/</g,'&lt;')}</strong></summary>
        ${lessons}
      </details>`;
    }).join('');
  }
  function renderOutlineBoxInteractive(courseId, data, checkedMap){
    if(!data || !Array.isArray(data.chapters)) return `<div class="muted">No chapters found.</div>`;
    return data.chapters.map((ch,ci)=>{
      const lessons = Array.isArray(ch.lessons) ? `<ul class="list-tight">${
        ch.lessons.map((l,li)=>{
          const id = lessonId(ci, ch.title, li, l.title);
          const isChecked = !!checkedMap[id];
          return `<li class="lesson-check">
            <input type="checkbox" data-lesson="${id}" ${isChecked?'checked':''}/>
            <span>${(l.title||'').replace(/</g,'&lt;')}${l.duration?` <span class="muted">(${l.duration} min)</span>`:''}</span>
          </li>`;
        }).join('')
      }</ul>` : '';
      return `<details open>
        <summary><strong>${(ch.title||'Chapter').replace(/</g,'&lt;')}</strong></summary>
        ${lessons}
      </details>`;
    }).join('');
  }
  function renderLessonQuizzesBox(data){
    if(!data || typeof data!=='object') return `<div class="muted">No lesson quizzes JSON.</div>`;
    const keys = Object.keys(data);
    if(!keys.length) return `<div class="muted">No quizzes found.</div>`;
    return keys.map(k=>{
      const items = Array.isArray(data[k]) ? data[k] : [];
      return `<details>
        <summary><strong>${k.replace(/[-_]/g,' ')}</strong> <span class="muted">• ${items.length} Q</span></summary>
        ${items.map((it,i)=>`
          <div style="margin:6px 0">
            <div><b>Q${i+1}.</b> ${(it.q||'').replace(/</g,'&lt;')}</div>
            ${Array.isArray(it.choices)? `<ul class="list-tight">${it.choices.map(c=>`<li>${(c||'').replace(/</g,'&lt;')}</li>`).join('')}</ul>`:''}
          </div>
        `).join('')}
      </details>`;
    }).join('');
  }
  const clean = (obj) => Object.fromEntries(Object.entries(obj).filter(([_, v]) => v !== undefined && !(typeof v === 'number' && Number.isNaN(v))));

  // ---- PayPal setup (client-side capture) ----
  async function setupPayPalForCourse(c){
    const zone = document.getElementById('paypal-zone');
    const btns = document.getElementById('paypal-buttons');
    if(!zone || !btns) return;
    zone.classList.remove('hidden');
    btns.innerHTML = '';

    if(!window.paypal || !paypal.Buttons){
      zone.innerHTML = `<div class="card"><div class="card-body">PayPal SDK missing — set your Client ID in <code>index.html</code>.</div></div>`;
      return;
    }
    const price = Number(c.price||0).toFixed(2);
    paypal.Buttons({
      style: { shape: 'pill', layout: 'vertical', label: 'paypal' },
      createOrder: (data, actions) => actions.order.create({ purchase_units: [{ description: c.title || 'Course', amount: { value: price } }]}),
      onApprove: async (data, actions) => {
        try{
          const details = await actions.order.capture();
          try{
            await col('payments').add({
              uid: auth.currentUser.uid, courseId: c.id, amount: +price, provider: 'paypal',
              orderId: data.orderID,
              captureId: details?.purchase_units?.[0]?.payments?.captures?.[0]?.id || '',
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          }catch(_e){}
          await col('enrollments').add({
            uid: auth.currentUser.uid, courseId: c.id, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            course: { id:c.id, title:c.title, category:c.category, credits:c.credits, coverImage:c.coverImage }
          });
          try{ await doc('courses', c.id).set({ participants: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.uid) }, { merge:true }); }catch(_e){}
          closeModal('m-modal'); notify('Payment complete — enrolled');
        }catch(e){ console.error(e); notify('Payment capture failed','danger'); }
      },
      onError: (err) => { console.error(err); notify('PayPal error','danger'); }
    }).render('#paypal-buttons');
  }

  // ---- Theme (instant) ----
  function applyTheme(){
    if (!document.body) return;
    Array.from(document.body.classList).filter(c => c.startsWith('theme-')).forEach(c => document.body.classList.remove(c));
    document.body.classList.add(`theme-${state.theme.palette}`);
    document.body.classList.remove('font-small','font-medium','font-large');
    document.body.classList.add(`font-${state.theme.font}`);
  }
  onReady(applyTheme);

  // ---- Page hero (route-aware header) ----
  function heroForRoute(route){
    switch(route){
      case 'dashboard': return { icon:'ri-dashboard-line', klass:'dashboard', title:'Dashboard', sub:'Your hub of activity' };
      case 'courses': return { icon:'ri-book-2-line', klass:'courses', title:'Courses', sub:'Create, browse, enroll' };
      case 'learning': return { icon:'ri-graduation-cap-line', klass:'learning', title:'My Learning', sub:'Enrolled courses' };
      case 'assessments': return { icon:'ri-file-list-3-line', klass:'assess', title:'Final Exams', sub:'Take and track results' };
      case 'chat': return { icon:'ri-chat-3-line', klass:'chat', title:'Chat', sub:'Course, DM, and group' };
      case 'tasks': return { icon:'ri-list-check-2', klass:'tasks', title:'Tasks', sub:'Personal kanban' };
      case 'profile': return { icon:'ri-user-3-line', klass:'profile', title:'Profile', sub:'Bio, avatar & certificates' };
      case 'admin': return { icon:'ri-shield-star-line', klass:'admin', title:'Admin', sub:'Users, roles & rosters' };
      case 'guide': return { icon:'ri-compass-3-line', klass:'guide', title:'Guide', sub:'All features explained' };
      case 'settings': return { icon:'ri-settings-3-line', klass:'settings', title:'Settings', sub:'Theme & preferences' };
      case 'search': return { icon:'ri-search-line', klass:'search', title:'Search', sub:'Global search' };
      default: return { icon:'ri-compass-3-line', klass:'guide', title:'LearnHub', sub:'Smart learning platform' };
    }
  }

  // ---- Modal + Sidebar helpers ----
  function openModal(id){ $('#'+id)?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); }
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };

  // ---- Router / Layout ----
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','guide','settings','search'];
  function go(route){
    const prev = state.route;
    state.route = routes.includes(route)?route:'dashboard';
    if (prev === 'chat' && state._unsubChat) { try{ state._unsubChat(); }catch{} state._unsubChat = null; }
    closeSidebar();
    render();
  }

  function layout(content){
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
            ['dashboard','Dashboard','ri-dashboard-line'],
            ['courses','Courses','ri-book-2-line'],
            ['learning','My Learning','ri-graduation-cap-line'],
            ['assessments','Finals','ri-file-list-3-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['guide','Guide','ri-compass-3-line'],
            ['settings','Settings','ri-settings-3-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}"
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

        <div class="main ${hero.klass}" id="main">${content}</div>
      </div>
    </div>

    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop"></div>`;
  }

  // ---- Views
  const vLogin=()=>`
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

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="muted">${label}</div>
          <div style="font-size:22px;font-weight:800">${value}</div>
        </div>
        <i class="${icon}" style="font-size:24px;opacity:.8"></i>
      </div>
    </div>`;

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Learning', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.filter(q=>q.isFinal).length,'assessments','ri-file-list-3-line')}
        ${dashCard('My Attempts', myAttempts,'assessments','ri-checkbox-circle-line')}
      </div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Announcements</h3>
        <div id="ann-list">
          ${state.announcements.map(a=>`
            <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;gap:10px">
              <div>
                <div style="font-weight:700">${a.title||'—'}</div>
                <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</div>
                <div style="margin-top:6px">${(a.body||'').replace(/</g,'&lt;')}</div>
              </div>
              ${canManageUsers()?`<div style="display:flex;gap:6px">
                <button class="btn ghost" data-edit-ann="${a.id}"><i class="ri-edit-line"></i></button>
                <button class="btn danger" data-del-ann="${a.id}"><i class="ri-delete-bin-6-line"></i></button>
              </div>`:''}
            </div></div>
          `).join('')}
          ${!state.announcements.length? `<div class="muted">No announcements.</div>`:''}
        </div>
        ${canManageUsers()? `<div style="margin-top:10px"><button class="btn" id="add-ann"><i class="ri-megaphone-line"></i> New Announcement</button></div>`:''}
      </div></div>
    `;
  }

  function courseCard(c){
    const img = c.coverImage || '/icons/learnhub-cap.svg';
    const goals = (c.goals||[]).slice(0,3).map(g=>`<li>${g}</li>`).join('');
    const isLong = (c.short||'').length > 160;
    const st = c.style||{};
    const styleStr = [
      st.bg ? `--cc-bg:${st.bg}` : '',
      st.text ? `--cc-text:${st.text}` : '',
      st.font ? `--cc-font:${st.font}` : '',
      st.badgeBg ? `--cc-badge-bg:${st.badgeBg}` : '',
      st.badgeText ? `--cc-badge-text:${st.badgeText}` : '',
      st.imgFilter ? `--cc-img-filter:${st.imgFilter}` : '',
    ].filter(Boolean).join(';');

    return `
    <div class="card course-card ${st.cardClass||''} ${state.highlightId===c.id?'highlight':''}" id="${c.id}" style="${styleStr}">
      <div class="img"><img src="${img}" alt="${c.title}"/></div>
      <div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800">${c.title}</div>
          <span class="badge">${c.category||'General'}</span>
        </div>

        <div class="short-wrap">
          <div class="muted short ${isLong?'clamp':''}">${(c.short||'').replace(/</g,'&lt;')}</div>
          ${isLong? `<button class="short-toggle" data-short-toggle>Read more</button>`:''}
        </div>

        ${goals?`<ul style="margin-top:8px">${goals}</ul>`:''}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
          <div class="muted">Credits: <strong>${c.credits||0}</strong></div>
          <div style="font-weight:800">${money(c.price||0)}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button class="btn" data-open="${c.id}"><i class="ri-external-link-line"></i> Details</button>
          ${canTeach()? `<button class="btn ghost" data-edit="${c.id}"><i class="ri-edit-line"></i></button>
          <button class="btn danger" data-del="${c.id}"><i class="ri-delete-bin-6-line"></i></button>`:''}
        </div>
      </div>
    </div>`;
  }

  function vCourses(){
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
        <div class="grid cols-4" data-sec="courses">
          ${state.courses.map(courseCard).join('')}
          ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
        </div>
      </div></div>
    `;
  }

  function vLearning(){
    const my=auth.currentUser?.uid;
    const list=state.enrollments.filter(e=>e.uid===my).map(e=> state.courses.find(c=>c.id===e.courseId)||{} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-4">
          ${list.map(c=>{
            const prog = (state.progress||[]).find(p=>p.courseId===c.id && p.uid===auth.currentUser?.uid) || {};
            const done = Object.keys(prog.lessons||{}).length;
            const total = prog.total || 0;
            const pct = total ? Math.round((done/total)*100) : 0;

            const best = (state.attempts||[])
              .filter(a=>a.courseId===c.id && a.uid===auth.currentUser?.uid)
              .reduce((m,a)=> Math.max(m, a.score||0), 0);
            const final = (state.quizzes||[]).find(q=>q.courseId===c.id && q.isFinal);
            const earned = final && best >= (final.passScore||70) ? (c.credits||0) : 0;

            const isLong = (c.short||'').length > 160;
            const txt = (c.short||'').replace(/</g,'&lt;');

            return `
            <div class="card course-card">
              <div class="img"><img src="${c.coverImage||'/icons/learnhub-cap.svg'}" alt="${c.title||''}"/></div>
              <div class="card-body">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                  <div style="font-weight:800">${c.title||'(deleted course)'}</div>
                  <span class="badge">${pct}% • Best ${best}% • ${earned}/${c.credits||0} cr</span>
                </div>
                <div class="short-wrap">
                  <div class="muted short ${isLong?'clamp':''}">${txt}</div>
                  ${isLong? `<button class="short-toggle" data-short-toggle>Read more</button>`:''}
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                  <div class="muted">Credits: <strong>${c.credits||0}</strong></div>
                  <button class="btn" data-open-course="${c.id}">Open</button>
                </div>
                <div class="progress-bar" style="margin-top:8px"><span style="width:${pct}%"></span></div>
              </div>
            </div>`;
          }).join('')}
          ${!list.length? `<div class="muted" style="padding:10px">You’re not enrolled yet.</div>`:''}
        </div>
      </div></div>`;
  }

  function vAssessments(){
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Final Exams</h3>
          ${canTeach()? `<button class="btn" id="new-quiz"><i class="ri-add-line"></i> New Final</button>`:''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${state.quizzes.filter(q=>q.isFinal).map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}%</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${canTeach()||q.ownerUid===auth.currentUser?.uid? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.quizzes.filter(q=>q.isFinal).length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Quiz</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr>
                  <td>${a.quizTitle}</td>
                  <td class="num">${a.score}%</td>
                  <td>${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }

  const vChat=()=>`
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
          ${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}
        </select>
        <select id="chat-dm" class="input hidden">
          <option value="">Select user…</option>
          ${state.profiles.filter(p=>p.uid!==auth.currentUser?.uid).map(p=>`<option value="${p.uid}">${p.name||p.email}</option>`).join('')}
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

  function vTasks(){
    const my=auth.currentUser?.uid;
    const lane=(key,label,color)=>{
      const cards=(state.tasks||[]).filter(t=> t.uid===my && t.status===key);
      return `
        <div class="card lane-row" data-lane="${key}"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="margin:0;color:${color}">${label}</h3>
            ${key==='todo'? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
          </div>
          <div class="grid lane-grid" id="lane-${key}">
            ${cards.map(t=>`
              <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
                <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                  <div>${t.title}</div>
                  <div class="actions">
                    <button class="btn ghost" data-edit="${t.id}"><i class="ri-edit-line"></i></button>
                    <button class="btn danger" data-del="${t.id}"><i class="ri-delete-bin-6-line"></i></button>
                  </div>
                </div>
              </div>`).join('')}
            ${cards.length? '': `<div class="muted" style="padding:10px">Drop tasks here…</div>`}
          </div>
        </div></div>`;
    };
    return `<div data-sec="tasks">${lane('todo','To do','#f59e0b')}${lane('inprogress','In progress','#3b82f6')}${lane('done','Done','#10b981')}</div>`;
  }

  // Guide view (abbreviated here – keep your previous rich content if you prefer)
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

  function vProfile(){
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'',avatar:'',signature:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <input id="pf-sign" type="file" accept="image/*" style="display:none"/>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Avatar</button>
              <button class="btn ghost" id="pf-pick-sign"><i class="ri-pen-nib-line"></i> Signature</button>
              <button class="btn danger" id="pf-delete"><i class="ri-delete-bin-6-line"></i> Delete profile</button>
              <button class="btn secondary" id="pf-view"><i class="ri-id-card-line"></i> View Card</button>
            </div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Course</th><th>Best Score</th><th>Certificate</th></tr></thead>
              <tbody>
                ${buildTranscript(auth.currentUser?.uid).map(r=>`
                  <tr>
                    <td>${r.courseTitle}</td>
                    <td class="num">${r.best}%</td>
                    <td>${r.completed? `<button class="btn" data-cert="${r.courseId}"><i class="ri-award-line"></i> Download</button>`:'—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div></div>
      </div>
    `;
  }

  function vAdmin(){
    if(!canManageUsers()) return `<div class="card"><div class="card-body">Admins only.</div></div>`;
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Role Manager</h3>
          <div class="grid">
            <input id="rm-uid" class="input" placeholder="User UID"/>
            <select id="rm-role" class="input">${VALID_ROLES.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
            <button class="btn" id="rm-save"><i class="ri-save-3-line"></i> Save Role</button>
            <div class="muted" style="font-size:12px">Tip: Create your own admin doc once in roles/{yourUid} via console.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>
            ${state.profiles.map(p=>`<tr>
              <td>${p.name||'—'}</td><td>${p.email||'—'}</td><td>${p.role||'student'}</td>
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
                ${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}
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

        <!-- Transcript Viewer (Admin) -->
        <div class="card" style="grid-column:1/-1"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript Viewer (Admin)</h3>
          <div class="grid cols-3">
            <div>
              <label class="muted">User</label>
              <select id="tv-user" class="input">
                <option value="">Select user…</option>
                ${state.profiles.map(p=>`<option value="${p.uid}">${p.name||p.email}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="tv-out" class="table-wrap" style="margin-top:8px"></div>
        </div></div>
      </div>
    `;
  }

  function vSettings(){
    const opts = THEME_PALETTES.map(p => `<option value="${p}" ${state.theme.palette===p?'selected':''}>${p}</option>`).join('');
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div><label>Palette</label>
            <select id="theme-palette" class="input">${opts}</select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              <option value="small" ${state.theme.font==='small'?'selected':''}>small</option>
              <option value="medium" ${state.theme.font==='medium'?'selected':''}>medium</option>
              <option value="large" ${state.theme.font==='large'?'selected':''}>large</option>
            </select>
          </div>
        </div>
        <div class="muted" style="margin-top:8px">Changes apply instantly.</div>
      </div></div>
    `;
  }

  const vSearch=()=>`<div class="card"><div class="card-body"><h3>Search</h3><div class="muted">Type in the top bar.</div></div></div>`;

  function safeView(r){
    switch(r){
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
      default: return vDashboard();
    }
  }

  // ---- Render / Shell ----
  function render(){
    if (!document.body) { onReady(render); return; }
    let root = document.getElementById('root');
    if (!root) { root = document.createElement('div'); root.id = 'root'; document.body.appendChild(root); }

    if(!auth.currentUser){
      root.innerHTML=vLogin();
      wireLogin();
      return;
    }
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if (state.route === 'chat') populateDmUserSelect();
    if(state.highlightId){
      const el=document.getElementById(state.highlightId);
      if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); }
      state.highlightId = null;
    }
  }

  // ---- Shell wiring ----
  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> {
      const open=document.body.classList.contains('sidebar-open');
      if(open) closeSidebar(); else { document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); }
    });
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest?.('.item[data-route]'); if(it){ go(it.getAttribute('data-route')); }
    });
    $('#side-nav')?.addEventListener('keydown', e=>{
      const it=e.target.closest?.('.item[data-route]'); if(!it) return;
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); go(it.getAttribute('data-route')); }
    });
    $('#main')?.addEventListener('click', (e)=>{
      const goEl = e.target.closest?.('[data-go]'); if (goEl) { go(goEl.getAttribute('data-go')); return; }
      const tg = e.target.closest?.('[data-short-toggle]');
      if(tg){
        const wrap = tg.closest('.card-body') || tg.parentElement;
        const block = wrap.querySelector('.short');
        if(block){ const isClamped = block.classList.toggle('clamp'); tg.textContent = isClamped ? 'Read more' : 'Read less'; }
      }
      closeSidebar();
    });
    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());

    // search live
    const input=$('#globalSearch'), results=$('#searchResults');
    if(input && results){
      let t;
      input.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ state.searchQ=input.value.trim(); go('search'); results.classList.remove('active'); }
      });
      input.addEventListener('input', ()=>{
        clearTimeout(t); const q=input.value.trim(); if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
        t=setTimeout(()=>{
          const ix=[];
          state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''}`}));
          state.quizzes.forEach(qz=> ix.push({label:qz.title, section:'Finals', route:'assessments', id:qz.id, text:qz.courseTitle||''}));
          state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'profile', id:p.uid, text:(p.bio||'')}));
          const tokens=q.toLowerCase().split(/\s+/).filter(Boolean);
          const out=ix.map(item=>{
            const l=item.label.toLowerCase(), t=(item.text||'').toLowerCase();
            const ok=tokens.every(tok=> l.includes(tok)||t.includes(tok));
            return ok?{item,score:tokens.length + (l.includes(tokens[0])?1:0)}:null;
          }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,12);

          results.innerHTML=out.map(r=>`<div class="row" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span class="muted">— ${r.section}</span></div>`).join('');
          results.classList.add('active');
          results.querySelectorAll('.row').forEach(row=>{
            row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id'); state.searchQ=q; state.highlightId=id; go(r); results.classList.remove('active'); };
          });
        },120);
      });

      document.addEventListener('click', e=>{
        try{
          if(results && typeof results.contains==='function' && e.target!==input && !results.contains(e.target)){
            results.classList.remove('active');
          }
        }catch(_e){}
      }, { capture:true });
    }

    // theme instant
    $('#theme-palette')?.addEventListener('change', (e)=>{ state.theme.palette=e.target.value; localStorage.setItem('lh.palette',state.theme.palette); applyTheme(); });
    $('#theme-font')?.addEventListener('change', (e)=>{ state.theme.font=e.target.value; localStorage.setItem('lh.font',state.theme.font); applyTheme(); });

    $('#mm-close')?.addEventListener('click', ()=> closeModal('m-modal'));
  }

  // ---- Chat helpers
  function profileKey(p){ return p.uid || p.id; }
  function getCourseRecipients(cid){
    const me = auth.currentUser?.uid;
    const course = state.courses?.find(c => c.id === cid);
    const byId = new Map((state.profiles||[]).map(p => [profileKey(p), p]));
    let ids = Array.isArray(course?.participants) && course.participants.length
      ? course.participants
      : (state.profiles||[]).map(profileKey);
    return ids.filter(id => id && id !== me).map(id => byId.get(id)).filter(Boolean)
      .sort((a,b) => (a.name||a.email||'').localeCompare(b.name||b.email||''));
  }
  function populateDmUserSelect(){
    const sel = document.getElementById('chat-dm'); if (!sel) return;
    const cid = document.getElementById('chat-course')?.value || '';
    const users = getCourseRecipients(cid);
    sel.innerHTML = '<option value="">Select user…</option>' + users.map(p => `<option value="${profileKey(p)}">${p.name || p.email}</option>`).join('');
  }

  // ---- Route wiring
  function wireRoute(){
    switch(state.route){
      case 'courses': wireCourses(); break;
      case 'learning': wireLearning(); break;
      case 'assessments': wireAssessments(); break;
      case 'chat': wireChat(); break;
      case 'tasks': wireTasks(); break;
      case 'profile': wireProfile(); break;
      case 'admin': wireAdmin(); break;
      case 'guide': wireGuide(); break;
      case 'settings': break;
      case 'dashboard': wireAnnouncements(); break;
    }
  }

  // ---- Login
  function wireLogin(){
    const doLogin=async ()=>{
      const email=$('#li-email')?.value.trim(), pass=$('#li-pass')?.value.trim();
      if(!email||!pass) return notify('Enter email & password','warn');
      try{ await auth.signInWithEmailAndPassword(email, pass); }catch(e){ notify(e?.message||'Login failed','danger'); }
    };
    $('#btnLogin')?.addEventListener('click', doLogin);
    $('#li-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

    $('#link-forgot')?.addEventListener('click', async ()=>{
      const email=$('#li-email')?.value.trim(); if(!email) return notify('Enter your email first','warn');
      try{ await auth.sendPasswordResetEmail(email); notify('Reset email sent','ok'); }catch(e){ notify(e?.message||'Failed','danger'); }
    });

    $('#link-register')?.addEventListener('click', async ()=>{
      const email=$('#li-email')?.value.trim(); const pass=$('#li-pass')?.value.trim()||'admin123';
      if(!email) return notify('Enter email, then click Sign up again','warn');
      try{
        const cred=await auth.createUserWithEmailAndPassword(email, pass);
        const uid=cred.user.uid;
        await Promise.all([
          doc('roles', uid).set({ uid, email, role:'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() }),
          doc('profiles', uid).set({ uid, email, name:'', bio:'', portfolio:'', role:'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  // ---- Courses
  function wireCourses(){
    $('#seed-demo')?.addEventListener('click', async ()=>{
      try { await window.seedDemoCourses(); notify('Demo courses added'); }
      catch (e) { console.error(e); notify((e && (e.code + ': ' + e.message)) || 'Failed to seed', 'danger'); }
    });

    $('#add-course')?.addEventListener('click', ()=>{
      if(!canTeach()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category"/>
          <input id="c-credits" class="input" type="number" placeholder="Credits"/>
          <input id="c-price" class="input" type="number" placeholder="Price"/>
          <textarea id="c-short" class="input" placeholder="Short description"></textarea>
          <textarea id="c-goals" class="input" placeholder="Goals (one per line)"></textarea>
          <input id="c-cover" class="input" placeholder="Cover image URL (https)"/>
          <input id="c-outlineUrl" class="input" placeholder="/data/outlines/slug.json"/>
          <input id="c-quizzesUrl" class="input" placeholder="/data/lesson-quizzes/slug.json"/>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');

      $('#c-save').onclick = async ()=>{
        const t = $('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const goals = ($('#c-goals')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
        const obj = {
          title:t,
          category: $('#c-category')?.value.trim(),
          credits: +($('#c-credits')?.value||0),
          price: +($('#c-price')?.value||0),
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
        try { await col('courses').add(obj); closeModal('m-modal'); notify('Saved'); }
        catch (e) { console.error('Failed to create course:', e); notify((e && (e.code + ': ' + e.message)) || 'Failed to create course', 'danger'); }
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest?.('button[data-open]');
      const editBtn=e.target.closest?.('button[data-edit]');
      const delBtn =e.target.closest?.('button[data-del]');
      if(openBtn){
        const id = openBtn.getAttribute('data-open');
        const snap = await doc('courses', id).get(); if(!snap.exists) return;
        const c = { id: snap.id, ...snap.data() };
        const enrolled = isEnrolled(c.id);

        $('#mm-title').textContent = c.title;
        $('#mm-body').innerHTML = `
          <div class="course-full">
            <div><img class="course-cover-thumb" src="${c.coverImage||'/icons/learnhub-cap.svg'}" alt="${c.title}"/></div>
            <div>
              <div class="muted">${c.category||'General'} • Credits ${c.credits||0}</div>
              <p>${(c.short||'').replace(/</g,'&lt;')}</p>
              ${(c.goals?.length ? `<ul class="list-tight">${c.goals.map(g=>`<li>${g}</li>`).join('')}</ul>` : '')}
              ${c.price>0 ? `<div style="margin-top:6px"><strong>Price:</strong> ${money(c.price)}</div>` : ''}
            </div>
          </div>

          <div class="section-box" style="margin-top:12px">
            <h4><i class="ri-layout-2-line"></i> Outline</h4>
            <div id="outline-box"><div class="muted">Loading…</div></div>
          </div>

          <div class="section-box" style="margin-top:12px">
            <h4><i class="ri-question-answer-line"></i> Lesson Quizzes</h4>
            <div id="lesson-quizzes-box"><div class="muted">Loading…</div></div>
          </div>

          <div id="paypal-zone" class="paypal-zone hidden">
            <div id="paypal-buttons"></div>
          </div>
        `;
        $('#mm-foot').innerHTML = `
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
            ${
              enrolled
              ? `<button class="btn ok" disabled>Enrolled</button>`
              : (c.price>0
                  ? `<button class="btn" id="show-pay"><i class="ri-bank-card-line"></i> Pay & Enroll (${money(c.price)})</button>`
                  : `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>`
                )
            }
            <button class="btn ghost" id="open-quiz"><i class="ri-question-line"></i> Finals</button>
          </div>
        `;
        openModal('m-modal');

        // Load outline + progress
        const outlineBox = document.getElementById('outline-box');
        let outlineData = null;
        try{ if(c.outlineUrl){ outlineData = await fetchJSON(c.outlineUrl); } }catch(err){ outlineData = null; }
        const progressLessons = await getProgressLessons(c.id);
        await ensureProgressTotal(c.id, countLessons(outlineData||{}));
        const bodyEl = document.getElementById('mm-body');
        bodyEl.insertAdjacentHTML('afterbegin', renderCourseProgressHeader(c, outlineData||{chapters:[]}, progressLessons));
        if(outlineData){ outlineBox.innerHTML = renderOutlineBoxInteractive(c.id, outlineData, progressLessons); }
        else { outlineBox.innerHTML = `<div class="muted">No outline URL for this course.</div>`; }
        outlineBox.addEventListener('change', async (ev)=>{
          const cb = ev.target.closest('input[type="checkbox"][data-lesson]'); if(!cb) return;
          await toggleLessonProgress(c.id, cb.getAttribute('data-lesson'), cb.checked);
          const fresh = await getProgressLessons(c.id);
          document.getElementById('course-progress').outerHTML =
            renderCourseProgressHeader(c, outlineData||{chapters:[]}, fresh);
        });

        // Lesson Quizzes
        const lessonBox = document.getElementById('lesson-quizzes-box');
        if(c.quizzesUrl){
          fetchJSON(c.quizzesUrl)
            .then(d => { lessonBox.innerHTML = renderLessonQuizzesBox(d); })
            .catch(err => { lessonBox.innerHTML = `<div class="muted">Could not load lesson quizzes (${(err&&err.message)||'error'}).</div>`; });
        }else{
          lessonBox.innerHTML = `<div class="muted">No lesson quizzes URL for this course.</div>`;
        }

        // Actions
        document.getElementById('open-quiz')?.addEventListener('click', ()=>{ state.searchQ=c.title; go('assessments'); });
        document.getElementById('enroll')?.addEventListener('click', async ()=>{
          await col('enrollments').add({
            uid:auth.currentUser.uid, courseId:c.id,
            createdAt:firebase.firestore.FieldValue.serverTimestamp(),
            course:{ id:c.id,title:c.title,category:c.category,credits:c.credits,coverImage:c.coverImage }
          });
          try{ await doc('courses', c.id).set({ participants: firebase.firestore.FieldValue.arrayUnion(auth.currentUser.uid) }, { merge:true }); }catch(_e){}
          closeModal('m-modal'); notify('Enrolled');
        });
        document.getElementById('show-pay')?.addEventListener('click', ()=> setupPayPalForCourse(c));
      }
      if(editBtn){
        if(!canTeach()) return notify('No permission','warn');
        const id=editBtn.getAttribute('data-edit'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()};
        $('#mm-title').textContent='Edit Course';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="c-title" class="input" value="${c.title||''}"/>
            <input id="c-category" class="input" value="${c.category||''}"/>
            <input id="c-credits" class="input" type="number" value="${c.credits||0}"/>
            <input id="c-price" class="input" type="number" value="${c.price||0}"/>
            <textarea id="c-short" class="input">${c.short||''}</textarea>
            <textarea id="c-goals" class="input">${(c.goals||[]).join('\n')}</textarea>
            <input id="c-cover" class="input" value="${c.coverImage||''}"/>
            <input id="c-outlineUrl" class="input" value="${c.outlineUrl||''}"/>
            <input id="c-quizzesUrl" class="input" value="${c.quizzesUrl||''}"/>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          const goals=($('#c-goals')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
          await doc('courses', id).set(clean({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(),
            credits:+($('#c-credits')?.value||0), price:+($('#c-price')?.value||0),
            short:$('#c-short')?.value.trim(), goals,
            coverImage:$('#c-cover')?.value.trim(), outlineUrl:$('#c-outlineUrl')?.value.trim(), quizzesUrl:$('#c-quizzesUrl')?.value.trim(),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          }),{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(delBtn){
        if(!canTeach()) return notify('No permission','warn');
        const id=delBtn.getAttribute('data-del');
        await doc('courses',id).delete();
        notify('Course deleted');
      }
    });
  }

  // ---- Learning
  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn = e.target.closest?.('button[data-open-course]'); if(!btn) return;
      const id = btn.getAttribute('data-open-course'); const snap = await doc('courses',id).get(); if(!snap.exists) return;
      const c = { id:snap.id, ...snap.data() };

      $('#mm-title').textContent = c.title;
      $('#mm-body').innerHTML = `
        <div class="course-full">
          <div><img class="course-cover-thumb" src="${c.coverImage||'/icons/learnhub-cap.svg'}" alt="${c.title}"/></div>
          <div>
            <div class="muted">${c.category||'General'} • Credits ${c.credits||0}</div>
            <p>${(c.short||'').replace(/</g,'&lt;')}</p>
            ${(c.goals?.length ? `<ul class="list-tight">${c.goals.map(g=>`<li>${g}</li>`).join('')}</ul>` : '')}
          </div>
        </div>

        <div class="section-box" style="margin-top:12px">
          <h4><i class="ri-layout-2-line"></i> Outline</h4>
          <div id="outline-box"><div class="muted">Loading…</div></div>
        </div>

        <div class="section-box" style="margin-top:12px">
          <h4><i class="ri-question-answer-line"></i> Lesson Quizzes</h4>
          <div id="lesson-quizzes-box"><div class="muted">Loading…</div></div>
        </div>
      `;
      $('#mm-foot').innerHTML = `
        <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
          <button class="btn ghost" id="open-quiz"><i class="ri-question-line"></i> Finals</button>
          <button class="btn" id="mm-close2">Close</button>
        </div>`;
      openModal('m-modal');

      document.getElementById('open-quiz')?.addEventListener('click', ()=>{ state.searchQ=c.title; go('assessments'); });
      document.getElementById('mm-close2')?.addEventListener('click', ()=> closeModal('m-modal'));

      const outlineBox = document.getElementById('outline-box');
      let outlineData = null;
      try{ if(c.outlineUrl){ outlineData = await fetchJSON(c.outlineUrl); } }catch(err){ outlineData = null; }
      const progressLessons = await getProgressLessons(c.id);
      await ensureProgressTotal(c.id, countLessons(outlineData||{}));
      const bodyEl = document.getElementById('mm-body');
      bodyEl.insertAdjacentHTML('afterbegin', renderCourseProgressHeader(c, outlineData||{chapters:[]}, progressLessons));
      if(outlineData){ outlineBox.innerHTML = renderOutlineBoxInteractive(c.id, outlineData, progressLessons); }
      else { outlineBox.innerHTML = `<div class="muted">No outline URL for this course.</div>`; }
      outlineBox.addEventListener('change', async (ev)=>{
        const cb = ev.target.closest('input[type="checkbox"][data-lesson]'); if(!cb) return;
        await toggleLessonProgress(c.id, cb.getAttribute('data-lesson'), cb.checked);
        const fresh = await getProgressLessons(c.id);
        document.getElementById('course-progress').outerHTML =
          renderCourseProgressHeader(c, outlineData||{chapters:[]}, fresh);
      });

      const lessonBox = document.getElementById('lesson-quizzes-box');
      if(c.quizzesUrl){
        fetchJSON(c.quizzesUrl)
          .then(d => { lessonBox.innerHTML = renderLessonQuizzesBox(d); })
          .catch(err => { lessonBox.innerHTML = `<div class="muted">Could not load lesson quizzes (${(err&&err.message)||'error'}).</div>`; });
      }else{
        lessonBox.innerHTML = `<div class="muted">No lesson quizzes URL for this course.</div>`;
      }
    });
  }

  // ---- Finals
  function wireAssessments(){
    $('#new-quiz')?.addEventListener('click', ()=>{
      if(!canTeach()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Final title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":1,"feedbackOk":"Correct!","feedbackNo":"Try again"}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal('m-modal');
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add(clean({ title:t, courseId, courseTitle:course.title, passScore:pass, items, isFinal:true, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() }));
        closeModal('m-modal'); notify('Final saved');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest?.('button[data-take]'); const edit=e.target.closest?.('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!isEnrolled(q.courseId) && state.role==='student') return notify('Enroll first','warn');
        $('#mm-title').textContent=q.title;
        $('#mm-body').innerHTML = (q.items||[]).map((it,idx)=>`
          <div class="card"><div class="card-body">
            <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
            <div style="margin-top:6px;display:grid;gap:6px">
              ${(it.choices||[]).map((c,i)=>`
                <label style="display:flex;gap:8px;align-items:center">
                  <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
                </label>`).join('')}
            </div>
            <div class="muted" id="fb-${idx}" style="margin-top:6px"></div>
          </div></div>`).join('');
        $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
        openModal('m-modal');
        const bodyEl = $('#mm-body');
        bodyEl.onchange = (ev)=>{
          const t = ev.target; if(!t?.name?.startsWith('q')) return;
          const idx = Number(t.name.slice(1));
          const it = (q.items||[])[idx]; if(!it) return;
          const val = +t.value; const fb = $(`#fb-${idx}`); if(!fb) return;
          if(val===+it.answer){ fb.textContent = it.feedbackOk||'Correct'; fb.style.color='var(--ok)'; }
          else { fb.textContent = it.feedbackNo||'Incorrect'; fb.style.color='var(--danger)'; }
        };
        bodyEl.scrollTop = 0;
        $('#q-submit').onclick=async ()=>{
          let correct=0;
          (q.items||[]).forEach((it,idx)=>{
            const v=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
            if(+v===+it.answer) correct++;
          });
          const total = (q.items||[]).length || 1;
          const score = Math.round((correct/total)*100);
          await col('attempts').add({
            uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, score,
            createdAt:firebase.firestore.FieldValue.serverTimestamp()
          });
          closeModal('m-modal'); notify(`Your score: ${score}%`);
        };
      }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(canTeach() || q.ownerUid===auth.currentUser?.uid)) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <textarea id="q-json" class="input">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set(clean({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() }),{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  // ---- Chat
  function wireChat(){
    const box=$('#chat-box');
    const modeSel=$('#chat-mode');
    const courseSel=$('#chat-course');
    const dmSel=$('#chat-dm');
    const groupInp=$('#chat-group');
    const input=$('#chat-input');
    const send=$('#chat-send');

    populateDmUserSelect();

    let unsub=null;
    const uiByMode=()=>{
      const m=modeSel.value;
      courseSel.classList.toggle('hidden', m!=='course');
      dmSel.classList.toggle('hidden', m!=='dm');
      groupInp.classList.toggle('hidden', m!=='group');
      if (m==='dm') populateDmUserSelect();
    };
    uiByMode();
    modeSel?.addEventListener('change', ()=>{ uiByMode(); sub(); });

    function channelKey(){
      const m=modeSel.value;
      if(m==='course'){
        const c=courseSel.value; return c?`course_${c}`:'';
      } else if(m==='dm'){
        const peer=dmSel.value; if(!peer) return '';
        const pair=[auth.currentUser.uid, peer].sort(); return `dm_${pair[0]}_${pair[1]}`;
      } else {
        const gid=(groupInp.value||'').trim(); return gid?`group_${gid}`:'';
      }
    }

    function paint(msgs){
      box.innerHTML = msgs.sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0))
        .map(m=>`
          <div style="margin-bottom:8px">
            <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
            <div>${(m.text||'').replace(/</g,'&lt;')}</div>
          </div>`).join('');
      box.scrollTop=box.scrollHeight;
    }

    function sub(){
      if(unsub){ try{unsub()}catch{} unsub=null; }
      if(state._unsubChat){ try{ state._unsubChat(); }catch{} state._unsubChat=null; }
      const ch = channelKey(); if(!ch){ box.innerHTML='<div class="muted">Pick a channel…</div>'; return; }
      unsub = col('messages').where('channel','==',ch).onSnapshot(
        s=> paint(s.docs.map(d=>({id:d.id,...d.data()}))),
        err=> console.warn('chat listener error:', err)
      );
      state._unsubChat = unsub;
    }

    courseSel?.addEventListener('change', ()=>{ populateDmUserSelect(); sub(); });
    dmSel?.addEventListener('change', sub);
    groupInp?.addEventListener('input', sub);
    groupInp?.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sub(); });

    send?.addEventListener('click', async ()=>{
      const ch=channelKey(); const text=input.value.trim(); if(!ch||!text) return;
      const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {};
      const payload = clean({
        channel: ch, type: modeSel.value, uid: auth.currentUser.uid, email: auth.currentUser.email, name: me.name||'',
        text, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        courseId: modeSel.value==='course' ? courseSel.value : undefined,
        peerUid: modeSel.value==='dm' ? dmSel.value : undefined,
        groupId: modeSel.value==='group' ? groupInp.value.trim() : undefined
      });
      await col('messages').add(payload);
      input.value='';
    });

    sub();
  }

  // ---- Tasks
  function wireTasks(){
    const root=$('[data-sec="tasks"]'); if(!root) return;

    $('#addTask')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        await col('tasks').add({ uid:auth.currentUser.uid, title:t, status:'todo', createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal('m-modal'); notify('Saved');
      };
    });

    root.addEventListener('click', async (e)=>{
      const btn=e.target.closest?.('button'); if(!btn) return;
      const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
      if(btn.hasAttribute('data-edit')){
        const snap=await doc('tasks',id).get(); if(!snap.exists) return;
        const t={id:snap.id,...snap.data()};
        $('#mm-title').textContent='Edit Task';
        $('#mm-body').innerHTML=`<div class="grid">
          <input id="t-title" class="input" value="${t.title||''}"/>
          <select id="t-status" class="input">${['todo','inprogress','done'].map(x=>`<option ${t.status===x?'selected':''}>${x}</option>`).join('')}</select>
        </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
        $('#t-save').onclick=async ()=>{
          await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        await doc('tasks',id).delete(); notify('Deleted');
      }
    });

    root.querySelectorAll('.task-card').forEach(card=>{
      card.setAttribute('draggable','true'); card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
      card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    });
    root.querySelectorAll('.lane-grid').forEach(grid=>{
      const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
      const show=e=>{ e.preventDefault(); row?.classList.add('highlight'); };
      const hide=()=> row?.classList.remove('highlight');
      grid.addEventListener('dragenter', show); grid.addEventListener('dragover', show); grid.addEventListener('dragleave', hide);
      grid.addEventListener('drop', async (e)=>{ e.preventDefault(); hide(); const id=e.dataTransfer.getData('text/plain'); if(!id) return;
        await doc('tasks',id).set({ status:lane, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      });
    });
  }

  // ---- Profile wiring (uploads + certificate)
  function wireProfile(){
    $('#pf-pick')?.addEventListener('click', ()=> $('#pf-avatar')?.click());
    $('#pf-pick-sign')?.addEventListener('click', ()=> $('#pf-sign')?.click());

    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(), bio:$('#pf-bio')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});

      const fileA=$('#pf-avatar')?.files?.[0];
      if(fileA){
        const ref=stg.ref().child(`avatars/${uid}/${Date.now()}_${fileA.name}`);
        await ref.put(fileA); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      const fileS=$('#pf-sign')?.files?.[0];
      if(fileS){
        const ref=stg.ref().child(`signatures/${uid}/${Date.now()}_${fileS.name}`);
        await ref.put(fileS); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ signature:url },{merge:true});
      }
      notify('Profile saved');
    });

    $('#pf-delete')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).delete();
      notify('Profile deleted');
    });

    $('#pf-view')?.addEventListener('click', ()=>{
      const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {};
      $('#mm-title').textContent='Profile Card';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <div style="display:flex;gap:12px;align-items:center">
            <img src="${me.avatar||'/icons/learnhub-cap.svg'}" alt="avatar" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:1px solid var(--border)"/>
            <div>
              <div style="font-weight:800">${me.name||me.email||'—'}</div>
              <div class="muted">${me.email||''}</div>
            </div>
          </div>
          <div>${(me.bio||'').replace(/</g,'&lt;')}</div>
          ${me.signature? `<div class="muted">Signature:</div><img src="${me.signature}" alt="signature" style="max-height:48px">`:''}
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`; openModal('m-modal');
      $('#mm-ok').onclick=()=> closeModal('m-modal');
    });

    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest?.('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email};

      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=1000;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,1000);
      ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(60,60,1280,880);
      ctx.fillStyle='#fff'; ctx.font='bold 60px Inter'; ctx.fillText('Certificate of Completion', 340, 240);
      ctx.font='28px Inter';
      ctx.fillText(`Awarded to: ${p.name||p.email}`, 340, 320);
      ctx.fillText(`Course: ${course.title||courseId}`, 340, 370);
      ctx.fillText(`Organization: LearnHub`, 340, 420);
      const id = 'LH-' + (courseId||'xxxx').slice(0,6).toUpperCase() + '-' + (auth.currentUser.uid||'user').slice(0,6).toUpperCase();
      ctx.fillText(`Certificate ID: ${id}`, 340, 470);
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 340, 520);
      if(p.signature){
        const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>{ ctx.drawImage(img, 980, 540, 260, 80); finish(); };
        img.src=p.signature;
      } else { finish(); }
      function finish(){
        ctx.fillStyle='#fff'; ctx.font='20px Inter'; ctx.fillText('Authorized Signature', 1000, 640);
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
      }
    });
  }

  // ---- Admin wiring (roles, profiles, roster, transcript viewer)
  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid = $('#rm-uid')?.value.trim();
      const raw = $('#rm-role')?.value || 'student';
      const role = (raw + '').toLowerCase();
      if(!uid) return notify('Enter UID + valid role','warn');
      await doc('roles', uid).set({ uid, role, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      notify('Role saved');
    });

    $('#main')?.addEventListener('click', async (e)=>{
      const ed=e.target.closest?.('button[data-admin-edit]'); const del=e.target.closest?.('button[data-admin-del]');
      if(ed){
        const uid=ed.getAttribute('data-admin-edit'); const snap=await doc('profiles',uid).get(); if(!snap.exists) return;
        const p={id:snap.id,...snap.data()};
        $('#mm-title').textContent='Edit Profile (admin)';
        $('#mm-body').innerHTML=`<div class="grid">
          <input id="ap-name" class="input" value="${p.name||''}"/>
          <input id="ap-portfolio" class="input" value="${p.portfolio||''}"/>
          <textarea id="ap-bio" class="input">${p.bio||''}</textarea>
        </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="ap-save">Save</button>`; openModal('m-modal');
        $('#ap-save').onclick=async ()=>{
          await doc('profiles',uid).set({ name:$('#ap-name')?.value.trim(), portfolio:$('#ap-portfolio')?.value.trim(), bio:$('#ap-bio')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(del){
        const uid=del.getAttribute('data-admin-del');
        await doc('profiles',uid).delete();
        notify('Profile deleted');
      }
    });

    // Roster tools
    $('#btn-roster-sync')?.addEventListener('click', async ()=>{
      const cid=$('#roster-course')?.value;
      if(!cid) return notify('Pick a course','warn');
      try{
        const [enrSnap, cSnap] = await Promise.all([
          col('enrollments').where('courseId','==',cid).get(),
          doc('courses',cid).get()
        ]);
        const uids = new Set(enrSnap.docs.map(d=>d.data().uid));
        const c = cSnap.data()||{};
        if(c.ownerUid) uids.add(c.ownerUid);
        await doc('courses',cid).set({ participants: Array.from(uids) }, { merge:true });
        notify('Roster synced');
        $('#roster-out').textContent = `Participants: ${Array.from(uids).join(', ')}`;
      }catch(e){ notify(e?.message||'Sync failed','danger'); }
    });
    $('#btn-roster-view')?.addEventListener('click', async ()=>{
      const cid=$('#roster-course')?.value;
      if(!cid) return notify('Pick a course','warn');
      const s=await doc('courses',cid).get();
      const arr = s.data()?.participants||[];
      $('#roster-out').textContent = `Participants: ${arr.join(', ') || '—'}`;
    });

    // Transcript viewer
    function buildTranscript(uid){
      const byCourse = {};
      (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
        byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId, best:0, completed:false};
        byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
        const q = state.quizzes.find(q=>q.courseId===a.courseId && q.isFinal);
        byCourse[a.courseId].completed = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
      });
      return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
    }
    function adminRenderTranscript(uid){
      const rows = buildTranscript(uid);
      const html = `
        <table class="table">
          <thead><tr><th>Course</th><th>Best Score</th><th>Credits</th><th>Certificate</th></tr></thead>
          <tbody>
            ${rows.map(r=>{
              const course = state.courses.find(c=>c.id===r.courseId) || {};
              const earned = r.completed ? (course.credits||0) : 0;
              return `<tr>
                <td>${r.courseTitle}</td>
                <td class="num">${r.best}%</td>
                <td class="num">${earned}/${course.credits||0}</td>
                <td>${r.completed? `<button class="btn" data-admin-cert="${uid}" data-course="${r.courseId}"><i class="ri-award-line"></i> Download</button>`:'—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
      $('#tv-out').innerHTML = html;
    }
    function adminGenerateCertificate(uid, courseId){
      const p = state.profiles.find(x=>x.uid===uid) || { name:'', email:'' };
      const course = state.courses.find(c=>c.id===courseId) || { title:courseId, credits:0 };
      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=1000;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,1000);
      ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(60,60,1280,880);
      ctx.fillStyle='#fff'; ctx.font='bold 60px Inter'; ctx.fillText('Certificate of Completion', 340, 240);
      ctx.font='28px Inter';
      ctx.fillText(`Awarded to: ${p.name||p.email}`, 340, 320);
      ctx.fillText(`Course: ${course.title||courseId}`, 340, 370);
      ctx.fillText(`Credits: ${course.credits||0}`, 340, 420);
      ctx.fillText(`Organization: LearnHub`, 340, 470);
      const id = 'LH-' + (courseId||'xxxx').slice(0,6).toUpperCase() + '-' + (uid||'user').slice(0,6).toUpperCase();
      ctx.fillText(`Certificate ID: ${id}`, 340, 520);
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 340, 570);
      if(p.signature){
        const img=new Image(); img.crossOrigin='anonymous'; img.onload=finish; img.src=p.signature;
      } else { finish(); }
      function finish(){
        if(p.signature){ ctx.drawImage(this, 980, 540, 260, 80); ctx.fillStyle='#fff'; ctx.font='20px Inter'; ctx.fillText('Authorized Signature', 1000, 640); }
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${(course.title||courseId)}_${(p.name||p.email||'user')}.png`; a.click();
      }
    }
    $('#tv-user')?.addEventListener('change', (e)=>{ const uid = e.target.value; $('#tv-out').innerHTML = uid ? '<div class="muted">Loading…</div>' : ''; if(uid) adminRenderTranscript(uid); });
    $('#main')?.addEventListener('click', (e)=>{
      const b = e.target.closest?.('button[data-admin-cert]'); if(!b) return;
      const uid = b.getAttribute('data-admin-cert');
      const courseId = b.getAttribute('data-course');
      adminGenerateCertificate(uid, courseId);
    });
  }

  // ---- Guide wiring (copy buttons etc.)
  function wireGuide(){
    const root = $('#main'); if(!root || root.__wired) return; root.__wired = true;
  }

  // ---- Announcements (Dashboard)
  function wireAnnouncements(){
    if(!canManageUsers()) return;
    $('#add-ann')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Announcement';
      $('#mm-body').innerHTML=`<div class="grid">
        <input id="an-title" class="input" placeholder="Title"/>
        <textarea id="an-body" class="input" placeholder="Body"></textarea>
      </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="an-save">Save</button>`; openModal('m-modal');
      $('#an-save').onclick=async ()=>{
        await col('announcements').add({ title:$('#an-title')?.value.trim(), body:$('#an-body')?.value.trim(), createdAt:firebase.firestore.FieldValue.serverTimestamp(), uid:auth.currentUser.uid });
        closeModal('m-modal'); notify('Announcement posted');
      };
    });

    $('#ann-list')?.addEventListener('click', async (e)=>{
      const ed=e.target.closest?.('button[data-edit-ann]'); const del=e.target.closest?.('button[data-del-ann]');
      if(ed){
        const id=ed.getAttribute('data-edit-ann'); const s=await doc('announcements',id).get(); if(!s.exists) return;
        const a={id:s.id,...s.data()};
        $('#mm-title').textContent='Edit Announcement';
        $('#mm-body').innerHTML=`<div class="grid">
          <input id="an-title" class="input" value="${a.title||''}"/>
          <textarea id="an-body" class="input">${a.body||''}</textarea>
        </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="an-save">Save</button>`; openModal('m-modal');
        $('#an-save').onclick=async ()=>{ await doc('announcements',id).set({ title:$('#an-title')?.value.trim(), body:$('#an-body')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true}); closeModal('m-modal'); notify('Saved'); };
      }
      if(del){
        const id=del.getAttribute('data-del-ann'); await doc('announcements',id).delete(); notify('Deleted');
      }
    });
  }

  // ---- Firestore sync
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    const uid=auth.currentUser.uid;

    state.unsub.push(
      col('profiles').onSnapshot(
        s => { state.profiles = s.docs.map(d=>({id:d.id, ...d.data()})); if (state.route === 'chat') populateDmUserSelect(); if (['profile','admin','chat'].includes(state.route)) render(); },
        err => console.warn('profiles listener error:', err)
      )
    );
    state.unsub.push(
      col('enrollments').where('uid','==',uid).onSnapshot(s=>{
        state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
        state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
        if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
      })
    );
    state.unsub.push(
      col('courses').orderBy('createdAt','desc').onSnapshot(
        s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if (state.route === 'chat') populateDmUserSelect(); if (['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
        err => console.warn('courses listener error:', err)
      )
    );
    state.unsub.push(
      col('quizzes').orderBy('createdAt','desc').onSnapshot(
        s => { state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()})); if(['assessments','dashboard','profile'].includes(state.route)) render(); },
        err => console.warn('quizzes listener error:', err)
      )
    );
    state.unsub.push(
      col('attempts').where('uid','==',uid).onSnapshot(
        s => { state.attempts = s.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0)); if(['assessments','profile','dashboard'].includes(state.route)) render(); },
        err => console.warn('attempts listener error:', err)
      )
    );
    state.unsub.push(
      col('tasks').where('uid','==',uid).onSnapshot(
        s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
        err => console.warn('tasks listener error:', err)
      )
    );
    state.unsub.push(
      col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(
        s=>{ state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard'].includes(state.route)) render(); }
      )
    );
    // NEW: progress sync
    state.unsub.push(
      col('progress').where('uid','==',uid).onSnapshot(
        s => { state.progress = s.docs.map(d=>({id:d.id, ...d.data()})); if(['courses','learning','profile','admin'].includes(state.route)) render(); },
        err => console.warn('progress listener error:', err)
      )
    );
  }

  async function resolveRole(uid){
    try{
      const r=await doc('roles',uid).get(); const role=(r.data()?.role||'student').toLowerCase();
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  // ---- Auth
  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){
      clearUnsubs();
      if(state._unsubChat){ try{state._unsubChat();}catch{} state._unsubChat=null; }
      onReady(render);
      return;
    }
    state.role = await resolveRole(user.uid);
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    onReady(applyTheme);
    sync();
    onReady(render);
  });

  // ---- Boot
  onReady(render);

  // ---- Seed demo courses (optional) ----
  window.seedDemoCourses = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const list=[
      {title:'Advanced Digital Marketing',category:'Marketing',credits:4,price:250,short:'Master SEO, social media, content strategy.',goals:['Get certified','Hands-on project','Career guidance'],coverImage:'https://images.unsplash.com/photo-1554774853-b415df9eeb92?w=1200&q=80', style: { cardClass: 'theme-gold' }},
      {title:'Modern Web Bootcamp',category:'CS',credits:5,price:0,short:'HTML, CSS, JS, and tooling.',goals:['Responsive sites','Deploy to Hosting','APIs basics'],coverImage:'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&q=80',
        style:{ bg:'linear-gradient(135deg,#0ea5e9,#22c55e)', text:'#0b1220', badgeBg:'rgba(255,255,255,.4)', badgeText:'#0b1220', imgFilter:'saturate(1.05)' } },
      {title:'Data Visualization 101',category:'Analytics',credits:3,price:120,short:'Chart design, data literacy, storytelling with visuals.',goals:['Good chart choices','Avoid mislead','Tell impact'],coverImage:'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1200&q=80',style:{cardClass:'theme-ice'}}
    ];
    for(const c of list){
      await col('courses').add({...c, ownerUid:u.uid, ownerEmail:u.email, participants:[u.uid], createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    }
    alert('Demo courses added');
  };
})();