// Service worker: lets browsers install PolyWeave as an app. It always fetches from the
// network (no offline copy), so everyone automatically plays the latest version.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => new Response('PolyWeave needs an internet connection.', { status: 503, headers: { 'Content-Type': 'text/plain' } })));
});
