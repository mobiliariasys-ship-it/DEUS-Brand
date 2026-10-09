'use strict';
// Promo de tapones: toda compra con banda lleva de regalo los tapones DEUS. El
// sitio lo muestra (clase html.promo + raspe en el checkout) y el backend lo
// anota en el pedido para que el despacho no se olvide de meterlos en el
// paquete. Nació como el Cyber de octubre (5 al 7); el dueño la dejó corriendo
// después, sin la marca Cyber y sin fecha de término.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { llevaRegaloTapones, PROMO_TAPONES, TAPONES_PRICE } = require('../services/precio');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('el regalo de tapones sigue después del Cyber, sin fecha de término', () => {
  assert.strictEqual(PROMO_TAPONES, true);
  assert.strictEqual(llevaRegaloTapones({}), true);
  assert.strictEqual(llevaRegaloTapones({ soloTapones: false }), true);
});

test('una compra de solo tapones no suma otros tapones de regalo', () => {
  assert.strictEqual(llevaRegaloTapones({ soloTapones: true }), false);
});

test('el sitio muestra la promo cuando el backend la aplica, y el contador vencido no la apaga', () => {
  // <head>: la clase html.promo, sin fecha de corte
  assert.ok(HTML.includes("<script>document.documentElement.classList.add('promo');</script>"),
    'falta el script del <head> que pone html.promo');
  assert.strictEqual(PROMO_TAPONES, true, 'si se apaga la promo en el backend, sacar también html.promo del <head>');
  assert.ok(!/classList\.remove\('promo'\)/.test(HTML), 'nada en la página puede apagar la promo por su cuenta');
  // El contador del top bar ya pasó su plazo: la barra llega sin él
  assert.ok(HTML.includes('<div class="announce-bar" id="offer-bar">🇨🇱 <b class="ab-titulo">ENVÍO GRATIS<span class="solo-promo"> + TAPONES DE OÍDO GRATIS</span></b><div class="ab-plazo">1-2 días de envío</div></div>'),
    'la barra de arriba tiene que llegar con la promo y sin contador');
});

test('el checkout no ofrece tapones pagados mientras van de regalo, y el raspe no sale en "solo tapones"', () => {
  assert.ok(HTML.includes('html.promo #upsell-card{display:none!important;}'), 'el upsell pagado de tapones tiene que ocultarse con la promo');
  assert.ok(HTML.includes('#checkout-overlay.tapones .raspe{display:none!important;}'), 'el raspe no va en el checkout de solo tapones');
  assert.ok(/<div class="raspe solo-promo" id="raspe">/.test(HTML), 'el raspe tiene que apagarse solo con html.promo');
});

test('el raspe tacha el precio al que de verdad se venden los tapones', () => {
  const m = HTML.match(/<s class="raspe-antes">\$([\d.]+)<\/s>/);
  assert.ok(m, 'falta el precio tachado en el raspe');
  assert.strictEqual(Number(m[1].replace(/\./g, '')), TAPONES_PRICE,
    'el tachado tiene que ser el precio de la tienda (si cambia TAPONES_PRICE, cambiarlo también en el raspe)');
});

test('sin precio tachado: ni el backend ni el sitio muestran el $78.990 ni el %', () => {
  // El dueño sacó el tachado el 9-oct-2026. ancla 0 / off 0 = solo el precio real.
  const { DESPUES } = require('../services/precio');
  assert.strictEqual(DESPUES.ancla, 0);
  assert.strictEqual(DESPUES.off, 0);
  const arranque = HTML.match(/: \{ precio: (\d+), ancla: (\d+), off: (\d+) \};/);
  assert.ok(arranque, 'falta el PRECIO de arranque del sitio');
  assert.deepStrictEqual(arranque.slice(1).map(Number), [DESPUES.precio, 0, 0], 'el sitio arranca con otro precio o con tachado');
  assert.ok(!/78\.990|78990/.test(HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '')), 'quedó el $78.990 en la página');
  assert.ok(HTML.includes('<div class="price-block"><span class="pb-main"><sup>$</sup>68.990</span></div>'), 'el bloque de precio llega sin tachado');
  assert.ok(HTML.includes('<span class="co-price-now">$68.990</span></div>'), 'el checkout llega sin tachado');
});

