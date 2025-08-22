const CACHE='learnhub-v1';const ASSETS=['/','/index.html','/css/styles.css','/js/app.js','/assets/learnhub-mark.svg','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>(k===CACHE?null:caches.delete(k))))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const req=e.request; if(new URL(req.url).origin!==self.location.origin) return;
  e.respondWith(caches.match(req).then(cached=>{const fetchP=fetch(req).then(res=>{const copy=res.clone(); caches.open(CACHE).then(c=>c.put(req,copy)); return res}).catch(()=>cached); return cached||fetchP}))});