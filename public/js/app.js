/* LearnHub — E-Learning & Community Platform (v1.3)
   - Firebase compat (Auth, Firestore, Storage)
   - Roles: student | instructor | admin (roles/{uid}.role + ADMIN_EMAILS override)
   - Features: Courses (outline w/ video + images), Enrollments, Finals (quizzes), Attempts,
               Transcript & Certificates, Course Chat, Sticky Notes per lesson, Tasks,
               Profiles (avatar + signature), Search w/ highlight, Themes (instant)
*/

(() => {
  'use strict';

  /* ---------- Firebase ---------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing.');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  // Helpers (must be above anything that uses them)
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);

  /* ---------- Constants ---------- */
  const ADMIN_EMAILS = ['admin@learnhub.com'];
  const VALID_ROLES  = ['student','instructor','admin'];

  /* ---------- State ---------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette: localStorage.getItem('lh_theme_palette') || 'sunrise',
            font:    localStorage.getItem('lh_theme_font')    || 'medium' },
    searchQ:'', highlightId:null,
    // data
    courses:[], enrollments:[], quizzes:[], attempts:[], messages:[], tasks:[], profiles:[], notes:[], inbox:[],
    // ui
    unsub:[]
  };

  /* ---------- Utils ---------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const nowYear=()=> new Date().getFullYear();

  const notify=(msg,type='ok')=>{
    let n=$('#notification');
    if(!n){ n=document.createElement('div'); n.id='notification'; n.className='notification'; document.body.appendChild(n); }
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=> n.className='notification', 2200);
  };

  const setTheme=(palette,font)=>{
    if(palette){ state.theme.palette=palette; localStorage.setItem('lh_theme_palette',palette); }
    if(font){ state.theme.font=font; localStorage.setItem('lh_theme_font',font); }
    document.documentElement.setAttribute('data-theme',state.theme.palette);
    document.documentElement.setAttribute('data-font',state.theme.font);
  };
  setTheme(state.theme.palette, state.theme.font);

  const youtubeEmbedUrl = (url)=>{
    if(!url) return '';
    const m = url.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);
    return m ? `https://www.youtube.com/embed/${m[1]}` : '';
  };

  /* ---------- Search ---------- */
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.quizzes.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
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

  /* ---------- Permissions ---------- */
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled = (courseId)=>{
    const uid=auth.currentUser?.uid; if(!uid) return false;
    return state.enrollments.some(e=> e.courseId===courseId && e.uid===uid);
  };
  const canTakeQuiz    = (courseId)=> isEnrolled(courseId) || state.role!=='student';
  const canPostMessage = (courseId)=> isEnrolled(courseId) || state.role!=='student';

  /* ---------- Router + Layout ---------- */
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; closeSidebar(); render(); }

  function layout(content){
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand" id="brand">
          <div class="logo"><img src="/assets/learnhub-mark.svg" alt="LearnHub"/></div>
          <div class="title">LearnHub</div>
        </div>

        <div class="nav" id="side-nav">
          ${[
            ['dashboard','Dashboard','ri-dashboard-line'],
            ['courses','Courses','ri-book-2-line'],
            ['learning','My Learning','ri-graduation-cap-line'],
            ['assessments','Final Exams','ri-file-list-3-line'],
            ['chat','Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['settings','Settings','ri-settings-3-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
              <i class="${ic}"></i><span>${label}</span>
            </div>`).join('')}
        </div>

        <div class="footer">
          <div class="muted" id="copyright" style="font-size:12px">© ${nowYear()} LearnHub</div>
        </div>
      </aside>

      <div>
        <div class="topbar">
          <div style="display:flex; align-items:center; gap:10px">
            <button class="btn ghost" id="burger" title="Menu"><i class="ri-menu-line"></i></button>
            <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
          </div>

          <div class="search-inline">
            <input id="globalSearch" class="input" placeholder="Search courses, finals, profiles…" autocomplete="off"/>
            <div id="searchResults" class="search-results"></div>
          </div>

          <div style="display:flex; gap:8px">
            <button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
          </div>
        </div>

        <div class="backdrop" id="backdrop"></div>
        <div class="main" id="main">${content}</div>
      </div>
    </div>

    <!-- Modal -->
    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop" id="mb-modal"></div>
    `;
  }

  /* ---------- Views ---------- */
  const vLogin=()=>`
  <div class="login-page">
    <div class="card login-card">
      <div class="card-body">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px">
          <div class="logo"><img src="/assets/learnhub-mark.svg" alt="LearnHub"/></div>
          <div><div style="font-size:20px; font-weight:800">LearnHub</div><div class="muted">Sign in to continue</div></div>
        </div>
        <div class="login-grid">
          <label>Email</label><input id="li-email" class="input" type="email" placeholder="you@example.com" autocomplete="username"/>
          <label>Password</label><input id="li-pass" class="input" type="password" placeholder="••••••••" autocomplete="current-password"/>
          <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
          <div style="display:flex; justify-content:space-between; gap:8px">
            <button id="link-forgot" class="btn ghost" style="padding:6px 10px; font-size:12px"><i class="ri-key-2-line"></i> Forgot password</button>
            <button id="link-register" class="btn secondary" style="padding:6px 10px; font-size:12px"><i class="ri-user-add-line"></i> Sign up</button>
          </div>
          <div class="muted" style="font-size:12px; margin-top:6px">Default admin — admin@learnhub.com / admin123</div>
        </div>
      </div>
    </div>
  </div>`;

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body stat">
        <div>
          <div class="muted">${label}</div>
          <h2>${value}</h2>
        </div>
        <div class="icon"><i class="${icon}"></i></div>
      </div>
    </div>`;

  function vDashboard(){
    const uid=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===uid).length;
    const myAttempts = state.attempts.filter(a=>a.uid===uid).length;
    const myTasks = state.tasks.filter(t=>t.uid===uid && t.status!=='done').length;
    const creditsEarned = buildTranscript(uid).reduce((s,r)=> s + (r.completed?(r.credits||0):0), 0);
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length, 'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll, 'learning','ri-graduation-cap-line')}
        ${dashCard('Finals Taken', myAttempts, 'assessments','ri-file-list-3-line')}
        ${dashCard('Open Tasks', myTasks, 'tasks','ri-list-check-2')}
      </div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Welcome</h3>
        <p class="muted">Browse courses, enroll, read lessons (with video), add sticky notes, chat, and take the final to earn credits & download your certificate.</p>
        <div class="muted" style="margin-top:8px">Total credits earned: <strong>${creditsEarned}</strong></div>
      </div></div>
    `;
  }

  function vCourses(){
    const canCreate = canCreateCourse();
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <h3 style="margin:0">Courses</h3>
          ${canCreate? `<button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>`:''}
        </div>
        <div class="grid cols-2" data-sec="courses">
          ${state.courses.map(c=>`
            <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">
                    ${c.category||'General'} • Credits: ${c.credits||0} • by ${c.ownerEmail||'—'}
                  </div>
                </div>
                <div class="actions" style="display:flex; gap:6px">
                  <button class="btn" data-open="${c.id}"><i class="ri-external-link-line"></i></button>
                  ${canEditCourse(c)? `<button class="btn ghost" data-edit="${c.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
        </div>
      </div></div>
    `;
  }

  function vLearning(){
    const uid=auth.currentUser?.uid;
    const list=state.enrollments.filter(e=>e.uid===uid).map(e=> e.course||{} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2">
          ${list.map(c=>`
            <div class="card">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • Credits: ${c.credits||0}</div>
                </div>
                <button class="btn" data-open-course="${c.id}">Open</button>
              </div>
            </div>`).join('')}
          ${!list.length? `<div class="muted" style="padding:10px">You’re not enrolled yet. Open a course and click “Enroll”.</div>`:''}
        </div>
      </div></div>`;
  }

  function vAssessments(){
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <h3 style="margin:0">Final Exams</h3>
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="new-quiz"><i class="ri-add-line"></i> New Final</button>`:''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${state.quizzes.map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">
                    ${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}% ${q.scheduledAt? '• exam: '+new Date(q.scheduledAt).toLocaleString() : ''}
                  </div>
                </div>
                <div class="actions" style="display:flex; gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===auth.currentUser?.uid)? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.quizzes.length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Course</th><th>Final</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr data-open-course="${a.courseId}">
                  <td>${a.courseTitle||'—'}</td>
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
      <div style="display:flex; justify-content:space-between; align-items:center">
        <h3 style="margin:0">Course Chat</h3>
        <select id="chat-course" class="input" style="max-width:320px">
          <option value="">Select course…</option>
          ${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}
        </select>
      </div>
      <div id="chat-box" style="margin-top:10px; max-height:55vh; overflow:auto; border:1px solid var(--border); border-radius:12px; padding:10px"></div>
      <div style="display:flex; gap:8px; margin-top:10px">
        <input id="chat-input" class="input" placeholder="Message…"/>
        <button class="btn" id="chat-send"><i class="ri-send-plane-2-line"></i></button>
      </div>
      <div class="muted" style="font-size:12px; margin-top:6px">Only enrolled students + instructors can post. Everyone enrolled can see the chat.</div>
    </div></div>`;

  function vTasks(){
    const uid=auth.currentUser?.uid;
    const lane=(key,label,color)=>{
      const cards=(state.tasks||[]).filter(t=> t.uid===uid && t.status===key);
      return `
        <div class="card lane-row" data-lane="${key}"><div class="card-body">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px">
            <h3 style="margin:0; color:${color}">${label}</h3>
            ${key==='todo'? `<button class="btn" id="addTask"><i class="ri-add-line"></i> Add Task</button>`:''}
          </div>
          <div class="grid lane-grid" id="lane-${key}">
            ${cards.map(t=>`
              <div class="card task-card" id="${t.id}" draggable="true" data-task="${t.id}" style="cursor:grab">
                <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'', avatar:'', signature:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <input id="pf-sign-name" class="input" placeholder="Signature name (text for fallback)" value="${me.signName||''}"/>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <input id="pf-sign" type="file" accept="image/*" style="display:none"/>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Upload avatar</button>
              <button class="btn ghost" id="pf-pick-sign"><i class="ri-pen-nib-line"></i> Upload signature</button>
            </div>
            <div class="muted" style="font-size:12px">After saving, fields stay filled (so you can edit). That’s expected.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Course</th><th>Best</th><th>Credits</th><th>Certificate</th></tr></thead>
              <tbody>
                ${buildTranscript(auth.currentUser?.uid).map(r=>`
                  <tr>
                    <td>${r.courseTitle}</td>
                    <td class="num">${r.best}%</td>
                    <td class="num">${r.credits||0}</td>
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
            <div class="muted" style="font-size:12px">Tip: UID is in Firebase → Authentication → Users.</div>
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
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div><label>Palette</label>
            <select id="theme-palette" class="input">
              ${['sunrise','ocean','forest','grape','dark'].map(x=>`<option value="${x}" ${state.theme.palette===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              ${['small','medium','large'].map(x=>`<option value="${x}" ${state.theme.font===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px">
          <button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save</button>
        </div>
      </div></div>
    `;
  }

  function vSearch(){
    const q=state.searchQ||''; const res=q?doSearch(q):[];
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <h3 style="margin:0">Search</h3>
          <div class="muted">Query: <strong>${q||'(empty)'}</strong></div>
        </div>
        ${res.length? `<div class="grid">${res.map(r=>`
          <div class="card"><div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
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

  /* ---------- Sidebar (mobile) ---------- */
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };
  const ensureEdge=()=>{ if($('#sidebarEdge')) return; const d=document.createElement('div'); d.id='sidebarEdge'; document.body.appendChild(d);
    ['pointerenter','touchstart'].forEach(e=> d.addEventListener(e, openSidebar, {passive:true}));
  };

  /* ---------- Render ---------- */
  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'}); } }
  }

  function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }

  /* ---------- Wiring (shell & per-view) ---------- */
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
  }

  function wireRoute(){
    switch(state.route){
      case 'dashboard':
        $('#main')?.addEventListener('click', e=>{
          const box=e.target.closest('[data-go]'); if(box){ go(box.getAttribute('data-go')); }
        });
        break;
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

  /* ---------- Courses ---------- */
  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credits" class="input" type="number" value="3" placeholder="Credits"/>
          <textarea id="c-desc" class="input" placeholder="Short description"></textarea>
          <textarea id="c-outline" class="input" placeholder='Outline JSON — see tools/seed.html for example'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid Outline JSON','danger'); }
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), desc:$('#c-desc')?.value.trim(),
          outline, ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        await col('courses').add(obj); closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        openCourseReader({id:snap.id, ...snap.data()});
      }
      if(editBtn){
        const id=editBtn.getAttribute('data-edit'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()}; if(!canEditCourse(c)) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Course';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="c-title" class="input" value="${c.title||''}"/>
            <input id="c-category" class="input" value="${c.category||''}"/>
            <input id="c-credits" class="input" type="number" value="${c.credits||0}"/>
            <textarea id="c-desc" class="input">${c.desc||''}</textarea>
            <textarea id="c-outline" class="input">${JSON.stringify(c.outline||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid Outline JSON','danger'); }
          await doc('courses', id).set({ title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), desc:$('#c-desc')?.value.trim(), outline, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  function openCourseReader(c){
    const enrolled=isEnrolled(c.id);
    $('#mm-title').textContent=c.title;
    // build TOC
    const toc = (c.outline||[]).map((ch,ci)=>`
      <div class="chapter">${ch.title||('Chapter '+(ci+1))}</div>
      ${(ch.lessons||[]).map((ls,li)=>`<div class="lesson" data-lesson="${ci}:${li}">${ls.title||('Lesson '+(li+1))}</div>`).join('')}
    `).join('');
    $('#mm-body').innerHTML=`
      <div class="reader">
        <div class="toc">
          <div class="muted" style="font-size:12px; margin-bottom:6px">${c.category||'General'} • Credits: ${c.credits||0}</div>
          ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
          <div style="margin-top:10px">${toc || '<div class="muted">No outline.</div>'}</div>
        </div>
        <div class="pane">
          <div id="lesson-head" style="font-weight:800; margin-bottom:8px">${c.desc||''}</div>
          <div class="video" id="lesson-video" style="display:none"></div>
          <div id="lesson-body" style="margin-top:8px"></div>

          <div class="note-box">
            <label for="note-text">My sticky note for this lesson</label>
            <textarea id="note-text" class="input" placeholder="Write a quick note…"></textarea>
            <button class="btn" id="note-save"><i class="ri-sticky-note-line"></i> Save note</button>
            <div id="note-list" class="muted" style="font-size:12px"></div>
          </div>
        </div>
      </div>
    `;
    $('#mm-foot').innerHTML=`
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <button class="btn ghost" id="open-final"><i class="ri-question-line"></i> Final Exam</button>
        <button class="btn ghost" id="close-reader">Close</button>
      </div>`;
    openModal('m-modal');

    // enroll
    $('#enroll')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await col('enrollments').add({ uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id, title:c.title, category:c.category, credits:c.credits||0} });
      notify('Enrolled');
      closeModal('m-modal');
    });

    // lesson rendering
    let currentKey='';
    function renderLesson(ci,li){
      const ch=(c.outline||[])[ci]||{}; const ls=(ch.lessons||[])[li]||{};
      currentKey=`${ci}:${li}`;
      $$('.lesson',$('.toc')).forEach(el=> el.classList.toggle('active', el.getAttribute('data-lesson')===currentKey));
      $('#lesson-head').textContent=ls.title||('Lesson '+(li+1));
      const emb = youtubeEmbedUrl(ls.video||'');
      const vbox = $('#lesson-video');
      if(emb){
        vbox.style.display='block';
        vbox.innerHTML=`<iframe src="${emb}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
      } else if(ls.video && /\.mp4($|\?)/i.test(ls.video)){
        vbox.style.display='block';
        vbox.innerHTML=`<video controls src="${ls.video}"></video>`;
      } else {
        vbox.style.display='none';
        vbox.innerHTML='';
      }
      $('#lesson-body').innerHTML = (ls.html||'').replace(/\n/g,'<br/>') + (Array.isArray(ls.images)? ls.images.map(u=>`<div style="margin-top:8px"><img src="${u}" style="max-width:100%; border-radius:8px; border:1px solid var(--border)"/></div>`).join('') : '');
      loadNotes();
    }
    // click TOC
    $$('.lesson',$('.toc')).forEach(el=>{
      el.addEventListener('click', ()=>{ const [ci,li]=el.getAttribute('data-lesson').split(':').map(n=>+n); renderLesson(ci,li); });
    });
    // default lesson
    if((c.outline||[])[0]?.lessons?.length) renderLesson(0,0);

    // notes
    async function loadNotes(){
      const uid=auth.currentUser?.uid; if(!uid || !currentKey) return;
      const snap=await col('notes').where('uid','==',uid).where('courseId','==',c.id).where('lessonKey','==',currentKey).orderBy('createdAt','desc').get();
      const list=snap.docs.map(d=>d.data());
      $('#note-list').innerHTML = list.length? list.map(n=>`• ${new Date(n.createdAt?.toDate?.()||n.createdAt).toLocaleString()}: ${n.text}`).join('<br/>') : 'No notes yet.';
    }
    $('#note-save')?.addEventListener('click', async ()=>{
      const text=$('#note-text')?.value.trim(); if(!text||!currentKey) return;
      await col('notes').add({ uid:auth.currentUser.uid, courseId:c.id, lessonKey:currentKey, text,
        createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      $('#note-text').value=''; loadNotes(); notify('Note saved');
    });

    // open final (jumps to Assessments route and highlights quiz for this course)
    $('#open-final')?.addEventListener('click', ()=>{
      state.searchQ=c.title; go('assessments');
    });
    $('#close-reader')?.addEventListener('click', ()=> closeModal('m-modal'));
  }

  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course], tr[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      openCourseReader({id:snap.id, ...snap.data()});
    });
  }

  /* ---------- Finals (Quizzes) ---------- */
  function wireAssessments(){
    // create
    $('#new-quiz')?.addEventListener('click', ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Final title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <input id="q-when" class="input" type="datetime-local" />
          <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":1,"feedback":["No","Yes","No"]}]'></textarea>
          <div class="muted" style="font-size:12px">Use choices[], answer (index), and optional feedback[] same length as choices[].</div>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal('m-modal');
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        const when=$('#q-when')?.value? new Date($('#q-when').value).toISOString() : '';
        if(!t||!courseId) return notify('Fill title & course','warn');
        let qs=[]; try{ qs=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, items:qs, scheduledAt:when, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal('m-modal'); notify('Final saved');
      };
    });

    // take/edit
    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeQuiz(q.courseId)) return notify('Enroll first to take','warn');

        $('#mm-title').textContent=q.title;
        $('#mm-body').innerHTML = `
          <div style="max-height:65vh; overflow:auto; padding-right:4px">
            ${q.items.map((it,idx)=>`
              <div class="card" style="margin-bottom:8px"><div class="card-body">
                <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
                <div style="margin-top:6px; display:grid; gap:6px">
                  ${it.choices.map((c,i)=>`
                    <label style="display:flex; gap:8px; align-items:center">
                      <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
                    </label>`).join('')}
                </div>
                <div class="muted" id="fb-${idx}" style="font-size:12px; margin-top:6px"></div>
              </div></div>
            `).join('')}
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
        openModal('m-modal');

        // instant feedback on select
        q.items.forEach((it,idx)=>{
          $$( `input[name="q${idx}"]` ).forEach(r=>{
            r.addEventListener('change', ()=>{
              const choice=+r.value;
              const ok = choice===+it.answer;
              const fb = (it.feedback||[])[choice] || (ok? 'Correct':'Incorrect');
              const el = $('#fb-'+idx); if(el){ el.textContent=fb; el.style.color = ok? '#10b981' : '#ef4444'; }
            });
          });
        });

        $('#q-submit').onclick=async ()=>{
          let correct=0;
          q.items.forEach((it,idx)=>{
            const v=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
            if(+v===+it.answer) correct++;
          });
          const score = Math.round((correct/q.items.length)*100);
          await col('attempts').add({
            uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, courseTitle:q.courseTitle,
            score, createdAt:firebase.firestore.FieldValue.serverTimestamp()
          });
          closeModal('m-modal'); notify(`Your score: ${score}%`);
        };
      }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===auth.currentUser?.uid || state.role==='admin')) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <input id="q-when" class="input" type="datetime-local" value="${q.scheduledAt? new Date(q.scheduledAt).toISOString().slice(0,16):''}"/>
            <textarea id="q-json" class="input">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          const when=$('#q-when')?.value? new Date($('#q-when').value).toISOString() : '';
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, scheduledAt:when, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });

    // click attempt row to open course
    $('#main')?.querySelectorAll('tr[data-open-course]')?.forEach(tr=>{
      tr.addEventListener('click', async ()=>{
        const id=tr.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        openCourseReader({id:snap.id, ...snap.data()});
      });
    });
  }

  /* ---------- Chat ---------- */
  function wireChat(){
    const box=$('#chat-box'); const courseSel=$('#chat-course'); const input=$('#chat-input'); const send=$('#chat-send');
    let unsubChat=null, currentCourse='';
    const paint=(msgs)=>{
      box.innerHTML = msgs.map(m=>`
        <div style="margin-bottom:8px">
          <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
          <div>${(m.text||'').replace(/</g,'&lt;')}</div>
        </div>`).join('');
      box.scrollTop=box.scrollHeight;
    };
    const sub=(cid)=>{
      unsubChat?.(); unsubChat=null; currentCourse=cid; box.innerHTML='';
      if(!cid) return;
      unsubChat = col('messages').where('courseId','==',cid).orderBy('createdAt').onSnapshot(s=>{
        state.messages = s.docs.map(d=>({id:d.id,...d.data()})); paint(state.messages);
      }, err => console.warn(err));
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

  /* ---------- Profile ---------- */
  function wireProfile(){
    $('#pf-pick')?.addEventListener('click', ()=> $('#pf-avatar')?.click());
    $('#pf-pick-sign')?.addEventListener('click', ()=> $('#pf-sign')?.click());
    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(), bio:$('#pf-bio')?.value.trim(), signName:$('#pf-sign-name')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      const avatar=$('#pf-avatar')?.files?.[0];
      if(avatar){
        const ref=stg.ref().child(`avatars/${uid}/${avatar.name}`);
        await ref.put(avatar); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      const sign=$('#pf-sign')?.files?.[0];
      if(sign){
        const ref=stg.ref().child(`signatures/${uid}/${sign.name}`);
        await ref.put(sign); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ signature:url },{merge:true});
      }
      notify('Profile saved');
    });

    // certificate download
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email, signName:''};
      // Generate nicer certificate PNG
      const canvas=document.createElement('canvas'); canvas.width=1600; canvas.height=1100;
      const ctx=canvas.getContext('2d');
      // background + border
      ctx.fillStyle='#fdfaf5'; ctx.fillRect(0,0,1600,1100);
      ctx.strokeStyle='#0b0d10'; ctx.lineWidth=8; ctx.strokeRect(50,50,1500,1000);
      ctx.strokeStyle='#b1976b'; ctx.lineWidth=4; ctx.strokeRect(70,70,1460,960);
      // title
      ctx.fillStyle='#0b0d10';
      ctx.font='700 64px Georgia';
      ctx.fillText('Certificate of Completion', 420, 260);
      // recipient
      ctx.font='400 28px Georgia';
      ctx.fillText('This certifies that', 680, 330);
      ctx.font='700 48px Georgia';
      ctx.fillText(`${p.name||auth.currentUser.email}`, 520, 400);
      ctx.font='400 28px Georgia';
      ctx.fillText('has successfully completed the course', 560, 450);
      ctx.font='700 36px Georgia';
      ctx.fillText(`${course.title||courseId}`, 560, 500);
      ctx.font='400 24px Georgia';
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 560, 560);
      // signature line
      ctx.beginPath(); ctx.moveTo(560, 700); ctx.lineTo(1100, 700); ctx.strokeStyle='#222'; ctx.lineWidth=2; ctx.stroke();
      ctx.font='400 20px Georgia'; ctx.fillStyle='#444'; ctx.fillText('Authorized Signature', 760, 730);
      // signature image if any
      if(p.signature){
        const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>{ ctx.drawImage(img, 700, 630, 250, 80); download(); };
        img.onerror=download; img.src=p.signature;
      } else {
        // fallback signature text
        ctx.font='italic 32px Georgia'; ctx.fillStyle='#222'; ctx.fillText(p.signName||'LearnHub', 720, 690);
        download();
      }
      function download(){
        const url=canvas.toDataURL('image/png');
        const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
      }
    });
  }

  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      notify('Role saved');
    });
  }

  function wireSettings(){
    $('#theme-palette')?.addEventListener('change', e=> setTheme(e.target.value, null));
    $('#theme-font')?.addEventListener('change', e=> setTheme(null, e.target.value));
    $('#save-theme')?.addEventListener('click', ()=> notify('Theme saved'));
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
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:a.courseTitle||a.courseId, best:0, completed:false, credits:0};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId);
      const pass = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
      byCourse[a.courseId].completed = pass;
      byCourse[a.courseId].credits = pass ? (state.courses.find(c=>c.id===a.courseId)?.credits||0) : 0;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  /* ---------- Firestore sync ---------- */
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    // profiles
    state.unsub.push(col('profiles').onSnapshot(s=>{ state.profiles=s.docs.map(d=>({id:d.id,...d.data()})); if(['profile','admin'].includes(state.route)) render(); }));
    // courses
    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(s=>{ state.courses=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); }));
    // my enrollments
    state.unsub.push(col('enrollments').where('uid','==',auth.currentUser.uid).onSnapshot(s=>{ state.enrollments=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','learning'].includes(state.route)) render(); }));
    // finals
    state.unsub.push(col('quizzes').orderBy('createdAt','desc').onSnapshot(s=>{ state.quizzes=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments'].includes(state.route)) render(); }));
    // attempts
    state.unsub.push(col('attempts').where('uid','==',auth.currentUser.uid).orderBy('createdAt','desc').onSnapshot(s=>{ state.attempts=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments','profile','dashboard'].includes(state.route)) render(); }));
    // tasks
    state.unsub.push(col('tasks').where('uid','==',auth.currentUser.uid).onSnapshot(s=>{ state.tasks=s.docs.map(d=>({id:d.id,...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); }));
  }

  async function resolveRole(uid,email){
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',uid).get(); const role=(r.data() && r.data().role || 'student').toLowerCase();
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  /* ---------- Auth ---------- */
  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid, user.email);
    // ensure profile exists + store role on profile for admin list
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', createdAt:firebase.firestore.FieldValue.serverTimestamp(), role: state.role });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  /* ---------- Seed helper (dev) ---------- */
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    // course sample
    const outline = [
      { title:"Chapter 1: Basics", lessons:[
        { title:"Welcome", video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ", html:"Welcome text here. You can put HTML or plain text.", images:[] },
        { title:"Numbers", html:"Understanding numbers…", images:[] }
      ]},
      { title:"Chapter 2: Algebra", lessons:[
        { title:"Equations", html:"ax + b = 0", images:[] }
      ]}
    ];
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',credits:3,desc:'Equations, functions, factoring.',outline,ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3}});
    await col('quizzes').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,items:[
      {q:'2+2?',choices:['3','4','5'],answer:1,feedback:['No','Correct','No']},
      {q:'5x=20, x=?',choices:['2','4','5'],answer:2,feedback:['No','No','Correct']}
    ],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    alert('Seeded sample Algebra course + final');
  };

  /* ---------- Boot ---------- */
  render();
})();