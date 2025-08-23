/* LearnHub — E-Learning & Community Platform (v1.3)
   - Pure JS + Firebase compat (Auth, Firestore, Storage)
   - Routes: dashboard, courses, learning, assessments, chat, tasks, profile, admin, settings, help, search
   - Features: Course reader (chapters/lessons + YouTube/MP4), sticky notes, finals (single/multi-choice), attempts,
               transcript & certificate PNG, tasks (DnD), course chat + 1:1 inbox, search, themes, admin role manager
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
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add your admin emails here
  const VALID_ROLES  = ['student','instructor','admin'];

  const THEME_PALETTES = ['sunrise','ocean','forest','grape','slate','dark'];
  const THEME_FONTS    = ['small','medium','large'];

  /* ---------- State ---------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette:'sunrise', font:'medium' },
    searchQ:'', highlightId:null,
    // data
    profiles:[], courses:[], enrollments:[], quizzes:[], finals:[], attempts:[],
    tasks:[], notes:[], messages:[], announcements:[],
    myEnrolledIds: new Set(),
    // course reader
    openCourse:null, chapIdx:0, lessonIdx:0,
    // helpers
    unsub:[], _unsubChat:null
  };

  /* ---------- Utilities ---------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const nowYear=()=> new Date().getFullYear();

  const notify=(msg,type='ok')=>{
    let n=$('#notification');
    if(!n){ n=document.createElement('div'); n.id='notification'; n.className='notification'; document.body.appendChild(n); }
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=> n.className='notification', 2200);
  };

  const setTheme=(palette, font)=>{
    if(palette) state.theme.palette=palette;
    if(font) state.theme.font=font;
    document.documentElement.setAttribute('data-theme', state.theme.palette);
    document.documentElement.setAttribute('data-font', state.theme.font);
  };

  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);

  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };
  const ensureEdge=()=>{ if($('#sidebarEdge')) return; const d=document.createElement('div'); d.id='sidebarEdge'; document.body.appendChild(d);
    ['pointerenter','touchstart'].forEach(e=> d.addEventListener(e, openSidebar, {passive:true}));
  };

  /* ---------- Search ---------- */
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.finals.forEach(q=>   ix.push({label:q.title, section:'Finals',  route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'profile', id:p.uid||p.id, text:`${p.email||''} ${p.bio||''} ${p.portfolio||''}`}));
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
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','help','search'];
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
            ['assessments','Final Exams','ri-award-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['settings','Settings','ri-settings-3-line'],
            ['help','How to use','ri-question-line']
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
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn ghost" id="burger" title="Menu"><i class="ri-menu-line"></i></button>
            <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
          </div>

          <div class="search-inline">
            <input id="globalSearch" class="input" placeholder="Search courses, finals, profiles…" autocomplete="off"/>
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

    <!-- Modal -->
    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head" style="display:flex;align-items:center;gap:8px">
        <strong id="mm-title">Modal</strong>
        <button class="btn ghost" id="mm-close" style="margin-left:auto"><i class="ri-close-line"></i></button>
      </div>
      <div class="body" id="mm-body" style="max-height:65vh; overflow:auto"></div>
      <div class="foot" id="mm-foot" style="display:flex;gap:8px;justify-content:flex-end"></div>
    </div></div><div class="modal-backdrop"></div>`;
  }

  /* ---------- Permissions ---------- */
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled = (courseId)=>{
    const uid=auth.currentUser?.uid; if(!uid) return false;
    return state.enrollments.some(e=> e.courseId===courseId && e.uid===uid);
  };
  const canPostMessage = (courseId)=> isEnrolled(courseId) || state.role!=='student';
  const canTakeFinal   = (courseId)=> isEnrolled(courseId) || state.role!=='student';

  /* ---------- Views ---------- */
  const vLogin=()=>`
  <div style="display:grid;place-items:center;min-height:100vh;padding:20px">
    <div class="card" style="width:min(420px,96vw)">
      <div class="card-body">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
          <div class="logo" style="width:44px;height:44px;overflow:hidden;border-radius:12px;background:#0c1626;display:grid;place-items:center">
            <img src="/assets/learnhub-mark.svg" alt="LearnHub" style="width:100%;height:100%;object-fit:cover"/>
          </div>
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
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="muted" style="font-size:12px">${label}</div>
          <h2 style="margin:2px 0 0 0">${value}</h2>
        </div>
        <i class="${icon}" style="font-size:24px;opacity:.6"></i>
      </div>
    </div>`;

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    const myInbox = (state.messages||[]).filter(m=> m.toUid===my).slice(0,5);
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-user-follow-line')}
        ${dashCard('Final Exams', state.finals.length,'assessments','ri-award-line')}
        ${dashCard('My Attempts', myAttempts,'assessments','ri-file-list-3-line')}
      </div>

      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Announcements</h3>
          ${(state.announcements||[]).slice(0,5).map(a=>`
            <div style="padding:8px 0;border-bottom:1px dashed var(--border)">
              <div style="font-weight:700">${a.title||'Announcement'}</div>
              <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</div>
              <div>${(a.text||'').replace(/</g,'&lt;')}</div>
            </div>`).join('') || `<div class="muted">No announcements yet.</div>`}
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Inbox</h3>
          ${myInbox.length? myInbox.map(m=>`
            <div style="padding:8px 0;border-bottom:1px dashed var(--border)">
              <div style="font-weight:700">${m.title||'Message'}</div>
              <div class="muted" style="font-size:12px">from ${m.fromEmail||'Instructor'} • ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleString()}</div>
              <div>${(m.text||'').replace(/</g,'&lt;')}</div>
            </div>`).join('') : `<div class="muted">No messages.</div>`}
        </div></div>
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
          ${state.courses.map(c=>`
            <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
                  <div class="muted" style="font-size:12px">${c.short||''}</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
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
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div><div style="font-weight:800">${c.title}</div><div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits</div></div>
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
          <h3 style="margin:0">Final Exams</h3>
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="new-final"><i class="ri-add-line"></i> New Final</button>`:''}
        </div>
        <div class="grid" data-sec="finals">
          ${state.finals.map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}% ${q.finalDateTime? '• '+new Date(q.finalDateTime).toLocaleString():''}</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===auth.currentUser?.uid)? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.finals.length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table" id="attempts-table">
            <thead><tr><th>Course</th><th>Final</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr data-open-course="${a.courseId}">
                  <td>${a.courseTitle||'—'}</td>
                  <td>${a.quizTitle||'—'}</td>
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'',avatar:'',signature:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <input id="pf-signname" class="input" placeholder="Signature Name (printed)"/>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Upload avatar</button>
              <input id="pf-sign" type="file" accept="image/png,image/svg+xml" style="display:none"/>
              <button class="btn ghost" id="pf-pick-sign"><i class="ri-pencil-line"></i> Upload signature</button>
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
            <div class="muted" style="font-size:12px">Tip: UID is in Firebase Authentication → Users.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
            ${state.profiles.map(p=>`<tr>
              <td>${p.name||'—'}</td><td>${p.email||'—'}</td><td>${p.role||'student'}</td>
              <td><button class="btn danger" data-del-profile="${p.uid||p.id}"><i class="ri-delete-bin-6-line"></i></button></td></tr>`).join('')}
            </tbody></table>
          </div>
          <h3 style="margin:12px 0 8px 0">Message a student</h3>
          <div class="grid">
            <select id="msg-to" class="input">
              <option value="">Select student…</option>
              ${state.profiles.map(p=> `<option value="${p.uid||p.id}">${p.name||p.email||p.uid}</option>`).join('')}
            </select>
            <input id="msg-title" class="input" placeholder="Title"/>
            <textarea id="msg-text" class="input" placeholder="Message"></textarea>
            <button id="msg-send" class="btn"><i class="ri-send-plane-2-line"></i> Send</button>
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
          <div>
            <label>Palette</label>
            <select id="theme-palette" class="input">
              ${THEME_PALETTES.map(x=>`<option ${state.theme.palette===x?'selected':''} value="${x}">${x}</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Font size</label>
            <select id="theme-font" class="input">
              ${THEME_FONTS.map(x=>`<option ${state.theme.font===x?'selected':''} value="${x}">${x}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px"><button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save</button></div>
      </div></div>
    `;
  }

  function vHelp(){
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Quick “How to use”</h3>
        <div class="grid cols-2">
          <div>
            <h4>For students</h4>
            <ol>
              <li>Sign up or sign in.</li>
              <li>Open <em>Courses</em> → select a course → <strong>Enroll</strong>.</li>
              <li>Use the left chapter list to read lessons, watch videos, and add sticky notes.</li>
              <li>When ready, open <em>Final Exams</em> → take the final for your course.</li>
              <li>See your scores in <em>Assessments</em> → <em>My Attempts</em> and download certificates in <em>Profile</em>.</li>
              <li>Chat inside <em>Course Chat</em> after selecting the course.</li>
            </ol>
          </div>
          <div>
            <h4>For instructors/admin</h4>
            <ol>
              <li>Go to <em>Courses</em> → <strong>New Course</strong> (title, category, credits, short desc, outline JSON).</li>
              <li>Outline JSON format: chapters → lessons → optional <code>video</code> (YouTube or mp4), <code>html</code>, <code>images</code>.</li>
              <li>Create a <em>Final Exam</em> in <em>Final Exams</em> with pass score & items (single or multi-select).</li>
              <li>Use <em>Admin</em> to assign roles, purge profiles, or send 1-to-1 messages.</li>
              <li>Post announcements (via Firestore console → <code>announcements</code>).</li>
            </ol>
          </div>
        </div>
      </div></div>`;
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
      case 'help': return vHelp();
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

  /* ---------- Modal helpers ---------- */
  function openModal(){ $('#m-modal')?.classList.add('active'); $('.modal-backdrop')?.classList.add('active'); }
  function closeModal(){ $('#m-modal')?.classList.remove('active'); $('.modal-backdrop')?.classList.remove('active'); }

  /* ---------- Wiring ---------- */
  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> document.body.classList.contains('sidebar-open')? closeSidebar(): openSidebar());
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);
    ensureEdge();

    $('#mm-close')?.addEventListener('click', closeModal);

    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ go(it.getAttribute('data-route')); }
    });

    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());

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

    $('#copyright')?.replaceChildren(document.createTextNode(`© ${nowYear()} LearnHub`));
  }

  function wireRoute(){
    switch(state.route){
      case 'dashboard': wireDashboard(); break;
      case 'courses': wireCourses(); break;
      case 'learning': wireLearning(); break;
      case 'assessments': wireAssessments(); break;
      case 'chat': wireChat(); break;
      case 'tasks': wireTasks(); break;
      case 'profile': wireProfile(); break;
      case 'admin': wireAdmin(); break;
      case 'settings': wireSettings(); break;
      case 'search': wireSearch(); break;
      case 'help': break;
    }
  }

  function wireDashboard(){
    $('#main')?.addEventListener('click', e=>{
      const card=e.target.closest('[data-go]'); if(!card) return;
      go(card.getAttribute('data-go'));
    });
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
          doc('profiles', uid).set({ uid, email, name:'', bio:'', portfolio:'', role: ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  /* ---------- Courses ---------- */
  function parseOutline(c){
    try{
      const raw = typeof c.outline==='string' ? JSON.parse(c.outline||'[]') : (Array.isArray(c.outline)? c.outline : []);
      return Array.isArray(raw)? raw : [];
    }catch{ return []; }
  }

  function openCourseModal(course){
    state.openCourse = course;
    const outline = parseOutline(course);
    const ch = outline[state.chapIdx] || {title:'', lessons:[]};
    const le = (ch.lessons||[])[state.lessonIdx] || {};

    // media
    let media='';
    if(le.video){
      if(/youtube\.com|youtu\.be/.test(le.video)){
        const id = (le.video.match(/(?:v=|be\/)([^&?/]+)/)||[])[1]||'';
        media = id? `<div class="ratio" style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:12px;border:1px solid var(--border)">
            <iframe src="https://www.youtube.com/embed/${id}" title="Video" frameborder="0" allowfullscreen style="position:absolute;top:0;left:0;width:100%;height:100%"></iframe>
          </div>` : '';
      }else{
        media = `<video controls style="width:100%;border-radius:12px;border:1px solid var(--border)"><source src="${le.video}"/></video>`;
      }
    }

    // lesson images
    const imgs = (le.images||[]).map(u=> `<img src="${u}" alt="" style="max-width:100%;border-radius:8px;border:1px solid var(--border)"/>`).join('');

    // sidebar chapters
    const side = outline.map((c,i)=>`
      <div class="card clickable" data-goto-chap="${i}" style="${i===state.chapIdx?'outline:2px solid var(--primary);':''}">
        <div class="card-body" style="padding:8px 10px">
          <div style="font-weight:700">${c.title||('Chapter '+(i+1))}</div>
          <div class="muted" style="font-size:12px">${(c.lessons||[]).length} lesson(s)</div>
        </div>
      </div>`).join('');

    const lessonTabs = (ch.lessons||[]).map((l,j)=>`
      <button class="btn ${j===state.lessonIdx?'ok':''}" data-goto-lesson="${j}" style="padding:6px 8px">${l.title||('Lesson '+(j+1))}</button>
    `).join('');

    const enrolled = isEnrolled(course.id);
    $('#mm-title').textContent=course.title;
    $('#mm-body').innerHTML = `
      <div class="grid cols-3">
        <div style="grid-column: span 2">
          <div class="muted" style="margin-bottom:6px">${course.category||'General'} • ${course.credits||0} credits</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${lessonTabs}</div>
          ${media}
          <div style="margin-top:10px">${(le.html||'').toString()}</div>
          <div style="margin-top:10px;display:grid;gap:8px">${imgs}</div>

          <!-- sticky notes -->
          <div class="card" style="margin-top:12px"><div class="card-body">
            <h4 style="margin:0 0 8px 0">My Notes</h4>
            <div id="notes-list" style="display:grid;gap:6px"></div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <input id="note-text" class="input" placeholder="Add a quick note about this lesson…"/>
              <button class="btn" id="note-add"><i class="ri-sticky-note-add-line"></i></button>
            </div>
          </div></div>
        </div>
        <div>
          <div class="card"><div class="card-body">
            <div style="display:flex;flex-direction:column;gap:8px">
              ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
              <button class="btn ghost" id="open-final"><i class="ri-award-line"></i> Open Final</button>
              <div class="muted" style="font-size:12px">${course.short||''}</div>
            </div>
            <div style="margin-top:10px"><h4 style="margin:0 0 6px 0">Chapters</h4>${side||'<div class="muted">No chapters yet.</div>'}</div>
          </div></div>
        </div>
      </div>
    `;
    $('#mm-foot').innerHTML = `<button class="btn ghost" id="mm-close-foot"><i class="ri-close-line"></i> Close</button>`;
    openModal();
    $('#mm-close-foot')?.addEventListener('click', closeModal);

    // notes list for current lesson
    paintNotes(course.id, state.chapIdx, state.lessonIdx);

    // listeners
    $('#enroll')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await col('enrollments').add({ uid, courseId:course.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:course.id, title:course.title, category:course.category, credits:course.credits||0} });
      notify('Enrolled');
    });
    $('#open-final')?.addEventListener('click', ()=>{ state.searchQ=course.title; go('assessments'); closeModal(); });

    $('#mm-body')?.addEventListener('click', e=>{
      const b1=e.target.closest('[data-goto-chap]'); const b2=e.target.closest('[data-goto-lesson]');
      if(b1){ state.chapIdx=+b1.getAttribute('data-goto-chap'); state.lessonIdx=0; openCourseModal(course); }
      if(b2){ state.lessonIdx=+b2.getAttribute('data-goto-lesson'); openCourseModal(course); }
      const del=e.target.closest('button[data-del-note]'); if(del){
        const id=del.getAttribute('data-del-note'); doc('notes',id).delete().catch(()=>{});
      }
    });

    $('#note-add')?.addEventListener('click', async ()=>{
      const text=$('#note-text')?.value.trim(); if(!text) return;
      await col('notes').add({
        uid:auth.currentUser.uid, courseId:course.id,
        chapIdx:state.chapIdx, lessonIdx:state.lessonIdx,
        text, createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      $('#note-text').value='';
    });
  }

  function paintNotes(courseId, chapIdx, lessonIdx){
    const wrap=$('#notes-list'); if(!wrap) return;
    const items=(state.notes||[]).filter(n=> n.courseId===courseId && n.chapIdx===chapIdx && n.lessonIdx===lessonIdx)
      .sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0));
    wrap.innerHTML = items.map(n=>`
      <div class="card" style="background:var(--bg-soft)">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>${(n.text||'').replace(/</g,'&lt;')}</div>
          <button class="btn ghost" title="Delete" data-del-note="${n.id}"><i class="ri-delete-bin-6-line"></i></button>
        </div>
      </div>`).join('') || `<div class="muted">No notes yet.</div>`;
  }

  function wireCourses(){
    // Add course
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <div class="grid cols-3">
            <input id="c-category" class="input" placeholder="Category"/>
            <input id="c-credits" class="input" type="number" value="3" placeholder="Credits"/>
            <input id="c-video" class="input" placeholder="(Optional) Intro video URL"/>
          </div>
          <textarea id="c-short" class="input" placeholder="Short description"></textarea>
          <textarea id="c-outline" class="input" style="min-height:180px" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Welcome","video":"https://youtu.be/...","html":"Text here","images":["https://..."]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal();
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid outline JSON','danger'); }
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||3), short:$('#c-short')?.value.trim(),
          outline:JSON.stringify(outline), introVideo:$('#c-video')?.value.trim(),
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        await col('courses').add(obj); closeModal(); notify('Saved');
      };
    });

    // open/edit
    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()}; state.chapIdx=0; state.lessonIdx=0; openCourseModal(c);
      }
      if(editBtn){
        const id=editBtn.getAttribute('data-edit'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()}; if(!canEditCourse(c)) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Course';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="c-title" class="input" value="${c.title||''}"/>
            <div class="grid cols-3">
              <input id="c-category" class="input" value="${c.category||''}"/>
              <input id="c-credits" class="input" type="number" value="${c.credits||0}"/>
              <input id="c-video" class="input" value="${c.introVideo||''}" placeholder="Intro video URL"/>
            </div>
            <textarea id="c-short" class="input">${c.short||''}</textarea>
            <textarea id="c-outline" class="input" style="min-height:180px">${c.outline||'[]'}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal();
        $('#c-save').onclick=async ()=>{
          let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid outline JSON','danger'); }
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0),
            introVideo:$('#c-video')?.value.trim(), short:$('#c-short')?.value.trim(), outline:JSON.stringify(outline),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });
  }

  /* ---------- Learning ---------- */
  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); const row=e.target.closest('tr[data-open-course]');
      const id=(btn?.getAttribute('data-open-course')) || (row?.getAttribute('data-open-course'));
      if(!id) return;
      const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()}; state.chapIdx=0; state.lessonIdx=0; openCourseModal(c);
    });
  }

  /* ---------- Finals / Assessments ---------- */
  function renderQuizModal(q){
    const isMulti = (item)=> Array.isArray(item.answer);
    $('#mm-title').textContent=q.title;
    $('#mm-body').innerHTML = q.items.map((it,idx)=>`
      <div class="card"><div class="card-body">
        <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
        <div style="margin-top:6px;display:grid;gap:6px">
          ${it.choices.map((c,i)=>`
            <label style="display:flex;gap:8px;align-items:center">
              <input type="${isMulti(it)?'checkbox':'radio'}" name="q${idx}" value="${i}"/> <span>${c}</span>
            </label>`).join('')}
        </div>
        <div id="fb-${idx}" style="margin-top:6px;font-size:12px"></div>
      </div></div>
    `).join('');
    $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
    openModal();

    $('#q-submit').onclick=async ()=>{
      let correct=0;
      q.items.forEach((it,idx)=>{
        const fb=$(`#fb-${idx}`);
        if(Array.isArray(it.answer)){
          const picked=[...document.querySelectorAll(`input[name="q${idx}"]:checked`)].map(x=>+x.value).sort();
          const ans=[...it.answer].map(Number).sort();
          const ok=JSON.stringify(picked)===JSON.stringify(ans);
          if(ok) correct++;
          if(fb){ fb.textContent = ok?(it.feedbackOk||'Correct'): (it.feedbackNo||'Incorrect'); fb.style.color= ok?'#10b981':'#ef4444'; }
        }else{
          const v=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
          const ok= (+v===+it.answer);
          if(ok) correct++;
          if(fb){ fb.textContent = ok?(it.feedbackOk||'Correct'): (it.feedbackNo||'Incorrect'); fb.style.color= ok?'#10b981':'#ef4444'; }
        }
      });
      const score = Math.round((correct/q.items.length)*100);
      await col('attempts').add({
        uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title,
        courseId:q.courseId, courseTitle:q.courseTitle,
        score, createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      notify(`Your score: ${score}%`);
    };
  }

  function wireAssessments(){
    // create final
    $('#new-final')?.addEventListener('click', ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Final title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <div class="grid cols-3">
            <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
            <input id="q-datetime" class="input" type="datetime-local" placeholder="Final date & time"/>
            <input id="q-duration" class="input" type="number" value="60" placeholder="Duration (min)"/>
          </div>
          <textarea id="q-json" class="input" style="min-height:200px" placeholder='[
  {"q":"Pick primes","choices":["2","3","4","5"],"answer":[0,1,3],"feedbackOk":"Great!","feedbackNo":"Check primes"},
  {"q":"2+2?","choices":["3","4","5"],"answer":1}
]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal();
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        const when = $('#q-datetime')?.value ? new Date($('#q-datetime').value).toISOString() : '';
        await col('quizzes').add({
          title:t, courseId, courseTitle:course.title, passScore:pass, isFinal:true,
          items, finalDateTime: when, durationMin: +($('#q-duration')?.value||60),
          ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        closeModal(); notify('Final saved');
      };
    });

    // open/edit/take
    const sec=$('[data-sec="finals"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeFinal(q.courseId)) return notify('Enroll first to take','warn');
        renderQuizModal(q);
      }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===auth.currentUser?.uid || state.role==='admin')) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <div class="grid cols-3">
              <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
              <input id="q-datetime" class="input" type="datetime-local" value="${q.finalDateTime? new Date(q.finalDateTime).toISOString().slice(0,16):''}"/>
              <input id="q-duration" class="input" type="number" value="${q.durationMin||60}"/>
            </div>
            <textarea id="q-json" class="input" style="min-height:200px">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal();
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({
            title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70),
            items, isFinal:true,
            finalDateTime: $('#q-datetime')?.value ? new Date($('#q-datetime').value).toISOString(): '',
            durationMin: +($('#q-duration')?.value||60),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });

    // attempts table rows open course
    $('#attempts-table')?.addEventListener('click', async (e)=>{
      const row=e.target.closest('tr[data-open-course]'); if(!row) return;
      const id=row.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()}; state.chapIdx=0; state.lessonIdx=0; openCourseModal(c);
    });
  }

  /* ---------- Chat ---------- */
  function wireChat(){
    const box=$('#chat-box'); const courseSel=$('#chat-course'); const input=$('#chat-input'); const send=$('#chat-send');
    let currentCourse='';
    const paint=(msgs)=>{
      if(!box) return;
      box.innerHTML = msgs.map(m=>`
        <div style="margin-bottom:8px">
          <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
          <div>${(m.text||'').replace(/</g,'&lt;')}</div>
        </div>`).join('');
      box.scrollTop=box.scrollHeight;
    };
    const sub=(cid)=>{
      if(state._unsubChat){ try{state._unsubChat()}catch{} state._unsubChat=null; }
      currentCourse=cid; if(!cid){ if(box) box.innerHTML=''; return; }
      // avoid composite index: no orderBy, sort client-side
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
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal();
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        await col('tasks').add({ uid:auth.currentUser.uid, title:t, status:'todo', createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal(); notify('Saved');
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
        $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal();
        $('#t-save').onclick=async ()=>{
          await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal(); notify('Saved');
        };
      } else {
        await doc('tasks',id).delete(); notify('Deleted');
      }
    });

    root.querySelectorAll('.task-card').forEach(card=>{
      card.setAttribute('draggable','true');
      card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
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
  function buildTranscript(uid){
    const byCourse = {};
    (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:a.courseTitle||a.courseId, best:0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.finals.find(q=>q.courseId===a.courseId);
      const pass = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
      byCourse[a.courseId].completed = pass;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  function drawCertificatePNG({name, courseTitle, dateStr, signName, signImgUrl}){
    const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
    const ctx=canvas.getContext('2d');
    // background
    ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
    // border
    ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(60,60,1280,780);
    ctx.strokeStyle='#2cc5e3'; ctx.lineWidth=2; ctx.strokeRect(80,80,1240,740);
    // title
    ctx.fillStyle='#ffffff'; ctx.font='bold 56px serif'; ctx.fillText('Certificate of Completion', 340, 220);
    // body
    ctx.font='28px Arial'; ctx.fillText(`Awarded to: ${name}`, 300, 300);
    ctx.fillText(`For successfully completing: ${courseTitle}`, 300, 350);
    ctx.fillText(`Date: ${dateStr}`, 300, 400);
    // signature line
    ctx.beginPath(); ctx.moveTo(950,630); ctx.lineTo(1250,630); ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=3; ctx.stroke();
    ctx.fillStyle='#ffffff'; ctx.font='20px Arial'; ctx.fillText('Authorized Signature', 990, 660);
    ctx.font='24px "Times New Roman"'; ctx.fillText(signName||'', 960, 620);
    return new Promise(resolve=>{
      if(signImgUrl){
        const img=new Image(); img.crossOrigin='anonymous';
        img.onload=()=>{ ctx.drawImage(img, 930, 520, 160, 60); resolve(canvas.toDataURL('image/png')); };
        img.onerror=()=> resolve(canvas.toDataURL('image/png'));
        img.src=signImgUrl;
      }else{
        resolve(canvas.toDataURL('image/png'));
      }
    });
  }

  function wireProfile(){
    $('#pf-pick')?.addEventListener('click', ()=> $('#pf-avatar')?.click());
    $('#pf-pick-sign')?.addEventListener('click', ()=> $('#pf-sign')?.click());
    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(), bio:$('#pf-bio')?.value.trim(),
        signName:$('#pf-signname')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      // avatar
      const file=$('#pf-avatar')?.files?.[0];
      if(file){
        const ref=stg.ref().child(`avatars/${uid}/${file.name}`);
        await ref.put(file); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      // signature image
      const sfile=$('#pf-sign')?.files?.[0];
      if(sfile){
        const ref=stg.ref().child(`signatures/${uid}/${sfile.name}`);
        await ref.put(sfile); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ signature:url },{merge:true});
      }
      // clear inputs as requested
      ['pf-name','pf-portfolio','pf-bio','pf-signname'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
      if($('#pf-avatar')) $('#pf-avatar').value='';
      if($('#pf-sign')) $('#pf-sign').value='';
      notify('Profile saved');
    });

    // certificate download
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email, signName:'', signature:''};
      const url=await drawCertificatePNG({
        name: p.name||auth.currentUser.email,
        courseTitle: course.title||courseId,
        dateStr: new Date().toLocaleDateString(),
        signName: p.signName||'',
        signImgUrl: p.signature||''
      });
      const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
    });
  }

  /* ---------- Admin ---------- */
  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      await doc('profiles',uid).set({ role },{merge:true}); // mirror to profile
      notify('Role saved');
    });

    $('#main')?.addEventListener('click', async (e)=>{
      const delp=e.target.closest('button[data-del-profile]'); if(delp){
        const id=delp.getAttribute('data-del-profile');
        try{ await doc('profiles',id).delete(); notify('Profile removed'); }catch(e){ notify('Delete failed','danger'); }
      }
    });

    $('#msg-send')?.addEventListener('click', async ()=>{
      const to=$('#msg-to')?.value; const title=$('#msg-title')?.value.trim(); const text=$('#msg-text')?.value.trim();
      if(!to || !text) return notify('Choose student & write a message','warn');
      await col('messages').add({
        toUid:to, title, text, fromUid:auth.currentUser.uid, fromEmail:auth.currentUser.email,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      $('#msg-title').value=''; $('#msg-text').value='';
      notify('Sent');
    });
  }

  /* ---------- Settings ---------- */
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

  /* ---------- Firestore sync ---------- */
  function clearUnsubs(){ (state.unsub||[]).forEach(u=>{try{u()}catch{}}); state.unsub=[]; }

  function sync(){
    clearUnsubs();
    const uid=auth.currentUser?.uid; if(!uid) return;

    // profiles
    state.unsub.push(
      col('profiles').onSnapshot(
        s => { state.profiles = s.docs.map(d=>({id:d.id, uid:d.id, ...d.data()})); if(['profile','admin'].includes(state.route)) render(); },
        err => console.warn('profiles listener error:', err)
      )
    );

    // my enrollments
    state.unsub.push(
      col('enrollments').where('uid','==',uid).onSnapshot(
        s => {
          state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
          state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
          if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
        },
        err => console.warn('enrollments listener error:', err)
      )
    );

    // courses (single field order)
    state.unsub.push(
      col('courses').orderBy('createdAt','desc').onSnapshot(
        s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
        err => console.warn('courses listener error:', err)
      )
    );

    // quizzes/finals — filter client-side (avoids composite index)
    state.unsub.push(
      col('quizzes').orderBy('createdAt','desc').onSnapshot(
        s => {
          state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()}));
          state.finals  = state.quizzes.filter(q => q.isFinal===true);
          if(['assessments','dashboard','profile'].includes(state.route)) render();
        },
        err => console.warn('quizzes listener error:', err)
      )
    );

    // attempts — sort client-side
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

    // tasks
    state.unsub.push(
      col('tasks').where('uid','==',uid).onSnapshot(
        s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
        err => console.warn('tasks listener error:', err)
      )
    );

    // my notes
    state.unsub.push(
      col('notes').where('uid','==',uid).onSnapshot(
        s => { state.notes=s.docs.map(d=>({id:d.id,...d.data()})); },
        err => console.warn('notes listener error:', err)
      )
    );

    // announcements
    state.unsub.push(
      col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(
        s => { state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(state.route==='dashboard') render(); },
        err => console.warn('announcements listener error:', err)
      )
    );

    // inbox (1:1 messages to me)
    state.unsub.push(
      col('messages').where('toUid','==',uid).onSnapshot(
        s => { state.inbox=s.docs.map(d=>({id:d.id,...d.data()})); if(state.route==='dashboard') render(); },
        err => console.warn('inbox listener error:', err)
      )
    );
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
    // ensure profile exists + mirror role
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  /* ---------- Boot ---------- */
  setTheme('sunrise','medium');
  render();

  /* ---------- Seed helper (optional) ---------- */
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const outline=[{
      title:"Chapter 1: Basics",
      lessons:[
        {title:"Welcome",video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",html:"<p>Welcome text here. You can put <strong>HTML</strong> or plain text.</p>",images:[]},
        {title:"Numbers",html:"<p>Understanding numbers…</p>",images:[]}
      ]
    },{
      title:"Chapter 2: Algebra",
      lessons:[{title:"Equations",html:"<p><code>ax + b = 0</code></p>",images:[]}]
    }];
    const c1=await col('courses').add({
      title:'Algebra Basics', category:'Math', credits:3,
      short:'Equations, functions, factoring.',
      outline: JSON.stringify(outline),
      ownerUid:u.uid, ownerEmail:u.email, createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await col('enrollments').add({
      uid:u.uid, courseId:c1.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(),
      course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3}
    });
    await col('quizzes').add({
      title:'Algebra Final', courseId:c1.id, courseTitle:'Algebra Basics', passScore:70, isFinal:true,
      items:[
        {q:'2+2?', choices:['3','4','5'], answer:1, feedbackOk:'Correct', feedbackNo:'Try again'},
        {q:'Pick primes', choices:['2','3','4','5'], answer:[0,1,3], feedbackOk:'Great!', feedbackNo:'Recheck primes'}
      ],
      ownerUid:u.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    alert('Seeded sample course & final');
  };
})();