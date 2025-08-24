/* LearnHub — E-Learning & Community Platform
   Keep UI/UX as-is; add fixes + features:
   - Stable rules usage
   - Profile + Admin share same 'profiles' docs
   - Avatar/signature upload, cache-bust
   - Announcements, Guide page
   - Finals only; transcript; certificate with org settings
   - Notes inside course viewer
   - Mobile-first drawer intact
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
  const ADMIN_EMAILS = ['admin@learnhub.com']; // optional default
  const VALID_ROLES  = ['student','instructor','admin'];
  const YT_EMBED_BASE = 'https://www.youtube.com/embed/';
  const DEFAULT_AVATAR = 'https://dummyimage.com/160x160/0c0f14/7ad3ff.png&text=Avatar';
  const DEFAULT_SIGN = 'https://dummyimage.com/220x70/0c0f14/7ad3ff.png&text=Signature';
  const EDU_VIDS = [
    'https://www.youtube.com/watch?v=9bZkp7q19f0',
    'https://www.youtube.com/watch?v=H1elmMBnykA',
    'https://www.youtube.com/watch?v=9bZkp7q19f0'
  ];

  // ---------- Helpers ----------
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const col = (name)=> db.collection(name);
  const doc = (name,id)=> db.collection(name).doc(id);
  const ts = firebase.firestore.FieldValue.serverTimestamp();
  const notify=(msg,type='ok')=>{
    let n=$('#notification'); if(!n){ n=document.createElement('div'); n.id='notification'; n.className='notification'; document.body.appendChild(n); }
    n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200);
  };
  const nowYear=()=> new Date().getFullYear();
  const uid=()=> auth.currentUser?.uid;

  // ---------- State ----------
  const state = {
    route:'dashboard',
    user:null, role:'student',
    theme:{ palette:(localStorage.getItem('lh:palette')||'sunrise'), font:(localStorage.getItem('lh:font')||'medium') },
    searchQ:'', highlightId:null, myEnrolledIds:new Set(),
    // data
    profiles:[], courses:[], enrollments:[], quizzes:[], attempts:[], tasks:[], messages:[], notes:[], announcements:[],
    org:{ name:'LearnHub Academy', location:'Online', signerName:'Program Director', certificateNote:'Certificate of Completion', signatureUrl:'' },
    unsub:[], _unsubChat:null, _currentCourseChat:''
  };

  // ---------- Theme ----------
  function applyTheme(){
    document.body.classList.remove('theme-sunrise','theme-ocean','theme-forest','theme-grape','theme-slate','theme-dark');
    document.body.classList.add(`theme-${state.theme.palette}`);
    document.body.classList.remove('font-small','font-medium','font-large');
    document.body.classList.add(`font-${state.theme.font}`);
  }
  applyTheme();

  // ---------- Permissions ----------
  const canManageUsers  = ()=> state.role==='admin';
  const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
  const canEditCourse   = (c)=> state.role==='admin' || c.ownerUid===uid();
  const isEnrolled      = (courseId)=> state.myEnrolledIds.has(courseId);
  const canPostMessage  = (courseId)=> isEnrolled(courseId) || state.role!=='student';
  const canTakeFinal    = (courseId)=> isEnrolled(courseId) || state.role!=='student';

  // ---------- Router ----------
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search','guide'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; closeSidebar(); render(); }

  // ---------- Layout ----------
  function layout(content){
    return `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand" id="brand">
          <div class="logo">${$('#logo-mark')?.content?.firstElementChild?.outerHTML || ''}</div>
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

    <div class="modal" id="m-modal"><div class="dialog">
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close"><i class="ri-close-line"></i> Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop" id="mb-modal"></div>`;
  }

  // ---------- Search ----------
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.quizzes.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
    state.profiles.forEach(p=> ix.push({label:p.name||p.email||p.uid, section:'Profiles', route:'profile', id:p.uid, text:(p.bio||'')+' '+(p.portfolio||'')}));
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

  // ---------- Views ----------
  const vLogin=()=>`
  <div class="login-wrap">
    <div class="card login-card">
      <div class="card-body">
        <div class="login-brand">
          <div class="logo">${$('#logo-mark')?.content?.firstElementChild?.outerHTML || ''}</div>
          <div>
            <div style="font-size:20px;font-weight:800;text-align:center">LearnHub</div>
            <div class="muted" style="text-align:center">Sign in to continue</div>
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

  const dashCard=(label,value,route,icon)=>`
    <div class="card clickable" data-go="${route}">
      <div class="card-body" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div class="muted" style="font-size:12px">${label}</div>
          <h2 style="margin:4px 0 0">${value}</h2>
        </div>
        <i class="${icon}" style="font-size:26px;color:var(--brand)"></i>
      </div>
    </div>`;
  function vDashboard(){
    const my=uid();
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;
    // random edu video
    const vid = EDU_VIDS[Math.floor(Math.random()*EDU_VIDS.length)];
    const vidId = (vid.includes('watch?v=')? vid.split('watch?v=')[1] : vid.split('/').pop()).split('&')[0];

    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.length,'assessments','ri-file-list-3-line')}
        ${dashCard('My Attempts', myAttempts,'assessments','ri-bar-chart-2-line')}
      </div>

      <div class="grid cols-2" style="margin-top:10px">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Announcements</h3>
          ${(state.announcements||[]).slice(0,6).map(a=>`
            <div style="padding:8px 0;border-bottom:1px solid var(--border)">
              <div style="font-weight:700">${a.title||'Untitled'}</div>
              <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.()||Date.now()).toLocaleString()}</div>
              <div>${(a.body||'').replace(/</g,'&lt;')}</div>
            </div>`).join('') || `<div class="muted">No announcements yet.</div>`}
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Learn something new</h3>
          <div style="position:relative;padding-top:56.25%;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
            <iframe src="${YT_EMBED_BASE+vidId}" title="Edu video" style="position:absolute;inset:0;width:100%;height:100%" frameborder="0" allowfullscreen></iframe>
          </div>
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
    const my=uid(); const list=state.enrollments.filter(e=>e.uid===my).map(e=> e.course||{} );
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
                  ${(['instructor','admin'].includes(state.role) || q.ownerUid===uid())? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
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
              ${(state.attempts||[]).filter(a=>a.uid===uid()).map(a=>`
                <tr class="attempt-row" data-open-course="${a.courseId}">
                  <td>${(state.courses.find(c=>c.id===a.courseId)||{}).title||'—'}</td>
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
      <div class="muted" style="font-size:12px;margin-top:6px">Only enrolled students + instructors can post.</div>
    </div></div>`;

  function vTasks(){
    const my=uid();
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
    const me = state.profiles.find(p=>p.uid===uid()) || {name:'',bio:'',portfolio:'',avatar:'',signatureUrl:''};
    const creditEarned = buildTranscript(uid()).reduce((sum,r)=> sum + (r.completed? (state.courses.find(c=>c.id===r.courseId)?.credits||0):0),0);
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>

            <label>Signature name (printed)</label>
            <input id="pf-signname" class="input" placeholder="e.g. ${state.org.signerName}" value="${me.signName||''}"/>

            <div class="grid cols-2">
              <div><label>Avatar (PNG/JPG)</label><input id="pf-avatar" type="file" accept="image/*" class="input"/></div>
              <div><label>Signature (PNG)</label><input id="pf-signature" type="file" accept="image/png" class="input"/></div>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-view"><i class="ri-id-card-line"></i> View card</button>
              <button class="btn danger" id="pf-delete"><i class="ri-delete-bin-line"></i> Delete profile</button>
            </div>
            <div class="muted" style="font-size:12px">Earned credits: <b>${creditEarned}</b></div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript</h3>
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Course</th><th>Best Score</th><th>Certificate</th></tr></thead>
              <tbody>
                ${buildTranscript(uid()).map(r=>`
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
          <h3 style="margin:0 0 8px 0">Organization / Certificate Settings</h3>
          <div class="grid">
            <input id="org-name" class="input" placeholder="Organization name" value="${state.org.name||''}"/>
            <input id="org-loc" class="input" placeholder="Location (City, Country)" value="${state.org.location||''}"/>
            <input id="org-signer" class="input" placeholder="Signer name" value="${state.org.signerName||''}"/>
            <input id="org-note" class="input" placeholder="Line under title" value="${state.org.certificateNote||''}"/>
            <label>Signature image (PNG)</label><input id="org-signature" type="file" accept="image/png" class="input"/>
            <button class="btn" id="org-save"><i class="ri-save-3-line"></i> Save</button>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody>
            ${state.profiles.map(p=>`
              <tr data-uid="${p.uid}">
                <td>${p.name||'—'}</td><td>${p.email||'—'}</td><td>${p.role||'student'}</td>
                <td>
                  <button class="btn ghost" data-edit-user="${p.uid}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del-user="${p.uid}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
            </tbody></table>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Announcements</h3>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input id="ann-title" class="input" placeholder="Title"/>
            <button class="btn" id="ann-add"><i class="ri-add-line"></i> Add</button>
          </div>
          <textarea id="ann-body" class="input" placeholder="Body (markdown/plain)"></textarea>
          <div style="margin-top:8px"></div>
          <div id="ann-list">
            ${(state.announcements||[]).map(a=>`
              <div class="card" data-ann="${a.id}" style="margin-top:8px"><div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:700">${a.title}</div>
                  <div class="muted" style="font-size:12px">${new Date(a.createdAt?.toDate?.()||Date.now()).toLocaleString()}</div>
                </div>
                <div>
                  <button class="btn ghost" data-ann-edit="${a.id}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-ann-del="${a.id}"><i class="ri-delete-bin-6-line"></i></button>
                </div>
              </div></div>`).join('')}
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcripts (demo)</h3>
          <div class="table-wrap">
            <table class="table"><thead><tr><th>Student</th><th>Course</th><th>Best</th><th>Completed</th></tr></thead><tbody>
              ${adminTranscriptRows().map(r=>`
                <tr><td>${r.name}</td><td>${r.course}</td><td class="num">${r.best}%</td><td>${r.completed?'Yes':'No'}</td></tr>
              `).join('')}
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
              ${['sunrise','ocean','forest','grape','slate','dark'].map(p=>`<option value="${p}" ${state.theme.palette===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              ${['small','medium','large'].map(f=>`<option value="${f}" ${state.theme.font===f?'selected':''}>${f}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="margin-top:10px"><button class="btn" id="save-theme"><i class="ri-save-3-line"></i> Save</button></div>
      </div></div>
    `;
  }

  function vGuide(){
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Quick Guide</h3>
        <h4>For Admin</h4>
        <ul>
          <li>Go to <b>Admin</b> → <b>Organization / Certificate Settings</b> and fill org name, location, signer, and upload signature PNG. Click Save.</li>
          <li>Use <b>Users</b> table to change roles. Click the pencil to edit role; trash to delete a profile.</li>
          <li>Post <b>Announcements</b>. Title + Body → Add. Edit/delete from list.</li>
        </ul>
        <h4>For Instructor</h4>
        <ul>
          <li>Create a course: <b>Courses → New Course</b> (title, category, credits, short, outline JSON). Outline supports video, text, images.</li>
          <li>Create final: <b>Finals → New Final</b>. Provide pass score and JSON items (single/multiple answers).</li>
        </ul>
        <h4>For Students</h4>
        <ul>
          <li>Enroll: open a course → <b>Enroll</b>.</li>
          <li>Read lessons: <b>My Learning</b> → Open. Use left ToC to switch chapters/lessons. Add <b>Notes</b> in the viewer.</li>
          <li>Chat with your course in <b>Course Chat</b>.</li>
          <li>Take final in <b>Finals</b>. Scores show in <b>My Attempts</b> & <b>Transcript</b>.</li>
          <li>Download certificate from <b>Profile → Transcript</b> once completed.</li>
        </ul>
        <h4>Troubleshooting</h4>
        <ul>
          <li>If you see “Missing or insufficient permissions”, deploy the rules below and sign out/in again.</li>
          <li>If avatars don’t show, confirm Firebase Storage is enabled and the profile has an <code>avatar</code> URL.</li>
        </ul>
      </div></div>
    `;
  }

  // ---------- Render ----------
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
      default: return vDashboard();
    }
  }

  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( safeView(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
  }

  // ---------- Shell ----------
  function openModal(id){ $('#'+id)?.classList.add('active'); $('.modal-backdrop')?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('.modal-backdrop')?.classList.remove('active'); }
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };
  function ensureEdge(){ if($('#sidebarEdge')) return; const d=document.createElement('div'); d.id='sidebarEdge'; document.body.appendChild(d); ['pointerenter','touchstart'].forEach(e=> d.addEventListener(e, openSidebar, {passive:true})); }

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
    }
  }

  // ---------- Login ----------
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
        const u=cred.user;
        const role = ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student';
        await Promise.all([
          doc('roles', u.uid).set({ uid:u.uid, email, role, createdAt:ts }),
          doc('profiles', u.uid).set({ uid:u.uid, email, name:'', bio:'', portfolio:'', role, createdAt:ts })
        ]);
        notify('Account created — you can sign in.');
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  // ---------- Courses ----------
  function openCourseViewer(course){
    const outline = parseOutline(course.outline);
    const lessons = outline.flatMap(ch=> ch.lessons.map(l=> ({...l, chapter:ch.title})) );
    let idx=0;
    const paint=()=>{
      const l=lessons[idx]||{};
      const v = l.video? embedVideo(l.video): '';
      const imgs=(l.images||[]).map(src=> `<img src="${src}" onerror="this.src='${DEFAULT_AVATAR}'" style="max-width:100%;border-radius:8px;border:1px solid var(--border);margin-top:8px"/>`).join('');
      $('#mm-title').textContent=course.title;
      $('#mm-body').innerHTML=`
        <div class="viewer">
          <div class="toc">
            ${outline.map((ch,ci)=>`
              <div class="sec"><div style="font-weight:700">${ch.title}</div>
                ${ch.lessons.map((ls,li)=>{
                  const id = outline.slice(0,ci).reduce((n,c)=>n+c.lessons.length,0)+li;
                  return `<div class="lesson ${idx===id?'active':''}" data-go="${id}">${ls.title}</div>`;
                }).join('')}
              </div>`).join('')}
          </div>
          <div class="content">
            <div class="muted" style="font-size:12px">${l.chapter||''}</div>
            <h3 style="margin:6px 0 8px 0">${l.title||''}</h3>
            ${v}
            <div style="margin-top:8px">${(l.html||'').replace(/</g,'&lt;').replace(/\n/g,'<br/>')}</div>
            ${imgs}
            <div style="margin-top:12px;display:flex;gap:8px">
              <button class="btn" id="addNote"><i class="ri-sticky-note-add-line"></i> Add note</button>
              <button class="btn ghost" id="openFinal"><i class="ri-file-list-3-line"></i> Final</button>
            </div>
            <div id="my-notes" style="margin-top:8px"></div>
          </div>
        </div>`;
      $('#mm-foot').innerHTML=`
        ${isEnrolled(course.id)? `<button class="btn ok" disabled>Enrolled</button>` : `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>`}
        <button class="btn ghost" id="mm-ok">Close</button>`;

      // notes
      paintNotes(course.id, idx);
      $('#addNote')?.addEventListener('click', async ()=>{
        const text = prompt('Note for this lesson:'); if(!text) return;
        await col('notes').add({ uid:uid(), courseId:course.id, lessonIndex:idx, text, createdAt:ts });
      });

      $('#openFinal')?.addEventListener('click', ()=>{
        closeModal('m-modal'); state.searchQ=course.title; go('assessments');
      });
    };

    openModal('m-modal'); paint();

    $('#mm-body').addEventListener('click', async (e)=>{
      const go=e.target.closest('.lesson[data-go]'); if(go){ idx=+go.getAttribute('data-go'); paint(); }
    });
    $('#mm-foot').addEventListener('click', async (e)=>{
      if(e.target.closest('#enroll')){
        await col('enrollments').add({ uid:uid(), courseId:course.id, createdAt:ts, course:{id:course.id,title:course.title,category:course.category,credits:course.credits||0} });
        state.myEnrolledIds.add(course.id);
        paint(); notify('Enrolled');
      }
      if(e.target.closest('#mm-ok')) closeModal('m-modal');
    });
  }

  function parseOutline(out){
    try{ const j = typeof out==='string'? JSON.parse(out): (out||[]); return Array.isArray(j)? j:[]; }catch{ return []; }
  }
  function embedVideo(url){
    if(!url) return '';
    if(url.includes('youtube.com')||url.includes('youtu.be')){
      const vidId = (url.includes('watch?v=')? url.split('watch?v=')[1] : url.split('/').pop()).split('&')[0];
      return `<div style="position:relative;padding-top:56.25%;border-radius:12px;overflow:hidden;border:1px solid var(--border)">
        <iframe src="${YT_EMBED_BASE+vidId}" style="position:absolute;inset:0;width:100%;height:100%" frameborder="0" allowfullscreen></iframe>
      </div>`;
    }
    if(/\.(mp4|webm|ogg)(\?|$)/i.test(url)){
      return `<video controls style="width:100%;border-radius:12px;border:1px solid var(--border)"><source src="${url}"></video>`;
    }
    return '';
  }
  function paintNotes(courseId, lessonIndex){
    const list=(state.notes||[]).filter(n=>n.uid===uid() && n.courseId===courseId && n.lessonIndex===lessonIndex);
    $('#my-notes').innerHTML = list.length? `<div class="card"><div class="card-body"><h4 style="margin:0 0 6px 0">My notes</h4>${list.map(n=>`<div style="padding:4px 0;border-bottom:1px solid var(--border)">${(n.text||'').replace(/</g,'&lt;')}</div>`).join('')}</div></div>` : '';
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
          <textarea id="c-outline" class="input" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Welcome","video":"https://www.youtube.com/watch?v=...","html":"Welcome...","images":[]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`; openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(),
          outline:$('#c-outline')?.value.trim(), ownerUid:uid(), ownerEmail:auth.currentUser.email, createdAt:ts };
        await col('courses').add(obj); closeModal('m-modal'); notify('Saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        openCourseViewer({id:snap.id, ...snap.data()});
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
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`; openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0),
            short:$('#c-short')?.value.trim(), outline:$('#c-outline')?.value.trim(), updatedAt:ts
          },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  // ---------- Learning ----------
  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); const row=e.target.closest('tr.attempt-row[data-open-course]');
      const target = btn || row; if(!target) return;
      const id=target.getAttribute('data-open-course'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      openCourseViewer({id:snap.id, ...snap.data()});
    });
  }

  // ---------- Finals (Assessments) ----------
  function quizEditorBody(q={}){
    return `
      <div class="grid">
        <input id="q-title" class="input" placeholder="Final title" value="${q.title||''}"/>
        <select id="q-course" class="input">${state.courses.map(c=>`<option value="${c.id}" ${q.courseId===c.id?'selected':''}>${c.title}</option>`).join('')}</select>
        <input id="q-pass" class="input" type="number" value="${q.passScore||70}" placeholder="Pass score (%)"/>
        <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4"],"answer":1},{"q":"Select primes","choices":["2","4","5"],"answer":[0,2]}]'>${q.items?JSON.stringify(q.items,null,2):''}</textarea>
      </div>`;
  }
  function wireAssessments(){
    $('#new-final')?.addEventListener('click', ()=>{
      if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
      $('#mm-title').textContent='New Final';
      $('#mm-body').innerHTML=quizEditorBody({});
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
      openModal('m-modal');
      $('#q-save').onclick=async ()=>{
        const t=$('#q-title')?.value.trim(); const courseId=$('#q-course')?.value; const pass=+($('#q-pass')?.value||70);
        if(!t||!courseId) return notify('Fill title & course','warn');
        let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const course=state.courses.find(c=>c.id===courseId)||{};
        await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, isFinal:true, items, ownerUid:uid(), createdAt:ts });
        closeModal('m-modal'); notify('Final saved');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeFinal(q.courseId)) return notify('Enroll first to take','warn');

        // render quiz (scrollable)
        $('#mm-title').textContent=q.title;
        $('#mm-body').innerHTML = q.items.map((it,idx)=>`
          <div class="card"><div class="card-body">
            <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
            <div style="margin-top:6px;display:grid;gap:6px">
              ${it.choices.map((c,i)=>`
                <label style="display:flex;gap:8px;align-items:center">
                  <input type="${Array.isArray(it.answer)?'checkbox':'radio'}" name="q${idx}" value="${i}"/> <span>${c}</span>
                </label>`).join('')}
            </div>
            <div class="muted" id="fb-${idx}" style="margin-top:6px;font-size:12px"></div>
          </div></div>
        `).join('');
        $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
        openModal('m-modal');

        $('#q-submit').onclick=async ()=>{
          let correct=0;
          q.items.forEach((it,idx)=>{
            const name=`q${idx}`; let selected=[];
            if(Array.isArray(it.answer)){
              selected = $$(`input[name="${name}"]:checked`).map(x=> +x.value);
              const ok = it.answer.slice().sort().join(',') === selected.slice().sort().join(',');
              if(ok) correct++;
              $(`#fb-${idx}`).textContent = ok ? (it.feedbackOk||'Correct') : (it.feedbackNo||'Incorrect');
              $(`#fb-${idx}`).style.color = ok? 'var(--ok)':'var(--danger)';
            }else{
              const v=(document.querySelector(`input[name="${name}"]:checked`)?.value)||'-1';
              const ok = +v===+it.answer; if(ok) correct++;
              $(`#fb-${idx}`).textContent = ok ? (it.feedbackOk||'Correct') : (it.feedbackNo||'Incorrect');
              $(`#fb-${idx}`).style.color = ok? 'var(--ok)':'var(--danger)';
            }
          });
          const score = Math.round((correct/q.items.length)*100);
          await col('attempts').add({ uid:uid(), email:auth.currentUser.email, quizId:q.id, quizTitle:q.title, courseId:q.courseId, score, createdAt:ts });
          notify(`Your score: ${score}%`);
        };
      }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===uid() || state.role==='admin')) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=quizEditorBody(q);
        $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), courseId:$('#q-course')?.value, passScore:+($('#q-pass')?.value||70), items, updatedAt:ts },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
    });
  }

  // ---------- Chat ----------
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
      state._unsubChat?.(); state._unsubChat=null; state._currentCourseChat=cid; box.innerHTML='';
      if(!cid) return;
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
      const text=input.value.trim(); if(!text||!state._currentCourseChat) return;
      if(!canPostMessage(state._currentCourseChat)) return notify('Enroll to chat','warn');
      const p = state.profiles.find(x=>x.uid===uid()) || {};
      await col('messages').add({ courseId:state._currentCourseChat, uid:uid(), email:auth.currentUser.email, name:p.name||'', text, createdAt:ts });
      input.value='';
    });
  }

  // ---------- Tasks ----------
  function wireTasks(){
    const root=$('[data-sec="tasks"]'); if(!root) return;

    $('#addTask')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        await col('tasks').add({ uid:uid(), title:t, status:'todo', createdAt:ts });
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
          await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:ts },{merge:true});
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
        await doc('tasks',id).set({ status:lane, updatedAt:ts },{merge:true});
      });
    });
  }

  // ---------- Profile ----------
  function wireProfile(){
    $('#pf-view')?.addEventListener('click', ()=>{
      const me = state.profiles.find(p=>p.uid===uid())||{};
      $('#mm-title').textContent='Profile Card';
      const av = (me.avatar||DEFAULT_AVATAR)+'?t='+(Date.now());
      const sg = (me.signatureUrl||DEFAULT_SIGN)+'?t='+(Date.now());
      $('#mm-body').innerHTML=`
        <div style="display:flex;gap:16px;align-items:center">
          <img src="${av}" class="round ph" width="84" height="84" onerror="this.src='${DEFAULT_AVATAR}'" alt="Avatar"/>
          <div>
            <div style="font-weight:800">${me.name||me.email||me.uid}</div>
            <div class="muted" style="font-size:12px">${me.email||''}</div>
            <div class="muted" style="font-size:12px">${me.portfolio||''}</div>
          </div>
        </div>
        <div style="margin-top:8px">${(me.bio||'').replace(/</g,'&lt;').replace(/\n/g,'<br/>')}</div>
        <div style="margin-top:10px"><div class="muted" style="font-size:12px">Signature</div><img src="${sg}" class="ph" style="max-width:220px" onerror="this.src='${DEFAULT_SIGN}'"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`; openModal('m-modal');
      $('#mm-ok').onclick=()=> closeModal('m-modal');
    });

    $('#pf-delete')?.addEventListener('click', async ()=>{
      if(!confirm('Delete your profile?')) return;
      await doc('profiles',uid()).delete();
      notify('Profile deleted');
    });

    $('#pf-save')?.addEventListener('click', async ()=>{
      const u=uid();
      // text fields
      await doc('profiles',u).set({
        name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(),
        bio:$('#pf-bio')?.value.trim(), signName:$('#pf-signname')?.value.trim(),
        updatedAt:ts
      },{merge:true});

      // files
      const a=$('#pf-avatar')?.files?.[0]; const s=$('#pf-signature')?.files?.[0];
      if(a){
        const ref=stg.ref().child(`avatars/${u}/${Date.now()}_${a.name}`);
        await ref.put(a); const url=await ref.getDownloadURL();
        await doc('profiles',u).set({ avatar:url },{merge:true});
      }
      if(s){
        const ref=stg.ref().child(`signatures/${u}/${Date.now()}_${s.name}`);
        await ref.put(s); const url=await ref.getDownloadURL();
        await doc('profiles',u).set({ signatureUrl:url },{merge:true});
      }

      // clear inputs
      if($('#pf-avatar')) $('#pf-avatar').value='';
      if($('#pf-signature')) $('#pf-signature').value='';
      notify('Profile saved');
    });

    // certificate
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const p=state.profiles.find(x=>x.uid===uid())||{name:auth.currentUser.email};
      await ensureOrgLoaded();
      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
      const ctx=canvas.getContext('2d');

      // bg
      ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
      // border
      ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(60,60,1280,780);

      // title + org note
      ctx.fillStyle='#fff';
      ctx.font='bold 56px Inter,system-ui'; ctx.fillText('Certificate of Completion', 340, 220);
      ctx.font='24px Inter,system-ui'; ctx.fillStyle='#94a3b8'; ctx.fillText(state.org.certificateNote||'', 340, 260);

      // recipient & course
      ctx.fillStyle='#fff';
      ctx.font='bold 40px Inter,system-ui'; ctx.fillText(`Awarded to: ${p.name||p.email}`, 340, 320);
      ctx.font='28px Inter,system-ui'; ctx.fillText(`For successfully completing the course: ${course.title||courseId}`, 340, 370);
      ctx.fillText(`Organization: ${state.org.name||''}  •  Location: ${state.org.location||''}`, 340, 410);
      const id=`${(course.title||courseId).replace(/\s+/g,'').slice(0,6).toUpperCase()}-${(uid()||'').slice(0,6).toUpperCase()}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`;
      ctx.fillText(`Certificate #: ${id}`, 340, 450);
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 340, 490);

      // signature line
      ctx.strokeStyle='#94a3b8'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(340, 610); ctx.lineTo(760,610); ctx.stroke();
      ctx.font='20px Inter,system-ui'; ctx.fillStyle='#94a3b8'; ctx.fillText(p.signName || state.org.signerName || 'Authorized', 340, 640);

      // signature image
      if(state.org.signatureUrl){
        const img=new Image(); img.crossOrigin='anonymous'; img.onload=()=>{
          ctx.drawImage(img, 780, 560, 260, 80);
          downloadPng();
        }; img.onerror=downloadPng; img.src=state.org.signatureUrl+'?t='+Date.now();
      }else{
        downloadPng();
      }

      function downloadPng(){
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${(course.title||courseId)}.png`; a.click();
      }
    });
  }

  // ---------- Admin events ----------
  function wireAdmin(){
    // Save org settings
    $('#org-save')?.addEventListener('click', async ()=>{
      const f=$('#org-signature')?.files?.[0]; let signatureUrl = state.org.signatureUrl || '';
      if(f){ const r=stg.ref().child(`org/signature_${Date.now()}.png`); await r.put(f); signatureUrl=await r.getDownloadURL(); }
      const obj={
        name:$('#org-name')?.value.trim(),
        location:$('#org-loc')?.value.trim(),
        signerName:$('#org-signer')?.value.trim(),
        certificateNote:$('#org-note')?.value.trim(),
        signatureUrl, updatedAt:ts
      };
      await doc('settings','org').set(obj,{merge:true});
      notify('Organization settings saved');
      state.org={...state.org,...obj};
    });

    // Announcements add
    $('#ann-add')?.addEventListener('click', async ()=>{
      const title=$('#ann-title')?.value.trim(); const body=$('#ann-body')?.value.trim();
      if(!title||!body) return notify('Title & body required','warn');
      await col('announcements').add({ title, body, createdAt:ts });
      $('#ann-title').value=''; $('#ann-body').value='';
      notify('Announcement added');
    });

    // list actions
    $('#ann-list')?.addEventListener('click', async (e)=>{
      const id=e.target.closest('[data-ann-edit]')?.getAttribute('data-ann-edit') || e.target.closest('[data-ann-del]')?.getAttribute('data-ann-del');
      if(!id) return;
      if(e.target.closest('[data-ann-edit]')){
        const snap=await doc('announcements',id).get(); if(!snap.exists) return;
        const a=snap.data();
        const title=prompt('Edit title', a.title||''); if(title==null) return;
        const body=prompt('Edit body', a.body||''); if(body==null) return;
        await doc('announcements',id).set({ title, body, updatedAt:ts },{merge:true}); notify('Updated');
      }else{
        if(!confirm('Delete announcement?')) return;
        await doc('announcements',id).delete(); notify('Deleted');
      }
    });

    // Users edit/delete
    $('#main')?.addEventListener('click', async (e)=>{
      const edit=e.target.closest('[data-edit-user]'); const del=e.target.closest('[data-del-user]');
      if(edit){
        const uid=edit.getAttribute('data-edit-user'); const p=(await doc('profiles',uid).get()).data()||{};
        const role=prompt('Set role (student/instructor/admin)', p.role||'student'); if(!role||!VALID_ROLES.includes(role)) return notify('Invalid role','warn');
        const name=prompt('Name (optional)', p.name||''); 
        await Promise.all([
          doc('roles',uid).set({ role, updatedAt:ts },{merge:true}),
          doc('profiles',uid).set({ role, name },{merge:true})
        ]);
        notify('User updated');
      }
      if(del){
        const uid=del.getAttribute('data-del-user'); if(!confirm('Delete profile?')) return;
        await doc('profiles',uid).delete(); notify('Deleted');
      }
    });
  }

  // ---------- Settings ----------
  function wireSettings(){
    $('#save-theme')?.addEventListener('click', ()=>{
      state.theme.palette=$('#theme-palette')?.value||'sunrise';
      state.theme.font=$('#theme-font')?.value||'medium';
      localStorage.setItem('lh:palette', state.theme.palette);
      localStorage.setItem('lh:font', state.theme.font);
      applyTheme();
      notify('Theme saved');
    });
  }

  // ---------- Transcript helpers ----------
  function buildTranscript(u){
    const byCourse = {};
    (state.attempts||[]).filter(a=>a.uid===u).forEach(a=>{
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId, best:0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId);
      byCourse[a.courseId].completed = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }
  function adminTranscriptRows(){
    const rows=[];
    state.profiles.forEach(p=>{
      const tr=buildTranscript(p.uid);
      tr.forEach(r=> rows.push({ name:p.name||p.email||p.uid, course:r.courseTitle, best:r.best, completed:r.completed }));
    });
    return rows;
  }

  // ---------- Sync ----------
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    const my=uid();

    state.unsub.push(col('profiles').onSnapshot(s=>{ state.profiles=s.docs.map(d=>({id:d.id,...d.data()})); if(['profile','admin'].includes(state.route)) render(); }, err=>console.warn('profiles',err)));
    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(s=>{ state.courses=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); }, err=>console.warn('courses',err)));
    state.unsub.push(col('enrollments').where('uid','==',my).onSnapshot(s=>{
      state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
      state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
      if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
    },err=>console.warn('enrollments',err)));
    state.unsub.push(col('quizzes').orderBy('createdAt','desc').onSnapshot(s=>{
      state.quizzes=s.docs.map(d=>({id:d.id,...d.data()})).filter(q=>q.isFinal===true);
      if(['assessments','dashboard','profile'].includes(state.route)) render();
    },err=>console.warn('quizzes',err)));
    state.unsub.push(col('attempts').where('uid','==',my).onSnapshot(s=>{
      state.attempts=s.docs.map(d=>({id:d.id,...d.data()}))
        .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
      if(['assessments','profile','dashboard'].includes(state.route)) render();
    },err=>console.warn('attempts',err)));
    state.unsub.push(col('tasks').where('uid','==',my).onSnapshot(s=>{ state.tasks=s.docs.map(d=>({id:d.id,...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },err=>console.warn('tasks',err)));
    state.unsub.push(col('notes').where('uid','==',my).onSnapshot(s=>{ state.notes=s.docs.map(d=>({id:d.id,...d.data()})); },err=>console.warn('notes',err)));
    state.unsub.push(col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(s=>{ state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','admin'].includes(state.route)) render(); },err=>console.warn('ann',err)));

    ensureOrgLoaded();
  }
  async function ensureOrgLoaded(){
    try{ const s=await doc('settings','org').get(); if(s.exists) state.org={...state.org, ...s.data()}; }catch{}
  }

  async function resolveRole(u,email){
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',u).get(); const role=(r.data()?.role||'student').toLowerCase();
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
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:ts });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  // ---------- Boot ----------
  render();

  // ---------- Dev helper: seed sample final/course ----------
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const outline=[{title:"Chapter 1: Basics",lessons:[{title:"Welcome",video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",html:"Welcome text here.",images:[]},{title:"Numbers",html:"Understanding numbers…",images:[]}]}];
    const c1=await col('courses').add({title:'Algebra Basics',category:'Math',credits:3,short:'Equations, functions, factoring.',outline:JSON.stringify(outline),ownerUid:u.uid,ownerEmail:u.email,createdAt:ts});
    await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:ts,course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3}});
    await col('quizzes').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,isFinal:true,items:[
      {q:'2+2?',choices:['3','4','5'],answer:1,feedbackOk:'Correct',feedbackNo:'Nope'},
      {q:'Select primes',choices:['2','4','5'],answer:[0,2],feedbackOk:'Nice',feedbackNo:'Not quite'}
    ],ownerUid:u.uid,createdAt:ts});
    alert('Seeded sample course & final');
  };
})();