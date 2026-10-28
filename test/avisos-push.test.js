'use strict';
// Aviso de venta por Web Push: llega al PC aunque el panel esté cerrado.
// Se prueba el servidor (suscripciones, envío, limpieza de las muertas y que
// el aviso viaje cifrado de verdad), el service worker y el gancho de metrics.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

// persist en memoria: el test no puede escribir avisos-push.json en el repo.
let guardado = null;
const persistPath = require.resolve('../services/persist');
require.cache[persistPath] = { id: persistPath, filename: persistPath, loaded: true, exports: {
  load: async (k, fb) => (guardado ? JSON.parse(JSON.stringify(guardado)) : fb),
  save: async (k, d) => { guardado = JSON.parse(JSON.stringify(d)); return true; }
} };
const webpush = require('web-push');
const ece = require('http_ece');
const avisos = require('../services/avisos-push');

// Una suscripción como la que arma el navegador, con sus llaves reales para
// poder descifrar lo que manda el servidor.
function suscripcionFalsa(n) {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: { endpoint: 'https://fcm.googleapis.com/fcm/send/prueba-' + n, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } },
    ecdh, auth
  };
}

const venta = { monto: 87980, metodo: 'MercadoPago', nombre: 'Camila Rojas', unidades: 1, tapones: true };
const resumen = { total: { count: 305 }, hoy: { count: 3, monto: 225960 } };

test('el texto del aviso: monto, qué llevó, medio de pago, primer nombre y cómo va el día', () => {
  const a = avisos.textoVenta(venta, resumen);
  assert.strictEqual(a.title, '💰 Nueva venta · $87.980');
  assert.strictEqual(a.body, '1 banda + tapones · MercadoPago · Camila\nHoy llevas 3 ventas · $225.960');
  assert.strictEqual(a.tag, 'deus-venta-305', 'misma etiqueta que el panel: no se duplica');
  assert.strictEqual(a.total, 305);
});

test('las llaves VAPID se crean solas una vez y se reusan', async () => {
  avisos._reiniciar(); guardado = null;
  const k1 = await avisos.clavePublica();
  avisos._reiniciar();
  const k2 = await avisos.clavePublica();
  assert.ok(k1 && k1.length > 60);
  assert.strictEqual(k1, k2, 'sin esto, cada deploy rompería las suscripciones');
  assert.ok(guardado.vapid.privateKey, 'la privada queda en el almacén, no en el código');
});

test('solo acepta suscripciones bien formadas y no repite el mismo navegador', async () => {
  avisos._reiniciar(); guardado = null;
  const { sub } = suscripcionFalsa(1);
  await assert.rejects(avisos.suscribir({ endpoint: 'http://inseguro/x', keys: sub.keys }));
  await assert.rejects(avisos.suscribir({ endpoint: sub.endpoint }));
  assert.strictEqual(await avisos.suscribir(sub), 1);
  assert.strictEqual(await avisos.suscribir(sub), 1, 'el mismo endpoint se reemplaza');
  assert.strictEqual(await avisos.desuscribir(sub.endpoint), 0);
});

test('el aviso viaja cifrado y firmado, y se descifra con las llaves del navegador', async () => {
  avisos._reiniciar(); guardado = null;
  const s = suscripcionFalsa(2);
  await avisos.suscribir(s.sub);
  const envios = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (sub, cuerpo, op) => {
    envios.push(webpush.generateRequestDetails(sub, cuerpo, op));
    return { statusCode: 201 };
  };
  try {
    const r = await avisos.enviar(avisos.textoVenta(venta, resumen));
    assert.deepStrictEqual(r, { enviados: 1, suscripciones: 1 });
  } finally { webpush.sendNotification = original; }
  const req = envios[0];
  assert.strictEqual(req.endpoint, s.sub.endpoint);
  assert.match(req.headers.Authorization, /^vapid t=.+, k=.+/, 'firmado con VAPID');
  assert.strictEqual(req.headers.TTL, 6 * 3600);
  assert.strictEqual(req.headers.Urgency, 'high');
  const claro = ece.decrypt(req.body, { version: 'aes128gcm', privateKey: s.ecdh, authSecret: s.auth });
  const aviso = JSON.parse(claro.toString('utf8'));
  assert.strictEqual(aviso.title, '💰 Nueva venta · $87.980');
  assert.strictEqual(aviso.tipo, 'venta');
});

