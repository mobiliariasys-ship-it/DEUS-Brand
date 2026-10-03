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
const { regaloCyber, CYBER_FIN_MS } = require('../services/precio');

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

test('el correo de despacho y el del cliente dicen que van los tapones de regalo', async () => {
  const { enviarPagoConfirmado, enviarConfirmacionCliente } = require('../services/email');
  const cap = capturarCorreos();
  try {
    const pedido = { product: 'DEUS Band', color: 'negra', cantidad: 1, regaloTapones: true, customer: { name: 'Prueba Cyber' }, shipping: { carrier: 'Starken', cost: 0, address: {} } };
    await enviarPagoConfirmado({ id: 'cyber-1', transaction_amount: 68990 }, pedido);
    await enviarConfirmacionCliente({ email: 'cliente@ejemplo.com', name: 'Prueba', monto: 68990, id: 'cyber-1', color: 'negra', regaloTapones: true });
    await enviarPagoConfirmado({ id: 'normal-1', transaction_amount: 68990 }, { ...pedido, regaloTapones: false });
  } finally { cap.restaurar(); }
  assert.strictEqual(cap.enviados.length, 3);
  assert.match(cap.enviados[0].html, /Regalo Cyber.*INCLUIR EN EL PAQUETE/s, 'el despacho tiene que ver que va el regalo');
  assert.match(cap.enviados[1].html, /Regalo Cyber.*Tapones de oído DEUS/s, 'el cliente tiene que ver su regalo');
  assert.doesNotMatch(cap.enviados[2].html, /Regalo Cyber/, 'un pedido sin regalo no lo menciona');
});
