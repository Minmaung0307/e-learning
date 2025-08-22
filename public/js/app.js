/* LearnHub — E-Learning & Community Platform (v1.3)
   Features: Courses (with chapters/lessons), Enrollments, Quizzes (single + multi),
             Attempts, Certificates (styled), Chat, Tasks, Profiles
   Roles: student | instructor | admin (roles/{uid}.role) + email override
*/
(() => {
  'use strict';

  /* ---------- Firebase ---------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  // Calm down WebChannel/HTTP3 issues on some networks
  try {
    db.settings({ experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
  } catch {}

  /* ---------- Constants ---------- */
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add your admin emails here
  const VALID_ROLES  = ['student','instructor','admin'];

  /* ---------- State ---------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette:'slate', font:'medium' },
    searchQ:'', highlightId:null,
    // data
    courses:[], enrollments:[], quizzes:[], attempts:[], messages:[], tasks:[], profiles:[],
    unsub:[]
  };

  /* ---------- Utils ---------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const notify=(msg,type='ok')=>{
    let n=$('#notification'); if(!n){n=document.createElement('div'); n.id='notification'; n.className='notification'; document.body.appendChild(n);}
    n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200);
  };
  const nowYear=()=> new Date().getFullYear();
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);
  const escapeHTML = (s)=> (s||'').replace(/[&<>]/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]) );

  /* ---- Theme Manager ---- */
  const setTheme = (palette, font) => {
    if (palette) state.theme.palette = palette;
    if (font) state.theme.font = font;
    document.documentElement.setAttribute('data-theme', state.theme.palette);
    document.documentElement.setAttribute('data-font', state.theme.font);
    try { localStorage.setItem('lh_theme', JSON.stringify(state.theme)); } catch {}
  };
  const loadTheme = () => {
    try {
      const saved = JSON.parse(localStorage.getItem('lh_theme') || '{}');
      if (saved.palette) state.theme.palette = saved.palette;
      if (saved.font) state.theme.font = saved.font;
    } catch {}
    setTheme(state.theme.palette, state.theme.font);
  };

  /* ---------- Permissions ---------- */
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled = (courseId)=> {
    const uid=auth.currentUser?.uid; if(!uid) return false;
    return state.enrollments.some(e=> e.courseId===courseId && e.uid===uid);
  };
  const canPostMessage = (courseId)=> isEnrolled(courseId) || state.role!=='student';
  const canTakeQuiz    = (courseId)=> isEnrolled(courseId) || state.role!=='student';

  /* ---------- Sidebar (mobile) ---------- */
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };
  const ensureEdge=()=>{ if($('#sidebarEdge')) return; const d=document.createElement('div'); d.id='sidebarEdge'; document.body.appendChild(d); ['pointerenter','touchstart'].forEach(e=> d.addEventListener(e, openSidebar, {passive:true})); };

  /* ---------- Search ---------- */
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''} ${(c.outline||[]).map(ch=>ch.title).join(' ')}`}));
    state.quizzes.forEach(q=> ix.push({label:q.title, section:'Quizzes', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'profile', id:p.uid, text:(p.bio||'')+' '+(p.portfolio||'')}));
    return ix;
  }
  function doSearch(q){
    const tokens=(q||'').toLowerCase().split(/\s+/).filter(Boolean);
    if(!tokens.length) return [];
    return buildIndex().map(item=>{
      const l=item.label.toLowerCase(), t=(item.text||'').toLowerCase();
      const ok=tokens.every(tok=> l.includes(tok)||t.includes(tok));
      return ok?{item,score:tokens.length + (l.includes(tokens[0])?1:0)}:null;
    }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,20);
  }

  /* ---------- Router + Layout ---------- */
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; closeSidebar(); render(); }

  function layout(content){
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand" id="brand">
          <div class="logo"><i class="ri-function-line"></i></div>
          <div class="title">LearnHub</div>
        </div>

        <div class="nav" id="side-nav">
          ${[
            ['dashboard','Dashboard','ri-dashboard-line'],
            ['courses','Courses','ri-book-2-line'],
            ['learning','My Learning','ri-graduation-cap-line'],
            ['assessments','Assessments','ri-file-list-3-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['settings','Settings','ri-settings-3-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
              <i class="${ic}"></i><span>${label}</span>
            </div>`).join('')}
        </div>

        <div class="footer" style="padding:10px 12px 16px">
          <div class="muted" id="copyright" style="font-size:12px">Powered by MM, ${nowYear()}</div>
        </div>
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

        <div class="backdrop" id="backdrop"></div>
        <div class="main" id="main">${content}</div>
      </div>
    </div>

    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop"></div>
    `;
  }

  /* ---------- Views ---------- */
  const vLogin=()=>`
  <div style="display:grid;place-items:center;min-height:100vh;padding:20px">
    <div class="card" style="width:min(420px,96vw)">
      <div class="card-body">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
          <div class="logo"><i class="ri-function-line"></i></div>
          <div><div style="font-size:20px;font-weight:800">LearnHub</div><div class="muted">Sign in to continue</div></div>
        </div>
        <div style="display:grid;gap:10px">
          <label>Email</label><input id="li-email" class="input" type="email" placeholder="you@example.com" autocomplete="username"/>
          <label>Password</label><input id="li-pass" class="input" type="password" placeholder="••••••••" autocomplete="current-password"/>
          <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
          <div style="display:flex;justify-content:space-between;gap:8px">
            <button id="link-forgot" class="btn ghost" style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot password</button>
            <button id="link-register" class="btn secondary" style="padding:6px 10px;font-size:12px"><i class="ri-user-add-line"></i> Sign up</button>
          </div>
          <div class="muted" style="font-size:12px;margin-top:6px">Default admin — admin@learnhub.com / admin123</div>
        </div>
      </div>
    </div>
  </div>`;

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
        <div><div class="muted">${label}</div><h2 style="margin:.2rem 0 0 0">${value}</h2></div>
        <div style="font-size:28px; opacity:.7"><i class="${icon}"></i></div>
      </div>
    </div>`;
  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Quizzes', state.quizzes.length,'assessments','ri-file-list-3-line')}
        ${dashCard('My Attempts', myAttempts,'assessments','ri-check-double-line')}
      </div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Welcome</h3>
        <p class="muted">Browse courses, enroll, take assessments, chat with peers, and earn certificates on completion.</p>
      </div></div>
    `;
  }

  function courseCard(c){
    return `
      <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:800">${c.title}</div>
            <div class="muted" style="font-size:12px">${c.category||'General'} • by ${c.ownerEmail||'—'}</div>
          </div>
          <div class="actions" style="display:flex;gap:6px">
            <button class="btn" data-open="${c.id}"><i class="ri-external-link-line"></i></button>
            ${canEditCourse(c)? `<button class="btn ghost" data-edit="${c.id}"><i class="ri-edit-line"></i></button>`:''}
          </div>
        </div>
      </div>`;
  }

  function vCourses(){
    const canCreate = canCreateCourse();
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">Courses</h3>
          ${canCreate? `<button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>`:''}
        </div>
        <div class="grid cols-2" data-sec="courses">
          ${state.courses.map(courseCard).join('')}
          ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
        </div>
      </div></div>
    `;
  }

  function vLearning(){
    const my=auth.currentUser?.uid; const list=state.enrollments.filter(e=>e.uid===my).map(e=> e.course||{} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2">
          ${list.map(c=>`
            <div class="card">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div><div style="font-weight:800">${c.title}</div><div class="muted" style="font-size:12px">${c.category||'General'}</div></div>
                <button class="btn" data-open-course="${c.id}">Open</button>
              </div>
            </div>`).join('')}
          ${!list.length? `<div class="muted" style="padding:10px">You’re not enrolled yet.</div>`:''}
        </div>
      </div></div>`;
  }

  function vAssessments(){
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Assessments</h3>
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="new-quiz"><i class="ri-add-line"></i> New Quiz</button>`:''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${state.quizzes.map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}%</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===auth.currentUser?.uid)? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.quizzes.length? `<div class="muted" style="padding:10px">No quizzes yet.</div>`:''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Quiz</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr><td>${a.quizTitle}</td><td class="num">${a.score}%</td><td>${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div></div>
    `;
  }

  const vChat=()=>`
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Course Chat</h3>
        <select id="chat-course" class="input" style="max-width:320px">
          <option value="">Select course…</option>
          ${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}
        </select>
      </div>
      <div id="chat-box" style="margin-top:10px;max-height:55vh;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:10px"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="chat-input" class="input" placeholder="Message…"/>
        <button class="btn" id="chat-send"><i class="ri-send-plane-2-line"></i></button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">Only enrolled students + instructors can post.</div>
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

  function vProfile(){
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <div style="display:flex;gap:8px">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Upload avatar</button>
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
            <div class="muted" style="font-size:12px">Tip: UID is in Authentication → Users.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
            ${state.profiles.map(p=>`<tr><td>${p.name||'—'}</td><td>${p.email||'—'}</td><td>${p.role||'student'}</td></tr>`).join('')}
            </tbody></table>
          </div>
        </div></div>
      </div>
    `;
  }

  function vSettings(){
    const palettes = ['sunrise','midnight','forest','ocean','grape','rose','sand','slate','emerald','amber','teal','dark'];
    const fonts = ['small','medium','large'];
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div><label>Palette</label>
            <select id="theme-palette" class="input">${palettes.map(p=>`<option value="${p}">${p}</option>`).join('')}</select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">${fonts.map(f=>`<option value="${f}">${f}</option>`).join('')}</select>
          </div>
        </div>
        <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap">
          ${palettes.map(p=>`<button class="btn ghost" data-palette="${p}" title="${p}">${p}</button>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save</button></div>
      </div></div>
    `;
  }

  function vSearch(){
    const q=state.searchQ||''; const res=q?doSearch(q):[];
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">Search</h3>
          <div class="muted">Query: <strong>${q||'(empty)'}</strong></div>
        </div>
        ${res.length? `<div class="grid">${res.map(r=>`
          <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:700">${r.label}</div>
              <div class="muted" style="font-size:12px">${r.section}</div>
            </div>
            <button class="btn" data-open-route="${r.route}" data-id="${r.id||''}">Open</button>
          </div></div>`).join('')}</div>` : `<p class="muted">No results.</p>`}
      </div></div>`;
  }

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
      case 'settings': return vSettings();
      case 'search': return vSearch();
      default: return vDashboard();
    }
  }

  /* ---------- Render ---------- */
  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
  }

  /* ---------- Wiring ---------- */
  function openModal(id){ $('#'+id)?.classList.add('active'); $('.modal-backdrop')?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('.modal-backdrop')?.classList.remove('active'); }

  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> document.body.classList.contains('sidebar-open')? closeSidebar(): openSidebar());
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);
    ensureEdge();

    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ go(it.getAttribute('data-route')); }
    });

    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());

    // search bar
    const input=$('#globalSearch'), results=$('#searchResults');
    if(input && results){
      let t;
      input.addEventListener('keydown', e=>{
        if(e.key==='Enter'){ state.searchQ=input.value.trim(); go('search'); results.classList.remove('active'); }
      });
      input.addEventListener('input', ()=>{
        clearTimeout(t); const q=input.value.trim(); if(!q){ results.classList.remove('active'); results.innerHTML=''; return; }
        t=setTimeout(()=>{
          const out=doSearch(q).slice(0,12);
          results.innerHTML=out.map(r=>`<div class="row" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span class="muted">— ${r.section}</span></div>`).join('');
          results.classList.add('active');
          results.querySelectorAll('.row').forEach(row=>{
            row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id'); state.searchQ=q; state.highlightId=id; go(r); results.classList.remove('active'); };
          });
        },120);
      });
      document.addEventListener('click', e=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
    }

    $('#mm-close')?.addEventListener('click', ()=> closeModal('m-modal'));
    $('#copyright')?.replaceChildren(document.createTextNode(`Powered by MM, ${nowYear()}`));
  }

  function wireRoute(){
    switch(state.route){
      case 'courses': wireCourses(); break;
      case 'learning': wireLearning(); break;
      case 'assessments': wireAssessments(); break;
      case 'chat': wireChat(); break;
      case 'tasks': wireTasks(); break;
      case 'profile': wireProfile(); break;
      case 'admin': wireAdmin(); break;
      case 'settings': wireSettings(); break;
      case 'search': wireSearch(); break;
    }
  }

  /* ---------- Login ---------- */
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
          doc('roles', uid).set({ uid, email, role: ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() }),
          doc('profiles', uid).set({ uid, email, name:'', bio:'', portfolio:'', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  /* ---------- Courses (with chapters/lessons) ---------- */
  function openCourseView(c){
    const outline = Array.isArray(c.outline)? c.outline : [];
    $('#mm-title').textContent=c.title;
    $('#mm-body').innerHTML=`
      <div class="grid">
        <div class="muted">${c.category||'General'} • by ${c.ownerEmail||'—'}</div>
        <p>${escapeHTML(c.desc||'')}</p>

        ${outline.length? `<div class="course-outline">
          <h3 style="margin:10px 0">Outline</h3>
          ${outline.map((ch,ci)=>`
            <div class="chapter">
              <h4>${escapeHTML(ch.title||`Chapter ${ci+1}`)}</h4>
              <div>${(ch.lessons||[]).map((ls,li)=>`
                <div class="lesson" data-ch="${ci}" data-li="${li}">
                  <i class="ri-play-circle-line"></i> ${escapeHTML(ls.title||`Lesson ${li+1}`)}
                </div>
              `).join('')}</div>
            </div>`).join('')}
        </div>` : `<div class="muted">No outline yet.</div>`}
      </div>`;
    $('#mm-foot').innerHTML=`
      <div style="display:flex;gap:8px">
        ${!isEnrolled(c.id)? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
        <button class="btn ghost" id="open-quiz"><i class="ri-question-line"></i> Quizzes</button>
      </div>`;
    openModal('m-modal');

    $('#mm-body')?.addEventListener('click', (e)=>{
      const l=e.target.closest('.lesson'); if(!l) return;
      const ch=+l.getAttribute('data-ch'), li=+l.getAttribute('data-li');
      const lesson=(outline[ch]?.lessons||[])[li]||{};
      showLesson(lesson, c.title);
    });

    $('#enroll')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await col('enrollments').add({ uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id, title:c.title, category:c.category} });
      closeModal('m-modal'); notify('Enrolled');
    });
    $('#open-quiz')?.addEventListener('click', ()=>{ state.searchQ=c.title; go('assessments'); });
  }

  function showLesson(lesson, courseTitle){
    $('#mm-title').textContent = `${courseTitle} — ${lesson.title||'Lesson'}`;
    const html = (lesson.html||'').toString();
    const imgs = (lesson.images||[]).map(u=>`<img src="${u}" alt="">`).join('');
    $('#mm-body').innerHTML = `<div class="course-content">${html}${imgs}</div>`;
    $('#mm-foot').innerHTML = `<button class="btn ghost" id="mm-close2">Close</button>`;
    $('#mm-close2')?.addEventListener('click', ()=> closeModal('m-modal'));
  }

  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <textarea id="c-desc" class="input" placeholder="Short description"></textarea>
          <label style="margin-top:6px">Outline JSON (chapters → lessons)</label>
          <textarea id="c-outline" class="input" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Intro","html":"<p>Hello</p>","images":["https://..."]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        let outline=[]; const raw=$('#c-outline')?.value.trim();
        if(raw){ try{ outline=JSON.parse(raw); }catch{ return notify('Invalid outline JSON','danger'); } }
        const obj={ title:t, category:$('#c-category')?.value.trim(), desc:$('#c-desc')?.value.trim(),
          outline, ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        await col('courses').add(obj); closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()};
        openCourseView(c);
      }
      if(editBtn){
        const id=editBtn.getAttribute('data-edit'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()}; if(!canEditCourse(c)) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Course';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="c-title" class="input" value="${c.title||''}"/>
            <input id="c-category" class="input" value="${c.category||''}"/>
            <textarea id="c-desc" class="input">${c.desc||''}</textarea>
            <label>Outline JSON</label>
            <textarea id="c-outline" class="input">${JSON.stringify(c.outline||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid outline JSON','danger'); }
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), desc:$('#c-desc')?.value.trim(),
            outline, updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()}; openCourseView(c);
    });
  }

  /* ---------- Quizzes (single + multiple) ---------- */
  function renderQuiz(q){
    $('#mm-title').textContent=q.title;
    $('#mm-body').innerHTML = (q.items||[]).map((it,idx)=>{
      const type = (it.type||'single')==='multi' ? 'multi' : 'single';
      const name = `q${idx}`;
      const choices = (it.choices||[]).map((c,i)=>{
        if(type==='multi'){
          return `<label style="display:flex; gap:8px; align-items:center">
            <input type="checkbox" name="${name}" value="${i}"/> <span>${escapeHTML(c)}</span>
          </label>`;
        }else{
          return `<label style="display:flex; gap:8px; align-items:center">
            <input type="radio" name="${name}" value="${i}"/> <span>${escapeHTML(c)}</span>
          </label>`;
        }
      }).join('');
      return `
        <div class="card"><div class="card-body">
          <div style="font-weight:700">Q${idx+1}. ${escapeHTML(it.q||'')}</div>
          <div style="margin-top:6px; display:grid; gap:6px">${choices}</div>
        </div></div>`;
    }).join('');
    $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
    openModal('m-modal');

    $('#q-submit').onclick=async ()=>{
      let correct=0;
      (q.items||[]).forEach((it,idx)=>{
        const type=(it.type||'single')==='multi'?'multi':'single';
        if(type==='multi'){
          const picked=Array.from(document.querySelectorAll(`input[name="q${idx}"]:checked`)).map(el=>+el.value).sort();
          const ans=[...(Array.isArray(it.answer)?it.answer:[it.answer])].map(Number).sort();
          const same = picked.length===ans.length && picked.every((v,i)=>v===ans[i]);
          if(same) correct++;
        }else{
          const v=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
          if(+v===+(Array.isArray(it.answer)?it.answer[0]:it.answer)) correct++;
        }
      });
      const score = Math.round((correct/Math.max(1,q.items.length))*100);
      await col('attempts').add({
        uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, score,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      closeModal('m-modal'); notify(`Your score: ${score}%`);
    };
  }

  function wireAssessments(){
    $('#new-quiz')?.addEventListener('click', ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Quiz';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Quiz title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <textarea id="q-json" class="input" style="min-height:180px" placeholder='[
  {"q":"2+2?","type":"single","choices":["3","4","5"],"answer":1},
  {"q":"Prime numbers","type":"multi","choices":["2","3","4","5"],"answer":[0,1,3]}
]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal('m-modal');
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let qs=[]; try{ qs=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, items:qs, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal('m-modal'); notify('Quiz saved');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeQuiz(q.courseId)) return notify('Enroll first to take','warn');
        renderQuiz(q);
      }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===auth.currentUser?.uid || state.role==='admin')) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Quiz';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <textarea id="q-json" class="input" style="min-height:180px">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  /* ---------- Chat ---------- */
  function wireChat(){
    const box=$('#chat-box'); const courseSel=$('#chat-course'); const input=$('#chat-input'); const send=$('#chat-send');
    let unsubChat=null, currentCourse='';
    const paint=(msgs)=>{
      box.innerHTML = msgs.map(m=>`
        <div style="margin-bottom:8px">
          <div style="font-weight:600">${escapeHTML(m.name||m.email||'User')} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
          <div>${escapeHTML(m.text||'')}</div>
        </div>`).join('');
      box.scrollTop=box.scrollHeight;
    };
    const sub=(cid)=>{
      unsubChat?.(); unsubChat=null; currentCourse=cid; box.innerHTML='';
      if(!cid) return;
      unsubChat = col('messages').where('courseId','==',cid).orderBy('createdAt').onSnapshot(s=>{
        state.messages = s.docs.map(d=>({id:d.id,...d.data()})); paint(state.messages);
      });
    };
    courseSel?.addEventListener('change', e=> sub(e.target.value));
    send?.addEventListener('click', async ()=>{
      const text=input.value.trim(); if(!text||!currentCourse) return;
      if(!canPostMessage(currentCourse)) return notify('Enroll to chat','warn');
      const p = state.profiles.find(x=>x.uid===auth.currentUser?.uid) || {};
      await col('messages').add({ courseId:currentCourse, uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      input.value='';
    });
  }

  /* ---------- Tasks ---------- */
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
      const btn=e.target.closest('button'); if(!btn) return;
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

    // drag drop
    root.querySelectorAll('.task-card').forEach(card=>{
      card.setAttribute('draggable','true'); card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
      card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    });
    root.querySelectorAll('.lane-grid').forEach(grid=>{
      const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
      const show=e=>{ e.preventDefault(); row?.classList.add('drop'); }; const hide=()=> row?.classList.remove('drop');
      grid.addEventListener('dragenter', show); grid.addEventListener('dragover', show); grid.addEventListener('dragleave', hide);
      grid.addEventListener('drop', async (e)=>{ e.preventDefault(); hide(); const id=e.dataTransfer.getData('text/plain'); if(!id) return;
        await doc('tasks',id).set({ status:lane, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      });
    });
  }

  /* ---------- Profile + Certificates ---------- */
  function drawCertificate(canvas, data){
    const ctx=canvas.getContext('2d');
    const W=canvas.width=1400, H=canvas.height=900;

    // background
    ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,W,H);

    // decorative border
    ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=10; ctx.strokeRect(40,40,W-80,H-80);
    ctx.strokeStyle='rgba(122,211,255,.5)'; ctx.lineWidth=2; ctx.strokeRect(70,70,W-140,H-140);

    // title
    ctx.fillStyle='#ffffff';
    ctx.font='700 64px "Playfair Display", Inter, serif';
    ctx.fillText('Certificate of Completion', 300, 200);

    // name + course
    ctx.font='600 36px Inter, system-ui';
    ctx.fillText(`Awarded to: ${data.name}`, 300, 280);
    ctx.font='400 30px Inter, system-ui';
    ctx.fillText(`For successfully completing: ${data.course}`, 300, 330);

    // date
    ctx.font='400 26px Inter, system-ui';
    ctx.fillText(`Date: ${data.date}`, 300, 380);

    // signature line
    ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(W-520, H-220); ctx.lineTo(W-180, H-220); ctx.stroke();
    ctx.font='italic 28px "Great Vibes", "Playfair Display", serif';
    ctx.fillText(data.signature||'Authorized Signature', W-500, H-230);
    ctx.font='600 18px Inter'; ctx.fillText(data.org||'LearnHub', W-460, H-190);
  }

  async function generateCertificate(course, profile){
    // make sure fonts are ready
    try{ await document.fonts.ready; }catch{}
    const canvas=document.createElement('canvas');
    drawCertificate(canvas, {
      name: profile.name || profile.email || 'Learner',
      course: course.title || 'Course',
      date: new Date().toLocaleDateString(),
      signature: profile.name ? `${profile.name}` : 'Authorized Signature',
      org: 'LearnHub'
    });
    const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${(course.title||'course').replace(/\s+/g,'_')}.png`; a.click();
  }

  function wireProfile(){
    $('#pf-pick')?.addEventListener('click', ()=> $('#pf-avatar')?.click());
    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(), bio:$('#pf-bio')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      const file=$('#pf-avatar')?.files?.[0];
      if(file){
        const ref=stg.ref().child(`avatars/${uid}/${file.name}`);
        await ref.put(file); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      notify('Profile saved');
    });

    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email};
      await generateCertificate(course, p);
    });
  }

  /* ---------- Admin ---------- */
  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      notify('Role saved');
    });
  }

  /* ---------- Settings ---------- */
  function wireSettings(){
    const pSel = document.getElementById('theme-palette');
    const fSel = document.getElementById('theme-font');
    if (pSel) pSel.value = state.theme.palette;
    if (fSel) fSel.value = state.theme.font;

    pSel?.addEventListener('change', e => setTheme(e.target.value, null));
    fSel?.addEventListener('change', e => setTheme(null, e.target.value));

    document.querySelectorAll('[data-palette]').forEach(btn=>{
      btn.addEventListener('click', ()=> setTheme(btn.getAttribute('data-palette'), null));
    });

    document.getElementById('save-theme')?.addEventListener('click', ()=> notify('Theme saved'));
  }

  function wireSearch(){
    $('#main')?.querySelectorAll('[data-open-route]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const r=el.getAttribute('data-open-route'); const id=el.getAttribute('data-id'); state.highlightId=id; go(r);
      });
    });
  }

  /* ---------- Transcript ---------- */
  function buildTranscript(uid){
    const byCourse = {};
    (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId, best:0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId);
      const pass = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
      byCourse[a.courseId].completed = pass;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  /* ---------- Firestore sync ---------- */
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    state.unsub.push(col('profiles').onSnapshot(s=>{ state.profiles=s.docs.map(d=>({id:d.id,...d.data()})); if(['profile','admin'].includes(state.route)) render(); }));
    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(s=>{ state.courses=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); }));
    state.unsub.push(col('enrollments').where('uid','==',auth.currentUser.uid).onSnapshot(s=>{ state.enrollments=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','learning'].includes(state.route)) render(); }));
    state.unsub.push(col('quizzes').orderBy('createdAt','desc').onSnapshot(s=>{ state.quizzes=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments'].includes(state.route)) render(); }));
    state.unsub.push(col('attempts').where('uid','==',auth.currentUser.uid).orderBy('createdAt','desc').onSnapshot(s=>{ state.attempts=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments','profile','dashboard'].includes(state.route)) render(); }));
    state.unsub.push(col('tasks').where('uid','==',auth.currentUser.uid).onSnapshot(s=>{ state.tasks=s.docs.map(d=>({id:d.id,...d.data()})); if(['tasks'].includes(state.route)) render(); }));
  }

  async function resolveRole(uid,email){
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',uid).get(); const role=(r.data()?.role||'student').toLowerCase();
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  /* ---------- Auth ---------- */
  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid, user.email);
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  /* ---------- Boot ---------- */
  loadTheme();
  render();

  /* ---------- Seed helper (optional) ---------- */
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    // Course with outline
    const outline = [
      { title:'Chapter 1: Getting Started', lessons:[
        { title:'Welcome', html:'<h3>Welcome</h3><p>This course introduces core ideas with examples.</p>', images:[] },
        { title:'Setup', html:'<p>Install tools and prepare your environment.</p>', images:[] }
      ]},
      { title:'Chapter 2: Deep Dive', lessons:[
        { title:'Concept A', html:'<p>Details about concept A.</p>', images:[] },
        { title:'Concept B (with image)', html:'<p>See the image below.</p>', images:['https://picsum.photos/seed/learnhub/800/400'] }
      ]}
    ];
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',desc:'Equations, functions, factoring.',outline,ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    const c2=await col('courses').add({title:'Intro to Web',category:'CS',desc:'HTML, CSS, JS.',ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math'}});
    // Quizzes (single + multi)
    await col('quizzes').add({title:'Algebra Quiz 1',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,items:[
      {q:'2+2?',type:'single',choices:['3','4','5'],answer:1},
      {q:'Prime numbers',type:'multi',choices:['2','3','4','5'],answer:[0,1,3]}
    ],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    alert('Seeded sample data');
  };
})();