'use strict';
// Promo Cyber "2 x $119.990": cada par de bandas cuesta $119.990 y la impar va
// a precio de lista, hasta el mismo corte que el regalo de tapones. El sitio
// la muestra y el backend la cobra: si se desalinean, el cliente ve un total y
// la pasarela le cobra otro.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const p = require('../services/precio');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const EN_CYBER = p.CYBER_FIN_MS - 3600000;   // miércoles 7, 23:00 de Chile
const DESPUES = p.CYBER_FIN_MS;               // jueves 8, 00:00 de Chile
const UNA = p.DESPUES.precio;
const clp = n => '$' + n.toLocaleString('es-CL');

test('en Cyber cada par cuesta $119.990 y la impar va a precio de lista', () => {
  const total = q => p.calcularMonto({ cantidad: q, ahora: EN_CYBER }).total;
  assert.strictEqual(total(1), UNA, 'una sola no cambia');
  assert.strictEqual(total(2), 119990);
  assert.strictEqual(total(3), 119990 + UNA);
  assert.strictEqual(total(4), 2 * 119990);
  assert.strictEqual(p.calcularMonto({ cantidad: 2, tapones: true, shippingCost: 3000, ahora: EN_CYBER }).total,
    119990 + p.UPSELL_TAPONES + 3000, 'tapones y envío se suman aparte');
  assert.strictEqual(p.calcularMonto({ cantidad: 2, soloTapones: true, ahora: EN_CYBER }).total,
    2 * p.TAPONES_PRICE, 'la promo es de bandas: los tapones solos no cambian');
});

test('la promo corta a la misma hora que el regalo de tapones', () => {
  assert.strictEqual(p.precioPar(DESPUES - 60000), p.PRECIO_PAR, 'miércoles 7, 23:59: todavía va');
  assert.strictEqual(p.precioPar(DESPUES), 0, 'jueves 8, 00:00: ya no');
  assert.strictEqual(p.calcularMonto({ cantidad: 2, ahora: DESPUES }).total, 2 * UNA);
});

test('el par siempre sale más barato que dos sueltas', () => {
  assert.ok(p.PRECIO_PAR < 2 * UNA, 'si el par no ahorra nada, no es promo');
  // Y si algún día sube el precio de lista, la promo nunca encarece la compra.
  for (let q = 1; q <= 10; q++) {
    assert.ok(p.subtotalBandas(q, EN_CYBER) <= q * UNA, q + ' bandas cuestan más con la promo');
  }
});

test('el sitio calcula el mismo subtotal que cobra el backend', () => {
  const m = HTML.match(/const subtotalBandas = q => ([\s\S]*?);\n/);
  assert.ok(m, 'falta subtotalBandas() en index.html');
  const sitio = (PRECIO, q) => new Function('PRECIO', 'q', 'return ' + m[1])(PRECIO, q);
  for (let q = 1; q <= 10; q++) {
    assert.strictEqual(sitio({ precio: UNA, par: p.PRECIO_PAR }, q), p.subtotalBandas(q, EN_CYBER), q + ' bandas en Cyber');
    assert.strictEqual(sitio({ precio: UNA, par: 0 }, q), p.subtotalBandas(q, DESPUES), q + ' bandas después del Cyber');
  }
});

test('los montos escritos en el HTML son los del backend', () => {
  const arranque = HTML.match(/PRECIO\.par = document\.documentElement\.classList\.contains\('cyber'\) \? (\d+) : 0;/);
  assert.ok(arranque, 'falta el precio del par de arranque');
  assert.strictEqual(Number(arranque[1]), p.PRECIO_PAR, 'el sitio arranca con otro precio del par');
  // Solo los del HTML de arranque (los que empiezan con $), no las plantillas JS.
  const montos = [...HTML.matchAll(/class="par-monto">(\$[^<]+)</g)].map(x => x[1]);
  assert.ok(montos.length >= 3, 'top bar, bajo el precio y CTA final');
  montos.forEach(x => assert.strictEqual(x, clp(p.PRECIO_PAR)));
  const ahorros = [...HTML.matchAll(/class="par-ahorro">(\$[^<]+)</g)].map(x => x[1]);
  assert.ok(ahorros.length >= 2);
  ahorros.forEach(x => assert.strictEqual(x, clp(2 * UNA - p.PRECIO_PAR)));
});

test('la promo nunca se anuncia como "2x1" (no es lleva 2 y paga 1)', () => {
  // Fuera de comentarios: ahí sí se explica por qué no se usa.
  const sinComentarios = HTML
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\b2\s*x\s*1\b/i.test(sinComentarios), 'el sitio dice "2x1" en algún lado');
});
