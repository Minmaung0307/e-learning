// very small, optional
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());