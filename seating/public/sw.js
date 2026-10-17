// Static files only. Never cache API responses, floor plans, PINs or guest records.
const CACHE='seating-shell-2c43e249fbd6';
const ASSETS=['/','/index.html','/style.css','/app.js','/floor.js','/areas.js','/rooms.js','/plan-cleanup.js','/area-manager.js','/floor-import.js','/plan-detection.js','/combinations.js','/suggestions.js','/wait-plan.js','/ready-alert.js','/device.js','/manifest.webmanifest','/app-icon.svg','/apple-touch-icon.png'];
ASSETS.push('/plan-fit.js','/render-cache.js','/service-ops.js','/reports.js','/dining-progress.js');
ASSETS.push('/accessibility.js');
ASSETS.push('/connection-indicator.js','/wait-forecast.js');
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('seating-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||!ASSETS.includes(url.pathname)||url.search)return;
 event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||Response.error())));
});
