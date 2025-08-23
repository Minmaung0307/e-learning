const CACHE = 'learnhub-v3';
const ASSETS = ['/', '/index.html', '/css/styles.css', '/js/app.js', '/manifest.webmanifest'];

self.addEventListener('install', ()=> self.skipWaiting());
self.addEventListener('activate', (e)=> e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', ()=>{});