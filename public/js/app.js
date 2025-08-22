/* LearnHub — E-Learning & Community Platform (v1.2)
   - Firebase compat: Auth, Firestore, Storage
   - Roles: student | instructor | admin (roles/{uid}.role). Admin override via ADMIN_EMAILS.
   - Features: Courses, Enrollments, Finals (assessments), Attempts, Certificates, Chat (course), Inbox (1:1), Tasks, Profile
   - This build adds:
     • Role Manager by email OR UID
     • Dashboard cards for Tasks / Chat / Direct Messages (clickable)
     • Finals editor with datetime-local inputs (no --:-- -- confusion)
     • Instant feedback (per-question) + multi-select support
     • Safer image handling in lessons (broken URLs won’t break UI)
*/

(() => {
  'use strict';

  /* ---------------- Firebase ---------------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing.');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  /* ---------------- Constants ---------------- */
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add more here if you want
  const VALID_ROLES  = ['student','instructor','admin'];

  /* ---------------- State ---------------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    searchQ:'', highlightId:null,
    // data
    profiles:[], courses:[], enrollments:[], finals:[], attempts:[], messages:[], tasks:[],
    announcements:[], inbox:[],
    unsub:[]
  };

  /* ---------------- Utils ---------------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const myUid=()=>auth.currentUser?.uid||null;
  const nowYear=()=>new Date().getFullYear();
  const notify=(msg,type='ok')=>{
    let n=$('#notification'); if(!n){n=document.createElement('div');n.id='notification';n.className='notification';document.body.appendChild(n);}
    n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200);
  };
  const escapeHTML = (s)=> String(s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

  /* ---------------- Permissions ---------------- */
  const canManageUsers  = ()=> state.role==='admin';
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canCreateFinal  = ()=> ['instructor','admin'].includes(state.role);
  const isEnrolled = (courseId)=>{
    const uid=myUid(); if(!uid) return false;
    return state.enrollments.some(e=> e.uid===uid && e.courseId===courseId);
  };
  const canPostCourseMsg = (courseId)=> isEnrolled(courseId) || ['instructor','admin'].includes(state.role);

  /* ---------------- Router + Layout ---------------- */
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','inbox','search'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; render(); }

  function layout(content){
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand" id="brand"><div class="logo">🧮</div><div class="title">LearnHub</div></div>
        <div class="nav" id="side-nav">
          ${[
            ['dashboard','Dashboard','ri-dashboard-line'],
            ['courses','Courses','ri-book-2-line'],
            ['learning','My Learning','ri-graduation-cap-line'],
            ['assessments','Finals','ri-file-list-3-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['inbox','Direct Messages','ri-mail-send-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line']
          ].map(([r,label,icon])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
              <i class="${icon}"></i><span>${label}</span>
            </div>`).join('')}
        </div>
        <div class="footer"><div class="muted" style="font-size:12px">© ${nowYear()} LearnHub</div></div>
      </aside>

      <div>
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn ghost" id="burger"><i class="ri-menu-line"></i></button>
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

  /* ---------------- Views ---------------- */

  const vLogin=()=>`
  <div class="login-page">
    <div class="card login-card">
      <div class="card-body">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
          <div class="logo">🧮</div>
          <div><div style="font-size:20px;font-weight:800">LearnHub</div><div class="muted">Sign in to continue</div></div>
        </div>
        <div class="login-grid">
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
        <div><div class="muted">${label}</div><h2 style="margin:4px 0 0">${value}</h2></div>
        <i class="${icon}" style="font-size:28px;opacity:.6"></i>
      </div>
    </div>`;

  function vDashboard(){
    const uid=myUid();
    const myEnroll = state.enrollments.filter(e=>e.uid===uid).length;
    const myAttempts = state.attempts.filter(a=>a.uid===uid).length;
    const myTasks = state.tasks.filter(t=>t.uid===uid && t.status!=='done').length;
    const myDMs = state.inbox.filter(m=>m.toUid===uid).length;

    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Learning', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals Taken', myAttempts,'assessments','ri-file-list-3-line')}
        ${dashCard('My Tasks', myTasks,'tasks','ri-list-check-2')}
      </div>
      <div class="grid cols-3">
        ${dashCard('Course Chat','Open','chat','ri-chat-3-line')}
        ${dashCard('Direct Messages', myDMs,'inbox','ri-mail-send-line')}
        ${dashCard('Profile & Transcript','Open','profile','ri-user-3-line')}
      </div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Welcome</h3>
        <p class="muted">Browse courses, enroll, read lessons, take finals, chat with peers, and earn certificates.</p>
      </div></div>
    `;
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
            <div class="card" id="${c.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${escapeHTML(c.title||'Untitled')}</div>
                  <div class="muted" style="font-size:12px">${escapeHTML(c.category||'General')} • by ${escapeHTML(c.ownerEmail||'—')}</div>
                </div>
                <div style="display:flex;gap:6px;align-items:center">
                  ${!isEnrolled(c.id) && state.role==='student' ? `<button class="btn" data-enroll="${c.id}" title="Enroll"><i class="ri-checkbox-circle-line"></i></button>`:''}
                  <button class="btn" data-open="${c.id}" title="Open"><i class="ri-external-link-line"></i></button>
                  ${canCreateCourse() && (state.role==='admin' || c.ownerUid===myUid())? `<button class="btn ghost" data-edit="${c.id}" title="Edit"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
        </div>
      </div></div>
    `;
  }

  function vLearning(){
    const uid=myUid();
    const list = state.enrollments.filter(e=>e.uid===uid).map(e=> e.course || state.courses.find(c=>c.id===e.courseId) || {id:e.courseId,title:'(Course)'} );
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Learning</h3>
        <div class="grid cols-2" data-sec="learning">
          ${list.map(c=>`
            <div class="card">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div><div style="font-weight:800">${escapeHTML(c.title||'Untitled')}</div><div class="muted" style="font-size:12px">${escapeHTML(c.category||'General')}</div></div>
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
          ${canCreateFinal()? `<button class="btn" id="new-final"><i class="ri-add-line"></i> New Final</button>`:''}
        </div>
        <div class="grid" data-sec="finals">
          ${state.finals.map(q=>`
            <div class="card" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                <div>
                  <div style="font-weight:800">${escapeHTML(q.title||'Untitled')}</div>
                  <div class="muted" style="font-size:12px">${escapeHTML(q.courseTitle||'—')} • pass ≥ ${q.passScore||70}% ${q.window?`• window: ${q.window}`:''}</div>
                </div>
                <div style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${canCreateFinal() || q.ownerUid===myUid()? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!state.finals.length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Final</th><th>Score</th><th>Course</th><th>Date</th></tr></thead>
            <tbody>
              ${state.attempts.filter(a=>a.uid===myUid()).map(a=>{
                const title = escapeHTML(a.quizTitle||a.finalTitle||'Final'); 
                const course = state.courses.find(c=>c.id===a.courseId)?.title || a.courseId || '—';
                return `<tr class="clickable" data-open-course="${a.courseId}">
                  <td>${title}</td><td class="num">${a.score}%</td><td>${escapeHTML(course)}</td>
                  <td>${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</td></tr>`;
              }).join('')}
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
        <select id="chat-course" class="input" style="max-width:360px">
          <option value="">Select course…</option>
          ${state.courses.map(c=>`<option value="${c.id}">${escapeHTML(c.title)}</option>`).join('')}
        </select>
      </div>
      <div id="chat-box" style="margin-top:10px;max-height:55vh;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:10px"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="chat-input" class="input" placeholder="Message…"/>
        <button class="btn" id="chat-send"><i class="ri-send-plane-2-line"></i></button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">Enrolled students + instructors can post.</div>
    </div></div>`;

  function vInbox(){
    const uid=myUid();
    const mine = state.inbox.filter(m=>m.toUid===uid || m.fromUid===uid).sort((a,b)=>(a.createdAt?.seconds||0)-(b.createdAt?.seconds||0));
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Direct Messages</h3>
          <button class="btn" id="dm-new"><i class="ri-mail-add-line"></i> New</button>
        </div>
        <div style="margin-top:10px" id="dm-list">
          ${mine.slice(-50).map(m=>{
            const me = m.fromUid===uid?'me':'them';
            const peerEmail = m.fromUid===uid ? (m.toEmail||m.toUid) : (m.fromEmail||m.fromUid);
            return `<div class="card"><div class="card-body">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div><strong>${me==='me'?'To':'From'}:</strong> ${escapeHTML(peerEmail||'—')}</div>
                <div class="muted" style="font-size:12px">${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleString()}</div>
              </div>
              <div style="margin-top:6px">${escapeHTML(m.text||'')}</div>
            </div></div>`;
          }).join('') || '<div class="muted">No messages yet.</div>'}
        </div>
      </div></div>
    `;
  }

  function vTasks(){
    const uid=myUid();
    const lane=(key,label,color)=>{
      const cards=(state.tasks||[]).filter(t=> t.uid===uid && t.status===key);
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
                  <div>${escapeHTML(t.title||'Task')}</div>
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
    const uid=myUid();
    const me = state.profiles.find(p=>p.uid===uid) || {name:'',bio:'',portfolio:'',signName:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${escapeHTML(me.name||'')}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${escapeHTML(me.portfolio||'')}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${escapeHTML(me.bio||'')}</textarea>
            <input id="pf-signname" class="input" placeholder="Signature (printed name)" value="${escapeHTML(me.signName||'')}"/>
            <div class="muted" style="font-size:12px">Avatar & signature (PNG recommended):</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="pf-avatar" type="file" accept="image/*"/>
              <input id="pf-sign" type="file" accept="image/*"/>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
            </div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Course</th><th>Best Score</th><th>Credits</th><th>Certificate</th></tr></thead>
              <tbody>
                ${buildTranscript(uid).map(r=>`
                  <tr>
                    <td>${escapeHTML(r.courseTitle)}</td>
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
            <input id="rm-uid" class="input" placeholder="User UID or Email"/>
            <select id="rm-role" class="input">${VALID_ROLES.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
            <button class="btn" id="rm-save"><i class="ri-save-3-line"></i> Save Role</button>
            <div class="muted" style="font-size:12px">Tip: Paste email or UID. Saves into roles/{uid} and mirrors to profiles/{uid}.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
            ${state.profiles.map(p=>`<tr><td>${escapeHTML(p.name||'—')}</td><td>${escapeHTML(p.email||'—')}</td><td>${escapeHTML(p.role||'student')}</td></tr>`).join('')}
            </tbody></table>
          </div>
        </div></div>
      </div>
    `;
  }

  function vSearch(){
    const q=state.searchQ||''; const res=q?doSearch(q):[];
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">Search</h3>
          <div class="muted">Query: <strong>${escapeHTML(q||'(empty)')}</strong></div>
        </div>
        ${res.length? `<div class="grid">${res.map(r=>`
          <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div style="font-weight:700">${escapeHTML(r.label)}</div>
              <div class="muted" style="font-size:12px">${r.section}</div>
            </div>
            <button class="btn" data-open-route="${r.route}" data-id="${r.id||''}">Open</button>
          </div></div>`).join('')}</div>` : `<p class="muted">No results.</p>`}
      </div></div>`;
  }

  function safeView(){
    switch(state.route){
      case 'dashboard': return vDashboard();
      case 'courses': return vCourses();
      case 'learning': return vLearning();
      case 'assessments': return vAssessments();
      case 'chat': return vChat();
      case 'inbox': return vInbox();
      case 'tasks': return vTasks();
      case 'profile': return vProfile();
      case 'admin': return vAdmin();
      case 'search': return vSearch();
      default: return vDashboard();
    }
  }

  /* ---------------- Render + Wiring ---------------- */
  function openModal(){ $('#m-modal')?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(){ $('#m-modal')?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }

  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView() );
    wireShell(); wireRoute();
  }

  function wireShell(){
    // nav
    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it) go(it.getAttribute('data-route'));
    });
    // dashboard cards
    $('#main')?.addEventListener('click', e=>{
      const c=e.target.closest('.card.clickable[data-go]'); if(c) go(c.getAttribute('data-go'));
    });
    // logout
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
          results.innerHTML=out.map(r=>`<div class="row" data-route="${r.route}" data-id="${r.id||''}"><strong>${escapeHTML(r.label)}</strong> <span class="muted">— ${r.section}</span></div>`).join('');
          results.classList.add('active');
          results.querySelectorAll('.row').forEach(row=>{
            row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id'); state.searchQ=q; state.highlightId=id; go(r); results.classList.remove('active'); };
          });
        },120);
      });
      document.addEventListener('click', e=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
    }
    // modal close
    $('#mm-close')?.addEventListener('click', closeModal);
  }

  function wireRoute(){
    switch(state.route){
      case 'courses': wireCourses(); break;
      case 'learning': wireLearning(); break;
      case 'assessments': wireAssessments(); break;
      case 'chat': wireChat(); break;
      case 'inbox': wireInbox(); break;
      case 'tasks': wireTasks(); break;
      case 'profile': wireProfile(); break;
      case 'admin': wireAdmin(); break;
      case 'search': wireSearch(); break;
    }
  }

  /* ---------------- Search index ---------------- */
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.finals.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'profile', id:p.uid, text:(p.bio||'')+' '+(p.portfolio||'')}));
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

  /* ---------------- Login ---------------- */
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
          doc('profiles', uid).set({ uid, email, name:'', bio:'', portfolio:'', signName:'', credits:0, createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  /* ---------------- Courses ---------------- */
  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credit" class="input" type="number" placeholder="Credits (e.g., 3)"/>
          <textarea id="c-desc" class="input" placeholder="Short description"></textarea>
          <textarea id="c-outline" class="input" placeholder='Outline JSON (chapters/lessons with optional "video", "html", "images")'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal();
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ outline=[]; }
        const obj={
          title:t, category:$('#c-category')?.value.trim(), desc:$('#c-desc')?.value.trim(), credit:+($('#c-credit')?.value||0),
          outline, ownerUid:myUid(), ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp()
        };
        try{ await col('courses').add(obj); closeModal(); notify('Course saved'); }catch(e){ notify(e?.message||'Save failed','danger'); }
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const enroll=e.target.closest('button[data-enroll]'); const open=e.target.closest('button[data-open]'); const edit=e.target.closest('button[data-edit]');
      if(enroll){
        const id=enroll.getAttribute('data-enroll');
        try{
          await col('enrollments').add({ uid:myUid(), courseId:id, createdAt:firebase.firestore.FieldValue.serverTimestamp(),
            course: { id, title: state.courses.find(c=>c.id===id)?.title||'', category: state.courses.find(c=>c.id===id)?.category||'' }});
          notify('Enrolled');
        }catch(err){ notify(err?.message||'Enroll denied by rules','danger'); }
      }
      if(open){
        const id=open.getAttribute('data-open'); openCourseModal(id);
      }
      if(edit){
        const id=edit.getAttribute('data-edit');
        const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id,...snap.data()};
        if(!(canCreateCourse() || c.ownerUid===myUid())) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Course';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="c-title" class="input" value="${escapeHTML(c.title||'')}"/>
            <input id="c-category" class="input" value="${escapeHTML(c.category||'')}"/>
            <input id="c-credit" class="input" type="number" value="${c.credit||0}"/>
            <textarea id="c-desc" class="input">${escapeHTML(c.desc||'')}</textarea>
            <textarea id="c-outline" class="input">${escapeHTML(JSON.stringify(c.outline||[],null,2))}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal();
        $('#c-save').onclick=async ()=>{
          let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ outline=c.outline||[]; }
          try{
            await doc('courses', id).set({
              title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), desc:$('#c-desc')?.value.trim(),
              credit:+($('#c-credit')?.value||0), outline, updatedAt:firebase.firestore.FieldValue.serverTimestamp()
            },{merge:true});
            closeModal(); notify('Saved');
          }catch(err){ notify(err?.message||'Update failed','danger'); }
        };
      }
    });
  }

  async function openCourseModal(id){
    try{
      const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id,...snap.data()};
      $('#mm-title').textContent=c.title;
      const firstVideo = ((c.outline||[])[0]?.lessons||[])[0]?.video || '';
      const vEmbed = firstVideo ? embedVideo(firstVideo) : '';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <div class="muted">${escapeHTML(c.category||'General')} • Credits: ${c.credit||0} • by ${escapeHTML(c.ownerEmail||'—')}</div>
          ${vEmbed? `<div style="margin:8px 0">${vEmbed}</div>`:''}
          <p>${escapeHTML(c.desc||'')}</p>
        </div>`;
      $('#mm-foot').innerHTML=`
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${!isEnrolled(c.id) && state.role==='student'? `<button class="btn" id="btn-enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>`:''}
          <button class="btn ghost" id="btn-notes"><i class="ri-sticky-note-line"></i> My notes</button>
        </div>`;
      openModal();

      $('#btn-enroll')?.addEventListener('click', async ()=>{
        try{
          await col('enrollments').add({ uid:myUid(), courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id,title:c.title,category:c.category} });
          closeModal(); notify('Enrolled');
        }catch(err){ notify(err?.message||'Enroll denied by rules','danger'); }
      });
      $('#btn-notes')?.addEventListener('click', ()=> openNotesModal(c.id));
    }catch(err){
      notify(err?.message||'Open denied by rules','danger');
    }
  }

  function embedVideo(url){
    try{
      const u=new URL(url);
      if(/(youtube\.com|youtu\.be)/.test(u.hostname)){
        // get id
        let id='';
        if(u.hostname.includes('youtu.be')) id=u.pathname.slice(1);
        else id=u.searchParams.get('v')||'';
        if(!id) return '';
        return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen></iframe>`;
      }
      if(/\.(mp4|webm|ogg)$/i.test(url)){
        return `<video controls style="width:100%;max-height:380px"><source src="${escapeHTML(url)}"></video>`;
      }
      return '';
    }catch{ return ''; }
  }

  function openNotesModal(courseId){
    $('#mm-title').textContent='My Notes';
    $('#mm-body').innerHTML=`<div class="grid"><textarea id="note-text" class="input" placeholder="Write your sticky note here…"></textarea></div>`;
    $('#mm-foot').innerHTML=`<button class="btn" id="note-save"><i class="ri-save-3-line"></i> Save</button>`;
    openModal();
    $('#note-save').onclick=async ()=>{
      const text = $('#note-text')?.value.trim(); if(!text) return closeModal();
      await col('notes').add({ uid:myUid(), courseId, text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      closeModal(); notify('Note saved');
    };
  }

  /* ---------------- Learning ---------------- */
  function wireLearning(){
    $('#main')?.addEventListener('click', e=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); openCourseModal(id);
    });
  }

  /* ---------------- Finals ---------------- */
  function wireAssessments(){
    $('#new-final')?.addEventListener('click', ()=>{
      if(!canCreateFinal()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Final title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${escapeHTML(c.title)}</option>`).join('')}</select>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <label class="muted">Window (optional):</label>
          <input id="q-start" class="input" type="datetime-local"/>
          <input id="q-end" class="input" type="datetime-local"/>
          <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":1,"feedbackRight":"Correct!","feedbackWrong":"Nope — 4"}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal();
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const s = $('#q-start')?.value ? new Date($('#q-start').value) : null;
        const e = $('#q-end')?.value ? new Date($('#q-end').value) : null;
        const course=state.courses.find(c=>c.id===courseId)||{};
        try{
          await col('finals').add({
            title:t, courseId, courseTitle:course.title||courseId, passScore:pass, items,
            windowStart: s? firebase.firestore.Timestamp.fromDate(s): null,
            windowEnd: e? firebase.firestore.Timestamp.fromDate(e): null,
            ownerUid: myUid(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          closeModal(); notify('Final saved');
        }catch(err){ notify(err?.message||'Save denied by rules','danger'); }
      };
    });

    const sec=$('[data-sec="finals"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
  const id=take.getAttribute('data-take');
  const snap=await doc('finals',id).get(); if(!snap.exists) return;
  const q={id:snap.id,...snap.data()};
  if(!canTakeQuiz(q.courseId)) return notify('Enroll first to take','warn');

  const mmBody = $('#mm-body');
  const mmFoot = $('#mm-foot');

  // Render quiz
  $('#mm-title').textContent=q.title||'Final Exam';
  mmBody.style.maxHeight='65vh';           // safety, CSS also handles this
  mmBody.style.overflowY='auto';

  mmBody.innerHTML = (q.items||[]).map((it,idx)=>{
    const isMulti = (it.type||'single').toLowerCase()==='multi' || Array.isArray(it.answer);
    const name = isMulti? `q${idx}[]` : `q${idx}`;
    return `
      <div class="card"><div class="card-body">
        <div style="font-weight:700">Q${idx+1}. ${it.q||''}</div>
        <div style="margin-top:6px; display:grid; gap:6px">
          ${(it.choices||[]).map((c,i)=>`
            <label style="display:flex; gap:8px; align-items:center">
              <input ${isMulti?'type="checkbox"':'type="radio"'} name="${name}" value="${i}"/>
              <span>${c}</span>
            </label>`).join('')}
        </div>
      </div></div>
    `;
  }).join('');

  mmFoot.innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
  openModal('m-modal');

  // Helper: compare arrays disregarding order
  const sameSet=(a,b)=>{
    if(!Array.isArray(a)||!Array.isArray(b) || a.length!==b.length) return false;
    const A=a.map(Number).sort((x,y)=>x-y), B=b.map(Number).sort((x,y)=>x-y);
    for(let i=0;i<A.length;i++) if(A[i]!==B[i]) return false; return true;
  };

  $('#q-submit').onclick = async ()=>{
    const items = q.items||[];
    let correct=0;

    items.forEach((it,idx)=>{
      const isMulti = (it.type||'single').toLowerCase()==='multi' || Array.isArray(it.answer);
      if(isMulti){
        const sel=[...document.querySelectorAll(`input[name="q${idx}[]"]:checked`)].map(el=>+el.value);
        const ans=Array.isArray(it.answer)? it.answer.map(Number):[];
        if(sameSet(sel, ans)) correct++;
      }else{
        const v=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
        if(+v===+(it.answer)) correct++;
      }
    });

    const score = items.length? Math.round((correct/items.length)*100) : 0;
    const pass  = score >= (q.passScore||70);

    await col('attempts').add({
      uid:auth.currentUser.uid,
      email:auth.currentUser.email,
      quizId:q.id,
      quizTitle:q.title||'Final',
      courseId:q.courseId,
      score,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });

    closeModal('m-modal');
    notify(`Your score: ${score}% ${pass?'(Pass)':'(Try again)'}`);
  };
}
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('finals',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(canCreateFinal() || q.ownerUid===myUid())) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${escapeHTML(q.title||'')}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <label class="muted">Window (optional):</label>
            <input id="q-start" class="input" type="datetime-local" value="${q.windowStart?.toDate? toDTLocal(q.windowStart.toDate()):''}"/>
            <input id="q-end" class="input" type="datetime-local" value="${q.windowEnd?.toDate? toDTLocal(q.windowEnd.toDate()):''}"/>
            <textarea id="q-json" class="input">${escapeHTML(JSON.stringify(q.items||[],null,2))}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal();
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          const s = $('#q-start')?.value ? new Date($('#q-start').value) : null;
          const e = $('#q-end')?.value ? new Date($('#q-end').value) : null;
          await doc('finals',id).set({
            title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items,
            windowStart: s? firebase.firestore.Timestamp.fromDate(s): null,
            windowEnd: e? firebase.firestore.Timestamp.fromDate(e): null,
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });
  }

  function toDTLocal(d){
    // yyyy-MM-ddThh:mm
    const pad=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openFinalModal(q){
    $('#mm-title').textContent=q.title;
    const items=q.items||[];
    $('#mm-body').innerHTML = items.map((it,idx)=>`
      <div class="card"><div class="card-body">
        <div style="font-weight:700">Q${idx+1}. ${escapeHTML(it.q||'')}</div>
        ${it.ref ? `<div class="muted" style="font-size:12px;margin-top:2px">Hint: ${escapeHTML(it.ref)}</div>` : ''}
        <div style="margin-top:6px;display:grid;gap:6px">
          ${(it.choices||[]).map((c,i)=>`
            <label style="display:flex;gap:8px;align-items:center">
              <input type="${it.multi?'checkbox':'radio'}" name="q${idx}" value="${i}"/> <span>${escapeHTML(c)}</span>
            </label>`).join('')}
        </div>
        <div id="fb-${idx}" class="muted" style="margin-top:8px;min-height:20px"></div>
      </div></div>`).join('') || '<p class="muted">No questions yet.</p>';

    $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
    openModal();

    // instant feedback
    const mark = (idx, correct) => {
      const it = items[idx] || {};
      const el = document.getElementById(`fb-${idx}`);
      if(!el) return;
      el.textContent = correct ? (it.feedbackRight || 'Correct!') : (it.feedbackWrong || 'Try again.');
      el.style.color = correct ? '#10b981' : '#ef4444';
    };
    items.forEach((it,idx)=>{
      const selector = `input[name="q${idx}"]`;
      document.querySelectorAll(selector).forEach(inp=>{
        inp.addEventListener('change', ()=>{
          if(it.multi){
            const marked = [...document.querySelectorAll(`${selector}:checked`)].map(x=>+x.value).sort();
            const ans = (Array.isArray(it.answer)?it.answer:[it.answer]).map(Number).sort();
            mark(idx, JSON.stringify(marked)===JSON.stringify(ans));
          }else{
            const v = (document.querySelector(`${selector}:checked`)?.value)||'-1';
            mark(idx, +v === +it.answer);
          }
        });
      });
    });

    $('#q-submit').onclick=async ()=>{
      let correct=0, total=items.length||1;
      items.forEach((it,idx)=>{
        if(it.multi){
          const marked=[...document.querySelectorAll(`input[name="q${idx}"]:checked`)].map(x=>+x.value).sort();
          const ans=(Array.isArray(it.answer)?it.answer:[it.answer]).map(Number).sort();
          if(JSON.stringify(marked)===JSON.stringify(ans)) correct++;
        }else{
          const v=(document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1';
          if(+v===+it.answer) correct++;
        }
      });
      const score = Math.round((correct/total)*100);
      const pass = score >= (q.passScore||70);
      try{
        await col('attempts').add({
          uid:myUid(), email:auth.currentUser.email, quizId:q.id, finalTitle:q.title, courseId:q.courseId, score,
          createdAt:firebase.firestore.FieldValue.serverTimestamp()
        });
        if(pass){
          // add credits to profile
          const me = state.profiles.find(p=>p.uid===myUid()) || {};
          const course=state.courses.find(c=>c.id===q.courseId)||{};
          const add = Number(course.credit||0);
          await doc('profiles', myUid()).set({ credits: Number(me.credits||0) + add },{merge:true});
        }
        closeModal();
        notify(`Your score: ${score}% ${pass?'(Pass)':'(Try again)'}`);
      }catch(err){ notify(err?.message||'Submit denied by rules','danger'); }
    };
  }

  /* ---------------- Chat (course-wide) ---------------- */
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
      }, err=> notify(err?.message||'Chat denied by rules','danger'));
    };
    courseSel?.addEventListener('change', e=> sub(e.target.value));
    send?.addEventListener('click', async ()=>{
      const text=input.value.trim(); if(!text||!currentCourse) return;
      if(!canPostCourseMsg(currentCourse)) return notify('Enroll to chat','warn');
      const p = state.profiles.find(x=>x.uid===myUid()) || {};
      try{
        await col('messages').add({ courseId:currentCourse, uid:myUid(), email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        input.value='';
      }catch(err){ notify(err?.message||'Post denied by rules','danger'); }
    });
  }

  /* ---------------- Direct Messages (Inbox) ---------------- */
  function wireInbox(){
    $('#dm-new')?.addEventListener('click', async ()=>{
      $('#mm-title').textContent='New Direct Message';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="dm-to" class="input" placeholder="Recipient email"/>
          <textarea id="dm-text" class="input" placeholder="Message"></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="dm-send">Send</button>`;
      openModal();
      $('#dm-send').onclick=async ()=>{
        const to=$('#dm-to')?.value.trim().toLowerCase(); const text=$('#dm-text')?.value.trim();
        if(!to||!text) return notify('Enter recipient email and message','warn');
        try{
          const q=await col('profiles').where('email','==',to).limit(1).get();
          if(q.empty) { notify('Recipient not found','warn'); return; }
          const toUid=q.docs[0].id;
          await col('inbox').add({
            fromUid:myUid(), toUid, fromEmail:auth.currentUser.email, toEmail:to, text,
            createdAt:firebase.firestore.FieldValue.serverTimestamp()
          });
          closeModal(); notify('Sent');
        }catch(err){ notify(err?.message||'Send denied by rules','danger'); }
      };
    });
  }

  /* ---------------- Tasks ---------------- */
  function wireTasks(){
    const root=$('[data-sec="tasks"]'); if(!root) return;

    $('#addTask')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal();
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        try{ await col('tasks').add({ uid:myUid(), title:t, status:'todo', createdAt:firebase.firestore.FieldValue.serverTimestamp() }); closeModal(); notify('Saved'); }
        catch(err){ notify(err?.message||'Save denied by rules','danger'); }
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
          <input id="t-title" class="input" value="${escapeHTML(t.title||'')}"/>
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

  /* ---------------- Profile ---------------- */
  function wireProfile(){
    $('#main')?.addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===myUid())||{name:auth.currentUser.email, signName:'', avatar:'', sign:''};
      await downloadCertificate(p, course);
    });

    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=myUid();
      try{
        await doc('profiles',uid).set({
          name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(),
          bio:$('#pf-bio')?.value.trim(), signName:$('#pf-signname')?.value.trim(),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        },{merge:true});
        // files
        const avatar=$('#pf-avatar')?.files?.[0]; const sign=$('#pf-sign')?.files?.[0];
        if(avatar){ const r=stg.ref().child(`avatars/${uid}/${avatar.name}`); await r.put(avatar); const url=await r.getDownloadURL(); await doc('profiles',uid).set({ avatar:url },{merge:true}); }
        if(sign){ const r=stg.ref().child(`signatures/${uid}/${sign.name}`); await r.put(sign); const url=await r.getDownloadURL(); await doc('profiles',uid).set({ sign:url },{merge:true}); }
        notify('Profile saved'); render(); // re-render to reflect avatar/sign/credits
      }catch(err){ notify(err?.message||'Save denied by rules','danger'); }
    });
  }

  async function downloadCertificate(profile, course){
    // Pretty certificate (dark frame)
    const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
    const ctx=canvas.getContext('2d');
    // background
    ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
    // border
    ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(40,40,1320,820);
    ctx.strokeStyle='#2cc5e3'; ctx.lineWidth=3; ctx.strokeRect(60,60,1280,780);
    // title
    ctx.fillStyle='#ffffff'; ctx.font='bold 60px Garamond, serif'; ctx.fillText('Certificate of Completion', 300, 200);
    // body
    ctx.font='28px Helvetica, Arial'; ctx.fillText(`This certifies that`, 300, 260);
    ctx.font='bold 40px "Times New Roman", serif'; ctx.fillText(`${profile.name||auth.currentUser.email}`, 300, 310);
    ctx.font='28px Helvetica, Arial'; ctx.fillText(`has successfully completed`, 300, 360);
    ctx.font='bold 36px "Times New Roman", serif'; ctx.fillText(`${course.title||course.id}`, 300, 408);
    const today=new Date().toLocaleDateString();
    ctx.font='24px Helvetica, Arial'; ctx.fillText(`Issued on ${today}`, 300, 456);
    // credits
    if(course.credit){ ctx.font='24px Helvetica, Arial'; ctx.fillText(`${course.credit} credits awarded`, 300, 496); }
    // signature line
    ctx.beginPath(); ctx.moveTo(300, 620); ctx.lineTo(700, 620); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    ctx.font='20px Helvetica, Arial'; ctx.fillText(profile.signName||'Authorized Signature', 300, 650);
    // signature image (optional)
    if(profile.sign){
      try{ const img=await loadImage(profile.sign); ctx.drawImage(img, 300, 560, 220, 80);}catch{}
    }
    // logo corner
    ctx.font='22px Helvetica, Arial'; ctx.fillText('LearnHub', 1050, 820);

    const url=canvas.toDataURL('image/png');
    const a=document.createElement('a'); a.href=url; a.download=`certificate_${(course.title||course.id||'course').replace(/\s+/g,'_')}.png`; a.click();
  }

  function loadImage(src){
    return new Promise((res,rej)=>{ const i=new Image(); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=rej; i.src=src; });
  }

  function buildTranscript(uid){
    const byCourse = {};
    (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
      const c = state.courses.find(x=>x.id===a.courseId);
      const title = c?.title || a.courseId || '—';
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:title, best:0, credits:c?.credit||0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const fin = state.finals.find(q=>q.courseId===a.courseId);
      const pass = fin ? (byCourse[a.courseId].best >= (fin.passScore||70)) : false;
      byCourse[a.courseId].completed = pass;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  /* ---------------- Admin: roles by email OR UID ---------------- */
  function wireAdmin(){
    const resolveUidFromInput = async (input) => {
      let uid = (input||'').trim();
      if(!uid) return null;
      // If admin typed an email, find uid in profiles by email.
      if (uid.includes('@')) {
        const q = await col('profiles').where('email','==',uid).limit(1).get();
        if (q.empty) return null;
        uid = q.docs[0].id;
      }
      return uid;
    };
    $('#rm-save')?.addEventListener('click', async ()=>{
      const raw = $('#rm-uid')?.value.trim(); 
      const role = $('#rm-role')?.value||'student';
      if(!VALID_ROLES.includes(role)) return notify('Enter a valid role','warn');
      const uid = await resolveUidFromInput(raw);
      if(!uid) return notify('User not found (use UID or an existing email)','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      await doc('profiles',uid).set({ role },{merge:true});
      notify('Role saved');
    });
  }

  /* ---------------- Search open route ---------------- */
  function wireSearch(){
    $('#main')?.querySelectorAll('[data-open-route]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const r=el.getAttribute('data-open-route'); const id=el.getAttribute('data-id'); state.highlightId=id; go(r);
      });
    });
    // click attempt row opens course
    $('#main')?.addEventListener('click', e=>{
      const tr=e.target.closest('tr[data-open-course]'); if(!tr) return;
      openCourseModal(tr.getAttribute('data-open-course'));
    });
  }

  /* ---------------- Firestore sync ---------------- */
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }

  function sync(){
    clearUnsubs();
    // profiles (public to authed)
    state.unsub.push(col('profiles').onSnapshot(s=>{ state.profiles=s.docs.map(d=>({id:d.id,uid:d.id,...d.data()})); if(['profile','admin'].includes(state.route)) render(); }));
    // courses
    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(s=>{ state.courses=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); }));
    // enrollments (mine)
    state.unsub.push(col('enrollments').where('uid','==',myUid()).onSnapshot(s=>{ state.enrollments=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','learning'].includes(state.route)) render(); }));
    // finals
    state.unsub.push(col('finals').orderBy('createdAt','desc').onSnapshot(s=>{ state.finals=s.docs.map(d=>({id:d.id,...d.data(), window: fmtWindow(d.data()) })); if(['assessments'].includes(state.route)) render(); }));
    // attempts (mine)
    state.unsub.push(col('attempts').where('uid','==',myUid()).orderBy('createdAt','desc').onSnapshot(s=>{ state.attempts=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments','profile','dashboard'].includes(state.route)) render(); }));
    // tasks (mine)
    state.unsub.push(col('tasks').where('uid','==',myUid()).onSnapshot(s=>{ state.tasks=s.docs.map(d=>({id:d.id,...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); }));
    // announcements
    state.unsub.push(col('announcements').orderBy('createdAt','desc').onSnapshot(s=>{ state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); }));
    // direct messages (where I am sender or recipient) – read filter happens client-side
    state.unsub.push(col('inbox').orderBy('createdAt','asc').onSnapshot(s=>{ state.inbox=s.docs.map(d=>({id:d.id,...d.data()})); if(['inbox','dashboard'].includes(state.route)) render(); }));
  }

  function fmtWindow(obj){
    const s=obj.windowStart?.toDate?.(); const e=obj.windowEnd?.toDate?.();
    if(!s && !e) return '';
    const p = d=> `${d?.toLocaleDateString()} ${d?.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
    return `${s? p(s):''}${s&&e?' — ':''}${e? p(e):''}`;
  }

  async function resolveRole(uid,email){
    // admin override by email
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',uid).get(); const role=(r.data()?.role||'student').toLowerCase();
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  /* ---------------- Auth ---------------- */
  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid, user.email);
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', signName:'', credits:0, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  /* ---------------- Boot ---------------- */
  render();

  // Expose a tiny seed helper (optional)
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',credit:3,desc:'Equations, functions, factoring.',ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp(),outline:[
      { "title":"Chapter 1","lessons":[{ "title":"Welcome","video":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","html":"Welcome to Algebra"},{ "title":"Numbers","html":"Natural, integers, rationals" }]},
      { "title":"Chapter 2","lessons":[{ "title":"Equations","html":"ax + b = 0" }]}
    ]});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math'}});
    await col('finals').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,items:[
      { "q":"2+2?","choices":["3","4","5"],"answer":1,"feedbackRight":"Correct!","feedbackWrong":"Nope — 4" },
      { "q":"Select primes < 6","choices":["1","2","3","4","5"],"answer":[1,2,4],"multi":true,"feedbackRight":"Great!","feedbackWrong":"Primes are 2,3,5" }
    ],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    alert('Seeded: Algebra course + enrollment + final');
  };

})();