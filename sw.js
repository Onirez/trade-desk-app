// Web push: header "Trade desk · now"; tapping opens the pump.fun coin URL built by links.py on the server.
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch (_) { d = {body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Trade desk · now',
    {body: d.body || '', icon: d.icon || '/icons/icon-192.png', data: {url: d.url || '/'}}));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url || '/'));
});
