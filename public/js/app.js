/* LearnHub — E-Learning (compact build, admin/instructor/student) */
(() => {
  'use strict';

  // ---- Firebase ----
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  // ---- Constants ----
  const VALID_ROLES = ['student','instructor','admin'];

  // ---- State ----
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette: localStorage.getItem('lh.palette') || 'sunrise', font: localStorage.getItem('lh.font') || 'medium' },
    searchQ:'', highlightId:null,
    courses:[], enrollments:[], quizzes:[], attempts:[], messages:[], tasks:[], profiles:[], notes:[], announcements:[],
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

  // ---- Theme (instant) ----
  function applyTheme(){
    document.body.classList.remove('theme-sunrise','theme-dark','theme-light','font-small','font-medium','font-large');
    document.body.classList.add(`theme-${state.theme.palette}`, `font-${state.theme.font}`);
  }
  applyTheme();

  // ---- Router / Layout ----
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','guide','settings','search'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; closeSidebar(); render(); }

  function layout(content){
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
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
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
    return `
      <div class="card course-card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
        <div class="img"><img src="${img}" alt="${c.title}"/></div>
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:800">${c.title}</div>
            <span class="badge">${c.category||'General'}</span>
          </div>
          <div class="muted" style="margin-top:6px">${c.short||''}</div>
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
          ${canTeach()? `<button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>`:''}
        </div>
        <div class="grid cols-2" data-sec="courses">
          ${state.courses.map(courseCard).join('')}
          ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
        </div>
      </div></div>
    `;
  }

  function vLearning(){
    const my=auth.currentUser?.uid; const list=state.enrollments.filter(e=>e.uid===my).map(e=> state.courses.find(c=>c.id===e.courseId)||{} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2">
          ${list.map(c=>`
            <div class="card course-card">
              <div class="img"><img src="${c.coverImage||'/icons/learnhub-cap.svg'}" alt="${c.title||''}"/></div>
              <div class="card-body">
                <div style="font-weight:800">${c.title||'(deleted course)'}</div>
                <div class="muted">${c.short||''}</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                  <div class="muted">Credits: <strong>${c.credits||0}</strong></div>
                  <button class="btn" data-open-course="${c.id}">Open</button>
                </div>
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
      <div class="muted" style="font-size:12px;margin-top:6px">Only signed-in users can post. Instructors/Admins can broadcast via Announcements.</div>
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
      </div>
    `;
  }

  function vGuide(){
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">How to use LearnHub (Admin & Instructor)</h3>
        <ol>
          <li><strong>Create a course</strong> → Courses → New Course. You can paste:
            <ul>
              <li><em>Outline JSON URL</em> (host on Hosting: <code>/data/...json</code>)</li>
              <li><em>Lesson Quizzes JSON URL</em> (keys = "<code>chapter-title-lesson-title</code>" in lowercase hyphen)</li>
            </ul>
          </li>
          <li><strong>Paid course</strong>: set <em>price</em> &gt; 0. On enroll, a demo checkout runs then auto-enrolls.</li>
          <li><strong>Finals</strong>: Assessments → New Final. Define <em>items</em> as JSON (supports feedback) and <em>passScore</em>.</li>
          <li><strong>Contact students</strong>:
            <ul>
              <li>Course-wide chat: Chat → select course</li>
              <li>Announcements (all users): Dashboard → New Announcement (Admins)</li>
            </ul>
          </li>
          <li><strong>Profiles</strong>: Users update their own details and upload Avatar/Signature. Admin sees them in Admin → Users.</li>
          <li><strong>Outline / lesson quizzes hosting</strong>: Put JSON under <code>public/data</code> and deploy. Paste the URLs in the course form.</li>
        </ol>
      </div></div>
    `;
  }

  function vSettings(){
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div><label>Palette</label>
            <select id="theme-palette" class="input">
              <option value="sunrise" ${state.theme.palette==='sunrise'?'selected':''}>sunrise</option>
              <option value="dark" ${state.theme.palette==='dark'?'selected':''}>dark</option>
              <option value="light" ${state.theme.palette==='light'?'selected':''}>light</option>
            </select>
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
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
  }

  function openModal(id){ $('#'+id)?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); }
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };

  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> {
      const open=document.body.classList.contains('sidebar-open');
      if(open) closeSidebar(); else { document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); }
    });
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);

    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ go(it.getAttribute('data-route')); }
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
      document.addEventListener('click', e=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
    }

    // theme instant
    $('#theme-palette')?.addEventListener('change', (e)=>{ state.theme.palette=e.target.value; localStorage.setItem('lh.palette',state.theme.palette); applyTheme(); });
    $('#theme-font')?.addEventListener('change', (e)=>{ state.theme.font=e.target.value; localStorage.setItem('lh.font',state.theme.font); applyTheme(); });

    $('#mm-close')?.addEventListener('click', ()=> closeModal('m-modal'));
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
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canTeach()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Marketing)"/>
          <input id="c-credits" class="input" type="number" value="3" placeholder="Credits"/>
          <input id="c-price" class="input" type="number" value="0" placeholder="Price (0=Free)"/>
          <textarea id="c-short" class="input" placeholder="Short description"></textarea>
          <textarea id="c-goals" class="input" placeholder="Goals (one per line)"></textarea>
          <input id="c-cover" class="input" placeholder="Cover image URL"/>
          <input id="c-outlineUrl" class="input" placeholder="Outline JSON URL (Hosting)"/>
          <input id="c-quizzesUrl" class="input" placeholder="Lesson Quizzes JSON URL (Hosting)"/>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const goals=($('#c-goals')?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
        const obj={
          title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), price:+($('#c-price')?.value||0),
          short:$('#c-short')?.value.trim(), goals, coverImage:$('#c-cover')?.value.trim(),
          outlineUrl:$('#c-outlineUrl')?.value.trim(), quizzesUrl:$('#c-quizzesUrl')?.value.trim(),
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp()
        };
        try{ await col('courses').add(obj); closeModal('m-modal'); notify('Saved'); }catch(e){ notify(e.message,'danger'); }
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]');
      const editBtn=e.target.closest('button[data-edit]');
      const delBtn =e.target.closest('button[data-del]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()};
        const enrolled=isEnrolled(c.id);
        $('#mm-title').textContent=c.title;
        $('#mm-body').innerHTML=`
          <div class="grid">
            <img src="${c.coverImage||'/icons/learnhub-cap.svg'}" alt="${c.title}" style="width:100%;border-radius:12px"/>
            <div class="muted">${c.category||'General'} • Credits ${c.credits||0}</div>
            <p>${c.short||''}</p>
            <ul>${(c.goals||[]).map(g=>`<li>${g}</li>`).join('')}</ul>
            ${c.price>0? `<div><strong>Price:</strong> ${money(c.price)}</div>`:''}
          </div>`;
        $('#mm-foot').innerHTML=`
          <div style="display:flex;gap:8px;justify-content:flex-end">
            ${!enrolled? `<button class="btn" id="enroll">${c.price>0? 'Pay & Enroll':'Enroll'}</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
            <button class="btn ghost" id="open-quiz"><i class="ri-question-line"></i> Finals</button>
          </div>`;
        openModal('m-modal');

        $('#enroll')?.addEventListener('click', async ()=>{
          if(c.price>0){
            // demo checkout
            await col('payments').add({ uid:auth.currentUser.uid, courseId:c.id, amount:c.price, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
            notify('Demo payment successful');
          }
          await col('enrollments').add({ uid:auth.currentUser.uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id,title:c.title,category:c.category,credits:c.credits,coverImage:c.coverImage} });
          closeModal('m-modal'); notify('Enrolled');
        });
        $('#open-quiz')?.addEventListener('click', ()=>{ state.searchQ=c.title; go('assessments'); });
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
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(),
            credits:+($('#c-credits')?.value||0), price:+($('#c-price')?.value||0),
            short:$('#c-short')?.value.trim(), goals,
            coverImage:$('#c-cover')?.value.trim(), outlineUrl:$('#c-outlineUrl')?.value.trim(), quizzesUrl:$('#c-quizzesUrl')?.value.trim(),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
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
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()};
      $('#mm-title').textContent=c.title;
      $('#mm-body').innerHTML=`<div class="grid">
        <img src="${c.coverImage||'/icons/learnhub-cap.svg'}" alt="${c.title}" style="width:100%;border-radius:12px"/>
        <p>${c.short||''}</p>
        <div class="muted">Outline: ${c.outlineUrl?`<a href="${c.outlineUrl}" target="_blank">view</a>`:'(none)'}</div>
        <div class="muted">Lesson Quizzes: ${c.quizzesUrl?`<a href="${c.quizzesUrl}" target="_blank">view</a>`:'(none)'}</div>
      </div>`;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`; openModal('m-modal');
      $('#mm-ok').onclick=()=> closeModal('m-modal');
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
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, items, isFinal:true, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal('m-modal'); notify('Final saved');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!isEnrolled(q.courseId) && state.role==='student') return notify('Enroll first','warn');
        // render quiz with scrollable modal
        $('#mm-title').textContent=q.title;
        $('#mm-body').innerHTML = q.items.map((it,idx)=>`
          <div class="card"><div class="card-body">
            <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
            <div style="margin-top:6px;display:grid;gap:6px">
              ${it.choices.map((c,i)=>`
                <label style="display:flex;gap:8px;align-items:center">
                  <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
                </label>`).join('')}
            </div>
            <div class="muted" id="fb-${idx}" style="margin-top:6px"></div>
          </div></div>`).join('');
        $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
        openModal('m-modal');
        // allow full scroll
        $('#mm-body').scrollTop = 0;

        // instant feedback on change
        q.items.forEach((it,idx)=>{
          $('#mm-body').addEventListener('change', (ev)=>{
            const t = ev.target;
            if(t && t.name===`q${idx}`){
              const val=+t.value;
              const fb=$(`#fb-${idx}`);
              if(val===+it.answer){ fb.textContent = it.feedbackOk||'Correct'; fb.style.color='var(--ok)'; }
              else { fb.textContent = it.feedbackNo||'Incorrect'; fb.style.color='var(--danger)'; }
            }
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
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  // ---- Chat
  function wireChat(){
    const box=$('#chat-box'); const courseSel=$('#chat-course'); const input=$('#chat-input'); const send=$('#chat-send');
    const paint=(msgs)=>{
      box.innerHTML = msgs.map(m=>`
        <div style="margin-bottom:8px">
          <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
          <div>${(m.text||'').replace(/</g,'&lt;')}</div>
        </div>`).join('');
      box.scrollTop=box.scrollHeight;
    };
    const sub=(cid)=>{
      if(state._unsubChat){ try{state._unsubChat()}catch{} state._unsubChat=null; }
      if(!cid){ box.innerHTML=''; return; }
      state._unsubChat = col('messages').where('courseId','==',cid).onSnapshot(
        s => {
          state.messages = s.docs.map(d=>({id:d.id, ...d.data()}))
            .sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0));
          paint(state.messages);
        },
        err => console.warn('chat listener error:', err)
      );
    };
    courseSel?.addEventListener('change', e=> sub(e.target.value));
    send?.addEventListener('click', async ()=>{
      const cid=courseSel.value; const text=input.value.trim(); if(!text||!cid) return;
      const p = state.profiles.find(x=>x.uid===auth.currentUser?.uid) || {};
      await col('messages').add({ courseId:cid, uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      input.value='';
    });
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

    // drag drop visuals
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

  // ---- Profile
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

    // certificate
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email};

      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=1000;
      const ctx=canvas.getContext('2d');
      // background + border
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
      // signature
      if(p.signature){
        const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>{
          ctx.drawImage(img, 980, 540, 260, 80);
          finish(); };
        img.src=p.signature;
      } else { finish(); }

      function finish(){
        ctx.fillStyle='#fff'; ctx.font='20px Inter'; ctx.fillText('Authorized Signature', 1000, 640);
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
      }
    });
  }

  // ---- Admin
  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      notify('Role saved');
    });

    $('#main')?.addEventListener('click', async (e)=>{
      const ed=e.target.closest('button[data-admin-edit]'); const del=e.target.closest('button[data-admin-del]');
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
      const ed=e.target.closest('button[data-edit-ann]'); const del=e.target.closest('button[data-del-ann]');
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

  // ---- Transcript
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

  // ---- Firestore sync (no composite indexes)
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    const uid=auth.currentUser.uid;

    state.unsub.push(
      col('profiles').onSnapshot(
        s => { state.profiles = s.docs.map(d=>({id:d.id, ...d.data()})); if(['profile','admin'].includes(state.route)) render(); },
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
        s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
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
        s => {
          state.attempts = s.docs.map(d=>({id:d.id, ...d.data()}))
            .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
          if(['assessments','profile','dashboard'].includes(state.route)) render();
        },
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
      col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(s=>{
        state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard'].includes(state.route)) render();
      })
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
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid);
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    applyTheme();
    sync(); render();
  });

  // ---- Boot
  render();

  // ---- Seed paid/free sample courses (admin could run in console) ----
  window.seedDemoCourses = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const list=[
      {title:'Advanced Digital Marketing',category:'Marketing',credits:4,price:250,short:'Master SEO, social media, content strategy.',goals:['Get certified','Hands-on project','Career guidance'],coverImage:'https://images.unsplash.com/photo-1554774853-b415df9eeb92?w=1200&q=80'},
      {title:'Modern Web Bootcamp',category:'CS',credits:5,price:0,short:'HTML, CSS, JS, and tooling.',goals:['Responsive sites','Deploy to Hosting','APIs basics'],coverImage:'https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=1200&q=80'}
    ];
    for(const c of list){
      await col('courses').add({...c, ownerUid:u.uid, ownerEmail:u.email, createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    }
    alert('Demo courses added');
  };
})();