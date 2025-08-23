/* LearnHub — Compact build (Compat SDK) — 2025-08
   Fixes:
   - Theme palette + font size (instant apply + persist)
   - Admin edit/delete profiles + roles
   - Profile save/view card/delete + avatar/signature uploads
   - Courses & My Learning open (reader with video/audio/image + sticky notes)
   - Finals sample + fully scrollable quiz
   - Dashboard cards clickable + daily EDU videos
*/

(() => {
  'use strict';

  // ---------- Firebase bootstrap ----------
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  // ---------- Constants ----------
  const ADMIN_EMAILS = ['admin@learnhub.com']; // overwrite/add real emails
  const VALID_ROLES  = ['student','instructor','admin'];

  // ---------- State ----------
  const state = {
    user:null, role:'student', route:'dashboard',
    theme: loadTheme(),
    searchQ:'',
    highlightId:null,

    // data
    profiles:[], courses:[], enrollments:[], quizzes:[], attempts:[], tasks:[],
    messages:[], notes:[], announcements:[],

    myEnrolledIds: new Set(),
    unsub:[]
  };

  // ---------- Utils ----------
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const notify=(msg,type='ok')=>{
    const n=$('#notification'); if(!n) return;
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=>n.className='notification',2500);
  };
  const col=(name)=> db.collection(name);
  const doc=(name,id)=> db.collection(name).doc(id);
  const yt = (url)=> {
    if(!url) return '';
    const m = url.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);
    return m? `<div style="position:relative;padding-top:56.25%"><iframe src="https://www.youtube.com/embed/${m[1]}" title="Video" allowfullscreen style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe></div>`:'';
  };
  const safeImg=(url)=> url && !/your-bucket\/path/i.test(url) ? `<img src="${url}" alt="image"/>` : '';
  const year=()=> new Date().getFullYear();
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled = (courseId)=> state.myEnrolledIds.has(courseId);
  function applyTheme(t){
    const b=document.body;
    b.classList.remove('theme-sunrise','theme-ocean','theme-forest','theme-grape','theme-dark','font-small','font-medium','font-large');
    b.classList.add(`theme-${t.palette||'sunrise'}`, `font-${t.font||'medium'}`);
  }
  function loadTheme(){
    try{ return JSON.parse(localStorage.getItem('lh_theme')||'{}'); }catch{ return {}; }
  }
  function saveTheme(){
    localStorage.setItem('lh_theme', JSON.stringify(state.theme||{}));
    applyTheme(state.theme||{});
    notify('Theme applied','ok');
  }

  // ---------- Search ----------
  const searchIndex = ()=> {
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.quizzes.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'admin', id:p.uid||p.id, text:(p.bio||'')}));
    return ix;
  };
  const doSearch=(q)=>{
    const tokens=(q||'').toLowerCase().split(/\s+/).filter(Boolean);
    if(!tokens.length) return [];
    return searchIndex().map(item=>{
      const l=item.label.toLowerCase(), t=(item.text||'').toLowerCase();
      const ok=tokens.every(tok=> l.includes(tok)||t.includes(tok));
      return ok?{item,score:tokens.length + (l.includes(tokens[0])?1:0)}:null;
    }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,20);
  };

  // ---------- Layout ----------
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','guide','search'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; render(); }

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
            ['dashboard','Dashboard','ri-dashboard-2-line'],
            ['courses','Courses','ri-book-2-line'],
            ['learning','My Learning','ri-graduation-cap-line'],
            ['assessments','Finals','ri-clipboard-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-user-line'],
            ['settings','Settings','ri-settings-3-line'],
            ['guide','Guide','ri-compass-3-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
              <i class="${ic}"></i><span>${label}</span>
            </div>`).join('')}
        </div>
        <div class="footer"><div class="muted" style="font-size:12px">© ${year()}</div></div>
      </aside>

      <div style="flex:1; min-width:0">
        <div class="topbar">
          <div style="display:flex; gap:8px; align-items:center">
            <button class="btn ghost" id="burger"><i class="ri-menu-line"></i></button>
            <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
          </div>
          <div class="search-inline" style="position:relative">
            <input id="globalSearch" class="input" placeholder="Search courses, finals, profiles…"/>
            <div id="searchResults" class="search-results"></div>
          </div>
          <div style="display:flex; gap:8px">
            <button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button>
          </div>
        </div>
        <div class="main" id="main">${content}</div>
      </div>
    </div>

    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div>
    <div class="modal-backdrop" id="mb-modal"></div>
    `;
  }

  // ---------- Views ----------
  const viewLogin=()=>`
  <div style="display:grid; place-items:center; min-height:100vh; padding:20px">
    <div class="card" style="width:min(420px,96vw)">
      <div class="card-body">
        <div style="display:flex; gap:10px; align-items:center; margin-bottom:10px">
          <div class="logo"><img src="/icons/learnhub-192.png" alt="LearnHub" style="width:32px;height:32px"/></div>
          <div><div style="font-size:20px; font-weight:800">LearnHub</div>
          <div class="muted">Sign in to continue</div></div>
        </div>
        <div class="grid">
          <label>Email</label><input id="li-email" class="input" type="email" autocomplete="username" />
          <label>Password</label><input id="li-pass" class="input" type="password" autocomplete="current-password" />
          <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
          <div style="display:flex; justify-content:space-between; gap:8px">
            <button id="link-forgot" class="btn ghost" style="padding:6px 10px; font-size:12px"><i class="ri-key-2-line"></i> Forgot</button>
            <button id="link-register" class="btn secondary" style="padding:6px 10px; font-size:12px"><i class="ri-user-add-line"></i> Sign up</button>
          </div>
          <div class="muted" style="font-size:12px">Default admin: admin@learnhub.com / admin123</div>
        </div>
      </div>
    </div>
  </div>`;

  const dashCard=(icon,label,value,route)=>`
    <div class="card dash-card clickable" data-go="${route}">
      <div>
        <div class="muted"><i class="${icon}"></i> ${label}</div>
        <h2>${value}</h2>
      </div>
      <i class="ri-arrow-right-line"></i>
    </div>`;

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;

    // daily EDU videos widget
    const videoPool = [
      'https://www.youtube.com/watch?v=H14bBuluwB8', // ted learn
      'https://www.youtube.com/watch?v=QRS8MkLhQmM', // feynman
      'https://www.youtube.com/watch?v=aircAruvnKk', // 3blue1brown
      'https://www.youtube.com/watch?v=0JUN9aDxVmI'  // khan
    ];
    const dayIndex = Math.abs(new Date().toDateString().split('').reduce((a,c)=>a+c.charCodeAt(0),0)) % videoPool.length;
    const eduEmbed = yt(videoPool[dayIndex]);

    const finalsDue = state.quizzes.filter(q=>q.isFinal).length;

    return `
      <div class="grid cols-4">
        ${dashCard('ri-book-2-line','Courses', state.courses.length,'courses')}
        ${dashCard('ri-graduation-cap-line','My Learning', myEnroll,'learning')}
        ${dashCard('ri-clipboard-line','Finals', finalsDue,'assessments')}
        ${dashCard('ri-bar-chart-2-line','My Attempts', myAttempts,'assessments')}
      </div>

      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Announcements</h3>
          ${(state.announcements||[]).slice(0,6).map(a=>`
            <div style="padding:8px 0; border-bottom:1px dashed var(--border)">
              <div style="font-weight:700">${a.title||'Announcement'}</div>
              <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</div>
              <div>${a.text||''}</div>
            </div>
          `).join('') || `<div class="muted">No announcements yet.</div>`}
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Learn • Today’s picks</h3>
          ${eduEmbed || '<div class="muted">Video unavailable</div>'}
        </div></div>
      </div>
    `;
  }

  function vCourses(){
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <h3 style="margin:0">Courses</h3>
          ${canCreateCourse()? `<button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>`:''}
        </div>

        <div class="grid cols-2" data-sec="courses">
          ${state.courses.map(c=>`
            <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
                </div>
                <div style="display:flex; gap:6px">
                  <button class="btn" data-open="${c.id}"><i class="ri-external-link-line"></i></button>
                  ${canEditCourse(c)? `<button class="btn ghost" data-edit="${c.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>
          `).join('')}
          ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
        </div>
      </div></div>
    `;
  }

  function vLearning(){
    const my=auth.currentUser?.uid;
    const list=state.enrollments.filter(e=>e.uid===my).map(e=> e.course||{} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2">
          ${list.map(c=>`
            <div class="card">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits</div>
                </div>
                <button class="btn" data-open-course="${c.id}">Open</button>
              </div>
            </div>
          `).join('')}
          ${!list.length? `<div class="muted" style="padding:10px">You’re not enrolled yet.</div>`:''}
        </div>
      </div></div>`;
  }

  function vAssessments(){
    const finals = state.quizzes.filter(q=>q.isFinal===true);
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <h3 style="margin:0">Final Exams</h3>
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="seed-finals"><i class="ri-add-line"></i> Add Sample Final</button>`:''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${finals.map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex; justify-content:space-between; align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}%</div>
                </div>
                <div style="display:flex; gap:6px">
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
            <thead><tr><th>Final</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr class="clickable" data-open-quiz="${a.quizId}">
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
      <div class="muted" style="font-size:12px; margin-top:6px">Enrolled students + instructors can post.</div>
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
                  <div>
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'',signatureName:'',avatar:'',signature:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <input id="pf-signname" class="input" placeholder="Signature name (text)" value="${me.signatureName||''}"/>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <div>
                <label>Avatar</label>
                <input id="pf-avatar" type="file" accept="image/*"/>
              </div>
              <div>
                <label>Signature (PNG)</label>
                <input id="pf-signature" type="file" accept="image/*"/>
              </div>
            </div>
            <div style="display:flex; gap:8px">
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-view"><i class="ri-id-card-line"></i> View card</button>
              <button class="btn danger" id="pf-delete"><i class="ri-delete-bin-6-line"></i> Delete profile</button>
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
            </tbody></table>
          </div>
        </div></div>
      </div>`;
  }

  function vAdmin(){
    if(!canManageUsers()) return `<div class="card"><div class="card-body">Admins only.</div></div>`;
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Role Manager</h3>
          <div class="grid">
            <input id="rm-uid" class="input" placeholder="User UID"/>
            <input id="rm-email" class="input" placeholder="Email (optional)"/>
            <select id="rm-role" class="input">${VALID_ROLES.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
            <div style="display:flex; gap:8px">
              <button class="btn" id="rm-save"><i class="ri-save-3-line"></i> Save Role</button>
              <button class="btn danger" id="rm-del"><i class="ri-delete-bin-6-line"></i> Delete Role Doc</button>
            </div>
            <div class="muted" style="font-size:12px">Tip: UID is in Authentication → Users.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
            <button class="btn secondary" id="admin-seed"><i class="ri-sparkling-2-line"></i> Seed samples</button>
          </div>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th style="width:160px">Actions</th></tr></thead>
              <tbody id="admin-users">
                ${state.profiles.map(p=>`
                  <tr data-user="${p.uid}">
                    <td>${p.name||'—'}</td>
                    <td>${p.email||'—'}</td>
                    <td>${p.role||'student'}</td>
                    <td>
                      <button class="btn ghost" data-edit-user="${p.uid}"><i class="ri-edit-line"></i></button>
                      <button class="btn danger" data-del-user="${p.uid}"><i class="ri-delete-bin-6-line"></i></button>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div></div>
      </div>
    `;
  }

  function vSettings(){
    const pal = state.theme?.palette || 'sunrise';
    const f   = state.theme?.font    || 'medium';
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div>
            <label>Palette</label>
            <select id="theme-palette" class="input">
              ${['sunrise','ocean','forest','grape','dark'].map(x=>`<option value="${x}" ${pal===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Font size</label>
            <select id="theme-font" class="input">
              ${['small','medium','large'].map(x=>`<option value="${x}" ${f===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px"><button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save</button></div>
      </div></div>
    `;
  }

  function vGuide(){
    return `
      <div class="card"><div class="card-body guide">
        <h3>Quick How-To (Admin & Instructor)</h3>
        <div class="grid">
          <div class="step">
            <strong>1) Create a course</strong><br/>
            Courses → New Course → Fill title, category, credits, short description. For long content, paste a JSON outline (chapters/lessons with text, images, video, audio).
          </div>
          <div class="step">
            <strong>2) Enroll students</strong><br/>
            Open a course → Enroll. Or students can enroll themselves from Courses.
          </div>
          <div class="step">
            <strong>3) Add the Final exam</strong><br/>
            Finals → “Add Sample Final” (or create your own). Students take finals and earn certificates when pass score is reached.
          </div>
          <div class="step">
            <strong>4) Chat & Notes</strong><br/>
            Course Chat lets enrolled students & instructors discuss. Students can add sticky notes per lesson in the reader.
          </div>
          <div class="step">
            <strong>5) Profiles</strong><br/>
            Each user can edit profile, upload avatar/signature, and download certificates from the Transcript box.
          </div>
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
      case 'guide': return vGuide();
      case 'search': return vSearch();
      default: return vDashboard();
    }
  }

  // ---------- Render ----------
  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=viewLogin(); wireLogin(); return; }
    applyTheme(state.theme||{});
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
  }

  // ---------- Wiring ----------
  function openModal(){ $('#m-modal')?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(){ $('#m-modal')?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }

  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> document.body.classList.toggle('sidebar-open'));
    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());
    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ state.route = it.getAttribute('data-route'); render(); }
    });
    $('#mm-close')?.addEventListener('click', closeModal);

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
      case 'guide': /* no extra wiring */ break;
      case 'search': wireSearch(); break;
    }
  }

  // ----- Login -----
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
          doc('profiles', uid).set({ uid, email, name:'', bio:'', portfolio:'', role: ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  // ----- Courses -----
  function renderCourseReader(course, cursor){
    const outline = parseOutline(course.outline);
    const [ci, li] = cursor;
    const chapter = outline[ci] || {title:'', lessons:[]};
    const lesson  = (chapter.lessons||[])[li] || {};
    const media = `
      ${(lesson.video? yt(lesson.video):'')}
      ${(lesson.audio? `<audio controls src="${lesson.audio}"></audio>`:'')}
      ${(lesson.images||[]).map(u=> `<div class="media">${safeImg(u)}</div>`).join('')}
    `;
    const notes = (state.notes||[]).filter(n=> n.courseId===course.id && n.chapterIndex===ci && n.lessonIndex===li);

    $('#mm-title').textContent = course.title;
    $('#mm-body').innerHTML = `
      <div class="reader">
        <div class="toc">
          ${(outline||[]).map((ch,idx)=>`
            <div style="margin-bottom:10px">
              <div style="font-weight:800">${idx+1}. ${ch.title||'Chapter'}</div>
              <div style="margin-left:8px">
                ${(ch.lessons||[]).map((ls,ii)=>`
                  <div class="clickable ${idx===ci&&ii===li?'highlight':''}" data-goto="${idx}:${ii}" style="padding:4px 6px; border-radius:8px; margin:2px 0">${ls.title||'Lesson'}</div>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="lesson">
          <h3>${chapter.title||''} — ${lesson.title||''}</h3>
          <div>${lesson.html||''}</div>
          <div style="margin-top:10px">${media}</div>
          <div style="margin-top:14px">
            <div class="note">
              <strong>My sticky notes</strong>
              <div id="notes-list" style="margin:6px 0">
                ${notes.map(n=>`<div style="padding:6px 8px; background:#0a121a; border-radius:8px; margin:4px 0">${n.text}</div>`).join('') || '<div class="muted">No notes yet.</div>'}
              </div>
              <div style="display:flex; gap:8px">
                <input id="note-text" class="input" placeholder="Add a note for this lesson"/>
                <button class="btn" id="note-save"><i class="ri-sticky-note-add-line"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    $('#mm-foot').innerHTML=`
      <div style="display:flex; gap:8px; flex:1; justify-content:flex-start">
        <button class="btn ghost" id="prev"><i class="ri-arrow-left-s-line"></i> Prev</button>
        <button class="btn ghost" id="next">Next <i class="ri-arrow-right-s-line"></i></button>
      </div>
      <button class="btn secondary" id="open-final"><i class="ri-clipboard-line"></i> Final Exam</button>
      <button class="btn" id="close-reader">Close</button>`;
    openModal();

    // wiring inside reader
    $('#close-reader')?.addEventListener('click', closeModal);
    $('#prev')?.addEventListener('click', ()=> {
      let c=ci, l=li-1;
      if(l<0){ c=Math.max(0,ci-1); l=(outline[c]?.lessons?.length||1)-1; }
      renderCourseReader(course,[c,l]);
    });
    $('#next')?.addEventListener('click', ()=>{
      let c=ci, l=li+1;
      if(l >= (outline[ci]?.lessons?.length||0)){ c=Math.min(outline.length-1,ci+1); l=0; }
      renderCourseReader(course,[c,l]);
    });
    $$('#mm-body [data-goto]')?.forEach(el=>{
      el.addEventListener('click', ()=>{
        const [C,L]=el.getAttribute('data-goto').split(':').map(x=>+x||0);
        renderCourseReader(course,[C,L]);
      });
    });
    $('#note-save')?.addEventListener('click', async ()=>{
      const t=$('#note-text')?.value.trim(); if(!t) return;
      await col('notes').add({
        uid:auth.currentUser.uid, courseId:course.id, chapterIndex:ci, lessonIndex:li,
        text:t, createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      notify('Note saved');
      // refresh notes quick
      const s=await col('notes').where('uid','==',auth.currentUser.uid).where('courseId','==',course.id).get();
      state.notes = s.docs.map(d=>({id:d.id,...d.data()}));
      renderCourseReader(course,[ci,li]);
    });
    $('#open-final')?.addEventListener('click', ()=>{
      const q = state.quizzes.find(x=> x.isFinal && x.courseId===course.id);
      if(!q) return notify('No final for this course yet','warn');
      openQuiz(q.id);
    });
  }

  function parseOutline(raw){
    if(!raw) return [];
    if(Array.isArray(raw)) return raw;
    try{ const arr=JSON.parse(raw); return Array.isArray(arr)?arr:[]; }catch{ return []; }
  }

  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credits" class="input" type="number" value="3" placeholder="Credits"/>
          <textarea id="c-short" class="input" placeholder="Short description"></textarea>
          <textarea id="c-outline" class="input" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Welcome","video":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","html":"Welcome text","images":[]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button><button class="btn ghost" id="c-cancel">Close</button>`;
      openModal();
      $('#c-cancel')?.addEventListener('click', closeModal);
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const outlineText = $('#c-outline')?.value.trim();
        let outline=[];
        try{ outline=outlineText?JSON.parse(outlineText):[]; }catch{ return notify('Outline must be valid JSON','danger'); }
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0),
          short:$('#c-short')?.value.trim(), outline:JSON.stringify(outline),
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email,
          createdAt:firebase.firestore.FieldValue.serverTimestamp()
        };
        try{ await col('courses').add(obj); closeModal(); notify('Course saved'); }catch(e){ notify(e.message||'Save failed','danger'); }
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
        $('#mm-body').innerHTML=`
          <div class="grid">
            <div class="muted">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
            <p>${c.short||''}</p>
          </div>`;
        $('#mm-foot').innerHTML=`
          <div style="display:flex; gap:8px; flex:1; justify-content:flex-start">
            ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
            <button class="btn ghost" id="open-reader"><i class="ri-book-open-line"></i> Open</button>
          </div>
          <button class="btn" id="close-course">Close</button>`;
        openModal();

        $('#close-course')?.addEventListener('click', closeModal);
        $('#enroll')?.addEventListener('click', async ()=>{
          const uid=auth.currentUser.uid;
          await col('enrollments').add({
            uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(),
            course:{id:c.id, title:c.title, category:c.category, credits:c.credits||0}
          });
          notify('Enrolled'); closeModal();
        });
        $('#open-reader')?.addEventListener('click', ()=> renderCourseReader(c,[0,0]));
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
            <textarea id="c-short" class="input">${c.short||''}</textarea>
            <textarea id="c-outline" class="input">${c.outline||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button><button class="btn ghost" id="c-cancel">Close</button>`;
        openModal();
        $('#c-cancel')?.addEventListener('click', closeModal);
        $('#c-save').onclick=async ()=>{
          let outline=c.outline;
          try{ const x=$('#c-outline')?.value; JSON.parse(x||'[]'); outline=x; }catch{ return notify('Invalid JSON','danger'); }
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(),
            category:$('#c-category')?.value.trim(),
            credits:+($('#c-credits')?.value||0),
            short:$('#c-short')?.value.trim(),
            outline,
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });
  }

  // ----- Learning -----
  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()}; renderCourseReader(c,[0,0]);
    });
  }

  // ----- Assessments (Finals) -----
  function openQuiz(quizId){
    // load quiz fresh to avoid stale
    doc('quizzes',quizId).get().then(snap=>{
      if(!snap.exists) return;
      const q={id:snap.id,...snap.data()};
      if(!isEnrolled(q.courseId) && state.role==='student') return notify('Enroll first to take','warn');

      $('#mm-title').textContent=q.title;
      $('#mm-body').innerHTML = (q.items||[]).map((it,idx)=>`
        <div class="card"><div class="card-body">
          <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
          <div style="margin-top:6px; display:grid; gap:6px">
            ${(it.choices||[]).map((c,i)=>`
              <label style="display:flex; gap:8px; align-items:center">
                <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
              </label>`).join('')}
          </div>
          <div class="muted" id="fb-${idx}" style="margin-top:6px"></div>
        </div></div>`).join('');
      $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button><button class="btn ghost" id="q-close">Close</button>`;
      openModal();

      // allow scroll to the end (body already scrollable via CSS), also auto-scroll when submitting
      $('#q-close')?.addEventListener('click', closeModal);
      $('#q-submit').onclick=async ()=>{
        let correct=0;
        (q.items||[]).forEach((it,idx)=>{
          const pick=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
          const ok = +pick === +it.answer;
          if(ok) correct++;
          const fb=$(`#fb-${idx}`); if(fb) fb.innerHTML = ok ? `<span style="color:#10b981">${it.feedbackOk||'Correct!'}</span>` : `<span style="color:#ef4444">${it.feedbackNo||'Try again'}</span>`;
        });
        const score = Math.round((correct/(q.items?.length||1))*100);
        await col('attempts').add({
          uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, score,
          createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        notify(`Your score: ${score}%`);
        $('#mm-body').scrollTo({top:$('#mm-body').scrollHeight, behavior:'smooth'});
      };
    });
  }

  function wireAssessments(){
    $('#seed-finals')?.addEventListener('click', async ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      // if at least one course exists, attach to the first
      const c = state.courses[0]; if(!c) return notify('Create a course first','warn');
      const items = [
        {q:'2 + 2 = ?', choices:['3','4','5'], answer:1, feedbackOk:'Correct', feedbackNo:'Nope — 2+2=4'},
        {q:'5x = 20, x = ?', choices:['2','4','5'], answer:2, feedbackOk:'Nice!', feedbackNo:'Rearrange to x=20/5'}
      ];
      await col('quizzes').add({
        title:`${c.title} — Final`,
        courseId:c.id, courseTitle:c.title, isFinal:true, passScore:70, items,
        ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      notify('Sample final added');
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){ openQuiz(take.getAttribute('data-take')); }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===auth.currentUser?.uid || state.role==='admin')) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <textarea id="q-json" class="input">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button><button class="btn ghost" id="q-close">Close</button>`;
        openModal();
        $('#q-close')?.addEventListener('click', closeModal);
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });

    // open quiz details from attempts table
    $('#main')?.querySelectorAll('[data-open-quiz]')?.forEach(el=>{
      el.addEventListener('click', ()=> openQuiz(el.getAttribute('data-open-quiz')));
    });
  }

  // ----- Chat -----
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
    if(!box || !courseSel || !send) return;
    let unsubChat=null;
    function sub(cid){
      unsubChat?.(); unsubChat=null; box.innerHTML='';
      if(!cid) return;
      unsubChat = col('messages').where('courseId','==',cid).onSnapshot(
        s => {
          state.messages = s.docs.map(d=>({id:d.id, ...d.data()}))
            .sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0));
          paintChat(state.messages);
        },
        err => console.warn('chat listener error:', err)
      );
    }
    courseSel?.addEventListener('change', e=> sub(e.target.value));
    send?.addEventListener('click', async ()=>{
      const text=input.value.trim(); const cid=courseSel.value;
      if(!text||!cid) return;
      if(!isEnrolled(cid) && state.role==='student') return notify('Enroll to chat','warn');
      const p = state.profiles.find(x=>x.uid===auth.currentUser?.uid) || {};
      await col('messages').add({ courseId:cid, uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      input.value='';
    });
  }

  // ----- Tasks -----
  function wireTasks(){
    const root=$('[data-sec="tasks"]'); if(!root) return;

    $('#addTask')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button><button class="btn ghost" id="t-close">Close</button>`;
      openModal();
      $('#t-close')?.addEventListener('click', closeModal);
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        try{
          await col('tasks').add({ uid:auth.currentUser.uid, title:t, status:'todo', createdAt:firebase.firestore.FieldValue.serverTimestamp() });
          closeModal(); notify('Saved');
        }catch(e){ notify(e.message||'Save failed','danger'); }
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
        $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button><button class="btn ghost" id="t-close">Close</button>`;
        openModal();
        $('#t-close')?.addEventListener('click', closeModal);
        $('#t-save').onclick=async ()=>{
          await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal(); notify('Saved');
        };
      } else {
        await doc('tasks',id).delete(); notify('Deleted');
      }
    });

    // drag drop (with accept highlight)
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

  // ----- Profile -----
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

  function wireProfile(){
    $('#pf-view')?.addEventListener('click', ()=>{
      const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {};
      $('#mm-title').textContent='Profile card';
      $('#mm-body').innerHTML=`
        <div class="card"><div class="card-body" style="display:flex; gap:16px; align-items:center">
          <img src="${me.avatar||''}" alt="avatar" style="width:72px; height:72px; border-radius:50%; border:1px solid var(--border); object-fit:cover" onerror="this.style.display='none'"/>
          <div>
            <div style="font-weight:800">${me.name||me.email||'—'}</div>
            <div class="muted" style="font-size:12px">${me.email||''}</div>
            <div>${me.bio||''}</div>
          </div>
        </div></div>
        <div class="muted" style="font-size:12px">Signature: ${me.signatureName||''}</div>
        ${me.signature? `<img src="${me.signature}" alt="signature" style="max-width:240px"/>`:''}
      `;
      $('#mm-foot').innerHTML=`<button class="btn" id="mm-close2">Close</button>`;
      openModal(); $('#mm-close2')?.addEventListener('click', closeModal);
    });

    $('#pf-delete')?.addEventListener('click', async ()=>{
      if(!confirm('Delete profile doc?')) return;
      await doc('profiles',auth.currentUser.uid).delete();
      notify('Profile deleted'); render();
    });

    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      const base={
        name:$('#pf-name')?.value.trim(),
        portfolio:$('#pf-portfolio')?.value.trim(),
        bio:$('#pf-bio')?.value.trim(),
        signatureName:$('#pf-signname')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      };
      await doc('profiles',uid).set(base,{merge:true});
      // uploads
      const avatarFile=$('#pf-avatar')?.files?.[0];
      if(avatarFile){
        const ref=stg.ref().child(`avatars/${uid}/avatar_${Date.now()}.${(avatarFile.name.split('.').pop()||'png')}`);
        await ref.put(avatarFile); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      const sigFile=$('#pf-signature')?.files?.[0];
      if(sigFile){
        const ref=stg.ref().child(`signatures/${uid}/signature_${Date.now()}.${(sigFile.name.split('.').pop()||'png')}`);
        await ref.put(sigFile); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ signature:url },{merge:true});
      }
      // clear file inputs
      $('#pf-avatar').value=null; $('#pf-signature').value=null;
      notify('Profile saved'); render();
    });

    // certificate download
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email};
      // certificate canvas
      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
      const ctx=canvas.getContext('2d');
      // background
      ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
      // ornamental border
      ctx.strokeStyle='#a855f7'; ctx.lineWidth=8; ctx.strokeRect(60,60,1280,780);
      ctx.strokeStyle='#22c55e'; ctx.lineWidth=2; ctx.strokeRect(80,80,1240,740);

      // title
      ctx.fillStyle='#fff'; ctx.font='bold 56px "Times New Roman", serif'; ctx.fillText('Certificate of Completion', 360, 200);
      // recipient
      ctx.font='36px "Garamond", serif'; ctx.fillText(`This certifies that`, 520, 270);
      ctx.font='bold 44px "Garamond", serif'; ctx.fillText(`${p.name||p.email}`, 480, 330);
      ctx.font='30px "Garamond", serif'; ctx.fillText(`has successfully completed the course`, 450, 380);
      ctx.font='bold 40px "Times New Roman", serif'; ctx.fillText(`${course.title||courseId}`, 430, 430);
      ctx.font='28px "Garamond", serif'; ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 580, 480);

      // signature line
      ctx.beginPath(); ctx.moveTo(980,650); ctx.lineTo(1180,650); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
      ctx.font='20px "Garamond", serif'; ctx.fillText('Authorized Signature', 990, 680);

      // try draw signature image if available
      const me = state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{};
      if(me.signature){
        const img=new Image(); img.crossOrigin="anonymous"; img.onload=()=>{
          ctx.drawImage(img, 970, 600, 220, 60);
          const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
        }; img.onerror=()=>{
          const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
        }; img.src=me.signature;
      }else{
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
      }
    });
  }

  // ----- Admin -----
  function wireAdmin(){
    // Role manager quick save/delete
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student'; const email=$('#rm-email')?.value.trim()||'';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, email, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      // mirror to profile if exists
      await doc('profiles',uid).set({ role, email },{merge:true});
      notify('Role saved'); render();
    });
    $('#rm-del')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); if(!uid) return notify('Enter UID','warn');
      await doc('roles',uid).delete(); notify('Role doc deleted');
    });

    // table buttons
    $('#admin-users')?.addEventListener('click', async (e)=>{
      const edit=e.target.closest('button[data-edit-user]'); const del=e.target.closest('button[data-del-user]');
      if(edit){
        const uid=edit.getAttribute('data-edit-user'); const p=state.profiles.find(x=>x.uid===uid)||{};
        $('#mm-title').textContent='Edit Profile (admin)';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="ad-name" class="input" placeholder="Name" value="${p.name||''}"/>
            <input id="ad-email" class="input" placeholder="Email" value="${p.email||''}"/>
            <select id="ad-role" class="input">${VALID_ROLES.map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join('')}</select>
            <textarea id="ad-bio" class="input" placeholder="Bio">${p.bio||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="ad-save" data-uid="${uid}">Save</button><button class="btn ghost" id="ad-close">Close</button>`;
        openModal();
        $('#ad-close')?.addEventListener('click', closeModal);
        $('#ad-save')?.addEventListener('click', async ()=>{
          const role=$('#ad-role')?.value||'student';
          await Promise.all([
            doc('profiles',uid).set({ name:$('#ad-name')?.value.trim(), email:$('#ad-email')?.value.trim(), role, bio:$('#ad-bio')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true}),
            doc('roles',uid).set({ role, email:$('#ad-email')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true})
          ]);
          closeModal(); notify('Saved'); render();
        });
      }
      if(del){
        const uid=del.getAttribute('data-del-user'); if(!confirm('Delete profile doc (Auth user not deleted)?')) return;
        await doc('profiles',uid).delete(); await doc('roles',uid).delete().catch(()=>{});
        notify('Deleted'); render();
      }
    });

    $('#admin-seed')?.addEventListener('click', async ()=>{
      await seedSampleData(); render();
    });
  }

  // ----- Settings -----
  function wireSettings(){
    $('#save-theme')?.addEventListener('click', ()=>{
      state.theme = { palette: $('#theme-palette')?.value || 'sunrise', font: $('#theme-font')?.value || 'medium' };
      saveTheme();
      render();
    });
  }

  function wireSearch(){
    $('#main')?.querySelectorAll('[data-open-route]')?.forEach(el=>{
      el.addEventListener('click', ()=>{
        const r=el.getAttribute('data-open-route'); const id=el.getAttribute('data-id'); state.highlightId=id; go(r);
      });
    });
  }

  // ----- Firestore sync -----
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

    // enrollments (mine)
    state.unsub.push(col('enrollments').where('uid','==',uid).onSnapshot(s=>{
      state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
      state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
      if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
    }));

    // courses (orderBy single field OK)
    state.unsub.push(
      col('courses').orderBy('createdAt','desc').onSnapshot(
        s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
        err => console.warn('courses listener error:', err)
      )
    );

    // finals/quizzes (avoid index by filtering client-side)
    state.unsub.push(
      col('quizzes').orderBy('createdAt','desc').onSnapshot(
        s => { state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()})); if(['assessments','dashboard','profile'].includes(state.route)) render(); },
        err => console.warn('quizzes listener error:', err)
      )
    );

    // attempts (mine) — no orderBy; sort client-side
    state.unsub.push(
      col('attempts').where('uid','==',auth.currentUser.uid).onSnapshot(
        s => {
          state.attempts = s.docs.map(d=>({id:d.id, ...d.data()}))
            .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
          if(['assessments','profile','dashboard'].includes(state.route)) render();
        },
        err => console.warn('attempts listener error:', err)
      )
    );

    // tasks (mine)
    state.unsub.push(
      col('tasks').where('uid','==',auth.currentUser.uid).onSnapshot(
        s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
        err => console.warn('tasks listener error:', err)
      )
    );

    // my notes (for quick refresh)
    state.unsub.push(col('notes').where('uid','==',uid).onSnapshot(s=>{
      state.notes=s.docs.map(d=>({id:d.id,...d.data()}));
    }));

    // announcements
    state.unsub.push(col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(s=>{
      state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard'].includes(state.route)) render();
    }));
  }

  async function resolveRole(uid,email){
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',uid).get(); const role=(r.data()?.role||'student').toLowerCase();
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  // ----- Auth -----
  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid, user.email);
    // ensure profile exists + mirror role
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role, email:user.email },{merge:true});
    }catch{}
    sync(); render();
  });

  // ----- Seed samples -----
  async function seedSampleData(){
    const u=auth.currentUser; if(!u) return notify('Sign in first','warn');

    // Sample course with media-rich outline
    const outline=[{
      title:"Chapter 1: Basics",
      lessons:[
        { title:"Welcome", video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ", html:"<p>Welcome text here. You can put <strong>HTML</strong> or plain text.</p>", images:["https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Placeholder_view_vector.svg/512px-Placeholder_view_vector.svg.png"] },
        { title:"Numbers", audio:"https://www.kozco.com/tech/piano2-CoolEdit.mp3", html:"Understanding numbers…", images:[] }
      ]
    },{
      title:"Chapter 2: Algebra",
      lessons:[ { title:"Equations", html:"ax + b = 0", images:[] } ]
    }];
    const c1 = await col('courses').add({
      title:'Algebra Basics', category:'Math', credits:3, short:'Equations, functions, factoring.',
      outline:JSON.stringify(outline),
      ownerUid:u.uid, ownerEmail:u.email, createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });

    // enroll self
    await col('enrollments').add({ uid:u.uid, courseId:c1.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c1.id, title:'Algebra Basics', category:'Math', credits:3} });

    // Final
    await col('quizzes').add({
      title:'Algebra Final', courseId:c1.id, courseTitle:'Algebra Basics', passScore:70, isFinal:true,
      items:[
        {q:'2 + 2 = ?', choices:['3','4','5'], answer:1, feedbackOk:'Correct', feedbackNo:'Nope — 2+2=4'},
        {q:'5x = 20, x = ?', choices:['2','4','5'], answer:2, feedbackOk:'Nice!', feedbackNo:'Rearrange to x=20/5'}
      ],
      ownerUid:u.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });

    // Announcement
    await col('announcements').add({ title:'Welcome to LearnHub', text:'Sample course and final are ready.', createdAt:firebase.firestore.FieldValue.serverTimestamp() });

    notify('Seeded sample course & final');
  }

  // ----- Boot -----
  render();

  // Expose seed for manual use (optional)
  window.seedSampleData = seedSampleData;

})();