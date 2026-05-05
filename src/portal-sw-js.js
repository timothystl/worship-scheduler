// Portal service worker — exported as a string, served at /portal-sw.js
export const PORTAL_SW_JS = `
'use strict';

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e) {}
  var title = data.title || 'Timothy Lutheran Church';
  var options = {
    body: data.body || '',
    icon: '/tlc-logo.png',
    badge: '/tlc-logo.png',
    tag: data.tag || 'tlc-notification',
    data: { url: data.url || '/portal' },
    requireInteraction: false,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/portal';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf('/portal') !== -1 && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
`;
