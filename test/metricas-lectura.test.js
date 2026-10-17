'use strict';
// Métricas de solo lectura (METRICAS_KEY): solo números, nunca datos de
// clientes, y una clave aparte que no abre nada que modifique.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const m = require('../services/metricas-lectura');

const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('la respuesta no lleva datos de clientes aunque el resumen los traiga', () => {
  const snap = {
    vistasTotal: 1000, conversion: 1.2, embudo: { visitas: 1000, checkouts: 40, ventas: 12 },
    conducta: { 'hito:precio': 800 }, ventasRecientes: [{ f: '2026-10-10', m: 68990, me: 'mp' }],
    tickets: [{ nombre: 'Ana Pérez', email: 'ana@correo.cl', instagram: '@ana', orden: 'X1' }],
    clientesNuevos: [{ nombre: 'Luis', telefono: '+56911111111' }]   // un campo futuro cualquiera
  };
  const pedidos = [
    { color: 'Negro', cantidad: 2, customer: { name: 'Ana Pérez', email: 'ana@correo.cl', rut: '11.111.111-1' },
      shipping: { address: { commune: 'Ñuñoa', street: 'Calle Falsa 123' } } },
    { colores: ['Gris', 'Negro'], customer: { name: 'Luis' }, shipping: { address: { commune: 'Maipú' } } }
  ];
  const r = m.armar(snap, pedidos, 7);
  const txt = JSON.stringify(r);
  for (const dato of ['Ana Pérez', 'ana@correo.cl', '@ana', 'Luis', '+56911111111', '11.111.111-1', 'Calle Falsa']) {
    assert.ok(!txt.includes(dato), 'se coló un dato de cliente: ' + dato);
  }
  assert.strictEqual(r.tickets, undefined);
  assert.strictEqual(r.clientesNuevos, undefined, 'un campo nuevo del resumen no viaja solo');
  assert.deepStrictEqual(r.embudo, snap.embudo);
  assert.deepStrictEqual(r.pedidosPorColor, { Negro: 3, Gris: 1 }, 'cuenta por unidad, como el panel');
  assert.deepStrictEqual(r.pedidosPorComuna, { 'Ñuñoa': 1, 'Maipú': 1 });
  assert.strictEqual(r.pedidosTotal, 2);
  assert.strictEqual(r.stock, 7);
});

test('la clave se compara completa y sin clave configurada no abre nada', () => {
  assert.ok(m.claveValida('abc123', 'abc123'));
  assert.ok(!m.claveValida('abc12', 'abc123'));
  assert.ok(!m.claveValida('', ''), 'sin METRICAS_KEY no hay acceso');
  assert.ok(!m.claveValida(undefined, 'abc123'));
});

test('las rutas de métricas son solo GET, con su propia clave por cabecera', () => {
  const rutas = SRV.match(/app\.(get|post|put|patch|delete|use)\('\/admin\/metricas[^']*'/g) || [];
  assert.deepStrictEqual(rutas.sort(), [
    "app.get('/admin/metricas'", "app.get('/admin/metricas/anuncios'", "app.get('/admin/metricas/utilidad'"
  ]);
  assert.match(SRV, /process\.env\.METRICAS_KEY/);
  assert.match(SRV, /req\.get\('x-metricas-key'\)/, 'la clave va en la cabecera, no en la URL');
  assert.match(SRV, /req\.get\('authorization'\)/, 'también como Authorization: Bearer (secretos de red)');
  assert.ok(!/req\.query\.(clave|key)[^\n]*metricas/i.test(SRV), 'nunca por la URL');
  // Las rutas que modifican siguen exigiendo la clave admin, no la de métricas
  for (const r of ['/admin/ads/budget', '/admin/ads/status', '/stock/ajustar', '/admin/resenas']) {
    const i = SRV.indexOf("'" + r + "'");
    if (i === -1) continue;
    const tramo = SRV.slice(i, i + 400);
    assert.ok(!/claveMetricasOk/.test(tramo), r + ' no puede abrirse con la clave de métricas');
  }
});
