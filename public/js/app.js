/* LearnHub — E-Learning & Community Platform (v1.3)
   Features:
   - Courses (chapters/lessons with video, text, images), Enrollments
   - Final Exams (one per course), Attempts, Transcript, Certificates
   - Chat (course-wide), Tasks (kanban), Sticky Notes per course
   - Announcements (in-app alerts; optional email hook)
   - Roles: student | instructor | admin (roles/{uid}.role) + ADMIN_EMAILS override
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
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add more admin emails here
  const VALID_ROLES  = ['student','instructor','admin'];

  // Optional email webhook (Cloud Function/Extension). If set, announcements POST here.
  const EMAIL_HOOK_URL = ''; // e.g. 'https://us-central1-<project>.cloudfunctions.net/sendAnnouncementEmail'

  /* ---------- State ---------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette:'sunrise', font:'medium' },
    searchQ:'', highlightId:null,
    courses:[], enrollments:[], quizzes:[], attempts:[], messages:[], tasks:[], profiles:[], announcements:[], notes:[],
    myEnrolledIds:new Set(),
    unsub:[]
  };

  /* ---------- Utils ---------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const nowYear=()=>new Date().getFullYear();
  const fmtDateTime=(ts)=>new Date(ts?.toDate?.()||ts||Date.now()).toLocaleString();
  const notify=(msg,type='ok')=>{
    let n=$('#notification'); if(!n){ n=document.createElement('div'); n.id='notification'; n.className='notification'; document.body.appendChild(n); }
    n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200);
  };
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);

  // Permissions
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canManageUsers  = ()=> state.role==='admin';
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled      = (courseId)=> state.myEnrolledIds.has(courseId);
  const canPostMessage  = (courseId)=> isEnrolled(courseId) || state.role!=='student';
  const canTakeFinal    = (courseId)=> isEnrolled(courseId) || state.role!=='student';

  // Theme
  function setTheme(p,f){
    if(p) state.theme.palette=p;
    if(f) state.theme.font=f;
    document.documentElement.setAttribute('data-theme',state.theme.palette);
    document.documentElement.setAttribute('data-font',state.theme.font);
  }
  setTheme('sunrise','medium');

  /* ---------- Search ---------- */
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''} ${c.short||''}`}));
    state.quizzes.filter(q=>q.isFinal).forEach(q=> ix.push({label:`Final: ${q.title}`, section:'Final Exams', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email, section:'Profiles', route:'admin', id:p.uid, text:(p.bio||'')+' '+(p.portfolio||'')}));
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

  /* ---------- Router & Layout ---------- */
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search','help'];

  function go(route){ state.route = routes.includes(route)?route:'dashboard'; closeSidebar(); render(); }

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
            ['assessments','Final Exams','ri-file-list-3-line'],
            ['chat','Course Chat','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['help','Quick How-To','ri-question-line'],
            ['settings','Settings','ri-settings-3-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${(r==='admin'||r==='help') && !(['admin','instructor'].includes(state.role))?'hidden':''}" data-route="${r}">
              <i class="${ic}"></i><span>${label}</span>
            </div>`).join('')}
        </div>

        <div class="footer"><div class="muted" id="copyright" style="font-size:12px">Powered by MM, ${nowYear()}</div></div>
      </aside>

      <div>
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="btn ghost" id="burger" title="Menu"><i class="ri-menu-line"></i></button>
            <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
          </div>

          <div class="search-inline" style="position:relative">
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

    <div class="modal" id="m-modal">
      <div class="dialog">
        <div class="head"><strong id="mm-title">Modal</strong>
          <button class="btn ghost" id="mm-close"><i class="ri-close-line"></i> Close</button></div>
        <div class="body" id="mm-body"></div>
        <div class="foot" id="mm-foot"></div>
      </div>
    </div>
    <div class="modal-backdrop" id="mb-modal"></div>
    `;
  }

  /* ---------- Views ---------- */
  const vLogin=()=>`
  <div class="login-page">
    <div class="card login-card">
      <div class="card-body">
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
          <div class="logo" style="width:44px;height:44px;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,var(--brand-2),var(--brand));display:grid;place-items:center">
            <img src="/icons/learnhub-192.png" alt="LearnHub" style="width:100%;height:100%;object-fit:cover"/>
          </div>
          <div><div style="font-size:20px;font-weight:800">LearnHub</div><div class="muted">Sign in to continue</div></div>
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

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="muted" style="font-size:12px">${label}</div>
          <h2 style="margin:.2rem 0">${value}</h2>
        </div>
        <div class="chip"><i class="${icon}"></i>${route}</div>
      </div>
    </div>`;

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    const myAlerts = state.announcements.filter(a=> !a.courseId || isEnrolled(a.courseId)).slice(0,4);
    const myTasks = state.tasks.filter(t=>t.uid===my).slice(0,4);
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Final Exams', state.quizzes.filter(q=>q.isFinal).length,'assessments','ri-file-list-3-line')}
        ${dashCard('My Attempts', myAttempts,'assessments','ri-timer-line')}
      </div>

      <div class="grid cols-2" style="margin-top:12px">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Announcements</h3>
          ${myAlerts.length? myAlerts.map(a=>`
            <div style="padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="font-weight:700">${a.title||'Announcement'}</div>
              <div class="muted" style="font-size:12px">${fmtDateTime(a.createdAt)} • ${a.courseTitle||'All Courses'}</div>
              <div style="margin-top:6px">${(a.text||'').replace(/</g,'&lt;')}</div>
            </div>`).join('') : `<div class="muted">No announcements yet.</div>`}
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Tasks</h3>
          ${myTasks.length? myTasks.map(t=>`
            <div style="display:flex;justify-content:space-between;border-bottom:1px solid var(--border);padding:8px 0">
              <div>${t.title}</div><div class="chip">${t.status}</div>
            </div>`).join('') : `<div class="muted">No tasks yet.</div>`}
        </div></div>
      </div>
    `;
  }

  function vCourses(){
    const canCreate = canCreateCourse();
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h3 style="margin:0">Courses</h3>
          <div style="display:flex;gap:8px;align-items:center">
            ${canCreate? `<button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>`:''}
          </div>
        </div>
        <div class="grid cols-2" data-sec="courses">
          ${state.courses.map(c=>`
            <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${c.title}</div>
                  <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
                  ${c.short? `<div style="margin-top:6px">${c.short}</div>`:''}
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-open="${c.id}"><i class="ri-external-link-line"></i> Open</button>
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
    const my=auth.currentUser?.uid;
    const list=state.enrollments.filter(e=>e.uid===my).map(e=> e.course||{} );
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
          ${!list.length? `<div class="muted" style="padding:10px">You’re not enrolled yet. Open a course and click <strong>Enroll</strong>.</div>`:''}
        </div>
      </div></div>`;
  }

  function vAssessments(){
    const finals = state.quizzes.filter(q=>q.isFinal);
    const my=auth.currentUser?.uid;
    const myAttempts = (state.attempts||[]).filter(a=>a.uid===my);
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Final Exams</h3>
          ${['instructor','admin'].includes(state.role)? `<button class="btn" id="new-final"><i class="ri-add-line"></i> New Final</button>`:''}
        </div>
        <div class="grid" data-sec="finals">
          ${finals.map(q=>{
            const bestForThis = Math.max(0,...myAttempts.filter(a=>a.quizId===q.id).map(a=>a.score||0));
            return `
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}% • best ${bestForThis}%</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===auth.currentUser?.uid)? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`;}).join('')}
          ${!finals.length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Attempts</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Exam</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${myAttempts.map(a=>`
                <tr class="clickable" data-open-course="${a.courseId}">
                  <td>${a.quizTitle}</td>
                  <td class="num">${a.score}%</td>
                  <td>${fmtDateTime(a.createdAt)}</td>
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'',avatar:'',signatureUrl:''};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <input id="pf-signname" class="input" placeholder="Signature name (printed on certs)" value="${me.signatureName||''}"/>
            <div style="display:flex;gap:8px;align-items:center">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Upload avatar</button>
              <input id="pf-signature" type="file" accept="image/*" style="display:none"/>
              <button class="btn ghost" id="pf-pick-sign"><i class="ri-ink-bottle-line"></i> Upload signature</button>
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
            </div>
            <div class="muted" style="font-size:12px">After saving, fields clear and preview updates below.</div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript & Certificates</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Course</th><th>Best</th><th>Certificate</th></tr></thead>
              <tbody>
                ${buildTranscript(auth.currentUser?.uid).map(r=>`
                  <tr>
                    <td>${r.courseTitle}</td><td class="num">${r.best}%</td>
                    <td>${r.completed? `<button class="btn" data-cert="${r.courseId}"><i class="ri-award-line"></i> Download</button>`:'—'}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div style="margin-top:10px;display:flex;gap:12px;align-items:center">
            <div class="chip"><i class="ri-bank-card-line"></i> Credits: ${calcCredits(auth.currentUser?.uid)}</div>
            <div class="chip"><i class="ri-timer-line"></i> Attempts: ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).length}</div>
          </div>
          <div style="margin-top:12px;display:flex;gap:12px;align-items:center">
            ${me.avatar? `<img src="${me.avatar}" alt="avatar" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid var(--border)"/>`:''}
            ${me.signatureUrl? `<img src="${me.signatureUrl}" alt="signature" style="height:40px;object-fit:contain;background:#fff;padding:4px;border-radius:6px"/>`:''}
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
            <div class="muted" style="font-size:12px">Tip: Find UID in Firebase → Authentication → Users.</div>
          </div>
          <div style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px" class="grid">
            <input id="purge-uid" class="input" placeholder="UID to purge (delete profile+role docs)"/>
            <button class="btn danger" id="purge-user"><i class="ri-delete-bin-6-line"></i> Purge User Docs</button>
            <div class="muted" style="font-size:12px">Use after deleting the Auth user to remove lingering Firestore docs.</div>
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

  function vHelp(){
    if(!['admin','instructor'].includes(state.role)) return `<div class="card"><div class="card-body">Instructors/Admins only.</div></div>`;
    return `
      <div class="card"><div class="card-body">
        <h2 style="margin:0 0 6px 0">Quick How-To (Admin & Instructor)</h2>
        <p class="muted">A fast walkthrough with tips and the intended workflow.</p>
        <ol style="line-height:1.7">
          <li><b>Create a Course</b> → <i>Courses → “New Course”</i>. Fill title, category, credits, short description. Paste an <b>Outline JSON</b> with chapters/lessons (video, HTML, images).</li>
          <li><b>Publish a Final Exam</b> → <i>Final Exams → “New Final”</i>. Choose the course, pass score, and MCQ items. Students must enroll to take it.</li>
          <li><b>Announce</b> → From a course card’s “Open”, click <i>Announce</i> to post an alert. (Optional: set EMAIL_HOOK_URL in app.js to email students.)</li>
          <li><b>Role Manage</b> → <i>Admin</i> page; set roles by UID. After deleting an Auth user, use <i>Purge User Docs</i> to remove lingering Firestore docs.</li>
          <li><b>Student Flow</b> → Student logs in → opens a course → <b>Enroll</b> → studies lessons (video + text + images) → takes Final → sees credits, transcript & certificate in <i>Profile</i>.</li>
          <li><b>Sticky Notes</b> → In a course “Open” view, students can add personal notes that only they can see.</li>
          <li><b>Chat</b> → Everyone enrolled can post in Course Chat (select course at top). Instructors can guide discussions.</li>
          <li><b>Tasks</b> → Personal kanban board (To do/In progress/Done). Drag & drop between lanes.</li>
          <li><b>Search</b> → Global search for courses, finals, profiles. Results open and highlight the target.</li>
        </ol>
        <p class="muted" style="margin-top:8px">Tip: Certificates become downloadable once the best score ≥ pass score for the course’s Final.</p>
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
              ${['sunrise','ocean','forest','plum','fire','dark'].map(x=>`<option value="${x}" ${state.theme.palette===x?'selected':''}>${x}</option>`).join('')}
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              ${['small','medium','large'].map(x=>`<option value="${x}" ${state.theme.font===x?'selected':''}>${x}</option>`).join('')}
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
            <div><div style="font-weight:700">${r.label}</div><div class="muted" style="font-size:12px">${r.section}</div></div>
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
      case 'help': return vHelp();
      case 'settings': return vSettings();
      case 'search': return vSearch();
      default: return vDashboard();
    }
  }

  /* ---------- Render & Shell ---------- */
  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
  }

  // sidebar (mobile)
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };

  function openModal(){ $('#m-modal')?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(){ $('#m-modal')?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }

  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> document.body.classList.contains('sidebar-open')? closeSidebar(): openSidebar());
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);
    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());
    $('#mm-close')?.addEventListener('click', closeModal);
    $('#copyright')?.replaceChildren(document.createTextNode(`Powered by MM, ${nowYear()}`));

    // top search
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

    // dashboard card clicks
    $$('#main .card.clickable').forEach(c=> c.addEventListener('click', ()=> go(c.getAttribute('data-go')) ));
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

  /* ---------- Courses (create/edit/open/enroll) ---------- */
  function openCourseModal(c){
    const enrolled = isEnrolled(c.id);
    $('#mm-title').textContent=c.title;
    $('#mm-body').innerHTML=`
      <div class="grid">
        <div class="muted">${c.category||'General'} • ${c.credits||0} credits • by ${c.ownerEmail||'—'}</div>
        ${c.short? `<p>${c.short}</p>`:''}
        ${renderOutlineReader(c)}
        <div style="margin-top:10px">
          <h4>Sticky Notes (only you can see)</h4>
          <div id="notes-box"></div>
          <div style="display:flex;gap:8px;margin-top:6px">
            <input id="note-text" class="input" placeholder="Add a note…"/>
            <button class="btn" id="note-add"><i class="ri-sticky-note-add-line"></i></button>
          </div>
        </div>
      </div>`;
    $('#mm-foot').innerHTML=`
      <div style="display:flex;gap:8px;align-items:center">
        ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
        ${canEditCourse(c)? `<button class="btn ghost" id="announce"><i class="ri-notification-3-line"></i> Announce</button>`:''}
        <button class="btn ghost" id="open-final"><i class="ri-question-line"></i> Final Exam</button>
      </div>`;
    openModal();

    // load my notes
    const my=auth.currentUser?.uid;
    const notes=(state.notes||[]).filter(n=>n.uid===my && n.courseId===c.id);
    paintNotes(notes);
    $('#note-add')?.addEventListener('click', async ()=>{
      const text=$('#note-text')?.value.trim(); if(!text) return;
      await col('notes').add({ uid:my, courseId:c.id, text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      $('#note-text').value='';
    });

    $('#enroll')?.addEventListener('click', async ()=>{
      await col('enrollments').add({ uid:auth.currentUser.uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(), course:{id:c.id, title:c.title, category:c.category, credits:c.credits||0} });
      notify('Enrolled'); closeModal();
    });

    $('#open-final')?.addEventListener('click', ()=>{
      state.searchQ=c.title; go('assessments');
    });

    $('#announce')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Announcement';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="an-title" class="input" placeholder="Title"/>
          <textarea id="an-text" class="input" placeholder="Message to students (also emailed if email hook enabled)"></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="an-send"><i class="ri-notification-3-line"></i> Post</button>`;
      $('#an-send').onclick=async ()=>{
        const title=$('#an-title')?.value.trim(), text=$('#an-text')?.value.trim();
        if(!title||!text) return notify('Fill title & message','warn');
        await col('announcements').add({ courseId:c.id, courseTitle:c.title, title, text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        if(EMAIL_HOOK_URL){
          try{ fetch(EMAIL_HOOK_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({courseId:c.id,courseTitle:c.title,title,text})}); }catch{}
        }
        notify('Announcement posted'); closeModal();
      };
    });
  }

  function renderOutlineReader(c){
    let outline=[];
    try{ outline = JSON.parse(c.outline||'[]'); }catch{ outline=[]; }
    if(!Array.isArray(outline) || !outline.length) return `<div class="muted">No outline added yet.</div>`;
    // render chapters + lessons compactly (first video/text visible with scroll)
    return `
      <div style="display:grid;grid-template-columns:280px 1fr;gap:12px;min-height:320px">
        <div class="card" style="overflow:auto;max-height:360px"><div class="card-body">
          ${outline.map((ch,ci)=>`
            <div style="margin-bottom:8px">
              <div style="font-weight:800">Chapter ${ci+1}: ${ch.title||''}</div>
              <div class="muted" style="font-size:12px">${(ch.lessons||[]).length} lessons</div>
              <div style="margin-top:6px;display:grid;gap:6px">
                ${(ch.lessons||[]).map((ls,li)=>`
                  <button class="btn ghost" data-open-lesson="${ci}:${li}" style="justify-content:flex-start">
                    <i class="ri-movie-line"></i> ${ls.title||('Lesson '+(li+1))}
                  </button>`).join('')}
              </div>
            </div>`).join('')}
        </div></div>
        <div class="card" style="max-height:420px;overflow:auto"><div class="card-body" id="lesson-view">
          <div class="muted">Select a lesson to start reading/watching.</div>
        </div></div>
      </div>
    `;
  }

  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credits" class="input" placeholder="Credits (number)" type="number" min="0"/>
          <textarea id="c-short" class="input" placeholder="Short description (shows on card)"></textarea>
          <textarea id="c-outline" class="input" placeholder='Outline JSON (chapters/lessons). Example:
[
  {"title":"Chapter 1","lessons":[
    {"title":"Welcome","video":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","html":"Welcome text...","images":[]}
  ]}
]
'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal();
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid outline JSON','danger'); }
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0),
          short:$('#c-short')?.value.trim(), outline:JSON.stringify(outline),
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email,
          createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        await col('courses').add(obj); closeModal(); notify('Course saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      // open course
      const openBtn=e.target.closest('button[data-open]');
      const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()};
        openCourseModal(c);
        // lesson open inside modal
        $('#mm-body')?.addEventListener('click', (ev)=>{
          const b=ev.target.closest('button[data-open-lesson]'); if(!b) return;
          const [ci,li]=b.getAttribute('data-open-lesson').split(':').map(x=>+x);
          let outline=[]; try{ outline=JSON.parse(c.outline||'[]'); }catch{}
          const lesson=((outline[ci]||{}).lessons||[])[li]||{};
          const host=$('#lesson-view');
          host.innerHTML=renderLesson(lesson);
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
            <textarea id="c-short" class="input">${c.short||''}</textarea>
            <textarea id="c-outline" class="input">${c.outline||'[]'}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal();
        $('#c-save').onclick=async ()=>{
          let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid outline JSON','danger'); }
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(),
            category:$('#c-category')?.value.trim(),
            credits:+($('#c-credits')?.value||0),
            short:$('#c-short')?.value.trim(),
            outline:JSON.stringify(outline),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });
  }

  function renderLesson(lesson){
    const v=lesson.video? embedVideo(lesson.video) : '';
    const imgs=(lesson.images||[]).map(src=>`<img src="${src}" alt="" style="max-width:100%;border-radius:10px;border:1px solid var(--border)"/>`).join('');
    const html=(lesson.html||'').replace(/\n/g,'<br/>');
    return `
      <div style="display:grid;gap:10px">
        ${lesson.title? `<h3 style="margin:0">${lesson.title}</h3>`:''}
        ${v? `<div>${v}</div>`:''}
        ${html? `<div>${html}</div>`:''}
        ${imgs? `<div style="display:grid;gap:8px">${imgs}</div>`:''}
      </div>`;
  }
  function embedVideo(url){
    // supports YouTube normal links
    try{
      const u=new URL(url);
      if(u.hostname.includes('youtube.com') || u.hostname.includes('youtu.be')){
        const id = u.searchParams.get('v') || u.pathname.split('/').pop();
        return `<div style="position:relative;padding-top:56.25%"><iframe src="https://www.youtube.com/embed/${id}" title="Video" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowfullscreen></iframe></div>`;
      }
    }catch{}
    return `<video controls style="width:100%;border-radius:10px"><source src="${url}"/></video>`;
  }

  function paintNotes(list){
    const box=$('#notes-box'); if(!box) return;
    box.innerHTML = list.map(n=>`
      <div class="card" style="margin:6px 0">
        <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
          <div>${(n.text||'').replace(/</g,'&lt;')}</div>
          <button class="btn ghost" data-del-note="${n.id}"><i class="ri-close-line"></i></button>
        </div>
      </div>`).join('');
    box.addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-del-note]'); if(!b) return;
      await doc('notes', b.getAttribute('data-del-note')).delete();
    },{once:true});
  }

  /* ---------- Finals (create/take/edit) ---------- */
  function wireAssessments(){
    $('#new-final')?.addEventListener('click', ()=>{
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
      openModal();
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let qs=[]; try{ qs=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, items:qs, isFinal:true, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
        closeModal(); notify('Final saved');
      };
    });

    const sec=$('[data-sec="finals"]'); if(!sec||sec.__wired){return;} sec.__wired=true;

    // open attempt row → open course
    $('#main')?.addEventListener('click', async (e)=>{
      const tr=e.target.closest('tr[data-open-course]'); if(!tr) return;
      const id=tr.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      openCourseModal({id:snap.id, ...snap.data()});
    });

    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeFinal(q.courseId)) return notify('Enroll first to take','warn');
        renderQuiz(q);
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
        openModal();
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal(); notify('Saved');
        };
      }
    });
  }

  function renderQuiz(q){
    $('#mm-title').textContent=q.title;
    $('#mm-body').innerHTML = `
      <div id="quiz-wrap" style="max-height:60vh;overflow:auto;scroll-behavior:smooth">
        ${q.items.map((it,idx)=>`
          <div class="card"><div class="card-body">
            <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
            <div style="margin-top:6px;display:grid;gap:6px">
              ${it.choices.map((c,i)=>`
                <label style="display:flex;gap:8px;align-items:center">
                  <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
                </label>`).join('')}
            </div>
            <div id="fb-${idx}" class="muted" style="font-size:12px;margin-top:6px"></div>
          </div></div>
        `).join('')}
      </div>`;
    $('#mm-foot').innerHTML=`<div style="display:flex;gap:8px">
      <button class="btn" id="q-check"><i class="ri-lightbulb-flash-line"></i> Check Answers</button>
      <button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>
    </div>`;
    openModal();

    // instant feedback (on Check)
    $('#q-check').onclick=()=>{
      q.items.forEach((it,idx)=>{
        const chosen = +($(`input[name="q${idx}"]:checked`)?.value ?? -1);
        const ok = chosen===+it.answer;
        const fb=$(`#fb-${idx}`);
        fb.textContent = ok ? (it.feedbackOk||'Correct!') : (it.feedbackNo||'Incorrect, review the lesson.');
        fb.style.color = ok ? 'var(--ok)' : 'var(--danger)';
      });
      // scroll to last question for long quizzes:
      $('#quiz-wrap').scrollTop = $('#quiz-wrap').scrollHeight;
    };

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
      closeModal(); notify(`Your score: ${score}%`);
    };
  }

  /* ---------- Chat ---------- */
  function wireChat(){
    const box=$('#chat-box'); const courseSel=$('#chat-course'); const input=$('#chat-input'); const send=$('#chat-send');
    let unsubChat=null, currentCourse='';
    const paint=(msgs)=>{
      box.innerHTML = msgs.map(m=>`
        <div style="margin-bottom:8px">
          <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${fmtDateTime(m.createdAt)}</span></div>
          <div>${(m.text||'').replace(/</g,'&lt;')}</div>
        </div>`).join('');
      box.scrollTop=box.scrollHeight;
    };
    const sub=(cid)=>{
      unsubChat?.(); unsubChat=null; currentCourse=cid; box.innerHTML='';
      if(!cid) return;
      unsubChat = col('messages').where('courseId','==',cid).orderBy('createdAt').onSnapshot(s=>{
        state.messages = s.docs.map(d=>({id:d.id,...d.data()})); paint(state.messages);
      }, err=> console.warn('chat err',err));
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
        $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
        $('#t-save').onclick=async ()=>{
          await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal(); notify('Saved');
        };
      } else {
        await doc('tasks',id).delete(); notify('Deleted');
      }
    });

    // DnD + drop highlight restored
    root.querySelectorAll('.task-card').forEach(card=>{
      card.setAttribute('draggable','true');
      card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
      card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    });
    root.querySelectorAll('.lane-grid').forEach(grid=>{
      const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
      const show=e=>{ e.preventDefault(); row?.classList.add('drop'); };
      const hide=()=> row?.classList.remove('drop');
      grid.addEventListener('dragenter', show); grid.addEventListener('dragover', show); grid.addEventListener('dragleave', hide);
      grid.addEventListener('drop', async (e)=>{ e.preventDefault(); hide(); const id=e.dataTransfer.getData('text/plain'); if(!id) return;
        await doc('tasks',id).set({ status:lane, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      });
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
    $('#purge-user')?.addEventListener('click', async ()=>{
      const uid=$('#purge-uid')?.value.trim(); if(!uid) return notify('Enter UID','warn');
      await Promise.allSettled([ doc('profiles',uid).delete(), doc('roles',uid).delete() ]);
      notify('User docs purged'); render(); // resync table
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
  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      const c={id:snap.id, ...snap.data()}; openCourseModal(c);
    });
  }
  function wireProfile(){
    $('#pf-pick')?.addEventListener('click', ()=> $('#pf-avatar')?.click());
    $('#pf-pick-sign')?.addEventListener('click', ()=> $('#pf-signature')?.click());
    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(),
        portfolio:$('#pf-portfolio')?.value.trim(),
        bio:$('#pf-bio')?.value.trim(),
        signatureName:$('#pf-signname')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      const upAvatar=$('#pf-avatar')?.files?.[0];
      const upSign=$('#pf-signature')?.files?.[0];
      if(upAvatar){
        const ref=stg.ref().child(`avatars/${uid}/${upAvatar.name}`); await ref.put(upAvatar);
        const url=await ref.getDownloadURL(); await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      if(upSign){
        const ref=stg.ref().child(`signatures/${uid}/${upSign.name}`); await ref.put(upSign);
        const url=await ref.getDownloadURL(); await doc('profiles',uid).set({ signatureUrl:url },{merge:true});
      }
      // clear inputs to placeholders
      ['pf-name','pf-portfolio','pf-bio','pf-signname'].forEach(id=>{ const el=$('#'+id); if(el) el.value=''; });
      if($('#pf-avatar')) $('#pf-avatar').value='';
      if($('#pf-signature')) $('#pf-signature').value='';
      notify('Profile saved');
      render(); // show updated preview
    });

    // certificate download
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email, signatureName:''};
      const avatar=p.avatar; const sig=p.signatureUrl;

      // certificate canvas
      const canvas=document.createElement('canvas'); canvas.width=1600; canvas.height=1131; // ~ A3 landscape ratio
      const ctx=canvas.getContext('2d');

      // background gradient + border
      const g=ctx.createLinearGradient(0,0,1600,0); g.addColorStop(0,'#0c1626'); g.addColorStop(1,'#122033');
      ctx.fillStyle=g; ctx.fillRect(0,0,1600,1131);
      ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=12; ctx.strokeRect(40,40,1520,1051);
      // inner border pattern
      ctx.strokeStyle='rgba(122,211,255,.35)'; ctx.lineWidth=3; ctx.setLineDash([14,10]); ctx.strokeRect(70,70,1460,991); ctx.setLineDash([]);

      // title
      ctx.fillStyle='#ffffff'; ctx.font='bold 70px "Times New Roman", serif';
      ctx.fillText('Certificate of Completion', 420, 230);

      // recipient
      ctx.font='36px Garamond, serif';
      ctx.fillText('Awarded to', 420, 320);
      ctx.font='bold 60px "Baskerville", serif';
      ctx.fillText(`${p.name||auth.currentUser.email}`, 420, 400);

      // course line
      ctx.font='36px Garamond, serif';
      ctx.fillText('for successfully completing the course', 420, 460);
      ctx.font='bold 48px "Times New Roman", serif';
      ctx.fillText(`${course.title||courseId}`, 420, 520);

      // date + org
      ctx.font='28px Garamond, serif';
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 420, 580);
      ctx.fillText(`Issued by: LearnHub`, 420, 620);

      // avatar (optional)
      if(avatar){
        const img = await loadImg(avatar);
        ctx.save(); ctx.beginPath(); ctx.arc(220,380,120,0,Math.PI*2); ctx.closePath(); ctx.clip();
        ctx.drawImage(img, 100,260,240,240); ctx.restore();
        ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=4; ctx.beginPath(); ctx.arc(220,380,120,0,Math.PI*2); ctx.stroke();
      }

      // signature line
      ctx.strokeStyle='rgba(255,255,255,.6)'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(420, 760); ctx.lineTo(900,760); ctx.stroke();
      ctx.font='24px "Great Vibes", cursive';
      ctx.fillStyle='#ffffff';
      ctx.fillText(`${p.signatureName||'Signatory'}`, 420, 790);

      // signature image (optional)
      if(sig){
        const s=await loadImg(sig);
        ctx.drawImage(s, 920, 690, 360, 140);
      }

      const url=canvas.toDataURL('image/png');
      const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click();
    });
  }

  function calcCredits(uid){
    const my = (state.attempts||[]).filter(a=>a.uid===uid);
    const passedCourseIds = new Set();
    my.forEach(a=>{
      const q=state.quizzes.find(x=>x.id===a.quizId);
      if(q && q.isFinal){
        const pass = a.score >= (q.passScore||70);
        if(pass) passedCourseIds.add(q.courseId);
      }
    });
    let sum=0;
    passedCourseIds.forEach(cid=>{
      const c=state.courses.find(x=>x.id===cid); sum += (+c?.credits||0);
    });
    return sum;
  }

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

  async function loadImg(url){ return new Promise((res,rej)=>{ const i=new Image(); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=rej; i.src=url; }); }

  /* ---------- Firestore sync ---------- */
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }

  function sync(){
    clearUnsubs();
    const uid=auth.currentUser.uid;

    // profiles
    state.unsub.push(col('profiles').onSnapshot(s=>{
      state.profiles=s.docs.map(d=>({id:d.id,...d.data()}));
      // stitch roles onto profiles for table
      // (lightweight: each profile doc should already include role from auth listener)
      if(['profile','admin'].includes(state.route)) render();
    }));

    // my enrollments
    state.unsub.push(col('enrollments').where('uid','==',uid).onSnapshot(s=>{
      state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
      state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
      if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
    }));

    // courses
    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(s=>{
      state.courses=s.docs.map(d=>({id:d.id,...d.data()}));
      if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render();
    }));

    // finals (quizzes)
    state.unsub.push(col('quizzes').where('isFinal','==',true).orderBy('createdAt','desc').onSnapshot(s=>{
      state.quizzes=s.docs.map(d=>({id:d.id,...d.data()}));
      if(['assessments','dashboard','profile'].includes(state.route)) render();
    }));

    // my attempts
    state.unsub.push(col('attempts').where('uid','==',uid).orderBy('createdAt','desc').onSnapshot(s=>{
      state.attempts=s.docs.map(d=>({id:d.id,...d.data()}));
      if(['assessments','profile','dashboard'].includes(state.route)) render();
    }));

    // my tasks
    state.unsub.push(col('tasks').where('uid','==',uid).onSnapshot(s=>{
      state.tasks=s.docs.map(d=>({id:d.id,...d.data()})); if(['tasks','dashboard'].includes(state.route)) render();
    }));

    // my notes
    state.unsub.push(col('notes').where('uid','==',uid).onSnapshot(s=>{
      state.notes=s.docs.map(d=>({id:d.id,...d.data()}));
    }));

    // announcements (global stream)
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
  render();

  /* ---------- Dev/Support helpers (optional) ---------- */
  // Minimal seed (user must be logged in)
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const outline=[{title:"Chapter 1: Basics",lessons:[{title:"Welcome",video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",html:"Welcome text here.",images:[]},{title:"Numbers",html:"Understanding numbers…",images:[]}]}];
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',credits:3,short:'Equations, functions, factoring.',outline:JSON.stringify(outline),ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3}});
    await col('quizzes').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,isFinal:true,items:[{q:'2+2?',choices:['3','4','5'],answer:1,feedbackOk:'Correct',feedbackNo:'Nope'},{q:'5x=20, x=?',choices:['2','4','5'],answer:2,feedbackOk:'Nice',feedbackNo:'Check again'}],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    alert('Seeded sample course & final');
  };
})();