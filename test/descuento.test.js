'use strict';
// El código de descuento toca lo que se COBRA, así que la regla vive en un solo
// lugar (services/precio.js) y las tres pasarelas la usan. Antes la fórmula del
// monto estaba copiada nueve veces entre server.js, flow.js y transbank.js:
// con un descuento encima, olvidarse de una copia significa cobrar distinto
// según por dónde entró el cliente.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const p = require('../services/precio');

const PRECIO = p.DESPUES.precio;          // $68.990 hoy
const m = (o) => p.calcularMonto(o);

test('sin código no cambia nada', () => {
  assert.strictEqual(m({ cantidad: 1 }).total, PRECIO);
  assert.strictEqual(m({ cantidad: 1 }).descuento, 0);
  assert.strictEqual(m({ cantidad: 1 }).codigo, null);
});

test('DEUSKEZ descuenta 7% redondeando hacia abajo', () => {
  const r = m({ cantidad: 1, codigo: 'DEUSKEZ' });
  assert.strictEqual(r.codigo, 'DEUSKEZ');
  assert.strictEqual(r.pct, 0.07);
  assert.strictEqual(r.total, Math.floor(PRECIO * 0.93));
  assert.strictEqual(r.total, 64160);
  assert.strictEqual(r.descuento, PRECIO - 64160);
});

test('el cliente nunca recibe MENOS del descuento anunciado', () => {
  // El redondeo va hacia abajo justo para esto: 68.990 x 0,93 = 64.160,7. Si se
  // redondeara hacia arriba (64.161) el descuento real seria 6,999%, o sea
  // anunciar un 7% y aplicar menos.
  for (const cant of [1, 2, 3, 5, 10]) {
    const r = m({ cantidad: cant, codigo: 'DEUSKEZ' });
    const pctReal = r.descuento / r.subtotal;
    assert.ok(pctReal >= 0.07, `con ${cant} unidades el descuento real fue ${(pctReal * 100).toFixed(4)}%`);
  }
});

test('se acepta en minúscula y con espacios', () => {
  const esperado = m({ cantidad: 1, codigo: 'DEUSKEZ' }).total;
  for (const c of ['deuskez', ' DeusKez ', '  deuskez']) {
    assert.strictEqual(m({ cantidad: 1, codigo: c }).total, esperado, 'falló con ' + JSON.stringify(c));
  }
});

test('un código inventado no descuenta nada', () => {
  for (const c of ['NOEXISTE', '', null, undefined, '   ', 'DEUSKE', 'DEUSKEZZ']) {
    const r = m({ cantidad: 1, codigo: c });
    assert.strictEqual(r.descuento, 0, 'descontó con ' + JSON.stringify(c));
    assert.strictEqual(r.total, PRECIO);
  }
});

test('el descuento NO se aplica al envío', () => {
  const r = m({ cantidad: 1, codigo: 'DEUSKEZ', shippingCost: 4000 });
  assert.strictEqual(r.envio, 4000);
  assert.strictEqual(r.total, 64160 + 4000);
  assert.strictEqual(r.descuento, PRECIO - 64160);   // igual que sin envío
});

test('alcanza a los tapones agregados y a la compra de solo tapones', () => {
  const conTapones = m({ cantidad: 1, tapones: true, codigo: 'DEUSKEZ' });
  assert.strictEqual(conTapones.subtotal, PRECIO + p.UPSELL_TAPONES);
  assert.strictEqual(conTapones.total, Math.floor((PRECIO + p.UPSELL_TAPONES) * 0.93));

  const solo = m({ cantidad: 1, soloTapones: true, codigo: 'DEUSKEZ' });
  assert.strictEqual(solo.subtotal, p.TAPONES_PRICE);
  assert.strictEqual(solo.total, Math.floor(p.TAPONES_PRICE * 0.93));
});

test('la cantidad sigue acotada entre 1 y 10', () => {
  assert.strictEqual(m({ cantidad: 0 }).qty, 1);
  assert.strictEqual(m({ cantidad: -5 }).qty, 1);
  assert.strictEqual(m({ cantidad: 99 }).qty, 10);
  assert.strictEqual(m({ cantidad: 'tres' }).qty, 1);
});

test('un envío negativo no puede inflar el descuento', () => {
  assert.strictEqual(m({ cantidad: 1, shippingCost: -50000 }).envio, 0);
  assert.strictEqual(m({ cantidad: 1, shippingCost: -50000 }).total, PRECIO);
});

test('las tres pasarelas calculan el monto con calcularMonto(), no a mano', () => {
  // Esta es la regresión que importa: si alguien vuelve a escribir la fórmula
  // dentro de una ruta, esa pasarela deja de aplicar el descuento y cobra de más.
  for (const f of ['../server.js', '../routes/flow.js', '../routes/transbank.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(src.includes('calcularMonto'), f + ' no usa calcularMonto()');
    assert.ok(!/precioBanda\(\)\s*\*\s*qty\s*\+/.test(src), f + ' volvió a calcular el monto a mano');
    assert.ok(!src.includes('12990'), f + ' tiene el precio del upsell escrito a mano');
  }
});

test('el frontend usa la MISMA regla que el backend', () => {
  // index.html estima el total en pantalla con su propia copia de la fórmula.
  // Si se desincronizan, el cliente ve un precio y la pasarela cobra otro.
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.ok(
    html.includes('Math.floor(sub * (1 - cuponAplicado.pct))'),
    'el redondeo del frontend ya no es floor sobre el subtotal de productos'
  );
});
