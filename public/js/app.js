/* LearnHub v1.7 */
(() => {
  'use strict';

  // Firebase
  firebase.initializeApp(window.__FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db   = firebase.firestore();
  const stg  = firebase.storage();

  // App constants
  const ADMIN_EMAILS = ['admin@learnhub.com']; // Add your admin emails here
  const VALID_ROLES  = ['student','instructor','admin'];

  // Rotating “Daily Learning” YouTube pool (safe edu content)
  const DAILY_VIDS = [
    'H14bBuluwB8','8mAITcNt710','aircAruvnKk','c6I24S72Jps','yPWkPOfnGsw',
    '8mAITMB7u6A','qz0aGYrrlhU','O5nskjZ_GoI','sBws8MSXN7A','mU6anWqZJcc'
  ];

  // State
  const state = {
    user:null, role:'student', route:'dashboard',
    theme:{ palette:'dark', font:'medium' },
    profiles:[], courses:[], enrollments:[], quizzes:[], attempts:[], tasks:[], notes:[],
    announcements:[], messages:[],
    myEnrolledIds:new Set(), unsub:[], _unsubChat:null, highlightId:null
  };

  // Short helpers
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const col=name=>db.collection(name);
  const doc=(name,id)=>db.collection(name).doc(id);
  const safeTS = ts => ts && ts.toMillis ? ts.toMillis() : (typeof ts==='number'? ts : 0);
  const notify=(msg,type='ok')=>{
    const n=$('#notification'); if(!n) return;
    n.textContent=msg; n.className=`notification show ${type}`;
    setTimeout(()=>n.className='notification',2200);
  };
  const isAdmin = ()=> state.role==='admin';
  const isSelf = uid => auth.currentUser?.uid===uid;
  const canEditCourse = c => isAdmin() || c.ownerUid===auth.currentUser?.uid;
  const isEnrolled = id => state.myEnrolledIds.has(id);
  const canTakeQuiz = cid => isEnrolled(cid) || state.role!=='student';
  const todaySeed = ()=> Math.floor(Date.now()/86400000);

  const ytid = (url='')=>{
    try{
      const u=new URL(url);
      if(u.hostname.includes('youtu.be')) return u.pathname.replace('/','');
      if(u.hostname.includes('youtube.com')) return u.searchParams.get('v')||'';
    }catch{}
    return '';
  };

  // Layout
  function layout(content){ return `
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
          ].map(([r,txt,ic])=>`
            <div class="item ${state.route===r?'active':''} ${r==='admin'&&!isAdmin()?'hidden':''}" data-route="${r}">
              <i class="${ic}"></i><span>${txt}</span>
            </div>`).join('')}
        </div>
        <div class="footer"><div class="muted" id="copyright" style="font-size:12px"></div></div>
      </aside>

      <div>
        <div class="topbar">
          <div style="display:flex; align-items:center; gap:10px">
            <button class="btn ghost" id="burger"><i class="ri-menu-line"></i></button>
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
    </div></div>
    <div class="modal-backdrop" id="mb-modal"></div>
  `;}

  // Views
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

  const dailyVideos = ()=>{
    const seed=todaySeed();
    const shuffled=[...DAILY_VIDS].sort((a,b)=>((a.charCodeAt(0)+seed)%7)-((b.charCodeAt(0)+seed)%7));
    return shuffled.slice(0,3);
  };

  function vDashboard(){
    const my=auth.currentUser?.uid;
    const myEnroll=state.enrollments.filter(e=>e.uid===my).length;
    const myAttempts=state.attempts.filter(a=>a.uid===my).length;
    const myTasks=state.tasks.filter(t=>t.uid===my && t.status!=='done').length;
    const vids=dailyVideos();
    return `
      <div class="grid cols-4">
        ${dashCard('Courses', state.courses.length,'courses','ri-book-2-line')}
        ${dashCard('My Enrollments', myEnroll,'learning','ri-graduation-cap-line')}
        ${dashCard('Finals', state.quizzes.filter(q=>q.isFinal).length,'assessments','ri-award-line')}
        ${dashCard('Open Tasks', myTasks,'tasks','ri-list-check-2')}
      </div>

      <div class="card" style="margin-top:10px"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center">
          <h3 style="margin:0">Daily Learning</h3>
          <span class="muted" style="font-size:12px">Auto-rotates daily</span>
        </div>
        <div class="grid cols-3" style="margin-top:8px">
          ${vids.map(id=>`<div class="card"><div class="card-body">
            <iframe width="100%" height="180" src="https://www.youtube.com/embed/${id}" title="Video" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>
          </div></div>`).join('')}
        </div>
      </div></div>
    `;
  }

  function vCourses(){
    return `
      <div class="card"><div class="card-body">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <h3 style="margin:0">Courses</h3>
          <button class="btn" id="add-course"><i class="ri-add-line"></i> New Course</button>
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
          <button class="btn" id="new-final"><i class="ri-add-line"></i> New Final</button>
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
                  ${(q.ownerUid===auth.currentUser?.uid || isAdmin())? `<button class="btn ghost" data-edit="${q.id}"><i class="ri-edit-line"></i></button>`:''}
                </div>
              </div>
            </div>`).join('')}
          ${!finals.length? `<div class="muted" style="padding:10px">No finals yet.</div>`:''}
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

  function transcriptRows(uid){
    const byCourse={};
    (state.attempts||[]).filter(a=>a.uid===uid).forEach(a=>{
      const title=(state.courses.find(c=>c.id===a.courseId)||{}).title||a.courseId;
      byCourse[a.courseId]=byCourse[a.courseId]||{courseId:a.courseId, courseTitle:title, best:0, completed:false};
      byCourse[a.courseId].best = Math.max(byCourse[a.courseId].best, a.score||0);
      const q = state.quizzes.find(q=>q.courseId===a.courseId && q.isFinal);
      const pass = q ? (byCourse[a.courseId].best >= (q.passScore||70)) : false;
      byCourse[a.courseId].completed = pass;
    });
    return Object.values(byCourse).sort((a,b)=> a.courseTitle.localeCompare(b.courseTitle));
  }

  function vProfile(){
    const me = state.profiles.find(p=> (p.uid||p.id)===auth.currentUser?.uid) || {};
    const notes = (state.notes||[]).filter(n=>n.uid===auth.currentUser?.uid).sort((a,b)=>safeTS(b.createdAt)-safeTS(a.createdAt));
    const rows = transcriptRows(auth.currentUser?.uid);
    return `
      <div class="profile-wrap">
        <div class="card profile-card"><div class="card-body">
          <div style="display:flex; gap:12px; align-items:center">
            <div class="avatar">
              ${me.avatar? `<img src="${me.avatar}" referrerpolicy="no-referrer"
                   onerror="this.parentNode.innerHTML='<span>no avatar</span>'"
                   style="width:100%;height:100%;object-fit:cover">`
                 : '<span>no avatar</span>'}
            </div>
            <div>
              <div style="font-weight:900;font-size:20px">${me.name||'(no name)'}</div>
              <div class="muted" style="font-size:12px">${me.email||''}</div>
              ${me.portfolio? `<a href="${me.portfolio}" target="_blank" rel="noopener" class="chip" style="margin-top:6px"><i class="ri-link-m"/></i> Portfolio</a>`:''}
            </div>
          </div>

          <div class="line"></div>

          <div class="grid">
            <label>Name</label><input id="pf-name" class="input" value="${me.name||''}" placeholder="Your name"/>
            <label>Email</label><input id="pf-email" class="input" value="${me.email||auth.currentUser?.email||''}" placeholder="you@example.com"/>
            <label>Portfolio URL</label><input id="pf-portfolio" class="input" value="${me.portfolio||''}" placeholder="https://…"/>
            <label>Short bio</label><textarea id="pf-bio" class="input" placeholder="Tell us about you…">${me.bio||''}</textarea>
            <div class="grid cols-2">
              <div><label>Avatar (PNG/JPG/WEBP)</label><input id="pf-avatar" type="file" accept="image/*"/></div>
              <div><label>Signature (PNG/WEBP/JPG)</label><input id="pf-sign" type="file" accept="image/png,image/webp,image/jpeg"/></div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <button class="btn" id="pf-save"><i class="ri-save-3-line"></i> Save</button>
              <button class="btn ghost" id="pf-view"><i class="ri-id-card-line"></i> View card</button>
              <button class="btn danger" id="pf-delete"><i class="ri-delete-bin-6-line"></i> Delete profile</button>
            </div>
          </div>
        </div></div>

        <div class="grid">
          <div class="card"><div class="card-body">
            <h3 class="section-title"><i class="ri-file-list-2-line"></i> Transcript</h3>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Course</th><th>Best Score</th><th>Certificate</th></tr></thead>
                <tbody>
                  ${rows.map(r=>`
                    <tr>
                      <td>${r.courseTitle}</td>
                      <td class="num">${r.best}%</td>
                      <td>${r.completed? `<button class="btn" data-cert="${r.courseId}"><i class="ri-award-line"></i> Download</button>`:'—'}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div></div>

          <div class="card"><div class="card-body">
            <h3 class="section-title"><i class="ri-sticky-note-line"></i> My Notes</h3>
            ${notes.length? `
              <div class="table-wrap"><table class="table">
                <thead><tr><th>Course</th><th>Note</th><th>When</th></tr></thead>
                <tbody>
                  ${notes.map(n=>{
                    const course=state.courses.find(c=>c.id===n.courseId);
                    return `<tr>
                      <td>${course?.title||n.courseId}</td>
                      <td>${(n.text||'').replace(/</g,'&lt;')}</td>
                      <td class="muted">${new Date(n.createdAt?.toDate?.()||n.createdAt||Date.now()).toLocaleString()}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table></div>` : `<div class="muted">You haven’t added notes yet.</div>`}
          </div></div>
        </div>
      </div>
    `;
  }

  function vAdmin(){
    if(!isAdmin()) return `<div class="card"><div class="card-body">Admins only.</div></div>`;
    return `
      <div class="grid cols-2">
        <div class="card"><div class="card-body">
          <h3 style="margin:0 0 8px 0">Role Manager</h3>
          <div class="grid">
            <input id="rm-uid" class="input" placeholder="User UID"/>
            <select id="rm-role" class="input">${VALID_ROLES.map(r=>`<option value="${r}">${r}</option>`).join('')}</select>
            <button class="btn" id="rm-save"><i class="ri-save-3-line"></i> Save Role</button>
          </div>
          <div style="margin-top:8px">
            <button class="btn secondary" id="seed-demo"><i class="ri-magic-line"></i> Load Demo Data</button>
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
                <td>
                  <button class="btn ghost" data-edit-user="${p.uid||p.id}"><i class="ri-edit-line"></i></button>
                  <button class="btn danger" data-del-user="${p.uid||p.id}"><i class="ri-delete-bin-6-line"></i></button>
                </td>
              </tr>`).join('')}
            </tbody></table>
          </div>
        </div></div>
      </div>
    `;
  }

  function vSettings(){
    const palettes=['dark','sunrise','ocean','forest','grape'];
    const fonts=['small','medium','large'];
    return `
      <div class="card"><div class="card-body">
        <h3 style="margin:0 0 8px 0">Theme</h3>
        <div class="grid cols-2">
          <div><label>Palette</label>
            <select id="theme-palette" class="input">
              ${palettes.map(p=>`<option value="${p}" ${state.theme.palette===p?'selected':''}>${p}</option>`).join('')}
            </select>
          </div>
          <div><label>Font size</label>
            <select id="theme-font" class="input">
              ${fonts.map(f=>`<option value="${f}" ${state.theme.font===f?'selected':''}>${f}</option>`).join('')}
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
        <h3 class="guide-h" style="margin:0 0 8px 0"><i class="ri-lightbulb-flash-line"></i> Quick Guide (Step by Step)</h3>

        <div class="grid cols-2" style="margin-top:8px">
          <div class="card"><div class="card-body">
            <h4 class="guide-p" style="margin:0 0 6px 0"><i class="ri-user-3-line"></i> Students</h4>
            <ol style="margin:0; padding-left:18px; line-height:1.7">
              <li>Go to <b>Courses</b> → open a course → click <b>Enroll</b>.</li>
              <li>Each lesson shows <b>video</b>, <b>text</b>, <b>images</b>. Add private <b>Notes</b> at the bottom.</li>
              <li>Use <b>Course Chat</b> to ask your instructor.</li>
              <li>Take the <b>Final</b> in the <b>Finals</b> tab. Score shows instantly.</li>
              <li>Pass ≥ threshold? Open <b>Profile → Transcript</b> → <b>Download Certificate</b>.</li>
              <li>Track your tasks in <b>Tasks</b> and drag them across lanes.</li>
            </ol>
          </div></div>

          <div class="card"><div class="card-body">
            <h4 class="guide-p" style="margin:0 0 6px 0"><i class="ri-shield-star-line"></i> Instructors & Admin</h4>
            <ol style="margin:0; padding-left:18px; line-height:1.7">
              <li><b>Admin → Role Manager</b> to promote users to <b>instructor</b> or <b>admin</b>.</li>
              <li><b>Courses → New Course</b>: paste Outline JSON (video/text/images). Save.</li>
              <li><b>Finals → New Final</b>: create single or multi-select questions.</li>
              <li>Use <b>Course Chat</b> to broadcast tips or answer students.</li>
              <li>(Optional) Click <b>Load Demo Data</b> in Admin to prefill samples.</li>
            </ol>
          </div></div>
        </div>
      </div></div>
    `;
  }

  function render(){
    const root=$('#root');
    if(!auth.currentUser){ root.innerHTML=vLogin(); wireLogin(); return; }
    root.innerHTML = layout( viewFor(state.route) );
    wireShell(); wireRoute();
    if(state.highlightId){ const el=document.getElementById(state.highlightId); if(el){ el.scrollIntoView({behavior:'smooth',block:'center'});} }
  }
  function viewFor(r){
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

  // Common UI plumbing
  const openSidebar=()=>{ document.body.classList.add('sidebar-open'); $('#backdrop')?.classList.add('active'); };
  const closeSidebar=()=>{ document.body.classList.remove('sidebar-open'); $('#backdrop')?.classList.remove('active'); };
  function openModal(id){ $('#'+id)?.classList.add('active'); $('#mb-modal')?.classList.add('active'); }
  function closeModal(id){ $('#'+id)?.classList.remove('active'); $('#mb-modal')?.classList.remove('active'); }

  function wireShell(){
    $('#burger')?.addEventListener('click', ()=> document.body.classList.contains('sidebar-open')? closeSidebar(): openSidebar());
    $('#backdrop')?.addEventListener('click', closeSidebar);
    $('#brand')?.addEventListener('click', closeSidebar);
    $('#main')?.addEventListener('click', closeSidebar);
    $('#side-nav')?.addEventListener('click', e=>{
      const it=e.target.closest('.item[data-route]'); if(it){ state.highlightId=null; state.route=it.getAttribute('data-route'); render(); }
    });
    $('#btnLogout')?.addEventListener('click', ()=> auth.signOut());
    $('#mm-close')?.addEventListener('click', ()=> closeModal('m-modal'));
    $('#copyright')?.replaceChildren(document.createTextNode(`Powered by MM • ${new Date().getFullYear()}`));

    // quick search
    const input=$('#globalSearch'), results=$('#searchResults'); let t;
    const doSearch=(q)=>{
      const tok=(q||'').toLowerCase().split(/\s+/).filter(Boolean);
      const ix=[];
      state.courses.forEach(c=> ix.push({label:c.title, section:'Courses', route:'courses', id:c.id, text:`${c.title} ${c.category||''} ${c.short||''}`}));
      state.quizzes.forEach(q=> ix.push({label:q.title, section:'Finals', route:'assessments', id:q.id, text:q.courseTitle||''}));
      state.profiles.forEach(p=> ix.push({label:p.name||p.email||p.id, section:'Profiles', route:'profile', id:p.uid||p.id, text:(p.bio||'') + ' ' + (p.portfolio||'') }));
      if(!tok.length) return [];
      return ix.map(item=>{
        const l=item.label.toLowerCase(), t=(item.text||'').toLowerCase();
        const ok=tok.every(x=> l.includes(x)||t.includes(x));
        return ok?item:null;
      }).filter(Boolean).slice(0,12);
    };
    if(input && results){
      input.addEventListener('input', ()=>{
        clearTimeout(t);
        t=setTimeout(()=>{
          const out=doSearch(input.value.trim());
          if(!out.length){ results.classList.remove('active'); results.innerHTML=''; return; }
          results.innerHTML=out.map(r=>`<div class="row" data-route="${r.route}" data-id="${r.id||''}"><strong>${r.label}</strong> <span class="muted">— ${r.section}</span></div>`).join('');
          results.classList.add('active');
          results.querySelectorAll('.row').forEach(row=>{
            row.onclick=()=>{ const r=row.getAttribute('data-route'); const id=row.getAttribute('data-id'); state.highlightId=id; results.classList.remove('active'); state.route=r; render(); };
          });
        },120);
      });
      document.addEventListener('click', e=>{ if(!results.contains(e.target) && e.target!==input) results.classList.remove('active'); });
    }
  }

  // Login
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
        </div>
      </div></div>
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
      const email=$('#li-email')?.value.trim(); if(!email) return notify('Enter email first','warn');
      try{ await auth.sendPasswordResetEmail(email); notify('Reset sent'); }catch(e){ notify(e?.message||'Failed','danger'); }
    });
    $('#link-register')?.addEventListener('click', async ()=>{
      const email=$('#li-email')?.value.trim(); const pass=$('#li-pass')?.value.trim()||'admin123';
      if(!email) return notify('Enter email, then click again','warn');
      try{
        const cred=await auth.createUserWithEmailAndPassword(email, pass);
        const uid=cred.user.uid;
        const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? 'admin' : 'student';
        await Promise.all([
          doc('roles', uid).set({ uid, email, role, createdAt:firebase.firestore.FieldValue.serverTimestamp() }),
          doc('profiles', uid).set({ uid, email, name:(email.split('@')[0]), bio:'', portfolio:'', avatar:'', signature:'', role, createdAt:firebase.firestore.FieldValue.serverTimestamp() })
        ]);
        notify('Account created — sign in now.');
        await auth.signOut();
      }catch(e){ notify(e?.message||'Signup failed','danger'); }
    });
  }

  // Outline rendering (video/text/images + notes)
  function parseOutline(str){ try{ const v=JSON.parse(str||'[]'); return Array.isArray(v)? v : []; }catch{return [];} }
  function imgTag(src){
    if(!/^https?:\/\//i.test(src||'')) return `<div class="muted" style="font-size:12px">Image URL invalid. Skipped.</div>`;
    const esc = src.replace(/"/g,'&quot;');
    return `<img src="${esc}" referrerpolicy="no-referrer"
      onerror="this.style.display='none'; const m=document.createElement('div'); m.className='muted'; m.style.fontSize='12px'; m.textContent='(image unavailable)'; this.parentNode.appendChild(m)"
      style="border-radius:12px; margin-top:6px">`;
  }
  const yta = id => `<iframe width="100%" height="320" src="https://www.youtube.com/embed/${id}" title="Video" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
  function renderCourseBody(c,enrolled){
    const outline=parseOutline(c.outline);
    return outline.map((ch,ci)=>`
      <div class="card"><div class="card-body">
        <div style="font-weight:800">Chapter ${ci+1}. ${ch.title||''}</div>
        <div class="grid" style="margin-top:6px">
          ${(ch.lessons||[]).map((ls,li)=>`
            <div class="card"><div class="card-body">
              <div style="font-weight:700">${ls.title||''}</div>
              ${ls.video && ytid(ls.video)? `<div style="margin:8px 0">${yta(ytid(ls.video))}</div>`:''}
              ${ls.audio? `<audio controls style="width:100%; margin:6px 0"><source src="${ls.audio}" type="audio/mpeg">Your browser does not support audio</audio>`:''}
              ${ls.html? `<div style="white-space:pre-wrap">${ls.html}</div>`:''}
              ${(ls.images||[]).map(src=> imgTag(src)).join('')}
              ${enrolled? `<div style="margin-top:8px">
                <input id="note-${c.id}-${ci}-${li}" class="input" placeholder="Sticky note…"/>
                <button class="btn" data-save-note="${c.id}" data-ci="${ci}" data-li="${li}"><i class="ri-sticky-note-line"></i> Save note</button>
              </div>`:''}
            </div></div>
          `).join('')}
        </div>
      </div></div>
    `).join('') || '<div class="muted">No outline yet.</div>';
  }

  // Courses wiring
  function wireCourses(){
    $('#add-course')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='New Course';
      $('#mm-body').innerHTML=`
        <div class="grid">
          <input id="c-title" class="input" placeholder="Title"/>
          <input id="c-category" class="input" placeholder="Category (e.g., Math)"/>
          <input id="c-credits" class="input" type="number" value="3" placeholder="Credits"/>
          <input id="c-short" class="input" placeholder="Short description"/>
          <label>Outline JSON</label>
          <textarea id="c-outline" class="input" placeholder='[{"title":"Chapter 1","lessons":[{"title":"Intro","video":"https://youtu.be/...","html":"Welcome","images":["https://…"]}]}]'></textarea>
        </div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="c-save">Save</button>`;
      openModal('m-modal');

      $('#c-save').onclick=async ()=>{
        const t=$('#c-title')?.value.trim(); if(!t) return notify('Title required','warn');
        const obj={ title:t, category:$('#c-category')?.value.trim(), credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(), outline:$('#c-outline')?.value.trim(),
          ownerUid:auth.currentUser.uid, ownerEmail:auth.currentUser.email, createdAt:firebase.firestore.FieldValue.serverTimestamp() };
        try{
          await col('courses').add(obj);
          closeModal('m-modal'); notify('Course saved');
        }catch(e){ console.warn(e); notify('Save blocked by rules. Please deploy the rules provided.', 'danger'); }
      };
    });

    const sec=$('[data-sec="courses"]'); if(!sec||sec.__wired) return; sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const openBtn=e.target.closest('button[data-open]'); const editBtn=e.target.closest('button[data-edit]');
      if(openBtn){
        const id=openBtn.getAttribute('data-open'); const snap=await doc('courses',id).get(); if(!snap.exists) return;
        const c={id:snap.id, ...snap.data()}; const enrolled=isEnrolled(c.id);
        $('#mm-title').textContent=c.title;
        $('#mm-body').innerHTML=renderCourseBody(c,enrolled);
        $('#mm-foot').innerHTML=`
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            ${!enrolled? `<button class="btn" id="enroll"><i class="ri-checkbox-circle-line"></i> Enroll</button>` : `<button class="btn ok" disabled>Enrolled</button>`}
            <button class="btn ghost" id="open-final"><i class="ri-award-line"></i> Final exam</button>
          </div>`;
        openModal('m-modal');

        $('#enroll')?.addEventListener('click', async ()=>{
          await col('enrollments').add({
            uid:auth.currentUser.uid, courseId:c.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(),
            course:{id:c.id, title:c.title, category:c.category, credits:c.credits||0}
          });
          closeModal('m-modal'); notify('Enrolled');
        });
        $('#open-final')?.addEventListener('click', ()=>{ state.highlightId=c.id; state.route='assessments'; render(); });

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
        const c={id:snap.id, ...snap.data()}; if(!canEditCourse(c)) return notify('No permission (only author/admin)', 'warn');
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
        $('#mm-foot').innerHTML=`
          <button class="btn danger" id="c-del"><i class="ri-delete-bin-6-line"></i> Delete</button>
          <button class="btn" id="c-save">Save</button>`;
        openModal('m-modal');
        $('#c-save').onclick=async ()=>{
          await doc('courses', id).set({
            title:$('#c-title')?.value.trim(), category:$('#c-category')?.value.trim(),
            credits:+($('#c-credits')?.value||0), short:$('#c-short')?.value.trim(), outline:$('#c-outline')?.value.trim(),
            updatedAt:firebase.firestore.FieldValue.serverTimestamp()
          },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
        $('#c-del').onclick=async ()=>{ await doc('courses',id).delete(); closeModal('m-modal'); notify('Deleted'); };
      }
    });
  }

  // Learning
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

  // Finals
  function wireAssessments(){
    $('#new-final')?.addEventListener('click', ()=>{
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
        try{
          await col('quizzes').add({ title:t, courseId, courseTitle:course.title, passScore:pass, isFinal:!!isFinal, items, ownerUid:auth.currentUser.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
          closeModal('m-modal'); notify('Final saved');
        }catch(e){ console.warn(e); notify('Save blocked by rules.', 'danger'); }
      };
    });

    const sec=$('[data-sec="quizzes"]'); if(!sec||sec.__wired) return; sec.__wired=true;
    sec.addEventListener('click', async (e)=>{
      const take=e.target.closest('button[data-take]'); const edit=e.target.closest('button[data-edit]');
      if(take){
        const id=take.getAttribute('data-take'); const snap=await doc('quizzes',id).get(); if(!snap.exists) return;
        const q={id:snap.id,...snap.data()};
        if(!canTakeQuiz(q.courseId)) return notify('Enroll first to take','warn');
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
        const q={id:snap.id,...snap.data()}; if(!(q.ownerUid===auth.currentUser?.uid || isAdmin())) return notify('No permission','warn');
        $('#mm-title').textContent='Edit Final';
        $('#mm-body').innerHTML=`
          <div class="grid">
            <input id="q-title" class="input" value="${q.title||''}"/>
            <input id="q-pass" class="input" type="number" value="${q.passScore||70}"/>
            <label><input type="checkbox" id="q-final" ${q.isFinal?'checked':''}/> This is final exam</label>
            <textarea id="q-json" class="input">${JSON.stringify(q.items||[],null,2)}</textarea>
          </div>`;
        $('#mm-foot').innerHTML=`
          <button class="btn danger" id="q-del"><i class="ri-delete-bin-6-line"></i> Delete</button>
          <button class="btn" id="q-save">Save</button>`;
        openModal('m-modal');
        $('#q-save').onclick=async ()=>{
          let items=[]; try{ items=JSON.parse($('#q-json')?.value||'[]'); }catch{ return notify('Invalid JSON','danger'); }
          await doc('quizzes',id).set({ title:$('#q-title')?.value.trim(), passScore:+($('#q-pass')?.value||70), isFinal:$('#q-final')?.checked, items, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          closeModal('m-modal'); notify('Saved');
        };
        $('#q-del').onclick=async ()=>{ await doc('quizzes',id).delete(); closeModal('m-modal'); notify('Deleted'); };
      }
    });
  }

  // Chat
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
      const pSnap = await doc('profiles', auth.currentUser.uid).get(); const p=pSnap.data()||{};
      await col('messages').add({ courseId:cid, uid:auth.currentUser.uid, email:auth.currentUser.email, name:p.name||'', text, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
      input.value='';
    });
  }

  // Tasks
  function wireTasks(){
    const root=$('[data-sec="tasks"]'); if(!root) return;

    $('#addTask')?.addEventListener('click', ()=>{
      $('#mm-title').textContent='Task';
      $('#mm-body').innerHTML=`<div class="grid"><input id="t-title" class="input" placeholder="Title"/></div>`;
      $('#mm-foot').innerHTML=`<button class="btn" id="t-save">Save</button>`; openModal('m-modal');
      $('#t-save').onclick=async ()=>{
        const t=$('#t-title')?.value.trim(); if(!t) return notify('Title required','warn');
        try{
          await col('tasks').add({ uid:auth.currentUser.uid, title:t, status:'todo', createdAt:firebase.firestore.FieldValue.serverTimestamp() });
          closeModal('m-modal'); notify('Saved');
        }catch(e){ notify('Permission denied (check Firestore rules for /tasks)', 'danger'); }
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
          try{
            await doc('tasks',id).set({ title:$('#t-title')?.value.trim(), status:$('#t-status')?.value||'todo', updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
            closeModal('m-modal'); notify('Saved');
          }catch(e){ notify('Permission denied (check Firestore rules for /tasks)', 'danger'); }
        };
      } else {
        try{ await doc('tasks',id).delete(); notify('Deleted'); }catch(e){ notify('Permission denied (check Firestore rules for /tasks)', 'danger'); }
      }
    });

    // Drag & drop lanes with highlight
    root.querySelectorAll('.task-card').forEach(card=>{
      card.setAttribute('draggable','true'); card.addEventListener('dragstart', e=>{ e.dataTransfer.setData('text/plain', card.getAttribute('data-task')); card.classList.add('dragging'); });
      card.addEventListener('dragend', ()=> card.classList.remove('dragging'));
    });
    root.querySelectorAll('.lane-grid').forEach(grid=>{
      const row=grid.closest('.lane-row'); const lane=row?.getAttribute('data-lane');
      const show=e=>{ e.preventDefault(); row?.classList.add('drop'); }; const hide=()=> row?.classList.remove('drop');
      grid.addEventListener('dragenter', show); grid.addEventListener('dragover', show); grid.addEventListener('dragleave', hide);
      grid.addEventListener('drop', async (e)=>{ e.preventDefault(); hide(); const id=e.dataTransfer.getData('text/plain'); if(!id) return;
        try{ await doc('tasks',id).set({ status:lane, updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); }
        catch(ex){ notify('Permission denied (check Firestore rules for /tasks)', 'danger'); }
      });
    });
  }

  // Profile wiring (save / view / delete / certificate)
  function wireProfile(){
    $('#pf-save')?.addEventListener('click', async ()=>{
      try{
        const uid=auth.currentUser.uid;
        await doc('profiles',uid).set({
          name:$('#pf-name')?.value.trim(),
          email:$('#pf-email')?.value.trim(),
          portfolio:$('#pf-portfolio')?.value.trim(),
          bio:$('#pf-bio')?.value.trim(),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp()
        },{merge:true});

        const up = async (inputSel, folder, field)=>{
          const f=$(inputSel)?.files?.[0]; if(!f) return null;
          const ref=stg.ref().child(`${folder}/${uid}/${Date.now()}_${f.name}`);
          await ref.put(f); const url=await ref.getDownloadURL();
          await doc('profiles',uid).set({ [field]: url },{merge:true}); return url;
        };
        const avatarUrl = await up('#pf-avatar','avatars','avatar');
        const signUrl   = await up('#pf-sign','signatures','signature');

        // local state refresh
        const idx = state.profiles.findIndex(p=> (p.uid||p.id)===uid);
        if(idx>=0){
          state.profiles[idx] = { ...state.profiles[idx],
            name:$('#pf-name').value.trim(), email:$('#pf-email').value.trim(),
            portfolio:$('#pf-portfolio').value.trim(), bio:$('#pf-bio').value.trim(),
            ...(avatarUrl?{avatar:avatarUrl}:{}) , ...(signUrl?{signature:signUrl}:{})
          };
        }
        if ($('#pf-avatar')) $('#pf-avatar').value='';
        if ($('#pf-sign')) $('#pf-sign').value='';
        notify('Profile saved');
      }catch(e){
        notify('Permission denied: you can only edit your own profile. Admins can edit others in Admin → Users.', 'danger');
      }
    });

    $('#pf-delete')?.addEventListener('click', async ()=>{
      if(!confirm('Delete your profile doc? (Auth account NOT deleted)')) return;
      try{ await doc('profiles', auth.currentUser.uid).delete(); notify('Profile doc deleted'); render(); }
      catch(e){ notify('Permission denied. (Admins or self can delete)', 'danger'); }
    });

    $('#pf-view')?.addEventListener('click', async ()=>{
      const pSnap = await doc('profiles', auth.currentUser.uid).get();
      const me = pSnap.data() || state.profiles.find(p=> (p.uid||p.id)===auth.currentUser?.uid) || {};
      $('#mm-title').textContent='My Profile Card';
      $('#mm-body').innerHTML=`
        <div class="card"><div class="card-body">
          <div style="display:flex; gap:12px; align-items:center">
            <div style="width:84px;height:84px;border-radius:50%;overflow:hidden;background:#222">
              ${me.avatar? `<img src="${me.avatar}" referrerpolicy="no-referrer"
                onerror="this.parentNode.innerHTML='<div class=&quot;muted&quot; style=&quot;font-size:12px;display:grid;place-items:center;height:100%&quot;>(avatar unavailable)</div>'"
                style="width:100%;height:100%;object-fit:cover">`
                : '<div class="muted" style="font-size:12px;display:grid;place-items:center;height:100%">no avatar</div>'}
            </div>
            <div>
              <div style="font-weight:900;font-size:20px">${me.name||'(no name)'}</div>
              <div class="muted" style="font-size:12px">${me.email||''}</div>
              ${me.portfolio? `<a href="${me.portfolio}" target="_blank" rel="noopener" class="chip" style="margin-top:6px"><i class="ri-link-m"/></i> Portfolio</a>`:''}
            </div>
          </div>
          ${me.bio? `<div class="muted" style="margin-top:8px">${me.bio}</div>`:''}
          ${me.signature? `<div style="margin-top:12px"><div class="muted" style="font-size:12px">Signature</div>
             <img src="${me.signature}" referrerpolicy="no-referrer"
              onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<div class=&quot;muted&quot; style=&quot;font-size:12px&quot;>(signature unavailable)</div>')"
              style="height:52px"></div>`:''}
        </div></div>
      `;
      $('#mm-foot').innerHTML=`<button class="btn ghost" id="mm-ok">Close</button>`;
      openModal('m-modal');
      $('#mm-ok').onclick=()=> closeModal('m-modal');
    });

    // certificate download
    $('#main').addEventListener('click', async (e)=>{
      const b=e.target.closest('button[data-cert]'); if(!b) return;
      const courseId=b.getAttribute('data-cert');
      const course=state.courses.find(c=>c.id===courseId)||{};
      const pSnap = await doc('profiles', auth.currentUser.uid).get();
      const p = pSnap.data()||{name:auth.currentUser.email};
      const canvas=document.createElement('canvas'); canvas.width=1400; canvas.height=900;
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#0b0d10'; ctx.fillRect(0,0,1400,900);
      ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=8; ctx.strokeRect(40,40,1320,820);
      ctx.strokeStyle='#153654'; ctx.lineWidth=2; ctx.strokeRect(60,60,1280,780);
      ctx.fillStyle='#fff';
      ctx.font='bold 56px Inter'; ctx.fillText('Certificate of Completion', 360, 200);
      ctx.font='28px Inter'; ctx.fillText(`Awarded to: ${p.name||p.email}`, 260, 280);
      ctx.fillText(`Course: ${course.title||courseId}`, 260, 330);
      ctx.fillText(`Date: ${new Date().toLocaleDateString()}`, 260, 380);
      ctx.beginPath(); ctx.moveTo(260, 560); ctx.lineTo(620,560); ctx.strokeStyle='#7ad3ff'; ctx.lineWidth=2; ctx.stroke();
      ctx.font='20px Inter'; ctx.fillText('Authorized Signature', 360, 590);
      const after=()=>{ ctx.fillStyle='#7ad3ff'; ctx.font='bold 32px Inter'; ctx.fillText('LearnHub', 1080, 760);
        const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`certificate_${course.title||courseId}.png`; a.click(); };
      if (p.signature){ const img=new Image(); img.referrerPolicy='no-referrer'; img.onload=()=>{ ctx.drawImage(img,260,480,240,80); after(); }; img.onerror=after; img.src=p.signature; } else { after(); }
    });
  }

  // Admin wiring (edit/delete user, seed demo data)
  function wireAdmin(){
    $('#rm-save')?.addEventListener('click', async ()=>{
      const uid=$('#rm-uid')?.value.trim(); const role=$('#rm-role')?.value||'student';
      if(!uid || !VALID_ROLES.includes(role)) return notify('Enter UID + valid role','warn');
      await doc('roles',uid).set({ uid, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      await doc('profiles',uid).set({ role },{merge:true});
      notify('Role saved');
    });

    $('#seed-demo')?.addEventListener('click', async ()=>{
      const u=auth.currentUser; if(!u) return;
      // Sample outline with text, audio, video, image
      const outline=[{
        title:"Chapter 1: Basics",
        lessons:[
          { title:"Welcome", video:"https://www.youtube.com/watch?v=H14bBuluwB8", html:"Welcome to the course! This lesson introduces goals and structure.", images:["https://images.unsplash.com/photo-1529070538774-1843cb3265df?q=80&w=1200&auto=format&fit=crop"], audio:"https://samplelib.com/lib/preview/mp3/sample-3s.mp3" },
          { title:"Numbers", html:"Understanding numbers, sets, and operations.\n\nKey terms: integers, rationals, reals.", images:[] }
        ]
      },{
        title:"Chapter 2: Algebra",
        lessons:[
          { title:"Equations", html:"Solve ax + b = 0 → x = -b/a\nPractice problems in the final." }
        ]
      }];
      const cRef = await col('courses').add({
        title:'Algebra Basics', category:'Math', credits:3, short:'Equations, functions, factoring.',
        outline:JSON.stringify(outline), ownerUid:u.uid, ownerEmail:u.email,
        createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      await col('enrollments').add({ uid:u.uid, courseId:cRef.id, createdAt:firebase.firestore.FieldValue.serverTimestamp(),
        course:{id:cRef.id, title:'Algebra Basics', category:'Math', credits:3} });

      await col('quizzes').add({
        title:'Algebra Final', courseId:cRef.id, courseTitle:'Algebra Basics', passScore:70, isFinal:true,
        items:[
          { q:'2+2?', choices:['3','4','5'], answer:1 },
          { q:'Which are solutions to 2x=10?', choices:['x=2','x=5','x=10'], answers:[1] },
          { q:'Select prime numbers', choices:['4','5','7','9'], answers:[1,2] }
        ],
        ownerUid:u.uid, createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });

      // Sample chat
      await Promise.all([
        col('messages').add({ courseId:cRef.id, uid:u.uid, email:u.email, name:'Admin', text:'Welcome to Algebra Basics!', createdAt:firebase.firestore.FieldValue.serverTimestamp() }),
        col('messages').add({ courseId:cRef.id, uid:u.uid, email:u.email, name:'Admin', text:'Ask anything in this chat.', createdAt:firebase.firestore.FieldValue.serverTimestamp() })
      ]);

      notify('Demo data loaded');
    });

    $('#main')?.addEventListener('click', async (e)=>{
      const editBtn = e.target.closest('button[data-edit-user]');
      const delBtn  = e.target.closest('button[data-del-user]');
      if(editBtn){
        const uid = editBtn.getAttribute('data-edit-user');
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
        $('#mm-foot').innerHTML = `
          <button class="btn danger" id="eu-del"><i class="ri-delete-bin-6-line"></i> Delete</button>
          <button class="btn" id="eu-save"><i class="ri-save-3-line"></i> Save</button>`;
        openModal('m-modal');

        $('#eu-save')?.addEventListener('click', async ()=>{
          const name = $('#eu-name')?.value.trim();
          const email = $('#eu-email')?.value.trim();
          const role = $('#eu-role')?.value;
          await doc('profiles',uid).set({ name, email, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          await doc('roles',uid).set({ uid, email, role, updatedAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
          notify('User updated'); closeModal('m-modal');
        });

        $('#eu-del')?.addEventListener('click', async ()=>{
          if(!confirm('Delete this user’s profile & role? (Auth user not deleted)')) return;
          await Promise.allSettled([ doc('profiles',uid).delete(), doc('roles',uid).delete() ]);
          notify('Profile & role removed'); closeModal('m-modal');
        });
      }
      if(delBtn){
        const uid = delBtn.getAttribute('data-del-user');
        if(!confirm('Delete this user’s profile & role?')) return;
        await Promise.allSettled([ doc('profiles',uid).delete(), doc('roles',uid).delete() ]);
        notify('Profile & role removed');
      }
    });
  }

  // Settings
  function applyTheme(){
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

    const f=state.theme.font; const size = f==='small' ? '14px' : (f==='large' ? '17px' : '16px');
    root.style.setProperty('--base-font-size', size);
  }
  function wireSettings(){
    $('#theme-palette')?.addEventListener('change', e=>{ state.theme.palette=e.target.value; applyTheme(); });
    $('#theme-font')?.addEventListener('change', e=>{ state.theme.font=e.target.value; applyTheme(); });
    $('#save-theme')?.addEventListener('click', ()=> notify('Theme saved'));
  }

  // Sync
  function clearUnsubs(){ state.unsub.forEach(u=>{try{u()}catch{}}); state.unsub=[]; }
  function sync(){
    clearUnsubs();
    const uid=auth.currentUser.uid;

    state.unsub.push(col('profiles').onSnapshot(
      s => { state.profiles = s.docs.map(d=>({id:d.id, ...d.data()})); if(['profile','admin'].includes(state.route)) render(); },
      err => console.warn('profiles listener error:', err)
    ));

    state.unsub.push(col('enrollments').where('uid','==',uid).onSnapshot(s=>{
      state.enrollments=s.docs.map(d=>({id:d.id,...d.data()}));
      state.myEnrolledIds = new Set(state.enrollments.map(e=>e.courseId));
      if(['dashboard','learning','assessments','chat'].includes(state.route)) render();
    }));

    state.unsub.push(col('courses').orderBy('createdAt','desc').onSnapshot(
      s => { state.courses = s.docs.map(d=>({id:d.id, ...d.data()})); if(['dashboard','courses','learning','assessments','chat'].includes(state.route)) render(); },
      err => console.warn('courses listener error:', err)
    ));

    state.unsub.push(col('quizzes').orderBy('createdAt','desc').onSnapshot(
      s => { state.quizzes = s.docs.map(d=>({id:d.id, ...d.data()})); if(['assessments','dashboard','profile'].includes(state.route)) render(); },
      err => console.warn('quizzes listener error:', err)
    ));

    state.unsub.push(col('attempts').where('uid','==',uid).onSnapshot(
      s => {
        state.attempts = s.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>safeTS(b.createdAt)-safeTS(a.createdAt));
        if(['assessments','profile','dashboard'].includes(state.route)) render();
      },
      err => console.warn('attempts listener error:', err)
    ));

    state.unsub.push(col('tasks').where('uid','==',uid).onSnapshot(
      s => { state.tasks = s.docs.map(d=>({id:d.id, ...d.data()})); if(['tasks','dashboard'].includes(state.route)) render(); },
      err => console.warn('tasks listener error:', err)
    ));

    state.unsub.push(col('notes').where('uid','==',uid).onSnapshot(s=>{
      state.notes=s.docs.map(d=>({id:d.id,...d.data()})); if(state.route==='profile') render();
    }));
  }

  async function resolveRole(uid,email){
    if(ADMIN_EMAILS.includes((email||'').toLowerCase())) return 'admin';
    try{
      const r=await doc('roles',uid).get(); const role=(r.data()?.role||'student').toLowerCase();
      return VALID_ROLES.includes(role)?role:'student';
    }catch{return 'student';}
  }

  auth.onAuthStateChanged(async (user)=>{
    state.user=user||null;
    if(!user){ clearUnsubs(); render(); return; }
    state.role = await resolveRole(user.uid, user.email);

    try{
      const pRef=doc('profiles',user.uid);
      const pSnap=await pRef.get();
      const fallbackName = user.displayName || (user.email ? user.email.split('@')[0] : 'User');
      if(!pSnap.exists){
        await pRef.set({ uid:user.uid, email:user.email||'', name:fallbackName, bio:'', portfolio:'', avatar:'', signature:'', role:state.role, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      }else{
        const cur=pSnap.data()||{}; const patch={role:state.role};
        if(!cur.email && user.email) patch.email=user.email;
        if(!cur.name) patch.name=fallbackName;
        if(Object.keys(patch).length) await pRef.set(patch,{merge:true});
      }
    }catch{}

    sync(); applyTheme(); render();
  });

  applyTheme();
  render();
})();