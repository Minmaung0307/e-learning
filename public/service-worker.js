// Minimal SW: cache on install, no fetch handler (avoids "no-op fetch" warning)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate',  () => self.clients.claim());