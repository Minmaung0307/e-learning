const CACHE = 'lh-v1';
const ASSETS = [
  '/', '/index.html', '/css/styles.css', '/js/app.js',
  '/icons/icon-192.png', '/icons/icon-512.png'
];

self.addEventListener('install', e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
});

self.addEventListener('fetch', e=>{
  const url = e.request.url;
  // don’t touch Firestore streams
  if (url.includes('firestore.googleapis.com')) return;

  e.respondWith(
    caches.match(e.request).then(resp=>{
      return resp || fetch(e.request).then(net=>{
        // put a copy for static GETs
        if (e.request.method==='GET' && net.ok && new URL(url).origin===location.origin) {
          const clone = net.clone();
          caches.open(CACHE).then(c=>c.put(e.request, clone));
        }
        return net;
      }).catch(()=> resp || (ASSETS.includes(new URL('/', location).pathname) ? caches.match('/index.html') : undefined));
    })
  );
});