/* LearnHub — E-Learning & Community Platform (v2.0, mobile-first)
   Features:
   - Announcements (admin CRUD)
   - Courses (outline with video/text/images), enroll, reader + sticky notes
   - Finals only (isFinal=true). Scrollable quiz body, instant per-question feedback, attempts
   - Course chat (per-course), Tasks (kanban with DnD), Profiles (avatar/signature), Certificates
   - Admin role manager + profiles list (view/edit role/delete profile doc)
   - Guide page, Search, Themes (palette + font-size), Credits on dashboard/profile
   - Mobile drawer sidebar: selecting a menu closes the drawer and opens the page
*/
(() => {
  'use strict';

  // ---------- Firebase ----------
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  // ---------- Constants ----------
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add more admin emails here
  const VALID_ROLES  = ['student','instructor','admin'];
  const YT_EDU = ['wX78iKhInsc','8mAITcNt710','HxaD_trXwRE','Qqx_wzMmFeA','r59xYe3Vyks','ERCMXc8x7mc','PkZNo7MFNFg','W6NZfCO5SIk'];

  // ---------- State ----------
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette: localStorage.getItem('lh:pal') || 'sunrise',
            font:    localStorage.getItem('lh:fsz') || 'medium' },
    searchQ:'', highlightId:null,
    courses:[], enrollments:[], quizzes:[], attempts:[], messages:[], tasks:[], profiles:[], notes:[], announcements:[],
    myEnrolledIds: new Set(),
    unsub:[], _unsubChat:null,
    reading:{ course:null, chapIdx:0, lesIdx:0 }
  };

  // ---------- Utils ----------
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const notify=(msg,type='ok')=>{ const n=$('#notification'); if(!n) return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200); };
  const nowYear=()=> new Date().getFullYear();
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);
  const byId = (arr,id)=> arr.find(x=>x.id===id);
  const initials = (nameOrEmail='')=>{
    const s = (nameOrEmail||'').trim();
    if(!s) return '🙂';
    const parts = s.split(/\s+/);
    if(parts.length>1) return (parts[0][0]+parts[1][0]).toUpperCase();
    if(s.includes('@')) return s[0].toUpperCase();
    return (s[0]||'L').toUpperCase();
  };

  function applyTheme(){
    document.documentElement.setAttribute('data-pal', state.theme.palette);
    const fsz = state.theme.font==='small'? '14px' : state.theme.font==='large'? '18px' : '16px';
    document.documentElement.style.setProperty('--fs', fsz);
  }
  applyTheme();

  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled = (courseId)=> state.myEnrolledIds.has(courseId);

  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.quizzes.filter(q=>q.isFinal).forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Users', route:'admin', id:p.uid||p.id, text:(p.bio||'')+' '+(p.portfolio||'')}));
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

  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search','guide'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; render(); }

  function layout(content){
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="logo"><img src="/icons/learnhub.svg" alt="LearnHub"/></div>
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
        <div class="footer"><div class="muted" style="font-size:12px;padding:10px">Powered by MM, ${nowYear()}</div></div>
      </aside>

      <div>
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn ghost" id="burger" title="Menu"><i class="ri-menu-line"></i></button>
            <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
          </div>

          <div class="search-inline" style="position:relative">
            <input id="globalSearch" class="input" placeholder="Search courses, finals, users…" autocomplete="off"/>
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
    </div></div><div class="modal-backdrop" id="mb-modal"></div>`;
  }

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="muted" style="font-size:12px">${label}</div>
          <h2 style="margin:.2em 0">${value}</h2>
        </div>
        <i class="${icon}" style="font-size:28px;opacity:.8"></i>
      </div>
    </div>`;

  function buildTranscript(uid){
    const byCourse = {};
    (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
      const course = state.courses.find(c=>c.id===a.courseId) || {};
      byCourse[a.courseId]=byCourse[a.courseId]||{
        courseId:a.courseId, courseTitle:course.title||a.courseId, best:0, completed:false, credits:course.credits||0
      };
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId && q.isFinal);
      byCourse[a.courseId].completed = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }
  const earnedCredits = (uid)=> buildTranscript(uid).filter(r=>r.completed).reduce((s,r)=> s+(r.credits||0), 0);

  // ---------- Views ----------
  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    const credits = earnedCredits(my||'');
    const picks = [...YT_EDU].sort(()=>Math.random()-0.5).slice(0,3);
    const anns = state.announcements || [];
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Learning', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.filter(q=>q.isFinal).length,'assessments','ri-file-list-3-line')}
        ${dashCard('Credits earned', credits,'profile','ri-award-line')}
      </div>

      <div class="card" style="margin-top:12px"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">Announcements</h3>
          ${canManageUsers()? `<button class="btn" id="ann-new"><i class="ri-megaphone-line"></i> New</button>`:''}
        </div>
        <div data-sec="ann-list">
          ${anns.length? anns.map(a=>`
            <div class="card" id="ann-${a.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
                <div style="flex:1">
                  <div style="font-weight:800">${a.title||'(Untitled)'}</div>
                  <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()} • ${a.ownerEmail||''}</div>
                  <div style="margin-top:6px;white-space:pre-wrap">${a.text||''}</div>
                </div>
                ${canManageUsers()? `
                  <div style="display:flex;gap:6px">
                    <button class="btn ghost" data-ann-edit="${a.id}"><i class="ri-edit-2-line"></i></button>
                    <button class="btn danger" data-ann-del="${a.id}"><i class="ri-delete-bin-6-line"></i></button>
                  </div>`:''}
              </div>
            </div>
          `).join('') : `<div class="muted">No announcements yet.</div>`}
        </div>
      </div></div>

      <div class="grid cols-3" style="margin-top:12px">
        ${picks.map(id=>`
          <div class="card"><div class="card-body">
            <div class="muted" style="margin-bottom:6px">Recommended</div>
            <iframe class="embed" src="https://www.youtube.com/embed/${id}" allowfullscreen></iframe>
          </div></div>`).join('')}
      </div>
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
            <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
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
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="new-quiz"><i class="ri-add-line"></i> New Final</button>`:''}
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
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===auth.currentUser?.uid)? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
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
            <thead><tr><th>Final</th><th>Course</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr><td>${a.quizTitle}</td><td>${(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId}</td><td class="num">${a.score}%</td><td>${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</td></tr>`).join('')}
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'',signatureName:'',avatar:'',signature:''};
    const credits = earnedCredits(auth.currentUser?.uid||'');
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <input id="pf-signame" class="input" placeholder="Signature name (printed under sign)" value="${me.signatureName||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <div class="muted">Avatar (.png/.jpg) and Signature (.png transparent)</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <input id="pf-signature" type="file" accept="image/*" style="display:none"/>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Avatar</button>
              <button class="btn ghost" id="pf-pick-sign"><i class="ri-pen-nib-line"></i> Signature</button>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn secondary" id="pf-view"><i class="ri-id-card-line"></i> View card</button>
              <button class="btn ok" id="cert-demo"><i class="ri-award-line"></i> Demo certificate</button>
              <button class="btn danger" id="pf-delete"><i class="ri-delete-bin-6-line"></i> Delete profile</button>
            </div>
            <div class="muted" style="font-size:12px">Credits earned: <b>${credits}</b></div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Course</th><th>Best Score</th><th>Credits</th><th>Certificate</th></tr></thead>
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
          <div class="muted" style="font-size:12px;margin-top:8px">
            <b>What are credits?</b> A course carries “credits” reflecting workload/level. You earn credits by completing courses (passing finals).
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
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>
            ${state.profiles.map(p=>`
              <tr data-uid="${p.uid}">
                <td>${p.name||'—'}</td>
                <td>${p.email||'—'}</td>
                <td>${p.role||'student'}</td>
                <td style="display:flex;gap:6px">
                  <button class="btn ghost" data-uview="${p.uid}"><i class="ri-eye-line"></i></button>
                  <button class="btn ghost" data-uedit="${p.uid}"><i class="ri-edit-2-line"></i></button>
                  <button class="btn danger" data-udel="${p.uid}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
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
              <option value="sunrise">sunrise</option>
              <option value="ocean">ocean</option>
              <option value="forest">forest</option>
              <option value="violet">violet</option>
              <option value="charcoal">charcoal</option>
              <option value="light">light</option>
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              <option value="small">small</option>
              <option value="medium">medium</option>
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

  function vGuide(){
    return `
      <div class="card"><div class="card-body guide">
        <h3 style="margin-top:0">Quick Guide</h3>
        <div class="section">
          <h2>Students</h2>
          <ol>
            <li>Go to <b>Courses</b> → open a course → <b>Enroll</b>.</li>
            <li>Read chapters; watch videos; add <b>Notes</b> per lesson.</li>
            <li>Use <b>Course Chat</b> to ask/answer.</li>
            <li>Take the <b>Final</b> in <b>Finals</b>. Passing grants credits & certificate.</li>
            <li>See your <b>Transcript</b> and download <b>Certificates</b> in <b>Profile</b>.</li>
          </ol>
        </div>
        <div class="section">
          <h2>Instructors/Admin</h2>
          <ol>
            <li>Use <b>Courses → New Course</b> to add (title, category, credits, short, outline JSON).</li>
            <li>Add <b>Final</b> in <b>Finals → New Final</b> (mark <code>isFinal:true</code> automatically set).</li>
            <li>Post <b>Announcements</b> on the <b>Dashboard</b>.</li>
            <li>Manage user roles via <b>Admin</b> (enter UID → set role).</li>
          </ol>
        </div>
        <div class="section">
          <h2>Outline JSON format (per course)</h2>
<pre>[
  { "title":"Chapter 1",
    "lessons":[
      {"title":"Welcome","video":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","html":"Welcome text...","images":["https://images.unsplash.com/photo-1513258496099-48168024aec0?q=80&w=1200&auto=format&fit=crop"]},
      {"title":"Numbers","html":"Understanding numbers...","images":[]}
    ]
  }
]</pre>
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

  // ---------- Render & shell ----------
  function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }
  function openSidebar(){ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); }
  function closeSidebar(){ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); }

  function layoutAndWire(content){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView(state.route) );

    // shell wiring
    $('#burger')?.addEventListener('click', ()=> document.body.classList.contains('sidebar-open')? closeSidebar(): openSidebar());
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);

    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ const r=it.getAttribute('data-route'); closeSidebar(); go(r); }
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
            row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id'); state.searchQ=q; state.highlightId=id; results.classList.remove('active'); go(r); };
          });
        },120);
      });
      document.addEventListener('click', e=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
    }

    $('#mm-close')?.addEventListener('click', ()=> closeModal('m-modal'));

    wireRoute();
  }

  function render(){ layoutAndWire(); }

  // ---------- Login ----------
  const vLogin=()=>`
    <div class="centered">
      <div class="card" style="width:min(420px,96vw)">
        <div class="card-body">
          <div class="login-header">
            <div class="login-logo"><img src="/icons/learnhub.svg" alt="LearnHub"/></div>
            <div style="margin-top:8px">
              <div style="font-size:20px;font-weight:800">LearnHub</div>
              <div class="muted">Sign in to continue</div>
            </div>
          </div>
          <div class="grid">
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

  // ---------- Wiring by route ----------
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
      case 'guide': /* no events */ break;
    }
  }

  function wireDashboard(){
    if(canManageUsers()){
      $('#ann-new')?.addEventListener('click', ()=>{
        $('#mm-title').textContent='New Announcement';
        $('#mm-body').innerHTML=`<div class="grid">
          <input id="ann-title" class="input" placeholder="Title"/>
          <textarea id="ann-text" class="input" placeholder="Message"></textarea>
        </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="ann-save">Save</button>`;
        openModal('m-modal');
        $('#ann-save').onclick=async ()=>{
          const t=$('#ann-title')?.value.trim(); const m=$('#ann-text')?.value.trim();
          if(!t) return notify('Title required','warn');
          await col('announcements').add({ title:t, text:m||'', createdAt:firebase.firestore.FieldValue.serverTimestamp(), ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email });
          closeModal('m-modal'); notify('Saved');
        };
      });

      $('[data-sec="ann-list"]')?.addEventListener('click', async (e)=>{
        const ed=e.target.closest('button[data-ann-edit]'); const del=e.target.closest('button[data-ann-del]');
        if(ed){
          const id=ed.getAttribute('data-ann-edit'); const snap=await doc('announcements',id).get(); if(!snap.exists) return;
          const a={id:snap.id,...snap.data()};
          $('#mm-title').textContent='Edit Announcement';
          $('#mm-body').innerHTML=`<div class="grid"><input id="ann-title" class="input" value="${a.title||''}"/><textarea id="ann-text" class="input">${a.text||''}</textarea></div>`;
          $('#mm-foot').innerHTML=`<button class="btn" id="ann-save">Save</button>`;
          openModal('m-modal');
          $('#ann-save').onclick=async ()=>{
            await doc('announcements',id).set({ title:$('#ann-title')?.value.trim(), text:$('#ann-text')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
            closeModal('m-modal'); notify('Saved');
          };
        }
        if(del){
          const id=del.getAttribute('data-ann-del');
          if(!confirm('Delete announcement?')) return;
          await doc('announcements',id).delete(); notify('Deleted');
        }
      });
    }
  }

  function showCourseModal(c){
    const enrolled=isEnrolled(c.id);
    $('#mm-title').textContent=c.title;
    $('#mm-body').innerHTML=`
      <div class="grid">
        <div class="muted">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
        <p>${c.short||''}</p>
      </div>`;
    $('#mm-foot').innerHTML=`
      <div style="display:flex;gap:8px">
        ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
        <button class="btn ghost" id="open-reader"><i class="ri-book-open-line"></i> Open course</button>
      </div>`;
    openModal('m-modal');

    $('#enroll')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await col('enrollments').add({ uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id, title:c.title, category:c.category, credits:c.credits||0} });
      closeModal('m-modal'); notify('Enrolled');
    });
    $('#open-reader')?.addEventListener('click', ()=>{ closeModal('m-modal'); openReader(c.id); });
  }

  function openReader(courseId){
    const c = byId(state.courses, courseId); if(!c) return;
    let outline=[];
    try{ outline = JSON.parse(c.outline||'[]'); }catch{ outline=[]; }
    const chap = outline[state.reading.chapIdx] || outline[0] || {title:'',lessons:[]};
    const les  = chap.lessons?.[state.reading.lesIdx] || chap.lessons?.[0] || {};
    $('#mm-title').textContent=c.title;
    $('#mm-body').innerHTML=`
      <div class="grid">
        <div class="muted">${c.category||'General'} • ${c.credits||0} credits</div>
        <div class="grid cols-2">
          <div>
            <div class="card"><div class="card-body">
              <div style="font-weight:800">${chap.title||''} — ${les.title||''}</div>
              ${les.video? renderVideo(les.video):''}
              ${les.html? `<div style="margin-top:8px;white-space:pre-wrap">${les.html}</div>`:''}
              ${(les.images||[]).map(u=>`<img class="media" src="${u}" alt="image" style="margin-top:8px"/>`).join('')}
            </div></div>
            <div class="grid" style="grid-template-columns:1fr auto;align-items:center;margin-top:8px">
              <div class="muted">Lesson navigation</div>
              <div style="display:flex;gap:6px">
                <button class="btn ghost" id="prevL"><i class="ri-arrow-left-line"></i> Prev</button>
                <button class="btn ghost" id="nextL">Next <i class="ri-arrow-right-line"></i></button>
              </div>
            </div>
          </div>
          <div>
            <div class="card"><div class="card-body">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div style="font-weight:700">My Sticky Notes</div>
                <button class="btn" id="addNote"><i class="ri-sticky-note-add-line"></i></button>
              </div>
              <div id="notesBox" style="margin-top:8px;max-height:45vh;overflow:auto"></div>
            </div></div>
          </div>
        </div>

        <div class="card"><div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="muted">Chapters</div>
            <button class="btn ghost" id="openFinal"><i class="ri-file-list-3-line"></i> Open Final</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
            ${outline.map((ch,ci)=>`
              <div class="card" style="min-width:200px"><div class="card-body">
                <div style="font-weight:700">${ch.title||('Chapter '+(ci+1))}</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">
                  ${(ch.lessons||[]).map((l,li)=>`<button class="btn ghost" data-ch="${ci}" data-li="${li}">${l.title||('Lesson '+(li+1))}</button>`).join('')}
                </div>
              </div></div>`).join('')}
          </div>
        </div></div>
      </div>
    `;
    $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-close2">Close</button>`;
    openModal('m-modal');
    $('#mm-close2').onclick=()=> closeModal('m-modal');

    // wire notes list
    paintNotes(courseId, chap.title||'', les.title||'');

    // nav
    $('#prevL')?.addEventListener('click', ()=> stepLesson(outline,-1,courseId));
    $('#nextL')?.addEventListener('click', ()=> stepLesson(outline, 1,courseId));
    $('#mm-body').querySelectorAll('button[data-ch]').forEach(b=>{
      b.addEventListener('click', ()=>{
        state.reading.chapIdx = +b.getAttribute('data-ch');
        state.reading.lesIdx  = +b.getAttribute('data-li');
        openReader(courseId);
      });
    });
    $('#openFinal')?.addEventListener('click', ()=>{
      closeModal('m-modal'); state.searchQ=c.title; go('assessments');
      notify('Open Finals tab to take the exam','ok');
    });

    // add note
    $('#addNote')?.addEventListener('click', async ()=>{
      const text = prompt('Note text'); if(!text) return;
      await col('notes').add({
        uid:auth.currentUser.uid, courseId, chapter:chap.title||'', lesson:les.title||'',
        text, createdAt:firebase.firestore.FieldValue.serverTimestamp()
      }).catch(e=>notify(e.message||'Failed','danger'));
    });
  }

  function paintNotes(courseId, chapter, lesson){
    const box=$('#notesBox'); if(!box) return;
    const mine=(state.notes||[]).filter(n=>n.uid===auth.currentUser?.uid && n.courseId===courseId && (n.chapter===chapter||!chapter));
    box.innerHTML = mine.length? mine.map(n=>`
      <div class="card"><div class="card-body" style="display:flex;justify-content:space-between;gap:10px">
        <div style="white-space:pre-wrap">${n.text}</div>
        <button class="btn danger" data-del-note="${n.id}"><i class="ri-delete-bin-6-line"></i></button>
      </div></div>`).join('') : `<div class="muted">No notes yet.</div>`;
    box.querySelectorAll('button[data-del-note]').forEach(b=>{
      b.onclick=()=> doc('notes',b.getAttribute('data-del-note')).delete().catch(()=>{});
    });
  }

  function renderVideo(url){
    try{
      const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/.exec(url);
      if(yt && yt[1]) return `<iframe class="embed" src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe>`;
    }catch{}
    return `<video class="embed" controls src="${url}"></video>`;
  }

  function stepLesson(outline, dir, courseId){
    const c=state.reading.chapIdx, l=state.reading.lesIdx;
    const lessons=outline[c]?.lessons||[];
    let nl=l+dir, nc=c;
    if(nl<0){ nc=c-1; nl=(outline[nc]?.lessons?.length||1)-1; }
    if(nl>=lessons.length){ nc=c+dir; nl=0; }
    if(outline[nc]){ state.reading.chapIdx=nc; state.reading.lesIdx=nl; openReader(courseId); }
  }

  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credits" class="input" type="number" placeholder="Credits (e.g., 3)"/>
          <textarea id="c-short" class="input" placeholder="Short description"></textarea>
          <textarea id="c-outline" class="input" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Welcome","video":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","html":"Welcome text...","images":["https://images.unsplash.com/photo-1513258496099-48168024aec0?q=80&w=1200&auto=format&fit=crop"]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        let outlineStr=$('#c-outline')?.value||'[]';
        try{ JSON.parse(outlineStr); }catch{ return notify('Invalid outline JSON','danger'); }
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(), outline:outlineStr,
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        await col('courses').add(obj).catch(e=>notify(e.message||'Failed','danger'));
        closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get().catch(()=>null); if(!snap||!snap.exists) return;
        const c={id:snap.id, ...snap.data()};
        showCourseModal(c);
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
            <textarea id="c-outline" class="input">${c.outline||'[]'}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          let outlineStr=$('#c-outline')?.value||'[]'; try{ JSON.parse(outlineStr); }catch{ return notify('Invalid outline JSON','danger'); }
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(), outline:outlineStr,
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true}).catch(e=>notify(e.message||'Failed','danger'));
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      state.reading.chapIdx=0; state.reading.lesIdx=0;
      openReader(id);
    });
  }

  function wireAssessments(){
    $('#new-quiz')?.addEventListener('click', ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" placeholder="Final title"/>
          <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":1,"feedbackOk":"Correct!","feedbackNo":"Try again."}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal('m-modal');
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let qs=[]; try{ qs=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, isFinal:true, items:qs, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() })
          .catch(e=>notify(e.message||'Failed','danger'));
        closeModal('m-modal'); notify('Final saved');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!isEnrolled(q.courseId) && state.role==='student') return notify('Enroll first to take','warn');

        // render quiz with scrolling body and instant feedback
        $('#mm-title').textContent=q.title;
        $('#mm-body').innerHTML = `
          <div id="quizWrap" style="max-height:60vh;overflow:auto">
            ${q.items.map((it,idx)=>`
            <div class="card"><div class="card-body">
              <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
              <div style="margin-top:6px;display:grid;gap:6px">
                ${it.choices.map((c,i)=>`
                  <label style="display:flex;gap:8px;align-items:center">
                    <input type="radio" name="q${idx}" value="${i}" data-ans="${it.answer}" data-ok="${it.feedbackOk||''}" data-no="${it.feedbackNo||''}"/> <span>${c}</span>
                  </label>`).join('')}
              </div>
              <div class="muted" id="fb-${idx}" style="margin-top:6px"></div>
            </div></div>`).join('')}
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
        openModal('m-modal');
        const wrap=$('#quizWrap'); wrap.scrollTop=0;

        // instant feedback
        q.items.forEach((it,idx)=>{
          $$(`input[name="q${idx}"]`).forEach(inp=>{
            inp.addEventListener('change', ()=>{
              const chosen=+inp.value, ans=+inp.getAttribute('data-ans');
              const box=$(`#fb-${idx}`); if(!box) return;
              if(chosen===ans){ box.textContent=inp.getAttribute('data-ok')||'Correct!'; box.style.color='var(--ok)'; }
              else { box.textContent=inp.getAttribute('data-no')||'Incorrect'; box.style.color='var(--danger)'; }
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
            uid:auth.currentUser.uid, email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, score,
            createdAt:firebase.firestore.FieldValue.serverTimestamp()
          }).catch(e=>notify(e.message||'Failed','danger'));
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
            <textarea id="q-json" class="input">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true})
            .catch(e=>notify(e.message||'Failed','danger'));
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

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
      unsubChat = col('messages').where('courseId','==',cid).onSnapshot(s=>{
        state.messages = s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0));
        paint(state.messages);
      }, err=>console.warn('chat listener error:',err));
    };
    courseSel?.addEventListener('change', e=> sub(e.target.value));
    send?.addEventListener('click', async ()=>{
      const text=input.value.trim(); if(!text||!currentCourse) return;
      if(!isEnrolled(currentCourse) && state.role==='student') return notify('Enroll to chat','warn');
      const p = state.profiles.find(x=>x.uid===auth.currentUser?.uid) || {};
      await col('messages').add({ courseId:currentCourse, uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        .catch(e=>notify(e.message||'Failed','danger'));
      input.value='';
    });
  }

  function wireTasks(){
    const root=$('[data-sec="tasks"]'); if(!root) return;

    $('#addTask')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        await col('tasks').add({ uid:auth.currentUser.uid, title:t, status:'todo', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
          .catch(e=>notify(e.message||'Failed','danger'));
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
          await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true})
            .catch(e=>notify(e.message||'Failed','danger'));
          closeModal('m-modal'); notify('Saved');
        };
      } else {
        await doc('tasks',id).delete().catch(e=>notify(e.message||'Failed','danger')); notify('Deleted');
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
        await doc('tasks',id).set({ status:lane, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}).catch(e=>notify(e.message||'Failed','danger'));
      });
    });
  }

  // ---------- Profile wiring & certificate ----------
  async function drawCertificateAndDownload({name,email,signature,signatureName},{title,credits}){
    const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
    ctx.strokeStyle='#a78bfa'; ctx.lineWidth=10; ctx.strokeRect(40,40,1320,820);
    ctx.strokeStyle='#6ea8ff'; ctx.lineWidth=2;
    for(let i=0;i<12;i++){ ctx.beginPath(); ctx.arc(80+i*8,80,40-i*3,Math.PI,1.5*Math.PI); ctx.stroke(); }
    ctx.fillStyle='#fff'; ctx.font='bold 64px Times New Roman'; ctx.fillText('Certificate of Completion', 300, 230);
    ctx.font='28px Garamond'; ctx.fillText(`Awarded to`, 300, 300);
    ctx.font='bold 44px Garamond'; ctx.fillStyle='#ffd36c'; ctx.fillText(`${name||email}`, 300, 360);
    ctx.fillStyle='#e7edf5'; ctx.font='26px Helvetica'; ctx.fillText(`for successfully completing`, 300, 410);
    ctx.font='bold 30px Helvetica'; ctx.fillText(`${title}`, 300, 450);
    ctx.font='24px Helvetica'; ctx.fillStyle='#e7edf5'; ctx.fillText(`Date: ${new Date().toLocaleDateString()}   Credits: ${credits||0}`, 300, 490);
    if(signature){
      await new Promise(res=>{
        const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>{ ctx.drawImage(img, 300, 560, 260, 90); ctx.fillStyle='#e7edf5'; ctx.font='18px Helvetica'; ctx.fillText(signatureName||'', 300, 665); res(); };
        img.onerror=()=>res(); img.src=signature;
      });
    }
    const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${title}.png`; a.click();
  }

  function wireProfile(){
    $('#pf-pick')?.addEventListener('click', ()=> $('#pf-avatar')?.click());
    $('#pf-pick-sign')?.addEventListener('click', ()=> $('#pf-signature')?.click());

    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(), bio:$('#pf-bio')?.value.trim(),
        signatureName:$('#pf-signame')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true}).catch(e=>notify(e.message||'Failed','danger'));

      const avatar=$('#pf-avatar')?.files?.[0];
      if(avatar){
        const ref=stg.ref().child(`avatars/${uid}/${Date.now()}_${avatar.name}`);
        await ref.put(avatar).catch(()=>{}); const url=await ref.getDownloadURL().catch(()=>null);
        if(url) await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      const sig=$('#pf-signature')?.files?.[0];
      if(sig){
        const ref=stg.ref().child(`signatures/${uid}/${Date.now()}_${sig.name}`);
        await ref.put(sig).catch(()=>{}); const url=await ref.getDownloadURL().catch(()=>null);
        if(url) await doc('profiles',uid).set({ signature:url },{merge:true});
      }
      notify('Profile saved');
      render();
    });

    $('#pf-view')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser?.uid; if(!uid) return;
      const snap=await doc('profiles',uid).get(); const me={uid,...(snap.data()||{})};
      $('#mm-title').textContent='Profile Card';
      const avatarHTML = me.avatar
        ? `<img src="${me.avatar}" alt="avatar" style="width:160px;height:160px;border-radius:50%;object-fit:cover;border:1px solid var(--border)"/>`
        : `<div class="avatar-fallback">${initials(me.name||me.email||'')}</div>`;
      $('#mm-body').innerHTML=`
        <div class="grid cols-2">
          <div class="card"><div class="card-body" style="display:grid;place-items:center">${avatarHTML}</div></div>
          <div class="card"><div class="card-body">
            <h3 style="margin:0">${me.name||me.email||'—'}</h3>
            <div class="muted" style="font-size:12px">${me.email||''}</div>
            <p style="white-space:pre-wrap">${me.bio||''}</p>
            ${me.portfolio? `<a class="btn ghost" href="${me.portfolio}" target="_blank" rel="noopener">Open portfolio</a>`:''}
            <div style="margin-top:10px">
              ${me.signature? `<img src="${me.signature}" alt="signature" style="max-width:180px"/>` : ''}
              <div class="muted">${me.signatureName||''}</div>
            </div>
          </div></div>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-close2">Close</button>`;
      $('#mm-close2').onclick=()=> closeModal('m-modal');
      openModal('m-modal');
    });

    $('#cert-demo')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser?.uid; const p=state.profiles.find(x=>x.uid===uid)||{name:auth.currentUser.email};
      await drawCertificateAndDownload(
        {name:p.name||'', email:auth.currentUser.email, signature:p.signature||'', signatureName:p.signatureName||''},
        {title:'Sample Course', credits:3}
      );
    });

    $('#pf-delete')?.addEventListener('click', async ()=>{
      if(!confirm('Delete your profile document? This does not delete your Auth user.')) return;
      await doc('profiles',auth.currentUser.uid).delete().catch(()=>{});
      notify('Profile deleted'); render();
    });

    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email, signature:'', signatureName:''};
      await drawCertificateAndDownload(
        {name:p.name||auth.currentUser.email, email:auth.currentUser.email, signature:p.signature||'', signatureName:p.signatureName||''},
        {title:course.title||courseId, credits:course.credits||0}
      );
    });
  }

  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true})
        .catch(e=>notify(e.message||'Failed','danger'));
      await doc('profiles',uid).set({ role },{merge:true}).catch(()=>{});
      notify('Role saved');
    });

    $('#main')?.addEventListener('click', async (e)=>{
      const v=e.target.closest('button[data-uview]'); const ed=e.target.closest('button[data-uedit]'); const del=e.target.closest('button[data-udel]');
      if(v){
        const uid=v.getAttribute('data-uview'); const snap=await doc('profiles',uid).get(); if(!snap.exists) return notify('No profile','warn');
        const me={uid,...snap.data()};
        $('#mm-title').textContent='User Card';
        $('#mm-body').innerHTML=`<div class="grid"><div><b>${me.name||'—'}</b> <span class="muted">${me.email||''}</span></div><div class="muted">${me.role||'student'}</div><div style="white-space:pre-wrap">${me.bio||''}</div></div>`;
        $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-close3">Close</button>`; openModal('m-modal'); $('#mm-close3').onclick=()=>closeModal('m-modal');
      }
      if(ed){
        const uid=ed.getAttribute('data-uedit'); const rdoc=await doc('roles',uid).get().catch(()=>null);
        const role=(rdoc?.data()?.role||'student');
        $('#mm-title').textContent='Edit Role';
        $('#mm-body').innerHTML=`<div class="grid"><select id="rm-role2" class="input">${VALID_ROLES.map(x=>`<option value="${x}" ${x===role?'selected':''}>${x}</option>`).join('')}</select></div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="rm-save2">Save</button>`; openModal('m-modal');
        $('#rm-save2').onclick=async ()=>{
          const nr=$('#rm-role2')?.value||'student';
          await doc('roles',uid).set({ uid, role:nr, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true}).catch(()=>{});
          await doc('profiles',uid).set({ role:nr },{merge:true}).catch(()=>{});
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(del){
        const uid=del.getAttribute('data-udel'); if(!confirm('Delete this profile document?')) return;
        await doc('profiles',uid).delete().catch(()=>{});
        notify('Deleted');
      }
    });
  }

  function wireSettings(){
    const pal=$('#theme-palette'), fs=$('#theme-font');
    if(pal) pal.value=state.theme.palette;
    if(fs)  fs.value=state.theme.font;
    const applyNow=()=>{
      state.theme.palette = pal.value;
      state.theme.font = fs.value;
      localStorage.setItem('lh:pal', state.theme.palette);
      localStorage.setItem('lh:fsz', state.theme.font);
      applyTheme();
      notify('Applied');
    };
    $('#save-theme')?.addEventListener('click', applyNow);
    pal?.addEventListener('change', applyNow);
    fs?.addEventListener('change', applyNow);
  }

  function wireSearch(){
    $('#main')?.querySelectorAll('[data-open-route]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const r=el.getAttribute('data-open-route'); const id=el.getAttribute('data-id'); state.highlightId=id; go(r);
      });
    });
  }

  // ---------- Firestore sync ----------
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

    // courses (single-field orderBy)
    state.unsub.push(
      col('courses').orderBy('createdAt','desc').onSnapshot(
        s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
        err => console.warn('courses listener error:', err)
      )
    );

    // finals/quizzes — avoid composite index by filtering client-side
    state.unsub.push(
      col('quizzes').orderBy('createdAt','desc').onSnapshot(
        s => { state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()})).filter(q=>q.isFinal===true); if(['assessments','dashboard','profile'].includes(state.route)) render(); },
        err => console.warn('quizzes listener error:', err)
      )
    );

    // attempts — avoid composite index by removing orderBy and sorting client-side
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

    // tasks
    state.unsub.push(
      col('tasks').where('uid','==',auth.currentUser.uid).onSnapshot(
        s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
        err => console.warn('tasks listener error:', err)
      )
    );

    // my notes
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

  // ---------- Auth ----------
  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid, user.email);
    try{
      const p=await doc('profiles',user.uid).get();
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  // ---------- Boot ----------
  function viewLogin(){ return vLogin(); }
  render();

  // ---------- Seed helper ----------
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const outline=[{title:"Chapter 1: Basics",lessons:[
      {title:"Welcome",video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",html:"Welcome text here.",images:["https://images.unsplash.com/photo-1513258496099-48168024aec0?q=80&w=1200&auto=format&fit=crop"]},
      {title:"Numbers",html:"Understanding numbers…",images:[]}
    ]}];
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',credits:3,short:'Equations, functions, factoring.',outline:JSON.stringify(outline),ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3}});
    await col('quizzes').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,isFinal:true,items:[
      {q:'2+2?',choices:['3','4','5'],answer:1,feedbackOk:'Correct',feedbackNo:'Nope'},
      {q:'5x=20, x=?',choices:['2','4','5'],answer:2,feedbackOk:'Nice',feedbackNo:'Check again'}
    ],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('announcements').add({title:'Welcome to LearnHub',text:'Explore courses and earn credits!',createdAt:firebase.firestore.FieldValue.serverTimestamp(),ownerUid:u.uid,ownerEmail:u.email});
    alert('Seeded sample course, final & announcement');
  };
})();