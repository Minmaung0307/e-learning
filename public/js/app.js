/* LearnHub — E-Learning & Community Platform (v1.2)
   - Long courses: chapters → lessons (title, video, html, images)
   - Course viewer with TOC, next/prev, sticky notes, progress & bookmarks
   - One FINAL exam per course → credits + professional certificate
   - Instructor announcements → in-app alerts
   - Dashboard shows credits; more theme palettes; instant theme apply
*/
(()=>{'use strict';

if(!window.firebase||!window.__FIREBASE_CONFIG) console.error('Firebase SDK or config missing');
firebase.initializeApp(window.__FIREBASE_CONFIG);
const auth=firebase.auth();
const db=firebase.firestore();
try{ db.settings({experimentalAutoDetectLongPolling:true,ignoreUndefinedProperties:true}); }catch{}
const stg=firebase.storage();

/* ---------- Constants ---------- */
const ADMIN_EMAILS=['admin@learnhub.com'];
const VALID_ROLES=['student','instructor','admin'];

/* ---------- State ---------- */
const state={
  user:null, role:'student', route:'dashboard',
  theme:{palette:'sunrise',font:'medium'},
  searchQ:'', highlightId:null,
  // data
  courses:[], finals:[], enrollments:[], attempts:[], profiles:[], tasks:[],
  // live
  announcements:[], unread:0,
  unsub:[]
};

/* ---------- Utils ---------- */
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const nowYear=()=>new Date().getFullYear();
const notify=(msg,type='ok')=>{const n=$('#notification'); if(!n)return; n.textContent=msg; n.className=`notification show ${type}`; setTimeout(()=>n.className='notification',2200);};
const escapeHTML=(s='')=>s.replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* Theme */
function setTheme(p,f,save=true){ if(p)state.theme.palette=p; if(f)state.theme.font=f;
  document.documentElement.setAttribute('data-theme',state.theme.palette);
  document.documentElement.setAttribute('data-font',state.theme.font);
  if(save) localStorage.setItem('lh_theme', JSON.stringify(state.theme));
}
(function(){ try{ const t=JSON.parse(localStorage.getItem('lh_theme')||'{}'); if(t.palette||t.font) setTheme(t.palette||'sunrise', t.font||'medium', false); }catch{} })();

/* Firestore helpers */
const col=n=>db.collection(n);
const doc=(n,id)=>db.collection(n).doc(id);

/* Permissions */
const canCreateCourse = ()=> ['instructor','admin'].includes(state.role);
const canManageUsers  = ()=> state.role==='admin';
const canEditCourse   = c => state.role==='admin'||c.ownerUid===auth.currentUser?.uid;
const myUid = ()=> auth.currentUser?.uid||'';
const enrolledCourseIds = ()=> state.enrollments.filter(e=>e.uid===myUid()).map(e=>e.courseId);

/* Search index (courses, finals titles, profiles) */
function buildIndex(){
  const ix=[];
  state.courses.forEach(c=>ix.push({label:c.title,section:'Courses',route:'courses',id:c.id,text:`${c.title} ${c.category||''} ${c.ownerEmail||''}`}));
  state.finals.forEach(f=>ix.push({label:`Final • ${f.courseTitle}`,section:'Assessments',route:'assessments',id:f.id,text:f.courseTitle||''}));
  state.profiles.forEach(p=>ix.push({label:p.name||p.email,section:'Profiles',route:'profile',id:p.uid,text:(p.bio||'')+' '+(p.portfolio||'')}));
  return ix;
}
function doSearch(q){
  const tokens=(q||'').toLowerCase().split(/\s+/).filter(Boolean); if(!tokens.length) return [];
  return buildIndex().map(it=>{
    const l=it.label.toLowerCase(), t=(it.text||'').toLowerCase();
    const ok=tokens.every(tok=>l.includes(tok)||t.includes(tok));
    return ok?{item:it,score:tokens.length+(l.includes(tokens[0])?1:0)}:null;
  }).filter(Boolean).sort((a,b)=>b.score-a.score).map(x=>x.item).slice(0,20);
}

/* Router + Layout */
const routes=['dashboard','courses','learning','assessments','chat','tasks','profile','admin','settings','search'];
function go(r){ state.route=routes.includes(r)?r:'dashboard'; closeSidebar(); render(); }

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
          ['settings','Settings','ri-settings-3-line']
        ].map(([r,l,ic])=>`
          <div class="item ${state.route===r?'active':''} ${r==='admin'&&!canManageUsers()?'hidden':''}" data-route="${r}">
            <i class="${ic}"></i><span>${l}</span>
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

        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn ghost bell" id="btnBell" title="Notifications">
            <i class="ri-notification-3-line"></i>${state.unread>0?'<span class="dot"></span>':''}
          </button>
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
  </div></div><div class="modal-backdrop"></div>
  `;
}

/* ---------- Views ---------- */
const vLogin=()=>`
<div style="display:grid;place-items:center;min-height:100vh;padding:20px">
  <div class="card" style="width:min(420px,96vw)"><div class="card-body">
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
  </div></div>
</div>`;

const dashCard=(label,value,route,icon)=>`
  <div class="card clickable" data-go="${route}">
    <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div class="muted" style="font-size:12px">${label}</div>
        <h2 style="margin:4px 0">${value}</h2>
      </div>
      <div style="font-size:28px;opacity:.8"><i class="${icon}"></i></div>
    </div>
  </div>`;
function vDashboard(){
  const uid=myUid();
  const myEnroll=state.enrollments.filter(e=>e.uid===uid).length;
  const myAttempts=state.attempts.filter(a=>a.uid===uid).length;
  const credits=(state.profiles.find(p=>p.uid===uid)||{}).credits||0;
  return `
    <div class="grid cols-4">
      ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
      ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
      ${dashCard('Final Exams', state.finals.length,'assessments','ri-award-line')}
      ${dashCard('My Credits', credits,'profile','ri-bank-card-line')}
    </div>

    <div class="card"><div class="card-body">
      <h3 style="margin:0 0 8px 0">Welcome</h3>
      <p class="muted">Read through chapters, take your course’s <strong>final exam</strong>, earn credits, and download a polished certificate.</p>
    </div></div>
  `;
}

function vCourses(){
  const canCreate=canCreateCourse();
  return `
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <h3 style="margin:0">Courses</h3>
        ${canCreate? `<button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>`:''}
      </div>
      <div class="grid cols-2" data-sec="courses">
        ${state.courses.map(c=>{
          const hasFinal=state.finals.some(f=>f.courseId===c.id);
          return `
          <div class="card ${state.highlightId===c.id?'highlight':''}" id="${c.id}">
            <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:800">${c.title}</div>
                <div class="muted" style="font-size:12px">${c.category||'General'} • by ${c.ownerEmail||'—'} • ${c.credit||3} credits</div>
              </div>
              <div class="actions" style="display:flex;gap:6px">
                <button class="btn" data-open="${c.id}"><i class="ri-eye-line"></i> Open</button>
                ${canEditCourse(c)? `<button class="btn ghost" data-edit="${c.id}"><i class="ri-edit-line"></i></button>`:''}
                ${canEditCourse(c)&&!hasFinal? `<button class="btn ghost" data-newfinal="${c.id}" title="Create final exam"><i class="ri-award-line"></i></button>`:''}
              </div>
            </div>
          </div>`}).join('')}
        ${!state.courses.length? `<div class="muted" style="padding:10px">No courses yet.</div>`:''}
      </div>
    </div></div>
  `;
}

function vLearning(){
  const uid=myUid(); const list=state.enrollments.filter(e=>e.uid===uid).map(e=> e.course||{});
  return `
    <div class="card"><div class="card-body">
      <h3 style="margin:0 0 8px 0">My Learning</h3>
      <div class="grid cols-2">
        ${list.map(c=>`
          <div class="card">
            <div class="card-body" style="display:flex;justify-content:space-between;align-items:center">
              <div><div style="font-weight:800">${c.title}</div><div class="muted" style="font-size:12px">${c.category||'General'}</div></div>
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
                <div style="font-weight:800">${q.title||('Final • '+(q.courseTitle||'Course'))}</div>
                <div class="muted" style="font-size:12px">${q.courseTitle||'—'} • pass ≥ ${q.passScore||70}%</div>
              </div>
              <div class="actions" style="display:flex;gap:6px">
                <button class="btn" data-take-final="${q.id}"><i class="ri-play-line"></i> Take</button>
                ${(['instructor','admin'].includes(state.role) || q.ownerUid===myUid())? `<button class="btn ghost" data-edit-final="${q.id}"><i class="ri-edit-line"></i></button>`:''}
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
          <thead><tr><th>Course</th><th>Score</th><th>Date</th></tr></thead>
          <tbody>
            ${(state.attempts||[]).filter(a=>a.uid===myUid()).map(a=>
              `<tr><td>${a.courseTitle}</td><td class="num">${a.score}%</td><td>${new Date(a.createdAt?.toDate?.()||a.createdAt||Date.now()).toLocaleString()}</td></tr>`).join('')}
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
  const me=state.profiles.find(p=>p.uid===myUid())||{name:'',bio:'',portfolio:'',credits:0};
  return `
    <div class="grid cols-2">
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">My Profile</h3>
        <div class="grid">
          <input id="pf-name" class="input" placeholder="Name" value="${me.name||''}"/>
          <input id="pf-portfolio" class="input" placeholder="Portfolio URL" value="${me.portfolio||''}"/>
          <textarea id="pf-bio" class="input" placeholder="Short bio">${me.bio||''}</textarea>
          <input id="pf-signname" class="input" placeholder="Signature name (optional)" value="${me.signName||''}"/>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input id="pf-avatar" type="file" accept="image/*" style="display:none"/>
            <input id="pf-signimg" type="file" accept="image/png,image/webp" style="display:none"/>
            <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
            <button class="btn ghost" id="pf-pick"><i class="ri-image-add-line"></i> Upload avatar</button>
            <button class="btn ghost" id="pf-picksign"><i class="ri-edit-2-line"></i> Upload signature PNG</button>
          </div>
          <div class="muted" style="font-size:12px">Credits: <strong>${me.credits||0}</strong></div>
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Transcript</h3>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Course</th><th>Best Score</th><th>Certificate</th></tr></thead>
            <tbody>
              ${buildTranscript(myUid()).map(r=>`
                <tr>
                  <td>${r.courseTitle}</td>
                  <td class="num">${r.best}%</td>
                  <td>${r.completed? `<button class="btn" data-cert="${r.courseId}"><i class="ri-award-line"></i> Download</button>`:'—'}</td>
                </tr>`).join('')}
            </tbody>
          </table>
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
          <select id="rm-role" class="input">${VALID_ROLES.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
          <button class="btn" id="rm-save"><i class="ri-save-3-line"></i> Save Role</button>
          <div class="muted" style="font-size:12px">Tip: UID is in Authentication → Users.</div>
        </div>
      </div></div>

      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Users (profiles)</h3>
        <div class="table-wrap">
          <table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Credits</th></tr></thead><tbody>
          ${state.profiles.map(p=>`<tr><td>${p.name||'—'}</td><td>${p.email||'—'}</td><td>${p.role||'student'}</td><td class="num">${p.credits||0}</td></tr>`).join('')}
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
            ${['sunrise','mint','violet','crimson','ocean','dark'].map(x=>`<option value="${x}">${x}</option>`).join('')}
          </select>
        </div>
        <div><label>Font size</label>
          <select id="theme-font" class="input">${['small','medium','large'].map(x=>`<option value="${x}">${x}</option>`).join('')}</select>
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

/* ---------- Render ---------- */
function render(){
  const root=$('#root');
  if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
  root.innerHTML=layout(safeView(state.route));
  wireShell(); wireRoute();
  if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
}

/* ---------- Shell wiring ---------- */
function openModal(){ $('#m-modal')?.classList.add('active'); $('.modal-backdrop')?.classList.add('active'); }
function closeModal(){ $('#m-modal')?.classList.remove('active'); $('.modal-backdrop')?.classList.remove('active'); }
function openSidebar(){ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); }
function closeSidebar(){ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); }

function wireShell(){
  $('#burger')?.addEventListener('click',()=>document.body.classList.contains('sidebar-open')?closeSidebar():openSidebar());
  $('#backdrop')?.addEventListener('click',closeSidebar);
  $('#brand')?.addEventListener('click',closeSidebar);
  $('#main')?.addEventListener('click',closeSidebar);

  $('#side-nav')?.addEventListener('click',e=>{
    const it=e.target.closest('.item[data-route]'); if(it) go(it.getAttribute('data-route'));
  });

  $('#btnLogout')?.addEventListener('click',()=>auth.signOut());
  $('#mm-close')?.addEventListener('click',closeModal);
  $('#copyright')?.replaceChildren(document.createTextNode(`Powered by MM, ${nowYear()}`));

  // global search
  const input=$('#globalSearch'), results=$('#searchResults');
  if(input&&results){
    let t;
    input.addEventListener('keydown',e=>{ if(e.key==='Enter'){ state.searchQ=input.value.trim(); go('search'); results.classList.remove('active'); }});
    input.addEventListener('input',()=>{
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
    document.addEventListener('click',e=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
  }

  // bell
  $('#btnBell')?.addEventListener('click',showNotificationsModal);
}

/* ---------- Per-route wiring ---------- */
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
  const doLogin=async()=>{
    const email=$('#li-email')?.value.trim(), pass=$('#li-pass')?.value.trim();
    if(!email||!pass) return notify('Enter email & password','warn');
    try{ await auth.signInWithEmailAndPassword(email,pass); }catch(e){ notify(e?.message||'Login failed','danger'); }
  };
  $('#btnLogin')?.addEventListener('click',doLogin);
  $('#li-pass')?.addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });
  $('#link-forgot')?.addEventListener('click',async()=>{
    const email=$('#li-email')?.value.trim(); if(!email) return notify('Enter your email first','warn');
    try{ await auth.sendPasswordResetEmail(email); notify('Reset email sent','ok'); }catch(e){ notify(e?.message||'Failed','danger'); }
  });
  $('#link-register')?.addEventListener('click',async()=>{
    const email=$('#li-email')?.value.trim(); const pass=$('#li-pass')?.value.trim()||'admin123';
    if(!email) return notify('Enter email, then click Sign up again','warn');
    try{
      const cred=await auth.createUserWithEmailAndPassword(email,pass);
      const uid=cred.user.uid;
      await Promise.all([
        doc('roles',uid).set({uid,email,role:ADMIN_EMAILS.includes(email.toLowerCase())?'admin':'student',createdAt:firebase.firestore.FieldValue.serverTimestamp()}),
        doc('profiles',uid).set({uid,email,name:'',bio:'',portfolio:'',credits:0,createdAt:firebase.firestore.FieldValue.serverTimestamp()})
      ]);
      notify('Account created—sign in now.');
    }catch(e){ notify(e?.message||'Signup failed','danger'); }
  });
}

/* ---------- Courses ---------- */
function wireCourses(){
  $('#add-course')?.addEventListener('click',()=>{
    if(!canCreateCourse()) return notify('Instructors/Admins only','warn');
    $('#mm-title').textContent='New Course';
    $('#mm-body').innerHTML=`
      <div class="grid">
        <input id="c-title" class="input" placeholder="Title"/>
        <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
        <input id="c-credit" class="input" placeholder="Credits (e.g., 3)" type="number" value="3"/>
        <textarea id="c-desc" class="input" placeholder="Short description"></textarea>
        <textarea id="c-outline" class="input" placeholder='Outline JSON (chapters → lessons with "title","video","html","images")'></textarea>
      </div>`;
    $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
    openModal();
    $('#c-save').onclick=async()=>{
      const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
      let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid Outline JSON','danger'); }
      const obj={title:t,category:$('#c-category')?.value.trim(),desc:$('#c-desc')?.value.trim(),
        credit:+($('#c-credit')?.value||3), outline,
        ownerUid:myUid(),ownerEmail:auth.currentUser.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()};
      await col('courses').add(obj); closeModal(); notify('Saved');
    };
  });

  const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;
  sec.addEventListener('click', async (e)=>{
    const openBtn=e.target.closest('button[data-open]');
    const editBtn=e.target.closest('button[data-edit]');
    const newFinalBtn=e.target.closest('button[data-newfinal]');
    if(openBtn){
      const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
      openCourseViewer({id:snap.id,...snap.data()});
    }
    if(editBtn){
      const id=editBtn.getAttribute('data-edit'); const s=await doc('courses',id).get(); if(!s.exists) return;
      const c={id:s.id,...s.data()}; if(!canEditCourse(c)) return notify('No permission','warn');
      $('#mm-title').textContent='Edit Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" value="${c.title||''}"/>
          <input id="c-category" class="input" value="${c.category||''}"/>
          <input id="c-credit" class="input" type="number" value="${c.credit||3}"/>
          <textarea id="c-desc" class="input">${c.desc||''}</textarea>
          <textarea id="c-outline" class="input">${JSON.stringify(c.outline||[],null,2)}</textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal();
      $('#c-save').onclick=async()=>{
        let outline=[]; try{ outline=JSON.parse($('#c-outline')?.value||'[]'); }catch{ return notify('Invalid Outline JSON','danger'); }
        await doc('courses',id).set({title:$('#c-title')?.value.trim(),category:$('#c-category')?.value.trim(),credit:+($('#c-credit')?.value||3),
          desc:$('#c-desc')?.value.trim(),outline,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        closeModal(); notify('Saved');
      };
    }
    if(newFinalBtn){
      const courseId=newFinalBtn.getAttribute('data-newfinal');
      const course=state.courses.find(x=>x.id===courseId); if(!course) return;
      $('#mm-title').textContent=`Final Exam • ${course.title}`;
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="q-title" class="input" value="Final — ${course.title}"/>
          <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
          <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":[1]}]'></textarea>
          <div class="muted" style="font-size:12px">For multiple-correct questions, put all correct indexes in "answer" array (e.g., [0,2]). Radio-style (single) still works: use a single index [1].</div>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save Final</button>`;
      openModal();
      $('#q-save').onclick=async()=>{
        let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
        const pass=+($('#q-pass')?.value||70);
        await col('finals').add({title:$('#q-title')?.value.trim(),courseId:courseId,courseTitle:course.title,passScore:pass,items,ownerUid:myUid(),createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        closeModal(); notify('Final created');
      };
    }
  });
}

