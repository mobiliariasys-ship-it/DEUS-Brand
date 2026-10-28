'use strict';
// Flow rechaza la transacción COMPLETA si el correo no le parece válido:
//
//   {"code":1620,"message":"The userEmail: andressherranz@gmail.con is not valid."}
//
// El cliente no pudo pagar y se perdió el pedido entero. El sitio ya avisa del
// tipeo antes de pagar; esto prueba la red de abajo, que es la que actúa si al
// navegador se le escapa algo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const correo = require('../services/correo');

test('el correo exacto que costó la venta se frena', () => {
  assert.strictEqual(correo.esUsable('andressherranz@gmail.con'), false);
  assert.strictEqual(correo.tldImposible('andressherranz@gmail.con'), true);
});

test('las terminaciones inventadas no llegan a la pasarela', () => {
  for (const tld of correo.TLD_IMPOSIBLES) {
    assert.strictEqual(correo.esUsable('a@gmail.' + tld), false, '.' + tld);
  }
});

test('los países reales NO se frenan', () => {
  // Este es el test que importa: bloquear de más bota ventas igual que no
  // bloquear. .co, .cm y .om son Colombia, Camerún y Omán.
  for (const e of ['a@gmail.co', 'a@algo.cm', 'a@algo.om', 'a@empresa.cl', 'a@uc.cl', 'a@sitio.com.ar']) {
    assert.strictEqual(correo.esUsable(e), true, e + ' es válido y debe pasar');
  }
});

test('correos rotos no llegan a la pasarela', () => {
  for (const e of ['', null, undefined, 'sinarroba', 'a@', '@b.com', 'a@b']) {
    assert.strictEqual(correo.esUsable(e), false, JSON.stringify(e));
  }
});

test('un espacio de más adentro del correo se limpia, no se rechaza', () => {
  // Un espacio dentro de un correo es siempre un tipeo (no existen sin
  // comillas), y a la pasarela viaja el normalizado. Rechazarlo sería botar
  // una venta arreglable.
  assert.strictEqual(correo.esUsable('a b@c.com'), true);
  assert.strictEqual(correo.normalizar('a b@c.com'), 'ab@c.com');
});

test('normalizar deja el correo listo para la pasarela', () => {
  assert.strictEqual(correo.normalizar('  Juan@GMAIL.com '), 'juan@gmail.com');
  assert.strictEqual(correo.normalizar('a b@c.com'), 'ab@c.com');
  assert.strictEqual(correo.normalizar(null), '');
});

test('el mensaje le dice al cliente qué arreglar', () => {
  // "No se pudo iniciar el pago" lo manda a reintentar el mismo error. El
  // mensaje tiene que nombrar el correo.
  assert.match(correo.MENSAJE, /correo/i);
});

// ── Las dos listas no se pueden separar ──────────────────────────────────
test('la lista de TLD del sitio y la del backend son la misma', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = html.match(/const TLD_IMPOSIBLES = \[([^\]]+)\]/);
  assert.ok(m, 'no encontré TLD_IMPOSIBLES en index.html');
  const delSitio = m[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepStrictEqual(delSitio.slice().sort(), correo.TLD_IMPOSIBLES.slice().sort(),
    'si una lista cambia, la otra tiene que cambiar igual — si no, el navegador y el backend frenan cosas distintas');
});

// ── El cableado en las rutas de pago ─────────────────────────────────────
test('Flow corta antes de llamar a la pasarela y traduce el error 1620', () => {
  const flow = fs.readFileSync(path.join(__dirname, '..', 'routes', 'flow.js'), 'utf8');
  assert.ok(/correo_\.esUsable\(customerEmail\)/.test(flow), 'debe validar antes de llamar a Flow');
  assert.ok(/campo: 'email'/.test(flow), 'debe marcar el campo para que el sitio sepa dónde apuntar');
  assert.ok(/1620|userEmail/.test(flow), 'debe traducir el rechazo de Flow');
  assert.ok(/status\(400\)/.test(flow),
    'tiene que ser 400: con 500 fetchBackend reintenta 4 veces y el cliente espera 12s para nada');
});

test('MercadoPago tiene el mismo corte', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/correo_\.esUsable\(customerEmail\)/.test(srv));
  assert.ok(/correo_\.normalizar\(customerEmail\)/.test(srv));
});

test('el sitio muestra el mensaje del backend en vez del genérico', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/function errorDeCorreo\(/.test(html));
  assert.ok((html.match(/errorDeCorreo\(data, msg\)/g) || []).length >= 2,
    'Flow y MercadoPago deben usarlo');
});