test('borra las suscripciones muertas (410) y conserva las que fallaron por otra cosa', async () => {
  avisos._reiniciar(); guardado = null;
  const viva = suscripcionFalsa(3).sub, muerta = suscripcionFalsa(4).sub;
  await avisos.suscribir(viva); await avisos.suscribir(muerta);
  const original = webpush.sendNotification;
  const errorOriginal = console.error; console.error = () => {};
  webpush.sendNotification = async (sub) => {
    const e = new Error('x'); e.statusCode = sub.endpoint === muerta.endpoint ? 410 : 500; throw e;
  };
  try {
    const r = await avisos.enviar({ title: 't' });
    assert.deepStrictEqual(r, { enviados: 0, suscripciones: 1 });
  } finally { webpush.sendNotification = original; console.error = errorOriginal; }
  assert.deepStrictEqual(guardado.subs.map(s => s.endpoint), [viva.endpoint]);
});

// ── Service worker ──
function sw(ventanas) {
  const L = {}, mostradas = [], mensajes = [];
  const clientes = ventanas.map(u => ({ url: u, postMessage: m => mensajes.push(m), focus: async () => {} }));
  const self = {
    addEventListener: (t, f) => { L[t] = f; },
    skipWaiting: () => {},
    clients: { matchAll: async () => clientes, claim: async () => {}, openWindow: async () => {} },
    registration: { showNotification: async (t, o) => mostradas.push({ t, ...o }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw-avisos.js'), 'utf8'), { self, URL });
  return {
    async push(d) {
      let p; L.push({ data: { json: () => d }, waitUntil: x => { p = x; } }); await p;
    }, mostradas, mensajes
  };
}

test('service worker: con el panel cerrado muestra el aviso con sonido', async () => {
  const w = sw(['https://deusbrand.cl/']);
  await w.push({ tipo: 'venta', total: 9, title: '💰 Nueva venta · $68.990', body: 'b', tag: 'deus-venta-9' });
  assert.strictEqual(w.mostradas.length, 1);
  assert.strictEqual(w.mostradas[0].silent, false);
  assert.strictEqual(w.mostradas[0].tag, 'deus-venta-9');
  assert.strictEqual(w.mensajes.length, 0, 'la tienda abierta no recibe nada');
});

test('service worker: con el panel abierto va en silencio y le pasa la venta al panel (ka-ching)', async () => {
  const w = sw(['https://deusbrand.cl/admin.html']);
  await w.push({ tipo: 'venta', total: 9, title: 't', body: 'b', tag: 'deus-venta-9' });
  assert.strictEqual(w.mostradas[0].silent, true);
  assert.strictEqual(w.mensajes[0].total, 9);
});

// ── Gancho de metrics: avisa cada venta nueva, no los reavisos ──
test('metrics avisa la venta nueva una sola vez (los reavisos de la misma orden no)', () => {
  const LEDGER = path.join(__dirname, '..', 'metrics-data.json');
  let respaldo = null; try { respaldo = fs.readFileSync(LEDGER); } catch (e) {}
  try {
    const metrics = require('../services/metrics');
    const vistos = [];
    metrics.alVender((v, r) => vistos.push({ v, total: r.total.count }));
    const orden = 'test-push-' + Date.now();
    metrics.registrarVenta({ monto: 68990, metodo: 'Flow', nombre: 'Prueba Push', orden, unidades: 1 });
    metrics.registrarVenta({ monto: 68990, metodo: 'Flow', nombre: 'Prueba Push', orden, unidades: 1 });
    assert.strictEqual(vistos.length, 1);
    assert.strictEqual(vistos[0].v.orden, orden);
    assert.strictEqual(vistos[0].total, metrics.snapshot().ventas.total.count);
  } finally {
    if (respaldo !== null) fs.writeFileSync(LEDGER, respaldo);
    else { try { fs.unlinkSync(LEDGER); } catch (e) {} }
  }
});

test('las rutas del aviso piden la clave del panel y el service worker se sirve', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  for (const r of ['/admin/push/clave', '/admin/push/suscribir', '/admin/push/desuscribir', '/admin/push/probar']) {
    const i = srv.indexOf("'" + r + "'");
    assert.ok(i > 0, 'falta ' + r);
    assert.match(srv.slice(i, i + 200), /clavePanelOk\(req, res\)/, r + ' sin clave');
  }
  assert.match(srv, /metrics\.alVender\(/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'sw-avisos.js')));
});
