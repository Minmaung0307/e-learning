self.addEventListener('install', e=>{
  e.waitUntil(caches.open('learnhub-v2').then(c=>c.addAll([
    '/', '/index.html', '/css/styles.css', '/js/app.js',
    '/manifest.webmanifest', '/assets/learnhub-mark.svg'
  ])));
});
self.addEventListener('activate', e=> e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e=>{
  const url=new URL(e.request.url);
  if(url.origin===location.origin){
    e.respondWith(caches.match(e.request).then(r=> r||fetch(e.request)));
  }
});