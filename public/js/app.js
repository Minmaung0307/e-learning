/* LearnHub — E-Learning & Community Platform (v1.3)
   - Auth, Firestore, Storage (Firebase v9 compat)
   - Roles: student | instructor | admin
   - Collections: profiles, roles, courses, enrollments, quizzes, attempts, tasks, messages, notes, announcements
*/
(() => {
  'use strict';

  /* ---------- Firebase ---------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing.');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  /* ---------- Constants ---------- */
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add extra admin emails here
  const VALID_ROLES  = ['student','instructor','admin'];

  /* ---------- State ---------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette:'dark', font:'medium' },
    searchQ:'', highlightId:null,
    // data
    profiles:[], courses:[], enrollments:[], quizzes:[], attempts:[], tasks:[], messages:[], notes:[], announcements:[],
    myEnrolledIds: new Set(),
    // runtime
    unsub:[],
    _unsubChat:null
  };

  /* ---------- Utils ---------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const nowYear=()=> new Date().getFullYear();
  const notify=(msg,type='ok')=>{
    const n=$('#notification'); if(!n) return;
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=> n.className='notification', 2200);
  };
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);
  const safeTS = (ts)=> ts && ts.toMillis ? ts.toMillis() : (typeof ts==='number'? ts : 0);

  /* ---------- Search ---------- */
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''} ${c.short||''}`}));
    state.quizzes.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'profile', id:p.uid, text:(p.bio||'') + ' ' + (p.portfolio||'') }));
    return ix;
  }
  function doSearch(q){
    const tokens=(q||'').toLowerCase().split(/\s+/).filter(Boolean);
    if(!tokens.length) return [];
    return buildIndex()
      .map(item=>{
        const l=item.label.toLowerCase(), t=(item.text||'').toLowerCase();
        const ok=tokens.every(tok=> l.includes(tok)||t.includes(tok));
        return ok?{item,score:tokens.length + (l.includes(tokens[0])?1:0)}:null;
      }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,20);
  }

  /* ---------- Permissions ---------- */
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled      = (courseId)=> state.myEnrolledIds.has(courseId);
  const canPostMessage  = (courseId)=> isEnrolled(courseId) || state.role!=='student';
  const canTakeQuiz     = (courseId)=> isEnrolled(courseId) || state.role!=='student';

  /* ---------- Router ---------- */
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search','guide'];
  function go(route){ state.route = routes.includes(route)? route : 'dashboard'; closeSidebar(); render(); }

  /* ---------- Layout ---------- */
  function layout(content){
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand" id="brand">
          <div class="logo"><img src="/icons/learnhub-192.png" alt="LearnHub"/></div>
          <div class="title">LearnHub</div>
        </div>
        <div class="nav" id="side-nav">
          ${[
            ['dashboard','Dashboard','ri-dashboard-line'],
            ['courses','Courses','ri-book-2-line'],
            ['learning','My Learning','ri-graduation-cap-line'],
            ['assessments','Finals','ri-award-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['settings','Settings','ri-settings-3-line'],
            ['guide','Guide','ri-question-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
              <i class="${ic}"></i><span>${label}</span>
            </div>`).join('')}
        </div>
        <div class="footer">
          <div class="muted" id="copyright" style="font-size:12px">Powered by MM, ${nowYear()}</div>
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
    <div class="card login-card"><div class="card-body">
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px">
        <div class="logo" style="width:44px;height:44px;border-radius:12px;background:#0c1626;display:grid;place-items:center;overflow:hidden">
          <img src="/icons/learnhub-192.png" alt="LearnHub" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div><div style="font-size:20px; font-weight:800">LearnHub</div><div class="muted">Sign in to continue</div></div>
      </div>
      <div class="grid">
        <label>Email</label><input id="li-email" class="input" type="email" placeholder="you@example.com" autocomplete="username"/>
        <label>Password</label><input id="li-pass" class="input" type="password" placeholder="••••••••" autocomplete="current-password"/>
        <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
        <div style="display:flex; justify-content:space-between; gap:8px">
          <button id="link-forgot" class="btn ghost" style="padding:6px 10px; font-size:12px"><i class="ri-key-2-line"></i> Forgot password</button>
          <button id="link-register" class="btn secondary" style="padding:6px 10px; font-size:12px"><i class="ri-user-add-line"></i> Sign up</button>
        </div>
        <div class="muted" style="font-size:12px">Default admin — admin@learnhub.com / admin123</div>
      </div>
    </div></div>
  </div>`;

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
        <div>
          <div class="muted" style="font-size:12px">${label}</div>
          <h2 style="margin:6px 0 0 0">${value}</h2>
        </div>
        <i class="${icon}" style="font-size:26px; opacity:.8"></i>
      </div>
    </div>`;

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    const myTasks = state.tasks.filter(t=>t.uid===my && t.status!=='done').length;
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.filter(q=>q.isFinal===true).length,'assessments','ri-award-line')}
        ${dashCard('Open Tasks', myTasks,'tasks','ri-list-check-2')}
      </div>
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Welcome</h3>
        <p class="muted">Browse courses, enroll, take finals, chat with peers, manage tasks, and earn certificates.</p>
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
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center; gap:10px">
                <div style="flex:1">
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits</div>
                  ${c.short? `<div class="muted" style="margin-top:6px">${c.short}</div>`:''}
                </div>
                <div style="display:flex; gap:6px">
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
    const my=auth.currentUser?.uid; const list=state.enrollments.filter(e=>e.uid===my).map(e=> e.course||{} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2">
          ${list.map(c=>`
            <div class="card">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div><div style="font-weight:800">${c.title}</div><div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits</div></div>
                <button class="btn" data-open-course="${c.id}">Open</button>
              </div>
            </div>`).join('')}
          ${!list.length? `<div class="muted" style="padding:10px">You’re not enrolled yet.</div>`:''}
        </div>
      </div></div>`;
  }

  function vAssessments(){
    const finals=state.quizzes.filter(q=>q.isFinal===true);
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <h3 style="margin:0">Final Exams</h3>
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="new-final"><i class="ri-add-line"></i> New Final</button>`:''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${finals.map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}%</div>
                </div>
                <div class="actions" style="display:flex; gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===auth.currentUser?.uid)? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!finals.length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
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
      <div class="muted" style="font-size:12px; margin-top:6px">Only enrolled students + instructors can post.</div>
    </div></div>`;

  function vTasks(){
    const my=auth.currentUser?.uid;
    const lane=(key,label,color)=>{
      const cards=(state.tasks||[]).filter(t=> t.uid===my && t.status===key);
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <h3 style="margin:0">My Profile</h3>
            <span class="muted" style="font-size:12px">UID: ${auth.currentUser?.uid||''}</span>
          </div>
          <div class="grid">
            <label>Name</label><input id="pf-name" class="input" value="${me.name||''}" placeholder="Your name"/>
            <label>Email</label><input id="pf-email" class="input" value="${me.email||auth.currentUser?.email||''}" placeholder="you@example.com"/>
            <label>Portfolio URL</label><input id="pf-portfolio" class="input" value="${me.portfolio||''}" placeholder="https://…"/>
            <label>Short bio</label><textarea id="pf-bio" class="input" placeholder="Tell us about you…">${me.bio||''}</textarea>
            <div class="grid cols-2">
              <div><label>Avatar</label><input id="pf-avatar" type="file" accept="image/*"/></div>
              <div><label>Signature (PNG)</label><input id="pf-sign" type="file" accept="image/png,image/webp"/></div>
            </div>
            <div style="display:flex; gap:8px"><button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button><button class="btn ghost" id="pf-view"><i class="ri-id-card-line"></i> View card</button></div>
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
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
            ${state.profiles.map(p=>`
              <tr>
                <td>${p.name||'—'}</td>
                <td>${p.email||'—'}</td>
                <td>${p.role||'student'}</td>
                <td><button class="btn ghost" data-edit-user="${p.uid}"><i class="ri-edit-line"></i></button></td>
              </tr>`).join('')}
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
              <option value="dark">dark</option>
              <option value="sunrise">sunrise</option>
              <option value="ocean">ocean</option>
              <option value="forest">forest</option>
              <option value="grape">grape</option>
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              <option value="small">small</option>
              <option value="medium" selected>medium</option>
              <option value="large">large</option>
            </select>
          </div>
        </div>
        <div style="margin-top:10px"><button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save</button></div>
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
            <div><div style="font-weight:700">${r.label}</div><div class="muted" style="font-size:12px">${r.section}</div></div>
            <button class="btn" data-open-route="${r.route}" data-id="${r.id||''}">Open</button>
          </div></div>`).join('')}</div>` : `<p class="muted">No results.</p>`}
      </div></div>`;
  }

  function vGuide(){
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Quick “How to use”</h3>
        <div class="grid">
          <div class="card"><div class="card-body">
            <strong>Students</strong>
            <ul>
              <li>Open <em>Courses</em> → pick a course → <em>Enroll</em>.</li>
              <li>Study content chapter-by-chapter, watch videos, add personal notes.</li>
              <li>Chat in <em>Course Chat</em> (must be enrolled).</li>
              <li>Take the final in <em>Finals</em>. Passing ≥ pass score adds certificate.</li>
              <li>See best scores & download certificate under <em>Profile → Transcript</em>.</li>
              <li>Track your to-dos in <em>Tasks</em> (drag between lanes).</li>
            </ul>
          </div></div>
          <div class="card"><div class="card-body">
            <strong>Instructors/Admin</strong>
            <ul>
              <li>Create courses in <em>Courses</em> (title, category, credits, short, outline JSON).</li>
              <li>Add a final under <em>Finals</em> (check “is final”, set pass score).</li>
              <li>Use <em>Admin</em> → set user roles (student/instructor/admin).</li>
              <li>Chat with students in <em>Course Chat</em>; use Announcements (future).</li>
            </ul>
          </div></div>
        </div>
      </div></div>
    `;
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
      case 'guide': return vGuide();
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

  /* ---------- Sidebar (mobile) ---------- */
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };

  /* ---------- Wiring ---------- */
  function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }

  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> document.body.classList.contains('sidebar-open')? closeSidebar(): openSidebar());
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);

    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ go(it.getAttribute('data-route')); }
    });
    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());

    // clickable dashboard cards
    $('#main')?.addEventListener('click', e=>{
      const c=e.target.closest('[data-go]'); if(c){ go(c.getAttribute('data-go')); }
    });

    // search
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
          doc('profiles', uid).set({ uid, email, name: (email.split('@')[0]), bio:'', portfolio:'', avatar:'', signature:'', role: ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  /* ---------- Courses ---------- */
  function parseOutline(str){
    try{ const v=JSON.parse(str||'[]'); return Array.isArray(v)? v : []; }catch{return [];}
  }
  function renderCourseBody(c,enrolled){
    const outline=parseOutline(c.outline);
    const chaptersHTML = outline.map((ch,ci)=>`
      <div class="card"><div class="card-body">
        <div style="font-weight:800">Chapter ${ci+1}. ${ch.title||''}</div>
        <div class="grid" style="margin-top:6px">
          ${(ch.lessons||[]).map((ls,li)=>`
            <div class="card"><div class="card-body">
              <div style="font-weight:700">${ls.title||''}</div>
              ${ls.video? `<div style="margin:8px 0"><iframe width="100%" height="320" src="https://www.youtube.com/embed/${(ls.video||'').split('v=')[1]||''}" title="Video" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>`:''}
              ${ls.html? `<div style="white-space:pre-wrap">${ls.html}</div>`:''}
              ${(ls.images||[]).map(src=>`<img src="${src}" style="max-width:100%; border-radius:12px; margin-top:6px">`).join('')}
              ${enrolled? `<div style="margin-top:8px">
                <input id="note-${c.id}-${ci}-${li}" class="input" placeholder="Sticky note for you…"/>
                <button class="btn" data-save-note="${c.id}" data-ci="${ci}" data-li="${li}"><i class="ri-sticky-note-line"></i> Save note</button>
              </div>`:''}
            </div></div>
          `).join('')}
        </div>
      </div></div>
    `).join('');

    return `
      <div class="grid">
        <div class="muted">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
        ${c.short? `<p>${c.short}</p>`:''}
        ${chaptersHTML || '<div class="muted">No outline yet.</div>'}
      </div>`;
  }

  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credits" class="input" type="number" value="3" placeholder="Credits"/>
          <input id="c-short" class="input" placeholder="Short description"/>
          <label>Outline JSON</label>
          <textarea id="c-outline" class="input" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Intro","video":"https://www.youtube.com/watch?v=...","html":"Welcome","images":[]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(), outline:$('#c-outline')?.value.trim(),
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        await col('courses').add(obj); closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()};
        const enrolled = isEnrolled(c.id);
        $('#mm-title').textContent=c.title;
        $('#mm-body').innerHTML = renderCourseBody(c,enrolled);
        $('#mm-foot').innerHTML=`
          <div style="display:flex; gap:8px">
            ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
            <button class="btn ghost" id="open-final"><i class="ri-award-line"></i> Final exam</button>
          </div>`;
        openModal('m-modal');

        $('#enroll')?.addEventListener('click', async ()=>{
          const uid=auth.currentUser.uid;
          await col('enrollments').add({ uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id, title:c.title, category:c.category, credits:c.credits||0} });
          closeModal('m-modal'); notify('Enrolled');
        });
        $('#open-final')?.addEventListener('click', ()=>{ state.searchQ=c.title; go('assessments'); });

        // save notes
        $('#mm-body')?.addEventListener('click', async (ev)=>{
          const b=ev.target.closest('button[data-save-note]'); if(!b) return;
          const courseId=b.getAttribute('data-save-note'); const ci=+b.getAttribute('data-ci'); const li=+b.getAttribute('data-li');
          const input = $(`#note-${courseId}-${ci}-${li}`); const text=(input?.value||'').trim(); if(!text) return;
          await col('notes').add({ uid:auth.currentUser.uid, courseId, chapter:ci, lesson:li, text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
          input.value=''; notify('Note saved');
        });
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
            <input id="c-short" class="input" value="${c.short||''}"/>
            <label>Outline JSON</label>
            <textarea id="c-outline" class="input">${c.outline||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          await doc('courses', id).set({ title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(), outline:$('#c-outline')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()};
      $('#mm-title').textContent=c.title;
      $('#mm-body').innerHTML=renderCourseBody(c,true);
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`;
      openModal('m-modal');
      $('#mm-ok').onclick=()=> closeModal('m-modal');
    });
  }

  /* ---------- Finals (Quizzes) ---------- */
  function wireAssessments(){
    $('#new-final')?.addEventListener('click', ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Final title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <label>Items JSON</label>
          <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":1}]'></textarea>
          <label><input type="checkbox" id="q-final" checked/> This is final exam</label>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal('m-modal');
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70); const isFinal=$('#q-final')?.checked;
        if(!t||!courseId) return notify('Fill title & course','warn');
        let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, isFinal:!!isFinal, items, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal('m-modal'); notify('Final saved');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeQuiz(q.courseId)) return notify('Enroll first to take','warn');
        // render quiz in a tall modal (scrollable)
        $('#mm-title').textContent=q.title;
        $('#mm-body').innerHTML = q.items.map((it,idx)=>`
          <div class="card"><div class="card-body">
            <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
            <div style="margin-top:6px; display:grid; gap:6px">
              ${it.choices.map((c,i)=>`
                <label style="display:flex; gap:8px; align-items:center">
                  <input type="${Array.isArray(it.answers)?'checkbox':'radio'}" name="q${idx}" value="${i}"/> <span>${c}</span>
                </label>`).join('')}
            </div>
            ${it.feedback? `<div class="muted" style="font-size:12px; margin-top:6px">${it.feedback}</div>`:''}
          </div></div>
        `).join('');
        $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
        openModal('m-modal');

        $('#q-submit').onclick=async ()=>{
          let correct=0;
          q.items.forEach((it,idx)=>{
            const nodes=[...document.querySelectorAll(`input[name="q${idx}"]`)];
            if(Array.isArray(it.answers)){
              const sel = nodes.filter(n=>n.checked).map(n=>+n.value).sort((a,b)=>a-b).join(',');
              const ans = (it.answers||[]).slice().sort((a,b)=>a-b).join(',');
              if(sel===ans) correct++;
            }else{
              const v=(nodes.find(n=>n.checked)?.value)||'-1';
              if(+v===+it.answer) correct++;
            }
          });
          const score = Math.round((correct/q.items.length)*100);
          await col('attempts').add({
            uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, score,
            createdAt:firebase.firestore.FieldValue.serverTimestamp()
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
            <label><input type="checkbox" id="q-final" ${q.isFinal?'checked':''}/> This is final exam</label>
            <textarea id="q-json" class="input">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), isFinal:$('#q-final')?.checked, items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  /* ---------- Chat ---------- */
  function paintChat(msgs){
    const box=$('#chat-box'); if(!box) return;
    box.innerHTML = msgs.map(m=>`
      <div style="margin-bottom:8px">
        <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
        <div>${(m.text||'').replace(/</g,'&lt;')}</div>
      </div>`).join('');
    box.scrollTop=box.scrollHeight;
  }
  function wireChat(){
    const box=$('#chat-box'); const courseSel=$('#chat-course'); const input=$('#chat-input'); const send=$('#chat-send');
    const sub=(cid)=>{
      if(state._unsubChat){ try{state._unsubChat()}catch{} state._unsubChat=null; }
      if(!cid){ box.innerHTML=''; return; }
      state._unsubChat = col('messages').where('courseId','==',cid).onSnapshot(
        s => { state.messages = s.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>safeTS(a.createdAt)-safeTS(b.createdAt)); paintChat(state.messages); },
        err => console.warn('chat listener error:', err)
      );
    };
    courseSel?.addEventListener('change', e=> sub(e.target.value));
    send?.addEventListener('click', async ()=>{
      const text=input.value.trim(); const cid=courseSel?.value||'';
      if(!text||!cid) return;
      if(!canPostMessage(cid)) return notify('Enroll to chat','warn');
      const p = state.profiles.find(x=>x.uid===auth.currentUser?.uid) || {};
      await col('messages').add({ courseId:cid, uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
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

    // DnD
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
    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(),
        email:$('#pf-email')?.value.trim(),
        portfolio:$('#pf-portfolio')?.value.trim(),
        bio:$('#pf-bio')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      const up = async (inputId, folder, field)=>{
        const f=$(inputId)?.files?.[0]; if(!f) return null;
        const ref=stg.ref().child(`${folder}/${uid}/${Date.now()}_${f.name}`);
        await ref.put(f); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ [field]: url },{merge:true}); return url;
      };
      await up('#pf-avatar','avatars','avatar');
      await up('#pf-sign','signatures','signature');
      if ($('#pf-avatar')) $('#pf-avatar').value='';
      if ($('#pf-sign')) $('#pf-sign').value='';
      notify('Profile saved'); render();
    });

    $('#pf-view')?.addEventListener('click', ()=>{
      const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {};
      $('#mm-title').textContent='My Profile Card';
      $('#mm-body').innerHTML=`
        <div style="display:flex; gap:12px; align-items:center">
          <div style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:#222">
            ${me.avatar? `<img src="${me.avatar}" style="width:100%;height:100%;object-fit:cover">` : ''}
          </div>
          <div>
            <div style="font-weight:900;font-size:18px">${me.name||'(no name)'}</div>
            <div class="muted" style="font-size:12px">${me.email||''}</div>
          </div>
        </div>
        <div class="muted" style="margin-top:8px">${me.bio||'—'}</div>
        ${me.signature? `<div style="margin-top:12px"><img src="${me.signature}" style="height:48px"></div>`:''}
      `;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`;
      openModal('m-modal');
      $('#mm-ok').onclick=()=> closeModal('m-modal');
    });

    // certificate download button
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email};
      // certificate PNG
      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
      const ctx=canvas.getContext('2d');
      // background and border
      ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
      ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(40,40,1320,820);
      ctx.strokeStyle='#153654'; ctx.lineWidth=2; ctx.strokeRect(60,60,1280,780);
      // title
      ctx.fillStyle='#fff';
      ctx.font='bold 56px Inter';
      ctx.fillText('Certificate of Completion', 360, 200);
      // body
      ctx.font='28px Inter';
      ctx.fillText(`Awarded to: ${p.name||p.email}`, 260, 280);
      ctx.fillText(`Course: ${course.title||courseId}`, 260, 330);
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 260, 380);
      // signature line
      ctx.beginPath(); ctx.moveTo(260, 560); ctx.lineTo(620,560); ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=2; ctx.stroke();
      ctx.font='20px Inter'; ctx.fillText('Authorized Signature', 360, 590);
      // logo mark
      ctx.fillStyle='#7ad3ff'; ctx.font='bold 32px Inter'; ctx.fillText('LearnHub', 1080, 760);
      const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
    });
  }

  /* ---------- Admin ---------- */
  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      await doc('profiles',uid).set({ role },{merge:true}); // mirror role
      notify('Role saved');
    });

    $('#main')?.addEventListener('click', async (e)=>{
      const btn = e.target.closest('button[data-edit-user]'); if(!btn) return;
      const uid = btn.getAttribute('data-edit-user');
      const pSnap = await doc('profiles',uid).get(); const p = {uid, ...(pSnap.data()||{})};
      const rSnap = await doc('roles',uid).get(); const curRole = (rSnap.data()?.role)|| (p.role||'student');

      $('#mm-title').textContent = 'Edit User';
      $('#mm-body').innerHTML = `
        <div class="grid">
          <input id="eu-name" class="input" placeholder="Name" value="${p.name||''}"/>
          <input id="eu-email" class="input" placeholder="Email" value="${p.email||''}"/>
          <select id="eu-role" class="input">
            ${VALID_ROLES.map(r=>`<option value="${r}" ${curRole===r?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>`;
      $('#mm-foot').innerHTML = `<button class="btn" id="eu-save">Save</button>`;
      openModal('m-modal');

      $('#eu-save')?.addEventListener('click', async ()=>{
        const name = $('#eu-name')?.value.trim();
        const email = $('#eu-email')?.value.trim();
        const role = $('#eu-role')?.value;
        await doc('profiles',uid).set({ name, email, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
        await doc('roles',uid).set({ uid, email, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
        notify('User updated'); closeModal('m-modal');
      });
    });
  }

  /* ---------- Settings ---------- */
  function applyTheme(){
    // simple palettes
    const p = state.theme.palette;
    const root = document.documentElement;
    const sets = {
      dark:    { bg:'#0b0d10', card:'#111827', brand:'#7ad3ff' },
      sunrise: { bg:'#0f0b10', card:'#1a1220', brand:'#f59e0b' },
      ocean:   { bg:'#07131a', card:'#0d1b24', brand:'#38bdf8' },
      forest:  { bg:'#0a120d', card:'#0e1a12', brand:'#34d399' },
      grape:   { bg:'#110914', card:'#1a0f20', brand:'#a78bfa' },
    };
    const s=sets[p]||sets.dark;
    root.style.setProperty('--bg', s.bg);
    root.style.setProperty('--card', s.card);
    root.style.setProperty('--brand', s.brand);
    // font size
    const f=state.theme.font;
    root.style.setProperty('font-size', f==='small'?'14px':(f==='large'?'17px':'16px'));
  }
  function wireSettings(){
    $('#theme-palette')?.addEventListener('change', e=>{ state.theme.palette=e.target.value; applyTheme(); });
    $('#theme-font')?.addEventListener('change', e=>{ state.theme.font=e.target.value; applyTheme(); });
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
      const title=(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId;
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:title, best:0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId && q.isFinal===true);
      const pass = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
      byCourse[a.courseId].completed = pass;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  /* ---------- Firestore sync ---------- */
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    const uid=auth.currentUser.uid;

    // profiles
    state.unsub.push(
      col('profiles').onSnapshot(
        s => { state.profiles = s.docs.map(d=>({id:d.id, ...d.data()})); if(['profile','admin'].includes(state.route)) render(); },
        err => console.warn('profiles listener error:', err)
      )
    );

    // my enrollments
    state.unsub.push(col('enrollments').where('uid','==',uid).onSnapshot(s=>{
      state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
      state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
      if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
    }));

    // courses (no where+order combo)
    state.unsub.push(
      col('courses').orderBy('createdAt','desc').onSnapshot(
        s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
        err => console.warn('courses listener error:', err)
      )
    );

    // finals only (filter client side)
    state.unsub.push(
      col('quizzes').orderBy('createdAt','desc').onSnapshot(
        s => { state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()})); if(['assessments','dashboard','profile'].includes(state.route)) render(); },
        err => console.warn('quizzes listener error:', err)
      )
    );

    // attempts — sort on client
    state.unsub.push(
      col('attempts').where('uid','==',uid).onSnapshot(
        s => {
          state.attempts = s.docs.map(d=>({id:d.id, ...d.data()}))
            .sort((a,b)=>safeTS(b.createdAt)-safeTS(a.createdAt));
          if(['assessments','profile','dashboard'].includes(state.route)) render();
        },
        err => console.warn('attempts listener error:', err)
      )
    );

    // tasks
    state.unsub.push(
      col('tasks').where('uid','==',uid).onSnapshot(
        s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
        err => console.warn('tasks listener error:', err)
      )
    );

    // notes (silent)
    state.unsub.push(col('notes').where('uid','==',uid).onSnapshot(s=>{
      state.notes=s.docs.map(d=>({id:d.id,...d.data()}));
    }));

    // announcements (optional)
    state.unsub.push(col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(s=>{
      state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard'].includes(state.route)) render();
    }));
  }

  async function resolveRole(uid,email){
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',uid).get(); const role=(r.data() && r.data().role ? (r.data().role+'').toLowerCase() : 'student');
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  /* ---------- Auth ---------- */
  auth.onAuthStateChanged(async (user)=>{
    state.user = user || null;
    if (!user) { clearUnsubs(); render(); return; }

    // resolve role
    state.role = await resolveRole(user.uid, user.email);

    // ensure profile + mirror role
    try{
      const pRef = doc('profiles', user.uid);
      const pSnap = await pRef.get();
      const fallbackName = user.displayName || (user.email ? user.email.split('@')[0] : 'User');

      if (!pSnap.exists) {
        await pRef.set({
          uid: user.uid, email: user.email||'', name: fallbackName, bio:'', portfolio:'', avatar:'', signature:'',
          role: state.role, createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        const cur = pSnap.data() || {};
        const patch = { role: state.role };
        if (!cur.email && user.email) patch.email = user.email;
        if (!cur.name) patch.name = fallbackName;
        if (Object.keys(patch).length) await pRef.set(patch, { merge: true });
      }
      // if someone put name/email in roles by mistake, pull once
      try {
        const rSnap = await doc('roles', user.uid).get();
        const r = rSnap.data()||{};
        const pull = {};
        if (r.name) pull.name=r.name;
        if (r.email) pull.email=r.email;
        if (Object.keys(pull).length) await pRef.set(pull, { merge:true });
      } catch {}
    }catch{}

    sync(); applyTheme(); render();
  });

  /* ---------- Dev helpers ---------- */
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const outline=[{title:"Chapter 1: Basics",lessons:[
      {title:"Welcome",video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",html:"Welcome text here.",images:[]},
      {title:"Numbers",html:"Understanding numbers…",images:[]}
    ]}];
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',credits:3,short:'Equations, functions, factoring.',outline:JSON.stringify(outline),ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3}});
    await col('quizzes').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,isFinal:true,items:[
      {q:'2+2?',choices:['3','4','5'],answer:1},
      {q:'5x=20, x=?',choices:['2','4','5'],answer:2}
    ],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    alert('Seeded sample course & final');
  };

  /* ---------- Boot ---------- */
  render();
})();