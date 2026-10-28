'use strict';
// Cyber de octubre (lunes 5 a miércoles 7, 23:59 de Chile): toda compra con
// banda lleva de regalo los tapones DEUS. El sitio lo muestra (clase
// html.cyber + raspe en el checkout) y el backend lo anota en el pedido para
// que el despacho no se olvide de meterlos en el paquete.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { regaloCyber, CYBER_FIN_MS, TAPONES_PRICE } = require('../services/precio');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('el regalo corre hasta el jueves 8-oct 00:00 de Chile y ni un minuto más', () => {
  assert.strictEqual(new Date(CYBER_FIN_MS).toISOString(), '2026-10-08T03:00:00.000Z');
  assert.strictEqual(regaloCyber({}, CYBER_FIN_MS - 60000), true, 'miércoles 7, 23:59: todavía va');
  assert.strictEqual(regaloCyber({}, CYBER_FIN_MS), false, 'jueves 8, 00:00: ya no');
  assert.strictEqual(regaloCyber({}, Date.UTC(2026, 9, 3, 15, 0)), true, 'antes del lunes 5 ya está activo');
});

test('una compra de solo tapones no suma otros tapones de regalo', () => {
  assert.strictEqual(regaloCyber({ soloTapones: true }, CYBER_FIN_MS - 60000), false);
  assert.strictEqual(regaloCyber({ soloTapones: false }, CYBER_FIN_MS - 60000), true);
});

test('el sitio y el backend cortan a la misma hora (las tres copias del fin)', () => {
  // <head>: la clase html.cyber
  const m = HTML.match(/Date\.now\(\)<Date\.UTC\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)\)document\.documentElement\.classList\.add\('cyber'\)/);
  assert.ok(m, 'falta el script del <head> que pone html.cyber');
  assert.strictEqual(Date.UTC(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]), CYBER_FIN_MS, 'html.cyber corta a otra hora que el backend');
  // Contador del top bar: FIN_PROMO_DIA es el día (medianoche de Chile) del corte
  const d = HTML.match(/var FIN_PROMO_DIA = Date\.UTC\((\d+), (\d+), (\d+)\) \/ 86400000;/);
  assert.ok(d, 'falta FIN_PROMO_DIA');
  assert.strictEqual(Date.UTC(+d[1], +d[2], +d[3]) + 3 * 3600000, CYBER_FIN_MS, 'el contador llega a cero a otra hora');
});

test('el checkout no ofrece tapones pagados mientras van de regalo, y el raspe no sale en "solo tapones"', () => {
  assert.ok(HTML.includes('html.cyber #upsell-card{display:none!important;}'), 'el upsell pagado de tapones tiene que ocultarse en Cyber');
  assert.ok(HTML.includes('#checkout-overlay.tapones .raspe{display:none!important;}'), 'el raspe no va en el checkout de solo tapones');
  assert.ok(/<div class="raspe solo-cyber" id="raspe">/.test(HTML), 'el raspe tiene que apagarse solo con html.cyber');
});

test('el raspe tacha el precio al que de verdad se venden los tapones', () => {
  const m = HTML.match(/<s class="raspe-antes">\$([\d.]+)<\/s>/);
  assert.ok(m, 'falta el precio tachado en el raspe');
  assert.strictEqual(Number(m[1].replace(/\./g, '')), TAPONES_PRICE,
    'el tachado tiene que ser el precio de la tienda (si cambia TAPONES_PRICE, cambiarlo también en el raspe)');
});

test('el precio tachado y el % son los mismos en el backend y en el sitio', () => {
  const { DESPUES } = require('../services/precio');
  const real = Math.floor((DESPUES.ancla - DESPUES.precio) / DESPUES.ancla * 100);
  assert.ok(DESPUES.off <= real, 'el sello no puede prometer más descuento que el real');
  const clp = n => '$' + n.toLocaleString('es-CL');
  const arranque = HTML.match(/: \{ precio: (\d+), ancla: (\d+), off: (\d+) \};/);
  assert.ok(arranque, 'falta el PRECIO de arranque del sitio');
  assert.deepStrictEqual(arranque.slice(1).map(Number), [DESPUES.precio, DESPUES.ancla, DESPUES.off], 'el sitio arranca con otro precio que el backend');
  assert.ok(HTML.includes('<span class="price-was">' + clp(DESPUES.ancla) + '</span> <span class="price-save">-' + DESPUES.off + '%</span>'),
    'el bloque de precio del HTML tiene otro tachado que el backend');
  assert.ok(HTML.includes('<span class="co-price-old">' + clp(DESPUES.ancla) + '</span>'),
    'el checkout tiene otro tachado que el backend');
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

test('los correos de una compra Cyber dicen "+ Tapones de oído DEUS GRATIS"', async () => {
  const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente } = require('../services/email');
  const cap = capturarCorreos();
  try {
    const pedido = { preference_id: 'deus-1', created_at: new Date().toISOString(), product: 'DEUS Band', product_price: 68990, total: 68990, color: 'negra', cantidad: 1, regaloTapones: true, customer: { name: 'Prueba Cyber' }, shipping: { carrier: 'Starken', cost: 0, address: {} } };
    await enviarPedidoNuevo(pedido);
    await enviarPagoConfirmado({ id: 'cyber-1', transaction_amount: 68990 }, pedido);
    await enviarConfirmacionCliente({ email: 'cliente@ejemplo.com', name: 'Prueba', monto: 68990, id: 'cyber-1', color: 'negra', regaloTapones: true });
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
    assert.doesNotMatch(c.subject + c.html, /Regalo Cyber|tapones de oído gratis|TAPONES GRATIS|Tapones de oído DEUS GRATIS|tapones de oído de regalo/, 'una compra sin regalo no lo menciona');
  }
});
