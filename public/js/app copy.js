/* LearnHub — E‑Learning SPA (starter) */
(()=>{'use strict';
if(!window.firebase||!window.__FIREBASE_CONFIG){console.error('Firebase SDK or config missing.')}
firebase.initializeApp(window.__FIREBASE_CONFIG);
const auth=firebase.auth();const db=firebase.firestore();try{firebase.storage()}catch{}
const ADMIN_EMAILS=['admin@learnhub.com'];const VALID_ROLES=['user','associate','manager','admin'];
const state={user:null,role:'user',route:'dashboard'};
const $=(s,r=document)=>r.querySelector(s);
const notify=(m,t='ok')=>{let n=$('#notification');if(!n){n=document.createElement('div');n.id='notification';n.className='notification';document.body.appendChild(n)}n.textContent=m;n.className=`notification show ${t}`;setTimeout(()=>n.className='notification',2200)};

function layout(content){return `<div class="app">
<aside class="sidebar" id="sidebar">
<div class="brand" id="brand"><div class="logo"><img src="/assets/learnhub-mark.svg" alt="LearnHub"/></div><div class="title">LearnHub</div></div>
<div class="nav" id="side-nav">
${[['dashboard','Dashboard','ri-dashboard-line']].map(([r,l,ic])=>`<div class="item ${state.route===r?'active':''}" data-route="${r}"><i class="${ic}"></i><span>${l}</span></div>`).join('')}
</div>
<div class="footer"><div class="muted" style="font-size:12px">© ${new Date().getFullYear()} LearnHub</div></div>
</aside>
<div>
  <div class="topbar"><div style="display:flex;align-items:center;gap:10px">
    <button class="btn ghost" id="burger"><i class="ri-menu-line"></i></button>
    <div class="badge"><i class="ri-shield-user-line"></i> ${state.role.toUpperCase()}</div>
  </div>
  <div style="display:flex;gap:8px"><button class="btn ghost" id="btnLogout"><i class="ri-logout-box-r-line"></i> Logout</button></div></div>
  <div class="backdrop" id="backdrop"></div>
  <div class="main" id="main">${content}</div>
</div>
</div>
<div class="modal" id="m-modal"><div class="dialog"><div class="head"><strong id="mm-title">Modal</strong><button class="btn ghost" id="mm-close">Close</button></div><div class="body" id="mm-body"></div><div class="foot" id="mm-foot"></div></div></div><div class="modal-backdrop" id="mb-modal"></div>`}

function viewLogin(){return `<div style="display:grid;place-items:center;min-height:100vh;padding:20px">
  <div class="card" style="width:min(420px,96vw)"><div class="card-body">
  <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">
    <div class="logo" style="width:44px;height:44px;overflow:hidden;border-radius:12px;background:#0c1626;display:grid;place-items:center">
      <img src="/assets/learnhub-mark.svg" alt="LearnHub" style="width:100%;height:100%;object-fit:cover"/>
    </div>
    <div><div style="font-size:20px;font-weight:800">LearnHub</div><div style="color:var(--muted)">Sign in to continue</div></div>
  </div>
  <div style="display:grid;gap:10px">
    <label>Email</label><input id="li-email" class="input" type="email" placeholder="you@example.com"/>
    <label>Password</label><input id="li-pass" class="input" type="password" placeholder="••••••••"/>
    <button id="btnLogin" class="btn"><i class="ri-login-box-line"></i> Sign In</button>
    <div style="display:flex;justify-content:space-between;gap:8px">
      <button id="link-forgot" class="btn ghost" style="padding:6px 10px;font-size:12px"><i class="ri-key-2-line"></i> Forgot password</button>
      <button id="link-register" class="btn" style="padding:6px 10px;font-size:12px;background:linear-gradient(90deg,#2cc5e3,#7ad3ff);color:#0b0d10"><i class="ri-user-add-line"></i> Sign up</button>
    </div>
    <div class="muted" style="font-size:12px;margin-top:6px">Default admin — admin@learnhub.com / admin123</div>
  </div></div></div></div>`}

function viewDashboard(){return `<div class="card"><div class="card-body"><h3 style="margin:0 0 8px 0">Welcome</h3><div style="color:var(--muted)">Starter is running. Wire your features in <code>app.js</code>.</div></div></div>`}

function render(){const root=document.getElementById('root'); if(!auth.currentUser){root.innerHTML=viewLogin(); wireLogin(); return;}
  root.innerHTML=layout(viewDashboard()); wireShell();}

function openSidebar(){document.body.classList.add('sidebar-open'); document.getElementById('backdrop')?.classList.add('active')}
function closeSidebar(){document.body.classList.remove('sidebar-open'); document.getElementById('backdrop')?.classList.remove('active')}

function wireShell(){
  document.getElementById('burger')?.addEventListener('click',()=>{document.body.classList.contains('sidebar-open')?closeSidebar():openSidebar()});
  document.getElementById('backdrop')?.addEventListener('click',closeSidebar);
  document.getElementById('brand')?.addEventListener('click',closeSidebar);
  document.getElementById('main')?.addEventListener('click',closeSidebar);
  document.getElementById('btnLogout')?.addEventListener('click',()=>auth.signOut());
  document.getElementById('side-nav')?.addEventListener('click',(e)=>{const it=e.target.closest('.item[data-route]'); if(it){ state.route=it.getAttribute('data-route'); closeSidebar(); render(); }});
}

function resolveRole(emailLower){ if(ADMIN_EMAILS.includes(emailLower)) return Promise.resolve('admin');
  return firebase.firestore().collection('userRegistry').doc(emailLower).get()
    .then(s=>{const role=(s.data()?.role||'user').toLowerCase(); return VALID_ROLES.includes(role)?role:'user'})
    .catch(()=> 'user');}

function wireLogin(){
  const doLogin=async()=>{const email=(document.getElementById('li-email')?.value||'').trim(); const pass=(document.getElementById('li-pass')?.value||'').trim();
    if(!email||!pass) return notify('Enter email & password','warn');
    try{await auth.signInWithEmailAndPassword(email,pass)}catch(e){notify(e?.message||'Login failed','danger')}};
  document.getElementById('btnLogin')?.addEventListener('click',doLogin);
  document.getElementById('li-pass')?.addEventListener('keydown',e=>{if(e.key==='Enter') doLogin()});
  document.getElementById('link-forgot')?.addEventListener('click',async()=>{const email=(document.getElementById('li-email')?.value||'').trim();
    if(!email) return notify('Enter your email first','warn'); try{await auth.sendPasswordResetEmail(email); notify('Reset email sent','ok')}catch(e){notify(e?.message||'Failed','danger')}});
  document.getElementById('link-register')?.addEventListener('click',async()=>{
    const email=(document.getElementById('li-email')?.value||'').trim(); const pass=(document.getElementById('li-pass')?.value||'').trim()||'admin123';
    if(!email) return notify('Enter an email in Email box, then click Sign up again.','warn');
    try{ await auth.createUserWithEmailAndPassword(email,pass);
      const id=email.toLowerCase(); await firebase.firestore().collection('userRegistry').doc(id).set({email:id, role: ADMIN_EMAILS.includes(id)?'admin':'user'}, {merge:true});
      notify('Account created — you can sign in.'); }catch(e){ notify(e?.message||'Signup failed','danger'); }});
}

auth.onAuthStateChanged(async(user)=>{ state.user=user||null; if(!user){render(); return;} const emailLower=(user.email||'').toLowerCase();
  state.role = ADMIN_EMAILS.includes(emailLower)?'admin':'user'; try{const reg=await firebase.firestore().collection('userRegistry').doc(emailLower).get();
  const r=(reg.data()?.role||state.role||'user').toLowerCase(); if(['user','associate','manager','admin'].includes(r)) state.role=r;}catch{}
  render(); });
render();})();