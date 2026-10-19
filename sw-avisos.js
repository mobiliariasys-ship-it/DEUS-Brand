// Service worker del aviso de ventas del panel (admin.html). Lo registra solo
// el panel, con alcance /admin: no toca la tienda ni intercepta nada. Su única
// tarea es mostrar la notificación que manda el servidor cuando entra una
// venta (services/avisos-push.js), aunque el panel esté cerrado.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

function panelAbierto(lista) {
  return lista.find(c => { try { return new URL(c.url).pathname.indexOf('/admin') === 0; } catch (e) { return false; } });
}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    const panel = panelAbierto(lista);
    // Con el panel abierto, él hace sonar el ka-ching (o, si su audio todavía
    // no está habilitado, vuelve a mostrar este aviso con el sonido de
    // Windows). Por eso acá va en silencio: así no suenan dos cosas.
    if (panel) panel.postMessage(d);
    return self.registration.showNotification(d.title || '💰 Nueva venta', {
      body: d.body || '',
      tag: d.tag || 'deus-venta',
      silent: !!panel,
      data: { url: '/admin.html' }
    });
  }));
});

// Tocar el aviso abre el panel (o lo trae al frente si ya estaba abierto).
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
    const panel = panelAbierto(lista);
    return panel ? panel.focus() : self.clients.openWindow((e.notification.data && e.notification.data.url) || '/admin.html');
  }));
});
