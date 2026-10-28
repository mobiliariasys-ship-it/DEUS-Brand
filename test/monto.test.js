'use strict';
// Lo que se COBRA vive en un solo lugar: calcularMonto() de services/precio.js.
// Antes la fórmula estaba copiada nueve veces entre server.js, flow.js y
// transbank.js — el cobro, el registro del pedido y el aviso de pago fallido en
// cada uno —, más TAPONES_PRICE declarado tres veces y el 12990 del upsell
// escrito a mano en seis. Con copias así, olvidarse de una significa cobrar
// distinto según por dónde entró el cliente.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const p = require('../services/precio');

const PRECIO = p.DESPUES.precio;          // $68.990 hoy
const m = (o) => p.calcularMonto(o);

test('una banda sin envío cobra el precio de lista', () => {
  const r = m({ cantidad: 1 });
  assert.strictEqual(r.productos, PRECIO);
  assert.strictEqual(r.envio, 0);
  assert.strictEqual(r.total, PRECIO);
});

test('el envío se suma aparte de los productos', () => {
  const r = m({ cantidad: 2, shippingCost: 4000 });
  assert.strictEqual(r.productos, PRECIO * 2);
  assert.strictEqual(r.envio, 4000);
  assert.strictEqual(r.total, PRECIO * 2 + 4000);
});

test('los tapones agregados y la compra de solo tapones usan precios distintos', () => {
  // No son intercambiables: UPSELL es lo que cuestan junto a una banda,
  // TAPONES_PRICE lo que cuestan solos. Confundirlos cobra de menos o de más.
  const conTapones = m({ cantidad: 1, tapones: true });
  assert.strictEqual(conTapones.total, PRECIO + p.UPSELL_TAPONES);

  const solo = m({ cantidad: 2, soloTapones: true });
  assert.strictEqual(solo.total, p.TAPONES_PRICE * 2);

  // Pedir tapones sueltos no arrastra el precio de la banda.
  assert.ok(solo.total < PRECIO);
});

test('la cantidad queda acotada entre 1 y 10', () => {
  assert.strictEqual(m({ cantidad: 0 }).qty, 1);
  assert.strictEqual(m({ cantidad: -5 }).qty, 1);
  assert.strictEqual(m({ cantidad: 99 }).qty, 10);
  assert.strictEqual(m({ cantidad: 'tres' }).qty, 1);
});

test('un envío negativo no puede bajar el total', () => {
  const r = m({ cantidad: 1, shippingCost: -50000 });
  assert.strictEqual(r.envio, 0);
  assert.strictEqual(r.total, PRECIO);
});

test('las tres pasarelas calculan el monto con calcularMonto(), no a mano', () => {
  // Esta es la regresión que importa: si alguien vuelve a escribir la fórmula
  // dentro de una ruta, esa pasarela empieza a cobrar por su cuenta.
  for (const f of ['../server.js', '../routes/flow.js', '../routes/transbank.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(src.includes('calcularMonto'), f + ' no usa calcularMonto()');
    assert.ok(!/precioBanda\(\)\s*\*\s*qty\s*\+/.test(src), f + ' volvió a calcular el monto a mano');
    assert.ok(!src.includes('12990'), f + ' tiene el precio del upsell escrito a mano');
  }
});
