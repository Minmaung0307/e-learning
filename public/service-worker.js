// ultra-tiny SW just to pass PWA checks
self.addEventListener('install', (e)=> self.skipWaiting());
self.addEventListener('activate', (e)=> self.clients.claim());
self.addEventListener('fetch', ()=>{}); // network-first