function embedVideoHTML(url){
  if(!url) return '';
  const u=url.trim();
  if(/(youtube\.com\/watch\?v=|youtu\.be\/)/i.test(u)){
    // YouTube embed
    const id = (u.match(/v=([^&]+)/)||u.match(/youtu\.be\/([^?]+)/)||[])[1] || '';
    if(!id) return '';
    return `<div class="course-video"><iframe style="width:100%;aspect-ratio:16/9;border:0" src="https://www.youtube.com/embed/${id}" allowfullscreen loading="lazy"></iframe></div>`;
  }
  // HTML5 video
  return `<video class="course-video" src="${u}" controls playsinline></video>`;
}

function lessonKey(ci,li){ return `c${ci}.l${li}`; }

async function loadNotes(courseId, lkey){
  const s=await col('notes').where('uid','==',myUid()).where('courseId','==',courseId).where('lessonKey','==',lkey).orderBy('createdAt','asc').get();
  return s.docs.map(d=>({id:d.id,...d.data()}));
}

function showLesson(lesson, course, ci, li){
  $('#mm-title').textContent = `${course.title} — ${lesson.title||'Lesson'}`;

  let html=(lesson.html||'').toString();
  if(!/[<][a-z/]/i.test(html)){ // plain text -> paragraphs
    html = `<p>${escapeHTML(html).replace(/\n{2,}/g,'</p><p>').replace(/\n/g,'<br>')}</p>`;
  }
  const imgs=(Array.isArray(lesson.images)?lesson.images:[]).map(u=>`<img src="${u}" alt="">`).join('');
  const video=embedVideoHTML(lesson.video||'');

  // notes
  const lkey=lessonKey(ci,li);
  $('#mm-body').innerHTML=`
    <div class="course-wrap">
      <div class="course-toc" id="course-toc"></div>
      <div>
        ${video}
        <div class="course-content">${html}${imgs}</div>

        <div class="notes-panel">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>My sticky notes</strong>
            <button class="btn ghost" id="add-note"><i class="ri-sticky-note-add-line"></i> Add</button>
          </div>
          <div id="notes-list" style="margin-top:6px"></div>
        </div>

        <div class="course-ctrls">
          <div style="display:flex;gap:8px">
            <button class="btn ghost" id="prev-lesson"><i class="ri-skip-back-mini-line"></i> Prev</button>
            <button class="btn" id="next-lesson">Next <i class="ri-skip-forward-mini-line"></i></button>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn ghost" id="bookmark-lesson"><i class="ri-bookmark-3-line"></i> Bookmark</button>
            ${isLastLesson(course,ci,li)? `<button class="btn" id="take-final"><i class="ri-award-line"></i> Take Final</button>`:''}
          </div>
        </div>
      </div>
    </div>`;

  buildToc(course, ci, li);
  wireLessonActions(course,ci,li,lkey);
  paintNotes(course.id, lkey);
  saveProgress(course.id, ci, li);
}

