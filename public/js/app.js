/* LearnHub — E-Learning & Community Platform
   Adds: paid courses, half-image cards, outline/quizzes JSON URL support,
   final exam generation (random 12), improved profile/media, announcements,
   guide page, DM/group/course messaging, instant theme changes, mobile drawer.
*/
(() => {
  'use strict';

  /* ---------- Firebase ---------- */
  if (!window.firebase || !window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing');
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  /* ---------- Constants ---------- */
  const ADMIN_EMAILS = ['admin@learnhub.com']; // add more emails here
  const VALID_ROLES  = ['student','instructor','admin'];

  /* ---------- State ---------- */
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette:'sunrise', font:'medium' },
    searchQ:'', highlightId:null,
    profiles:[], courses:[], enrollments:[], quizzes:[], attempts:[], tasks:[],
    announcements:[], messages:[], notes:[],
    // chat recipient
    chatTarget:{ type:'course', courseId:'', toUid:'', group:'' },
    unsub:[], _unsubChat:null
  };

  /* ---------- Utils ---------- */
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const nowYear=()=> new Date().getFullYear();
  const notify=(msg,type='ok')=>{
    const n=$('#notification'); if(!n) return;
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=>n.className='notification',2200);
  };
  const currency = (n)=> (n>0? `$${(+n).toFixed(2)}`: 'Free');

  const col=(name)=> db.collection(name);
  const doc=(name,id)=> db.collection(name).doc(id);

  const isPaid = (course)=> (+course.price||0) > 0;
  const isAdmin=()=> state.role==='admin';
  const isInstructor=()=> state.role==='instructor' || isAdmin();

  const canCreateCourse = ()=> isInstructor() || isAdmin();
  const canManageUsers  = ()=> isAdmin();
  const canEditCourse   = (c)=> isAdmin() || c.ownerUid===auth.currentUser?.uid;

  const isEnrolled = (courseId)=>{
    const uid=auth.currentUser?.uid; if(!uid) return false;
    return state.enrollments.some(e=> e.courseId===courseId && e.uid===uid);
  };

  // mobile drawer helpers
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };

  // search
  function buildIndex(){
    const ix=[];
    state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
    state.quizzes.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
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

  /* ---------- Router ---------- */
  const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','guide','search'];
  function go(route){ state.route = routes.includes(route)?route:'dashboard'; closeSidebar(); render(); }

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
            ['assessments','Final Exams','ri-file-list-3-line'],
            ['chat','Messages','ri-chat-3-line'],
            ['tasks','Tasks','ri-list-check-2'],
            ['profile','Profile','ri-user-3-line'],
            ['admin','Admin','ri-shield-star-line'],
            ['guide','Guide','ri-question-line'],
            ['settings','Settings','ri-settings-3-line']
          ].map(([r,label,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
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
      <div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div>
      <div class="body" id="mm-body"></div>
      <div class="foot" id="mm-foot"></div>
    </div></div><div class="modal-backdrop" id="mb-modal"></div>`;
  }

  /* ---------- Views ---------- */
  const vLogin=()=>`
  <div style="display:grid;place-items:center;min-height:100vh;padding:20px">
    <div class="card login-box" style="width:min(420px,96vw)">
      <div class="card-body">
        <img class="login-logo" src="/icons/learnhub-192.png" alt="LearnHub"/>
        <p class="title">LearnHub</p>
        <p class="subtitle">Sign in to continue</p>
        <div class="grid" style="margin-top:8px">
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
        <div><div class="muted">${label}</div><h2 style="margin:6px 0 0 0">${value}</h2></div>
        <i class="${icon}" style="font-size:24px;color:var(--brand)"></i>
      </div>
    </div>`;

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll = state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts = state.attempts.filter(a=>a.uid===my).length;

    // random educational videos (rotates on each view)
    const vids = [
      'https://www.youtube.com/embed/8mAITcNt710',
      'https://www.youtube.com/embed/HcA4p2QW19w',
      'https://www.youtube.com/embed/Ke90Tje7VS0'
    ];
    const vid = vids[Math.floor(Math.random()*vids.length)];

    const annHtml = (state.announcements||[]).map(a=>`
      <div class="ann">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong>${a.title||'Announcement'}</strong> <span class="muted" style="font-size:12px">• ${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</span></div>
          ${isAdmin()? `<div style="display:flex;gap:6px">
              <button class="btn ghost" data-edit-ann="${a.id}"><i class="ri-edit-line"></i></button>
              <button class="btn danger" data-del-ann="${a.id}"><i class="ri-delete-bin-6-line"></i></button>
            </div>`:''}
        </div>
        <div>${(a.body||'').replace(/</g,'&lt;')}</div>
      </div>
    `).join('');

    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.filter(q=>q.isFinal).length,'assessments','ri-file-list-3-line')}
        ${dashCard('My Attempts', myAttempts,'assessments','ri-bar-chart-2-line')}
      </div>

      <div class="grid cols-2" style="margin-top:12px">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Announcements</h3>
          ${isAdmin()? `<div style="margin-bottom:8px"><button class="btn" id="ann-add"><i class="ri-megaphone-line"></i> New announcement</button></div>`:''}
          ${annHtml || `<div class="muted">No announcements.</div>`}
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Today’s Educational Video</h3>
          <div style="aspect-ratio:16/9;background:#000;overflow:hidden;border-radius:12px;border:1px solid var(--border)">
            <iframe width="100%" height="100%" src="${vid}" title="Education" frameborder="0" allowfullscreen></iframe>
          </div>
        </div></div>
      </div>
    `;
  }

  /* ---------- Course Cards (half image) ---------- */
  function courseCard(c, context='catalog'){
    const priceText = currency(+c.price||0);
    const priceCls  = (+c.price||0)>0 ? 'paid' : 'free';
    const action = context==='catalog'
      ? (isEnrolled(c.id) ? `<button class="btn ok" data-open="${c.id}"><i class="ri-external-link-line"></i> Open</button>`
                          : `<button class="btn" data-enroll="${c.id}"><i class="ri-checkbox-circle-line"></i> Enroll</button>`)
      : `<button class="btn" data-open="${c.id}"><i class="ri-external-link-line"></i> Open</button>`;

    return `
    <div class="card course-card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
      <div class="img">
        <img src="${c.image||'/icons/learnhub-512.png'}" alt="${c.title}"/>
      </div>
      <div class="info">
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <div>
              <div style="font-weight:800">${c.title}</div>
              <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits</div>
            </div>
            <div class="price ${priceCls}">${priceText}</div>
          </div>
          <p style="margin:8px 0">${c.short||''}</p>
          ${c.goals? `<ul style="margin:0 0 8px 18px">${(Array.isArray(c.goals)?c.goals:(c.goals+'').split(/\n|,/)).slice(0,4).map(g=>`<li>${g}</li>`).join('')}</ul>`:''}
          <div style="display:flex;gap:6px;justify-content:flex-end">
            ${action}
            ${canEditCourse(c)? `<button class="btn ghost" data-edit="${c.id}"><i class="ri-edit-line"></i></button>`:''}
          </div>
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
          ${state.courses.map(c=> courseCard(c,'catalog')).join('')}
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
        <div class="grid cols-2" data-sec="learning">
          ${list.map(c=>`
            <div class="card course-card">
              <div class="img"><img src="${c.image||'/icons/learnhub-512.png'}" alt="${c.title}"/></div>
              <div class="info">
                <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                  <div><div style="font-weight:800">${c.title}</div>
                       <div class="muted" style="font-size:12px">${c.category||'General'} • ${c.credits||0} credits</div></div>
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
          ${isInstructor()? `<button class="btn" id="gen-final"><i class="ri-shuffle-line"></i> Generate final from course</button>`:''}
        </div>
        <div class="grid" data-sec="quizzes">
          ${state.quizzes.filter(q=>q.isFinal).map(q=>`
            <div class="card ${state.highlightId===q.id?'highlight':''}" id="${q.id}">
              <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <div style="font-weight:800">${q.title}</div>
                  <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}% • 24 mins</div>
                </div>
                <div class="actions" style="display:flex;gap:6px">
                  <button class="btn" data-take="${q.id}"><i class="ri-play-line"></i> Take</button>
                  ${ (q.ownerUid===auth.currentUser?.uid || isAdmin())? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
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
            <thead><tr><th>Exam</th><th>Course</th><th>Score</th><th>Date</th></tr></thead>
            <tbody>
              ${(state.attempts||[]).filter(a=>a.uid===auth.currentUser?.uid).map(a=>`
                <tr>
                  <td>${a.quizTitle}</td>
                  <td>${(state.courses.find(c=>c.id===a.courseId)||{}).title||'—'}</td>
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
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <h3 style="margin:0">Messages</h3>
        <div style="display:flex;gap:6px;align-items:center">
          <select id="chat-type" class="input" style="max-width:160px">
            <option value="course" ${state.chatTarget.type==='course'?'selected':''}>Course-wide</option>
            <option value="user"   ${state.chatTarget.type==='user'?'selected':''}>Direct</option>
            <option value="group"  ${state.chatTarget.type==='group'?'selected':''}>Group</option>
          </select>
          <select id="chat-course" class="input" style="max-width:260px; ${state.chatTarget.type==='course'?'':'display:none'}">
            <option value="">Select course…</option>
            ${state.courses.map(c=>`<option value="${c.id}" ${state.chatTarget.courseId===c.id?'selected':''}>${c.title}</option>`).join('')}
          </select>
          <select id="chat-user" class="input" style="max-width:260px; ${state.chatTarget.type==='user'?'':'display:none'}">
            <option value="">Select user…</option>
            ${state.profiles.filter(p=>p.uid!==auth.currentUser?.uid).map(p=>`<option value="${p.uid}" ${state.chatTarget.toUid===p.uid?'selected':''}>${p.name||p.email}</option>`).join('')}
          </select>
          <input id="chat-group" class="input" style="max-width:220px; ${state.chatTarget.type==='group'?'':'display:none'}" placeholder="Group (e.g., Diploma-2025)"/>
        </div>
      </div>
      <div id="chat-box" style="margin-top:10px;max-height:55vh;overflow:auto;border:1px solid var(--border);border-radius:12px;padding:10px"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="chat-input" class="input" placeholder="Message…"/>
        <button class="btn" id="chat-send"><i class="ri-send-plane-2-line"></i></button>
      </div>
      <div class="muted" style="font-size:12px;margin-top:6px">Course messages are visible to enrolled students + instructors. Direct and Group are visible only to their recipients.</div>
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
    const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {name:'',bio:'',portfolio:'', avatar:'', signature:'', org:'LearnHub', location:'', certPrefix:'LH'};
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">My Profile</h3>
          <div class="grid">
            <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
            <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
            <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
            <div class="grid cols-2">
              <input id="pf-org" class="input" placeholder="Organization" value="${me.org||'LearnHub'}"/>
              <input id="pf-location" class="input" placeholder="Location" value="${me.location||''}"/>
            </div>
            <div class="grid cols-2">
              <input id="pf-certprefix" class="input" placeholder="Certificate Prefix (e.g., LH)" value="${me.certPrefix||'LH'}"/>
              <input id="pf-signText" class="input" placeholder="Signature Name Text" value="${me.signText||''}"/>
            </div>

            <div style="display:flex;gap:8px;align-items:center">
              <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
              <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Upload avatar</button>
              ${me.avatar? `<img src="${me.avatar}" alt="avatar" style="width:36px;height:36px;border-radius:50%;border:1px solid var(--border)"/>` : `<span class="muted">No avatar</span>`}
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <input id="pf-signature" type="file" accept="image/*" style="display:none"/>
              <button class="btn ghost" id="pf-pick-sign"><i class="ri-ink-bottle-line"></i> Upload signature</button>
              ${me.signature? `<img src="${me.signature}" alt="signature" style="height:24px;border:1px dashed var(--border);padding:2px;background:#fff"/>` : `<span class="muted">No signature</span>`}
            </div>

            <div style="display:flex;gap:8px">
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-view"><i class="ri-id-card-line"></i> View card</button>
              <button class="btn danger" id="pf-del"><i class="ri-delete-bin-6-line"></i> Delete profile</button>
            </div>
          </div>
        </div></div>

        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Transcript & Certificates</h3>
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
          <hr class="sep"/>
          <div style="display:flex;gap:8px">
            ${isAdmin()? `<button class="btn ghost" id="demo-cert"><i class="ri-file-download-line"></i> Demo certificate</button>`:''}
            ${isAdmin()? `<button class="btn ghost" id="demo-trans"><i class="ri-file-download-line"></i> Demo transcript</button>`:''}
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
            <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr></thead><tbody id="adm-users">
            ${state.profiles.map(p=>`
              <tr data-uid="${p.uid}">
                <td>${p.name||'—'}</td>
                <td>${p.email||'—'}</td>
                <td>${p.role||'student'}</td>
                <td>
                  <button class="btn ghost" data-edit-user="${p.uid}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del-user="${p.uid}"><i class="ri-delete-bin-6-line"></i></button>
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
              <option value="sunrise" ${document.body.classList.contains('theme-sunrise')?'selected':''}>sunrise</option>
              <option value="dark" ${document.body.classList.contains('theme-dark')?'selected':''}>dark</option>
              <option value="light" ${document.body.classList.contains('theme-light')?'selected':''}>light</option>
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              <option value="small"  ${document.body.classList.contains('font-small')?'selected':''}>small</option>
              <option value="medium" ${document.body.classList.contains('font-medium')?'selected':''}>medium</option>
              <option value="large"  ${document.body.classList.contains('font-large')?'selected':''}>large</option>
            </select>
          </div>
        </div>
        <p class="muted" style="margin-top:8px">Changes apply instantly.</p>
      </div></div>
    `;
  }

  function vGuide(){
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Quick “How to Use” (Admin & Instructor)</h3>
        <ol>
          <li><strong>Create a course</strong> (Courses → New Course). Fields:<br/>
            <code>title, category, credits, short, price, image (URL), goals (comma lines)</code><br/>
            Optional: <code>outlineUrl</code> (JSON URL), <code>outline</code> (JSON inline), <code>quizzesUrl</code> (per-lesson quiz JSON).
          </li>
          <li><strong>Outline JSON</strong> format (either at <em>outlineUrl</em> or pasted into <em>outline</em>):<br/>
<pre>[
  { "title": "Chapter 1", "lessons": [
    { "title": "Welcome", "video": "https://youtu...", "html": "Lesson text (HTML ok)", "images": ["https://.../img1.jpg"] },
    { "title": "Numbers", "html": "..." }
  ]},
  { "title": "Chapter 2", "lessons": [ ... ] }
]</pre>
          </li>
          <li><strong>Lesson quizzes JSON</strong> (per course via <code>quizzesUrl</code>):<br/>
<pre>{
  "lessonKey (e.g. ch1-welcome)": [
    {"q":"2+2?","choices":["3","4","5"],"answer":1,"feedbackOk":"Nice!","feedbackNo":"Try again."},
    ...
  ],
  "ch1-numbers":[ ... ]
}</pre>
          </li>
          <li><strong>Final exam</strong>: “Final Exams” → “Generate final from course”. It pulls up to 12 randomized questions from lesson quizzes.</li>
          <li><strong>Paid courses</strong>: set <code>price</code> &gt; 0. Students click “Enroll” → demo “Pay” → then added to <em>My Learning</em>. Replace demo with Stripe/PayPal when you add a backend.</li>
          <li><strong>Messaging</strong>: “Messages” page → choose Course-wide / Direct / Group. Course-wide visible to enrolled students; Direct is 1:1; Group is by group string (e.g. “Diploma-2025”).</li>
          <li><strong>Certificates & Transcript</strong>: Profile → table shows course best score & credits. ≥75% for paid/main courses and ≥65% for optional free courses → certificate enabled. Download from Profile.</li>
          <li><strong>Credits</strong>: Academic units indicating workload; admins/instructors assign credits per course. Used on Transcript & completion thresholds.</li>
        </ol>
      </div></div>
    `;
  }

  const vSearch=()=> {
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
  };

  /* ---------- Render ---------- */
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
      case 'guide': break;
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
          doc('profiles', uid).set({ uid, email, name:'', bio:'', portfolio:'', role: ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
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
          <div class="grid cols-2">
            <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
            <input id="c-credits"  class="input" placeholder="Credits (e.g., 3)" type="number" min="0" step="1"/>
          </div>
          <textarea id="c-short" class="input" placeholder="Short description"></textarea>
          <textarea id="c-goals" class="input" placeholder="Goals (comma or newline separated)"></textarea>
          <div class="grid cols-2">
            <input id="c-price"   class="input" placeholder="Price (0 for free)" type="number" min="0" step="0.01"/>
            <input id="c-image"   class="input" placeholder="Image URL (course card)"/>
          </div>
          <div class="grid cols-2">
            <input id="c-outlineUrl" class="input" placeholder="Outline JSON URL (optional)"/>
            <input id="c-quizzesUrl" class="input" placeholder="Lesson quizzes JSON URL (optional)"/>
          </div>
          <textarea id="c-outline" class="input" placeholder='Inline Outline JSON (if no URL)'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');
      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const obj={
          title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0),
          short:$('#c-short')?.value.trim(), goals:($('#c-goals')?.value||'').split(/\n|,/).map(s=>s.trim()).filter(Boolean),
          price:+($('#c-price')?.value||0), image:$('#c-image')?.value.trim(),
          outlineUrl:$('#c-outlineUrl')?.value.trim(), quizzesUrl:$('#c-quizzesUrl')?.value.trim(),
          outline: $('#c-outline')?.value.trim()||'',
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email,
          createdAt:firebase.firestore.FieldValue.serverTimestamp()
        };
        await col('courses').add(obj); closeModal('m-modal'); notify('Course saved');
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;

    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]'); const enrollBtn=e.target.closest('button[data-enroll]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); openCourseModal(id);
      }
      if(editBtn){
        const id=editBtn.getAttribute('data-edit'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()}; if(!canEditCourse(c)) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Course';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="c-title" class="input" value="${c.title||''}"/>
            <div class="grid cols-2">
              <input id="c-category" class="input" value="${c.category||''}"/>
              <input id="c-credits"  class="input" type="number" value="${c.credits||0}"/>
            </div>
            <textarea id="c-short" class="input">${c.short||''}</textarea>
            <textarea id="c-goals" class="input">${(c.goals||[]).join('\n')}</textarea>
            <div class="grid cols-2">
              <input id="c-price" class="input" type="number" step="0.01" value="${c.price||0}"/>
              <input id="c-image" class="input" value="${c.image||''}"/>
            </div>
            <div class="grid cols-2">
              <input id="c-outlineUrl" class="input" value="${c.outlineUrl||''}"/>
              <input id="c-quizzesUrl" class="input" value="${c.quizzesUrl||''}"/>
            </div>
            <textarea id="c-outline" class="input">${c.outline||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(),
            category:$('#c-category')?.value.trim(),
            credits:+($('#c-credits')?.value||0),
            short:$('#c-short')?.value.trim(),
            goals: ($('#c-goals')?.value||'').split(/\n|,/).map(s=>s.trim()).filter(Boolean),
            price:+($('#c-price')?.value||0),
            image:$('#c-image')?.value.trim(),
            outlineUrl:$('#c-outlineUrl')?.value.trim(),
            quizzesUrl:$('#c-quizzesUrl')?.value.trim(),
            outline:$('#c-outline')?.value.trim(),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(enrollBtn){
        const id=enrollBtn.getAttribute('data-enroll');
        const c=state.courses.find(x=>x.id===id); if(!c) return;
        if(!isPaid(c)){
          await enrollInCourse(c, /*paid*/true); // free -> auto paid=true
          notify('Enrolled'); return;
        }
        // Paid — demo payment flow
        $('#mm-title').textContent='Checkout';
        $('#mm-body').innerHTML=`
          <p><strong>${c.title}</strong></p>
          <p>Price: ${currency(+c.price||0)}</p>
          <p class="muted">Demo payment only. Replace this with Stripe/PayPal in production.</p>`;
        $('#mm-foot').innerHTML=`
          <button class="btn ghost" id="pay-cancel">Cancel</button>
          <button class="btn" id="pay-ok"><i class="ri-bank-card-line"></i> Pay now</button>`;
        openModal('m-modal');
        $('#pay-cancel').onclick=()=> closeModal('m-modal');
        $('#pay-ok').onclick=async ()=>{ await enrollInCourse(c, /*paid*/true); closeModal('m-modal'); notify('Payment successful — Enrolled'); };
      }
    });
  }

  async function enrollInCourse(course, paidFlag){
    const uid=auth.currentUser.uid;
    await col('enrollments').add({
      uid, courseId:course.id, paid:!!paidFlag,
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),
      course:{ id:course.id, title:course.title, category:course.category, credits:course.credits||0, image:course.image||'', price:course.price||0 }
    });
  }

  async function openCourseModal(id){
    const snap=await doc('courses',id).get(); if(!snap.exists) return;
    const c={id:snap.id, ...snap.data()};
    const enrolled=isEnrolled(c.id);
    $('#mm-title').textContent=c.title;

    // fetch outline/quizzes if URLs present
    let outline=[];
    try{
      if(c.outlineUrl){ const res=await fetch(c.outlineUrl, {cache:'no-cache'}); outline=await res.json(); }
      else if(c.outline){ outline=JSON.parse(c.outline); }
    }catch(_){ outline=[]; }

    const chapters = (outline||[]).map((ch,ci)=>`
      <details ${ci===0?'open':''} style="border:1px solid var(--border);border-radius:10px;padding:8px">
        <summary><strong>${ch.title||('Chapter '+(ci+1))}</strong></summary>
        <div class="grid" style="margin-top:8px">
          ${(ch.lessons||[]).map((ls,li)=>`
            <div class="card"><div class="card-body">
              <div style="font-weight:700">${ls.title||('Lesson '+(li+1))}</div>
              ${ls.video? `<div style="margin:8px 0;aspect-ratio:16/9;border:1px solid var(--border);border-radius:10px;overflow:hidden"><iframe width="100%" height="100%" src="${ls.video.replace('watch?v=','embed/')}" title="Video" frameborder="0" allowfullscreen></iframe></div>`:''}
              ${ls.images?.length? `<div style="display:flex;gap:6px;flex-wrap:wrap">${ls.images.slice(0,3).map(u=>`<img src="${u}" alt="" style="border:1px solid var(--border);border-radius:8px;width:120px;height:80px;object-fit:cover"/>`).join('')}</div>`:''}
              ${ls.html? `<div style="margin-top:6px">${ls.html}</div>`:''}
              ${enrolled? `<div style="display:flex;justify-content:flex-end;margin-top:8px"><button class="btn" data-quiz-lesson="${id}" data-ci="${ci}" data-li="${li}"><i class="ri-question-line"></i> Lesson quiz</button></div>`:''}
            </div></div>`).join('')}
        </div>
      </details>`).join('');

    $('#mm-body').innerHTML=`
      <div class="grid">
        <div class="muted">${c.category||'General'} • ${c.credits||0} credits • ${currency(+c.price||0)}</div>
        <p>${c.short||''}</p>
        ${chapters || '<div class="muted">No outline.</div>'}
      </div>`;
    $('#mm-foot').innerHTML=`
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
        ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
        <button class="btn ghost" id="open-final"><i class="ri-medal-line"></i> Final exam</button>
      </div>`;
    openModal('m-modal');

    $('#enroll')?.addEventListener('click', async ()=>{
      if(isPaid(c)){
        // go through demo pay
        $('#mm-foot').innerHTML=`<button class="btn" id="demo-pay">Demo Pay & Enroll</button>`;
        $('#demo-pay').onclick=async ()=>{ await enrollInCourse(c,true); closeModal('m-modal'); notify('Enrolled'); };
      }else{
        await enrollInCourse(c,true); closeModal('m-modal'); notify('Enrolled');
      }
    });
    $('#open-final')?.addEventListener('click', ()=>{ state.searchQ=c.title; go('assessments'); });

    // handle lesson quiz open (pull quizzesUrl)
    $('#mm-body')?.addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-quiz-lesson]'); if(!b) return;
      if(!isEnrolled(c.id)) return notify('Enroll first to take','warn');
      const ci=+b.getAttribute('data-ci'), li=+b.getAttribute('data-li');
      const ch=(outline||[])[ci]; const ls=(ch?.lessons||[])[li];
      const lessonKey = `${(ch?.title||'ch'+(ci+1)).toLowerCase().replace(/\s+/g,'-')}-${(ls?.title||'lesson'+(li+1)).toLowerCase().replace(/\s+/g,'-')}`;
      let map={};
      try{
        if(c.quizzesUrl){ const r=await fetch(c.quizzesUrl,{cache:'no-cache'}); map=await r.json(); }
      }catch(_){}
      const items = map[lessonKey]||[];
      if(!items.length) return notify('No quiz for this lesson','warn');
      takeQuiz({ id:`LQ-${lessonKey}`, title:`${ls.title} — Quiz`, courseId:c.id, passScore:70, items });
    });
  }

  /* ---------- Learning ---------- */
  function wireLearning(){
    $('#main')?.addEventListener('click', async (e)=>{
      const btn=e.target.closest('button[data-open-course]'); if(!btn) return;
      const id=btn.getAttribute('data-open-course'); openCourseModal(id);
    });
  }

  /* ---------- Finals ---------- */
  function wireAssessments(){
    $('#gen-final')?.addEventListener('click', ()=>{
      // modal: choose course to generate
      $('#mm-title').textContent='Generate Final';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <select id="gf-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
          <input id="gf-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="gf-make">Generate</button>`;
      openModal('m-modal');
      $('#gf-make').onclick=async ()=>{
        const courseId=$('#gf-course')?.value; const pass=+($('#gf-pass')?.value||70);
        const course=state.courses.find(c=>c.id===courseId)||{};
        // attempt to fetch quizzesUrl to build a pool
        let pool=[];
        try{
          if(course.quizzesUrl){ const r=await fetch(course.quizzesUrl,{cache:'no-cache'}); const map=await r.json();
            Object.values(map).forEach(arr=> Array.isArray(arr)&&arr.forEach(q=> pool.push(q)));
          }
        }catch(_){}
        if(!pool.length){ notify('No lesson quizzes found for this course','warn'); return; }
        // pick up to 12 random
        const items=[]; const cp=[...pool];
        for(let i=0;i<12 && cp.length;i++){
          const at=Math.floor(Math.random()*cp.length); items.push(cp.splice(at,1)[0]);
        }
        await col('quizzes').add({title:`${course.title} — Final`,courseId,courseTitle:course.title,passScore:pass,isFinal:true,items,ownerUid:auth.currentUser.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        closeModal('m-modal'); notify('Final generated');
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired){return;} sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!isEnrolled(q.courseId) && !isInstructor()) return notify('Enroll first to take','warn');
        takeQuiz(q);
      }
      if(edit){
        const id=edit.getAttribute('data-edit'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===auth.currentUser?.uid || isAdmin())) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <textarea id="q-json" class="input" style="min-height:220px">${JSON.stringify(q.items||[],null,2)}</textarea>
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

  function takeQuiz(q){
    // render quiz (scrollable)
    $('#mm-title').textContent = q.title;
    $('#mm-body').innerHTML = `
      <div id="quiz-wrap" style="max-height:58vh;overflow:auto;padding-right:6px">
        ${q.items.map((it,idx)=>`
        <div class="card"><div class="card-body">
          <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
          <div style="margin-top:6px;display:grid;gap:6px">
            ${it.choices.map((c,i)=>`
              <label style="display:flex;gap:8px;align-items:center">
                <input type="radio" name="q${idx}" value="${i}"/> <span>${c}</span>
              </label>`).join('')}
          </div>
          <div id="fb-${idx}" class="muted" style="margin-top:6px"></div>
        </div></div>`).join('')}
      </div>`;
    $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
    openModal('m-modal');

    // instant feedback on selection
    q.items.forEach((it,idx)=>{
      $(`#quiz-wrap input[name="q${idx}"]`)?.closest('div')?.addEventListener('change', ()=>{
        const v=+((document.querySelector(`input[name="q${idx}"]:checked`)?.value)||'-1');
        const fb=$(`#fb-${idx}`); if(!fb) return;
        if(v===+it.answer){ fb.textContent=it.feedbackOk||'Correct'; fb.style.color='var(--ok)';}
        else { fb.textContent=it.feedbackNo||'Incorrect'; fb.style.color='var(--danger)';}
      }, {once:false});
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

  /* ---------- Chat ---------- */
  function wireChat(){
    const box=$('#chat-box'); const typeSel=$('#chat-type'); const courseSel=$('#chat-course');
    const userSel=$('#chat-user'); const groupInp=$('#chat-group');
    const input=$('#chat-input'); const send=$('#chat-send');
    const paint=(msgs)=>{
      box.innerHTML = msgs.map(m=>`
        <div style="margin-bottom:8px">
          <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
          <div>${(m.text||'').replace(/</g,'&lt;')}</div>
        </div>`).join('');
      box.scrollTop=box.scrollHeight;
    };
    function subChat(){
      if(state._unsubChat){ try{state._unsubChat()}catch{} state._unsubChat=null; }
      const t=state.chatTarget.type;
      if(t==='course' && state.chatTarget.courseId){
        state._unsubChat = col('messages').where('targetType','==','course').where('courseId','==',state.chatTarget.courseId).onSnapshot(
          s => { state.messages = s.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0)); paint(state.messages); },
          err => console.warn('chat listener error:', err)
        );
      } else if(t==='user' && state.chatTarget.toUid){
        const room = [auth.currentUser.uid, state.chatTarget.toUid].sort().join('_');
        state._unsubChat = col('messages').where('targetType','==','user').where('room','==',room).onSnapshot(
          s => { state.messages = s.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0)); paint(state.messages); },
          err => console.warn('chat listener error:', err)
        );
      } else if(t==='group' && (state.chatTarget.group||'').trim()){
        state._unsubChat = col('messages').where('targetType','==','group').where('group','==',state.chatTarget.group.trim()).onSnapshot(
          s => { state.messages = s.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0)); paint(state.messages); },
          err => console.warn('chat listener error:', err)
        );
      } else box.innerHTML='';
    }
    typeSel?.addEventListener('change', ()=>{
      state.chatTarget.type=typeSel.value;
      $('#chat-course').style.display = state.chatTarget.type==='course'?'block':'none';
      $('#chat-user').style.display   = state.chatTarget.type==='user'?'block':'none';
      $('#chat-group').style.display  = state.chatTarget.type==='group'?'block':'none';
      subChat();
    });
    courseSel?.addEventListener('change', ()=>{ state.chatTarget.courseId=courseSel.value; subChat(); });
    userSel?.addEventListener('change', ()=>{ state.chatTarget.toUid=userSel.value; subChat(); });
    groupInp?.addEventListener('input', ()=>{ state.chatTarget.group=groupInp.value; }); // sub later

    send?.addEventListener('click', async ()=>{
      const text=input.value.trim(); if(!text) return;
      const p = state.profiles.find(x=>x.uid===auth.currentUser?.uid) || {};
      const base = { uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
      if(state.chatTarget.type==='course' && state.chatTarget.courseId){
        if(!isEnrolled(state.chatTarget.courseId) && !isInstructor()) return notify('Enroll to chat','warn');
        await col('messages').add({ ...base, targetType:'course', courseId:state.chatTarget.courseId });
      } else if(state.chatTarget.type==='user' && state.chatTarget.toUid){
        const room=[auth.currentUser.uid, state.chatTarget.toUid].sort().join('_');
        await col('messages').add({ ...base, targetType:'user', toUid:state.chatTarget.toUid, room });
      } else if(state.chatTarget.type==='group' && (state.chatTarget.group||'').trim()){
        await col('messages').add({ ...base, targetType:'group', group:state.chatTarget.group.trim() });
      }
      input.value=''; subChat();
    });

    // initial
    subChat();
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
    $('#pf-pick-sign')?.addEventListener('click', ()=> $('#pf-signature')?.click());

    $('#pf-save')?.addEventListener('click', async ()=>{
      const uid=auth.currentUser.uid;
      // text bits
      await doc('profiles',uid).set({
        name:$('#pf-name')?.value.trim(),
        portfolio:$('#pf-portfolio')?.value.trim(),
        bio:$('#pf-bio')?.value.trim(),
        org:$('#pf-org')?.value.trim(),
        location:$('#pf-location')?.value.trim(),
        certPrefix:$('#pf-certprefix')?.value.trim(),
        signText:$('#pf-signText')?.value.trim(),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});

      // files
      const avatar=$('#pf-avatar')?.files?.[0];
      if(avatar){
        const ref=stg.ref().child(`avatars/${uid}/${Date.now()}_${avatar.name}`);
        await ref.put(avatar); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ avatar:url },{merge:true});
      }
      const signature=$('#pf-signature')?.files?.[0];
      if(signature){
        const ref=stg.ref().child(`signatures/${uid}/${Date.now()}_${signature.name}`);
        await ref.put(signature); const url=await ref.getDownloadURL();
        await doc('profiles',uid).set({ signature:url },{merge:true});
      }
      notify('Profile saved');
    });

    $('#pf-view')?.addEventListener('click', ()=>{
      const me = state.profiles.find(p=>p.uid===auth.currentUser?.uid) || {};
      $('#mm-title').textContent='Profile Card';
      $('#mm-body').innerHTML=`
        <div style="display:flex;gap:12px;align-items:center">
          <img src="${me.avatar||'/icons/learnhub-192.png'}" alt="avatar" style="width:64px;height:64px;border-radius:50%;border:1px solid var(--border)"/>
          <div>
            <div style="font-weight:800">${me.name||me.email||'—'}</div>
            <div class="muted" style="font-size:12px">${me.org||'LearnHub'} • ${me.location||''}</div>
          </div>
        </div>
        <p style="margin-top:8px">${me.bio||''}</p>
        ${me.signature? `<div class="muted" style="font-size:12px">Signature:</div><img src="${me.signature}" style="height:28px;background:#fff;border:1px dashed var(--border);padding:2px"/>`:''}
      `;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`; openModal('m-modal'); $('#mm-ok').onclick=()=> closeModal('m-modal');
    });

    $('#pf-del')?.addEventListener('click', async ()=>{
      if(!confirm('Delete your profile? This cannot be undone.')) return;
      await doc('profiles',auth.currentUser.uid).delete(); notify('Profile deleted');
    });

    // certificate download and demos
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(b){
        const courseId=b.getAttribute('data-cert');
        const course=state.courses.find(c=>c.id===courseId)||{};
        const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email, org:'LearnHub', certPrefix:'LH'};
        await drawCertificate({ name:p.name||auth.currentUser.email, org:p.org||'LearnHub', location:p.location||'', course:course.title||courseId, prefix:p.certPrefix||'LH', signature:p.signature||'', signText:p.signText||'' });
      }
      if(e.target.id==='demo-cert'){
        const p=state.profiles.find(x=>x.uid===auth.currentUser?.uid)||{name:auth.currentUser.email, org:'LearnHub', certPrefix:'LH'};
        await drawCertificate({ name:p.name||'Student Name', org:p.org||'LearnHub', location:p.location||'', course:'Sample Course', prefix:p.certPrefix||'LH', signature:p.signature||'', signText:p.signText||''});
      }
      if(e.target.id==='demo-trans'){
        await downloadDemoTranscript();
      }
    });
  }

  async function drawCertificate({name,org,location,course,prefix,signature,signText}){
    const id = `${prefix}-${Date.now().toString().slice(-7)}`;
    const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=1000;
    const ctx=canvas.getContext('2d');
    // bg
    ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,1000);
    // border
    ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(60,60,1280,880);
    // title
    ctx.fillStyle='#fff'; ctx.font='bold 56px Inter, ui-sans-serif'; ctx.fillText('Certificate of Completion', 330, 220);
    ctx.font='28px Inter'; ctx.fillText(`This is to certify that`, 330, 280);
    ctx.font='bold 46px Inter'; ctx.fillText(name, 330, 340);
    ctx.font='28px Inter'; ctx.fillText(`has successfully completed`, 330, 390);
    ctx.font='bold 36px Inter'; ctx.fillText(course, 330, 440);
    ctx.font='24px Inter'; ctx.fillText(`at ${org}${location?`, ${location}`:''}`, 330, 490);
    ctx.font='24px Inter'; ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 330, 540);
    ctx.font='20px Inter'; ctx.fillText(`Certificate No: ${id}`, 330, 580);
    // signature
    if(signature){
      const img = new Image(); img.crossOrigin='anonymous'; img.onload=()=>{
        ctx.drawImage(img, 980, 620, 220, 80);
        ctx.font='20px Inter'; ctx.fillStyle='#fff';
        ctx.fillText(signText||'Authorized Signature', 980, 720);
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course}.png`; a.click();
      };
      img.src=signature;
    }else{
      ctx.font='20px Inter'; ctx.fillStyle='#fff';
      ctx.fillText(signText||'Authorized Signature', 980, 720);
      const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course}.png`; a.click();
    }
  }

  async function downloadDemoTranscript(){
    // very simple CSV for demo
    const rows=[['Course','Best','Credits','Completed']];
    buildTranscript(auth.currentUser?.uid).forEach(r=> rows.push([r.courseTitle, r.best, r.credits||0, r.completed?'Yes':'No']));
    const csv = rows.map(r=> r.map(x=>`"${(x+'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='transcript_demo.csv'; a.click(); URL.revokeObjectURL(url);
  }

  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      await doc('profiles',uid).set({ role },{merge:true});
      notify('Role saved');
    });

    // edit/delete user profile rows
    $('#adm-users')?.addEventListener('click', async (e)=>{
      const editBtn=e.target.closest('button[data-edit-user]'); const delBtn=e.target.closest('button[data-del-user]');
      if(editBtn){
        const uid=editBtn.getAttribute('data-edit-user');
        const snap=await doc('profiles',uid).get(); if(!snap.exists) return;
        const p={id:snap.id, ...snap.data()};
        $('#mm-title').textContent='Edit User Profile';
        $('#mm-body').innerHTML=`<div class="grid">
          <input id="p-name" class="input" value="${p.name||''}" placeholder="Name"/>
          <input id="p-email" class="input" value="${p.email||''}" placeholder="Email (display only)"/>
          <textarea id="p-bio" class="input">${p.bio||''}</textarea>
        </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="p-save">Save</button>`;
        openModal('m-modal');
        $('#p-save').onclick=async ()=>{
          await doc('profiles',uid).set({ name:$('#p-name')?.value.trim(), bio:$('#p-bio')?.value.trim() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(delBtn){
        const uid=delBtn.getAttribute('data-del-user');
        if(!confirm('Delete this profile?')) return;
        await doc('profiles',uid).delete(); notify('Deleted');
      }
    });

    // announcements on dashboard
    $('#main').addEventListener('click', async (e)=>{
      const add=e.target.closest('#ann-add'); const edit=e.target.closest('button[data-edit-ann]'); const del=e.target.closest('button[data-del-ann]');
      if(add){
        $('#mm-title').textContent='Announcement'; $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="a-title" class="input" placeholder="Title"/>
            <textarea id="a-body" class="input" placeholder="Details"></textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="a-save">Save</button>`; openModal('m-modal');
        $('#a-save').onclick=async ()=>{
          await col('announcements').add({ title:$('#a-title')?.value.trim(), body:$('#a-body')?.value.trim(), createdAt:firebase.firestore.FieldValue.serverTimestamp() });
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(edit){
        const id=edit.getAttribute('data-edit-ann'); const snap=await doc('announcements',id).get(); if(!snap.exists) return;
        const a={id:snap.id,...snap.data()};
        $('#mm-title').textContent='Edit Announcement'; $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="a-title" class="input" value="${a.title||''}"/>
            <textarea id="a-body" class="input">${a.body||''}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`<button class="btn" id="a-save">Save</button>`; openModal('m-modal');
        $('#a-save').onclick=async ()=>{
          await doc('announcements',id).set({ title:$('#a-title')?.value.trim(), body:$('#a-body')?.value.trim(), updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
      }
      if(del){
        const id=del.getAttribute('data-del-ann'); await doc('announcements',id).delete(); notify('Deleted');
      }
    });
  }

  function wireSettings(){
    const applyPalette = (v)=>{
      ['theme-sunrise','theme-dark','theme-light'].forEach(cls=>document.body.classList.remove(cls));
      document.body.classList.add('theme-'+v); state.theme.palette=v;
    };
    const applyFont = (v)=>{
      ['font-small','font-medium','font-large'].forEach(cls=>document.body.classList.remove(cls));
      document.body.classList.add('font-'+v); state.theme.font=v;
    };
    $('#theme-palette')?.addEventListener('change', e=> applyPalette(e.target.value));
    $('#theme-font')?.addEventListener('change', e=> applyFont(e.target.value));
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
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId, best:0, credits: (state.courses.find(c=>c.id===a.courseId)||{}).credits||0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId && q.isFinal);
      const mainPass = 75, freePass = 65;
      const course = state.courses.find(c=>c.id===a.courseId)||{};
      const passReq = (course.price||0)>0 ? mainPass : freePass;
      byCourse[a.courseId].completed = q ? (byCourse[a.courseId].best >= passReq) : false;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  /* ---------- Sync ---------- */
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    const uid=auth.currentUser.uid;

    // profiles
    state.unsub.push(col('profiles').onSnapshot(
      s => { state.profiles = s.docs.map(d=>({id:d.id, ...d.data()})); if(['profile','admin','chat'].includes(state.route)) render(); },
      err => console.warn('profiles listener error:', err)
    ));

    // enrollments
    state.unsub.push(col('enrollments').where('uid','==',uid).onSnapshot(s=>{
      state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
      state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
      if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
    }));

    // courses (order by created only — no composite)
    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(
      s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
      err => console.warn('courses listener error:', err)
    ));

    // finals/quizzes — filter client-side
    state.unsub.push(col('quizzes').orderBy('createdAt','desc').onSnapshot(
      s => { state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()})); if(['assessments','dashboard','profile'].includes(state.route)) render(); },
      err => console.warn('quizzes listener error:', err)
    ));

    // attempts — where uid only (no orderBy to avoid index) then sort client-side
    state.unsub.push(col('attempts').where('uid','==',uid).onSnapshot(
      s => {
        state.attempts = s.docs.map(d=>({id:d.id, ...d.data()}))
          .sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
        if(['assessments','profile','dashboard'].includes(state.route)) render();
      },
      err => console.warn('attempts listener error:', err)
    ));

    // tasks
    state.unsub.push(col('tasks').where('uid','==',uid).onSnapshot(
      s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
      err => console.warn('tasks listener error:', err)
    ));

    // announcements
    state.unsub.push(col('announcements').orderBy('createdAt','desc').limit(25).onSnapshot(
      s => { state.announcements=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard'].includes(state.route)) render(); },
      err => console.warn('announcements listener error:', err)
    ));
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
      if(!p.exists) await doc('profiles',user.uid).set({ uid:user.uid, email:user.email, name:'', bio:'', portfolio:'', role:state.role, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      else await doc('profiles',user.uid).set({ role: state.role },{merge:true});
    }catch{}
    sync(); render();
  });

  /* ---------- Boot ---------- */
  render();

  /* ---------- Seed (optional) ---------- */
  window.seedSampleData = async function(){
    const u=auth.currentUser; if(!u) return alert('Sign in first');
    const outline=[{title:"Chapter 1: Basics",lessons:[{title:"Welcome",video:"https://www.youtube.com/watch?v=dQw4w9WgXcQ",html:"Welcome text here.",images:[]},{title:"Numbers",html:"Understanding numbers…",images:[]}]}];
    const c1=await col('courses').add({
      title:'Algebra Basics',category:'Math',credits:3,short:'Equations, functions, factoring.',
      goals:['Understand variables','Solve linear equations','Factor polynomials'],
      price:0, image:'/icons/learnhub-512.png',
      outline:JSON.stringify(outline),
      ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    const c2=await col('courses').add({
      title:'Modern Web Bootcamp',category:'CS',credits:4,short:'HTML, CSS, JS in practice.',
      goals:['Build responsive pages','Manage state','Component thinking'],
      price:19.99, image:'/icons/learnhub-512.png',
      outline:JSON.stringify(outline),
      ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    await col('enrollments').add({uid:u.uid,courseId:c1.id,paid:true,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math',credits:3,image:'/icons/learnhub-512.png',price:0}});
    await col('quizzes').add({title:'Algebra Final',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,isFinal:true,items:[{q:'2+2?',choices:['3','4','5'],answer:1,feedbackOk:'Correct',feedbackNo:'Nope'},{q:'5x=20, x=?',choices:['2','4','5'],answer:2,feedbackOk:'Nice',feedbackNo:'Check again'}],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    await col('announcements').add({ title:'Welcome to LearnHub!', body:'New courses are live today. Explore and enroll.', createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    alert('Seeded sample data');
  };
})();