// Captura lo que se le mandaría a Resend, sin red.
function capturarCorreos() {
  const enviados = [];
  const orig = https.request;
  const entorno = { k: process.env.RESEND_API_KEY, t: process.env.MAIL_TO };
  process.env.RESEND_API_KEY = 'test';
  process.env.MAIL_TO = 'despacho@ejemplo.com';
  https.request = (opts, cb) => {
    const req = new EventEmitter();
    let cuerpo = '';
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.write = c => { cuerpo += c; };
    req.end = () => {
      enviados.push(JSON.parse(cuerpo));
      const res = new EventEmitter();
      res.statusCode = 200;
      cb(res);
      res.emit('data', '{}');
      res.emit('end');
    };
    return req;
  };
  return {
    enviados,
    restaurar() {
      https.request = orig;
      if (entorno.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = entorno.k;
      if (entorno.t === undefined) delete process.env.MAIL_TO; else process.env.MAIL_TO = entorno.t;
    }
  };
}

test('los correos de una compra con la promo dicen "+ Tapones de oído DEUS GRATIS", sin "Cyber"', async () => {
  const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente } = require('../services/email');
  const cap = capturarCorreos();
  try {
    const pedido = { preference_id: 'deus-1', created_at: new Date().toISOString(), product: 'DEUS Band', product_price: 68990, total: 68990, color: 'negra', cantidad: 1, regaloTapones: true, customer: { name: 'Prueba Promo' }, shipping: { carrier: 'Starken', cost: 0, address: {} } };
    await enviarPedidoNuevo(pedido);
    await enviarPagoConfirmado({ id: 'promo-1', transaction_amount: 68990 }, pedido);
    await enviarConfirmacionCliente({ email: 'cliente@ejemplo.com', name: 'Prueba', monto: 68990, id: 'promo-1', color: 'negra', regaloTapones: true });
    await enviarPagoConfirmado({ id: 'normal-1', transaction_amount: 68990 }, { ...pedido, regaloTapones: false });
    await enviarConfirmacionCliente({ email: 'cliente@ejemplo.com', name: 'Prueba', monto: 68990, id: 'normal-1', color: 'negra', regaloTapones: false });
  } finally { cap.restaurar(); }
  assert.strictEqual(cap.enviados.length, 5);
  const [nuevo, despacho, cliente, despachoNormal, clienteNormal] = cap.enviados;
  assert.match(nuevo.html, /\+ Tapones de oído DEUS GRATIS/, 'el aviso de pedido nuevo anota el regalo');
  assert.match(despacho.subject, /TAPONES GRATIS/, 'el asunto del despacho avisa el regalo');
  assert.match(despacho.html, /\+ TAPONES DE OÍDO GRATIS — INCLUIR EN EL PAQUETE/, 'el despacho tiene que ver que va el regalo');
  assert.match(cliente.subject, /\+ tapones de oído gratis/, 'el cliente lo ve desde el asunto');
  assert.match(cliente.html, /\+ Tapones de oído DEUS GRATIS/, 'el cliente tiene que ver su regalo');
  for (const c of [despachoNormal, clienteNormal]) {
    assert.doesNotMatch(c.subject + c.html, /🎁 Regalo|tapones de oído gratis|TAPONES GRATIS|Tapones de oído DEUS GRATIS|tapones de oído de regalo/, 'una compra sin regalo no lo menciona');
  }
  for (const c of cap.enviados) assert.doesNotMatch(c.subject + c.html, /cyber/i, 'el Cyber terminó: ningún correo lo nombra');
});

test('la página y el chatbot ya no dicen "Cyber" (la promo sigue, la marca no)', () => {
  // Solo lo que ve el cliente: sin comentarios de HTML, CSS ni JS.
  const visible = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(visible, /cyber/i);
  assert.match(visible, /\+ TAPONES DE OÍDO GRATIS/, 'la promo se sigue anunciando en la barra');
  const chat = fs.readFileSync(path.join(__dirname, '..', 'services', 'chat.js'), 'utf8');
  assert.doesNotMatch(chat, /por Cyber|CYBER \(hasta/, 'el chatbot no puede seguir ofreciendo el regalo "por Cyber" con fecha');
  assert.match(chat, /PROMOCIÓN VIGENTE: toda compra de la banda lleva de REGALO los Tapones de oído DEUS/);
});