function isLastLesson(course,ci,li){
  const outline=course.outline||[]; if(!outline.length) return true;
  const lastC=outline.length-1;
  const lastL=(outline[lastC].lessons||[]).length-1;
  return ci===lastC && li===lastL;
}

async function paintNotes(courseId,lkey){
  const list=$('#notes-list'); if(!list) return;
  const notes=await loadNotes(courseId,lkey);
  list.innerHTML = notes.length? notes.map(n=>`
    <div class="note-item">
      <div class="muted" style="font-size:12px">${new Date(n.createdAt?.toDate?.()||n.createdAt||Date.now()).toLocaleString()}</div>
      <div style="white-space:pre-wrap">${escapeHTML(n.text||'')}</div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn ghost" data-edit="${n.id}"><i class="ri-edit-line"></i></button>
        <button class="btn danger" data-del="${n.id}"><i class="ri-delete-bin-6-line"></i></button>
      </div>
    </div>`).join('') : `<div class="muted">No notes yet.</div>`;

  list.onclick=async e=>{
    const ed=e.target.closest('button[data-edit]'); const del=e.target.closest('button[data-del]');
    if(ed){
      const id=ed.getAttribute('data-edit'); const t=prompt('Edit note text:'); if(t==null) return;
      await doc('notes',id).set({text:t,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); paintNotes(courseId,lkey);
    }else if(del){
      const id=del.getAttribute('data-del'); await doc('notes',id).delete(); paintNotes(courseId,lkey);
    }
  };
}

function buildToc(course,ci,li){
  const toc=$('#course-toc'); if(!toc) return;
  const outline=course.outline||[];
  toc.innerHTML = outline.map((ch,idx)=>`
    <div class="chapter">
      <div style="font-weight:700;margin:4px 0">${ch.title||('Chapter '+(idx+1))}</div>
      <div>
        ${(ch.lessons||[]).map((l,j)=>`
          <div class="lesson ${ci===idx&&li===j?'active':''}" data-ci="${idx}" data-li="${j}">${l.title||('Lesson '+(j+1))}</div>
        `).join('')}
      </div>
    </div>`).join('');

  toc.querySelectorAll('.lesson').forEach(x=>{
    x.onclick=()=>{ const nci=+x.getAttribute('data-ci'), nli=+x.getAttribute('data-li'); showLesson((course.outline[nci].lessons||[])[nli],course,nci,nli); };
  });
}

function wireLessonActions(course,ci,li,lkey){
  $('#prev-lesson')?.addEventListener('click',()=>{
    const {nci,nli}=prevLesson(course,ci,li); if(nci<0)return; showLesson(course.outline[nci].lessons[nli],course,nci,nli);
  });
  $('#next-lesson')?.addEventListener('click',()=>{
    const {nci,nli}=nextLesson(course,ci,li); if(nci<0)return; showLesson(course.outline[nci].lessons[nli],course,nci,nli);
  });
  $('#bookmark-lesson')?.addEventListener('click',async()=>{
    await doc('progress',`${myUid()}_${course.id}`).set({uid:myUid(),courseId:course.id,bookmark:lkey,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    notify('Bookmarked');
  });
  $('#add-note')?.addEventListener('click',async()=>{
    const t=prompt('Note text:'); if(!t) return;
    await col('notes').add({uid:myUid(),courseId:course.id,lessonKey:lkey,text:t,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    paintNotes(course.id,lkey);
  });
  $('#take-final')?.addEventListener('click',()=>{
    const f=state.finals.find(x=>x.courseId===course.id); if(!f) return notify('No final created yet','warn');
    openFinal(f);
  });
}

function prevLesson(course,ci,li){
  if(li>0) return {nci:ci,nli:li-1};
  if(ci>0){ const prev=(course.outline[ci-1].lessons||[]).length; if(prev>0) return {nci:ci-1,nli:prev-1}; }
  return {nci:-1,nli:-1};
}
function nextLesson(course,ci,li){
  const L=(course.outline[ci].lessons||[]).length;
  if(li<L-1) return {nci:ci,nli:li+1};
  if(ci<course.outline.length-1){ const next=(course.outline[ci+1].lessons||[]).length; if(next>0) return {nci:ci+1,nli:0}; }
  return {nci:-1,nli:-1};
}

async function saveProgress(courseId,ci,li){
  const id=`${myUid()}_${courseId}`;
  const course=state.courses.find(c=>c.id===courseId)||{outline:[]};
  const total=(course.outline||[]).reduce((a,ch)=>a+(ch.lessons||[]).length,0)||1;
  const completedKey=lessonKey(ci,li);
  await db.runTransaction(async tx=>{
    const ref=doc('progress',id); const s=await tx.get(ref);
    let c = s.exists? s.data():{uid:myUid(),courseId,current:{ci:0,li:0},completedLessons:[],percent:0};
    c.current={ci,li};
    if(!c.completedLessons.includes(completedKey)) c.completedLessons.push(completedKey);
    c.percent=Math.min(100, Math.round((c.completedLessons.length/total)*100));
    tx.set(ref, {...c, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
  }).catch(()=>{});
}

/* Course viewer (modal) */
function openCourseViewer(course){
  // default to first lesson or resume bookmark
  (async ()=>{
    let ci=0, li=0;
    try{
      const s=await doc('progress',`${myUid()}_${course.id}`).get();
      const p=s.data()||{};
      const cur=p.bookmark? p.bookmark: (p.current? lessonKey(p.current.ci,p.current.li): null);
      if(cur){ const m=cur.match(/^c(\d+)\.l(\d+)$/); if(m){ci=+m[1]; li=+m[2];}}
    }catch{}
    // render skeleton
    $('#mm-title').textContent=course.title;
    $('#mm-body').innerHTML= `<div class="course-wrap"><div class="course-toc" id="course-toc"></div><div><div class="muted">Loading…</div></div></div>`;
    $('#mm-foot').innerHTML=`
      <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
        <div class="muted" style="font-size:12px">Credits: ${course.credit||3}</div>
        ${(canEditCourse(course)? `<button class="btn ghost" id="announce"><i class="ri-notification-3-line"></i> Message learners</button>`:'')}
        <button class="btn ghost" id="close">Close</button>
      </div>`;
    openModal();

    const outline=course.outline||[]; if(!outline.length){ $('#mm-body').innerHTML='<p class="muted">No outline yet.</p>'; return; }
    // show first/current lesson
    showLesson((outline[ci].lessons||[])[li], course, ci, li);

    // instructor announcement (broadcast to enrolled)
    $('#announce')?.addEventListener('click', async ()=>{
      const text=prompt('Announcement to enrolled learners:'); if(!text) return;
      const enrolled = await col('enrollments').where('courseId','==',course.id).get();
      const batch = db.batch();
      enrolled.docs.forEach(d=>{
        const toUid=d.data().uid;
        const ref = col('announcements').doc();
        batch.set(ref,{toUid,courseId:course.id,courseTitle:course.title,title:`Message from ${auth.currentUser.email}`,text,createdAt:firebase.firestore.FieldValue.serverTimestamp(),readBy:[]});
      });
      await batch.commit(); notify('Sent');
    });
    $('#close')?.addEventListener('click', closeModal);
  })();
}

/* ---------- Assessments (Final only) ---------- */
function wireAssessments(){
  $('#new-final')?.addEventListener('click', ()=>{
    if(!['instructor','admin'].includes(state.role)) return notify('Instructors/Admins only','warn');
    // Simple creator not tied to course (you can pick course)
    $('#mm-title').textContent='New Final';
    $('#mm-body').innerHTML=`
      <div class="grid">
        <select id="f-course" class="input">${state.courses.map(c=>`<option value="${c.id}">${c.title}</option>`).join('')}</select>
        <input id="q-title" class="input" placeholder="Final title"/>
        <input id="q-pass" class="input" type="number" value="70" placeholder="Pass score (%)"/>
        <textarea id="q-json" class="input" placeholder='[{"q":"2+2?","choices":["3","4","5"],"answer":[1]}]'></textarea>
      </div>
      <div class="muted" style="font-size:12px">Multiple-correct supported: put all correct indexes in <code>answer</code> array.</div>`;
    $('#mm-foot').innerHTML=`<button class="btn" id="q-save">Save</button>`;
    openModal();
    $('#q-save').onclick=async ()=>{
      const cid=$('#f-course')?.value; const t=$('#q-title')?.value.trim();
      if(!cid||!t) return notify('Select course & title','warn');
      let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
      const c=state.courses.find(x=>x.id===cid)||{};
      await col('finals').add({title:t,courseId:cid,courseTitle:c.title,passScore:+($('#q-pass')?.value||70),items,ownerUid:myUid(),createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      closeModal(); notify('Final saved');
    };
  });

  const sec=$('[data-sec="finals"]'); if(!sec||sec.__wired){return;} sec.__wired=true;
  sec.addEventListener('click',async (e)=>{
    const take=e.target.closest('button[data-take-final]'); const edit=e.target.closest('button[data-edit-final]');
    if(take){
      const id=take.getAttribute('data-take-final'); const s=await doc('finals',id).get(); if(!s.exists) return;
      openFinal({id:s.id,...s.data()});
    }
    if(edit){
      const id=edit.getAttribute('data-edit-final'); const s=await doc('finals',id).get(); if(!s.exists) return;
      const q={id:s.id,...s.data()}; if(!(q.ownerUid===myUid()||state.role==='admin')) return notify('No permission','warn');
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
        await doc('finals',id).set({title:$('#q-title')?.value.trim(),passScore:+($('#q-pass')?.value||70),items,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        closeModal(); notify('Saved');
      };
    }
  });
}

function openFinal(q){
  $('#mm-title').textContent=q.title||('Final • '+(q.courseTitle||'Course'));
  $('#mm-body').innerHTML = (q.items||[]).map((it,idx)=>`
    <div class="card"><div class="card-body">
      <div style="font-weight:700">Q${idx+1}. ${it.q}</div>
      <div style="margin-top:6px;display:grid;gap:6px">
        ${it.choices.map((c,i)=>`
          <label style="display:flex;gap:8px;align-items:center">
            <input type="checkbox" name="q${idx}" value="${i}"/> <span>${c}</span>
          </label>`).join('')}
      </div>
    </div></div>
  `).join('');
  $('#mm-foot').innerHTML=`<button class="btn" id="q-submit"><i class="ri-checkbox-circle-line"></i> Submit</button>`;
  openModal();

  $('#q-submit').onclick=async ()=>{
    let correct=0;
    (q.items||[]).forEach((it,idx)=>{
      const selected=[...document.querySelectorAll(`input[name="q${idx}"]:checked`)].map(x=>+x.value);
      const ans = Array.isArray(it.answer)? it.answer.map(Number): [+it.answer];
      const same = selected.length===ans.length && selected.every(v=>ans.includes(v));
      if(same) correct++;
    });
    const score=Math.round((correct/(q.items||[]).length)*100);
    const pass = score >= (q.passScore||70);

    await col('attempts').add({uid:myUid(),email:auth.currentUser.email,courseId:q.courseId,courseTitle:q.courseTitle,score,createdAt:firebase.firestore.FieldValue.serverTimestamp(),passed:pass});
    if(pass){
      await addCredits(q.courseId);
      notify(`Passed! Score ${score}% — credits awarded.`);
    }else{
      notify(`Score ${score}% — try again.`,`warn`);
    }
    closeModal();
  };
}

/* Credits & Transcript & Certificate */
async function addCredits(courseId){
  const c=state.courses.find(x=>x.id===courseId)||{credit:3,title:'Course'};
  const uid=myUid(); const ref=doc('profiles',uid);
  await db.runTransaction(async tx=>{
    const s=await tx.get(ref); const old=(s.data()?.credits)||0;
    tx.set(ref,{credits:old+(+c.credit||3)}, {merge:true});
  });
}

function buildTranscript(uid){
  const byCourse={};
  (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
    byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId,courseTitle:a.courseTitle,best:0,completed:false};
    byCourse[a.courseId].best=Math.max(byCourse[a.courseId].best,a.score||0);
    const f=state.finals.find(x=>x.courseId===a.courseId);
    byCourse[a.courseId].completed = f ? (byCourse[a.courseId].best>=(f.passScore||70)) : false;
  });
  return Object.values(byCourse).sort((a,b)=>a.courseTitle.localeCompare(b.courseTitle));
}

function drawCertificate(canvas,opts){
  const {title='Certificate of Completion',statement='This is to certify that',recipient='Recipient',
    reason='has successfully completed',subject='Course',org='LearnHub',dateText=new Date().toLocaleDateString(),
    certId='LH-'+Math.random().toString(36).slice(2,8).toUpperCase(),logoImg=null,signImg=null,signName='Authorized Signature',borderStyle='classic'}=opts;
  const ctx=canvas.getContext('2d'); const W=canvas.width=1600,H=canvas.height=1100;
  ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,W,H);
  const drawClassic=()=>{ ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=12; ctx.strokeRect(60,60,W-120,H-120);
    ctx.strokeStyle='rgba(122,211,255,.5)'; ctx.lineWidth=3; ctx.strokeRect(100,100,W-200,H-200); };
  const drawMinimal=()=>{ ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=6; ctx.strokeRect(80,80,W-160,H-160); };
  const drawThematic=()=>{ drawMinimal(); ctx.save(); ctx.strokeStyle='rgba(122,211,255,.35)'; ctx.lineWidth=2; const r=26;
    [[100,100],[W-100,100],[100,H-100],[W-100,H-100]].forEach(([x,y])=>{ ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.stroke();}); ctx.restore(); };
  ({classic:drawClassic,minimal:drawMinimal,thematic:drawThematic}[borderStyle]||drawClassic)();
  if(logoImg){ const lw=160,lh=160; ctx.drawImage(logoImg,(W-lw)/2,130,lw,lh); }
  ctx.fillStyle='#fff'; ctx.textAlign='center';
  ctx.font='700 74px "Playfair Display", Inter, serif'; ctx.fillText(title, W/2, logoImg?360:260);
  ctx.font='400 28px Inter, system-ui'; ctx.fillStyle='rgba(255,255,255,.9)'; ctx.fillText(statement, W/2, logoImg?420:320);
  ctx.font='700 56px "Playfair Display", Inter, serif'; ctx.fillStyle='#fff'; ctx.fillText(recipient, W/2, logoImg?490:390);
  ctx.font='400 28px Inter, system-ui'; ctx.fillStyle='rgba(255,255,255,.9)'; ctx.fillText(reason, W/2, logoImg?540:440);
  ctx.font='600 36px Inter, system-ui'; ctx.fillStyle='#fff'; ctx.fillText(subject, W/2, logoImg?590:490);
  ctx.textAlign='left'; ctx.font='400 24px Inter, system-ui'; ctx.fillStyle='rgba(255,255,255,.9)';
  ctx.fillText(`Date: ${dateText}`,140,H-180); ctx.fillText(`Issued by: ${org}`,140,H-140); ctx.fillText(`Certificate ID: ${certId}`,140,H-100);
  ctx.textAlign='right'; const sx=W-180,sy=H-180; ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(sx-340,sy); ctx.lineTo(sx,sy); ctx.stroke();
  if(signImg){ const sw=260,sh=100; ctx.drawImage(signImg,sx-320,sy-120,sw,sh); }
  else { ctx.font='italic 36px "Great Vibes", "Playfair Display", serif'; ctx.fillStyle='#fff'; ctx.fillText(signName,sx-10,sy-16); }
  ctx.font='600 18px Inter, system-ui'; ctx.fillStyle='rgba(255,255,255,.75)'; ctx.fillText(org,sx-10,sy+30);
}

async function generateCertificate(course,profile){
  const loadImg=src=>new Promise(res=>{ if(!src){res(null);return;} const i=new Image(); i.crossOrigin='anonymous'; i.onload=()=>res(i); i.onerror=()=>res(null); i.src=src; });
  const [logoImg,signImg]=await Promise.all([loadImg('/assets/learnhub-mark.svg'), loadImg(profile.signatureUrl||null)]);
  const canvas=document.createElement('canvas');
  drawCertificate(canvas,{recipient:profile.name||profile.email||'Learner',subject:course.title||'Course',org:'LearnHub',logoImg,signImg,signName:profile.signName||profile.name||'Authorized Signature',borderStyle:'classic'});
  const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${(course.title||'course').replace(/\s+/g,'_')}.png`; a.click();
}

/* ---------- Chat ---------- */
function wireChat(){
  const box=$('#chat-box'), courseSel=$('#chat-course'), input=$('#chat-input'); let unsub=null,cid='';
  const paint=msgs=>{ box.innerHTML=msgs.map(m=>`
    <div style="margin-bottom:8px">
      <div style="font-weight:600">${m.name||m.email||'User'} <span class="muted" style="font-size:12px">• ${new Date(m.createdAt?.toDate?.()||m.createdAt||Date.now()).toLocaleTimeString()}</span></div>
      <div>${(m.text||'').replace(/</g,'&lt;')}</div>
    </div>`).join(''); box.scrollTop=box.scrollHeight; };
  const sub=cid0=>{ unsub?.(); unsub=null; cid=cid0; box.innerHTML=''; if(!cid) return;
    unsub = col('messages').where('courseId','==',cid).orderBy('createdAt').onSnapshot(s=>paint(s.docs.map(d=>({id:d.id,...d.data()}))));
  };
  courseSel?.addEventListener('change',e=>sub(e.target.value));
  $('#chat-send')?.addEventListener('click',async()=>{
    const text=input.value.trim(); if(!text||!cid) return;
    if(!enrolledCourseIds().includes(cid) && state.role==='student') return notify('Enroll to chat','warn');
    const p=state.profiles.find(x=>x.uid===myUid())||{};
    await col('messages').add({courseId:cid,uid:myUid(),email:auth.currentUser.email,name:p.name||'',text,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    input.value='';
  });
}

/* ---------- Tasks ---------- */
function wireTasks(){
  const root=$('[data-sec="tasks"]'); if(!root) return;
  $('#addTask')?.addEventListener('click',()=>{
    $('#mm-title').textContent='Task';
    $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
    $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal();
    $('#t-save').onclick=async()=>{ const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
      await col('tasks').add({uid:myUid(),title:t,status:'todo',createdAt:firebase.firestore.FieldValue.serverTimestamp()}); closeModal(); notify('Saved'); };
  });
  root.addEventListener('click',async e=>{
    const btn=e.target.closest('button'); if(!btn) return; const id=btn.getAttribute('data-edit')||btn.getAttribute('data-del'); if(!id) return;
    if(btn.hasAttribute('data-edit')){
      const s=await doc('tasks',id).get(); if(!s.exists) return; const t={id:s.id,...s.data()};
      $('#mm-title').textContent='Edit Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" value="${t.title||''}"/><select id="t-status" class="input">${['todo','inprogress','done'].map(x=>`<option ${t.status===x?'selected':''}>${x}</option>`).join('')}</select></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal();
      $('#t-save').onclick=async()=>{ await doc('tasks',id).set({title:$('#t-title')?.value.trim(),status:$('#t-status')?.value||'todo',updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); closeModal(); notify('Saved'); };
    }else{ await doc('tasks',id).delete(); notify('Deleted'); }
  });
  root.querySelectorAll('.task-card').forEach(card=>{
    card.setAttribute('draggable','true');
    card.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain',card.getAttribute('data-task')); card.classList.add('dragging');});
    card.addEventListener('dragend',()=>card.classList.remove('dragging'));
  });
  root.querySelectorAll('.lane-grid').forEach(grid=>{
    const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
    const show=e=>{e.preventDefault();row?.classList.add('drop');}; const hide=()=>row?.classList.remove('drop');
    grid.addEventListener('dragenter',show); grid.addEventListener('dragover',show); grid.addEventListener('dragleave',hide);
    grid.addEventListener('drop',async e=>{ e.preventDefault(); hide(); const id=e.dataTransfer.getData('text/plain'); if(!id) return; await doc('tasks',id).set({status:lane,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); });
  });
}

/* ---------- Profile ---------- */
function wireProfile(){
  $('#pf-pick')?.addEventListener('click',()=>$('#pf-avatar')?.click());
  $('#pf-picksign')?.addEventListener('click',()=>$('#pf-signimg')?.click());
  $('#pf-save')?.addEventListener('click',async()=>{
    const uid=myUid();
    await doc('profiles',uid).set({
      name:$('#pf-name')?.value.trim(), portfolio:$('#pf-portfolio')?.value.trim(), bio:$('#pf-bio')?.value.trim(), signName:$('#pf-signname')?.value.trim(),
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});
    const avatar=$('#pf-avatar')?.files?.[0]; if(avatar){ const ref=stg.ref().child(`avatars/${uid}/${avatar.name}`); await ref.put(avatar); const url=await ref.getDownloadURL(); await doc('profiles',uid).set({avatar:url},{merge:true}); }
    const sign=$('#pf-signimg')?.files?.[0]; if(sign){ const ref=stg.ref().child(`signatures/${uid}/${sign.name}`); await ref.put(sign); const url=await ref.getDownloadURL(); await doc('profiles',uid).set({signatureUrl:url},{merge:true}); }
    notify('Profile saved');
  });

  // certificate download
  $('#main').addEventListener('click',async e=>{
    const b=e.target.closest('button[data-cert]'); if(!b) return;
    const courseId=b.getAttribute('data-cert'); const course=state.courses.find(c=>c.id===courseId)||{};
    const p=state.profiles.find(x=>x.uid===myUid())||{name:auth.currentUser.email};
    generateCertificate(course,p);
  });
}

/* ---------- Admin ---------- */
function wireAdmin(){
  $('#rm-save')?.addEventListener('click',async()=>{
    const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
    if(!uid||!VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
    await doc('roles',uid).set({uid,role,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    notify('Role saved');
  });
}

/* ---------- Settings ---------- */
function wireSettings(){
  const pal=$('#theme-palette'), f=$('#theme-font');
  pal.value=state.theme.palette; f.value=state.theme.font;
  pal.addEventListener('change',e=>setTheme(e.target.value,null));
  f.addEventListener('change',e=>setTheme(null,e.target.value));
  $('#save-theme')?.addEventListener('click',()=>notify('Theme saved'));
}

/* ---------- Search page wiring ---------- */
function wireSearch(){
  $('#main')?.querySelectorAll('[data-open-route]').forEach(el=>{
    el.addEventListener('click',()=>{
      const r=el.getAttribute('data-open-route'), id=el.getAttribute('data-id'); state.highlightId=id; go(r);
    });
  });
}

/* ---------- Notifications (Announcements) ---------- */
function showNotificationsModal(){
  $('#mm-title').textContent='Notifications';
  const list=state.announcements.sort((a,b)=>b.createdAt?.toMillis?.()-a.createdAt?.toMillis?.());
  $('#mm-body').innerHTML = list.length? list.map(n=>`
    <div class="card"><div class="card-body">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><strong>${n.title||'Message'}</strong> <span class="muted" style="font-size:12px">• ${new Date(n.createdAt?.toDate?.()||n.createdAt||Date.now()).toLocaleString()}</span></div>
        ${!n.read? `<button class="btn ghost" data-read="${n.id}">Mark read</button>`:''}
      </div>
      <p style="margin:6px 0">${escapeHTML(n.text||'')}</p>
    </div></div>`).join('') : '<p class="muted">No notifications.</p>';
  $('#mm-foot').innerHTML=`<button class="btn ghost" id="close">Close</button>`;
  openModal();
  $('#close')?.addEventListener('click',closeModal);
  $('#mm-body').onclick=async e=>{
    const b=e.target.closest('button[data-read]'); if(!b) return;
    const id=b.getAttribute('data-read');
    await doc('announcements',id).set({readBy:firebase.firestore.FieldValue.arrayUnion(myUid())},{merge:true});
  };
}

/* ---------- Sync (listeners) ---------- */
function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
function sync(){
  clearUnsubs();
  state.unsub.push(col('profiles').onSnapshot(s=>{ state.profiles=s.docs.map(d=>({id:d.id,...d.data()})); if(['profile','admin','dashboard'].includes(state.route)) render(); }));
  state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(s=>{ state.courses=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); }));
  state.unsub.push(col('enrollments').where('uid','==',myUid()).onSnapshot(s=>{ state.enrollments=s.docs.map(d=>({id:d.id,...d.data()})); if(['dashboard','learning'].includes(state.route)) render(); }));
  state.unsub.push(col('finals').orderBy('createdAt','desc').onSnapshot(s=>{ state.finals=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments'].includes(state.route)) render(); }));
  state.unsub.push(col('attempts').where('uid','==',myUid()).orderBy('createdAt','desc').onSnapshot(s=>{ state.attempts=s.docs.map(d=>({id:d.id,...d.data()})); if(['assessments','profile','dashboard'].includes(state.route)) render(); }));
  state.unsub.push(col('tasks').where('uid','==',myUid()).onSnapshot(s=>{ state.tasks=s.docs.map(d=>({id:d.id,...d.data()})); if(['tasks'].includes(state.route)) render(); }));
  // announcements for me or my courses
  state.unsub.push(col('announcements').where('toUid','==',myUid()).onSnapshot(s=>{
    const items=s.docs.map(d=>({id:d.id,read: (d.data().readBy||[]).includes(myUid()), ...d.data()}));
    state.announcements = items;
    state.unread = items.filter(x=>!x.read).length;
    if(state.unread>0) notify(`You have ${state.unread} new message(s)`);
    if(['dashboard','courses','learning','assessments','profile','chat','tasks','settings','search'].includes(state.route)) render();
  }));
}

/* ---------- Role resolve ---------- */
async function resolveRole(uid,email){
  if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
  try{ const r=await doc('roles',uid).get(); const role=(r.data()?.role||'student').toLowerCase(); return VALID_ROLES.includes(role)?role:'student'; }
  catch{ return 'student'; }
}

/* ---------- Auth ---------- */
auth.onAuthStateChanged(async user=>{
  state.user=user||null;
  if(!user){ clearUnsubs(); render(); return; }
  state.role=await resolveRole(user.uid,user.email);
  try{
    const p=await doc('profiles',user.uid).get();
    if(!p.exists) await doc('profiles',user.uid).set({uid:user.uid,email:user.email,name:'',bio:'',portfolio:'',credits:0,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    else await doc('profiles',user.uid).set({role:state.role},{merge:true});
  }catch{}
  sync(); render();
});

/* ---------- Boot ---------- */
render();

/* ---------- Dev: seed helper in window ---------- */
window.seedSampleData=async function(){
  if(!auth.currentUser) return alert('Sign in first');
  const u=auth.currentUser;
  // A sample long course with video
  const outline=[{
    title:'Chapter 1: Getting Started',
    lessons:[
      {title:'Welcome', video:'https://www.w3schools.com/html/mov_bbb.mp4', html:'<h3>Welcome</h3><p>Intro content…</p>', images:[]},
      {title:'Numbers', video:'', html:'<p>Understanding numbers…</p>', images:[]}
    ]
  },{
    title:'Chapter 2: Algebra',
    lessons:[
      {title:'Equations', video:'https://www.youtube.com/watch?v=dQw4w9WgXcQ', html:'<p>ax + b = 0</p>', images:[]}
    ]
  }];
  const c1=await col('courses').add({title:'Algebra Basics',category:'Math',desc:'Equations, functions, factoring.',credit:3,outline,ownerUid:u.uid,ownerEmail:u.email,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  await col('enrollments').add({uid:u.uid,courseId:c1.id,createdAt:firebase.firestore.FieldValue.serverTimestamp(),course:{id:c1.id,title:'Algebra Basics',category:'Math'}});
  await col('finals').add({title:'Final — Algebra Basics',courseId:c1.id,courseTitle:'Algebra Basics',passScore:70,items:[
    {q:'2+2?',choices:['3','4','5'],answer:[1]},
    {q:'Solve: 5x=20. x=?',choices:['2','4','5'],answer:[1]}
  ],ownerUid:u.uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
  alert('Seeded: 1 course with outline, enrollment, and final.');
};

})();