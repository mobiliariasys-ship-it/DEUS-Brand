'use strict';
// Gasto de la ruleta en la utilidad diaria (pedido del dueño, 23-nov-2026):
// por día, lo que se llevó en premio cada persona que compró con su código,
// según lo que le salió. El descuento ya viene restado de lo vendido (es lo
// que el cliente dejó de pagar), así que va como dato y NO baja la utilidad:
// restarlo otra vez lo contaría dos veces.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ruleta = require('../services/ruleta');
const u = require('../services/utilidad');
const { precioBanda } = require('../services/precio');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// Almacenamiento en memoria, reloj controlable y premios elegidos a mano.
function servicio() {
  const datos = {};
  let t = Date.parse('2026-11-20T15:00:00Z');   // 12:00 en Chile (UTC-3 en noviembre)
  let r = 0.5;
  const s = ruleta.crearServicio({
    load: async (k, f) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : f),
    save: async (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); },
    ahora: () => t,
    azar: () => r,
  });
  return {
    s,
    async gira(correo, id) {
      r = { p7: 0.5, d3000: 0.1, correa: 0.3, tapones: 0.999, d10000: 0.99 }[id];
      assert.strictEqual(ruleta.sortear(r).id, id, 'el azar elegido da ' + id);
      return (await s.girar(correo)).publico.codigo;
    },
    en: iso => { t = Date.parse(iso); },
  };
}

test('suma por día lo que se llevó cada comprador, con el descuento real de su compra', async () => {
  const x = servicio();
  const a = await x.gira('a@gmail.com', 'p7');
  const b = await x.gira('b@gmail.com', 'd3000');
  const c = await x.gira('c@gmail.com', 'correa');
  await x.gira('d@gmail.com', 'd10000');   // giró pero no compró: no cuenta
  await x.s.marcarUsado(a, 'orden-a', { descuento: 4830, unidades: 1 });
  await x.s.marcarUsado(b, 'orden-b', { descuento: 3000, unidades: 2 });
  await x.s.marcarUsado(c, 'orden-c', { descuento: 0, unidades: 1 });
  const g = await x.s.gastoPorDia();
  assert.deepStrictEqual(Object.keys(g), ['2026-11-20']);
  const d = g['2026-11-20'];
  assert.strictEqual(d.ruleta, 7830);
  assert.strictEqual(d.usados, 3);
  assert.strictEqual(d.correas, 1);
  assert.strictEqual(d.tapones, 0);
  assert.strictEqual(d.estimado, false, 'los tres traen el descuento real');
  assert.deepStrictEqual(d.detalle, { '7% OFF': { n: 1, pesos: 4830 }, '$3.000 OFF': { n: 1, pesos: 3000 }, 'Correa extra': { n: 1, pesos: 0 } });
});

test('las compras de antes (sin descuento guardado) se calculan con la regla del premio y las bandas de la venta', async () => {
  const x = servicio();
  const a = await x.gira('a@gmail.com', 'p7');
  const b = await x.gira('b@gmail.com', 'd3000');
  await x.s.marcarUsado(a, 'orden-a');     // como antes del 23-nov: sin extra
  await x.s.marcarUsado(b, 'orden-b');
  const ventas = { 'orden-a': { orden: 'orden-a', unidades: 2 }, 'orden-b': { orden: 'orden-b', unidades: 1 } };
  const d = (await x.s.gastoPorDia({ buscarVenta: o => ventas[o] || null }))['2026-11-20'];
  // El 7% va sobre las DOS bandas de esa compra; el $3.000 es uno por compra.
  assert.strictEqual(d.ruleta, Math.ceil(precioBanda() * 2 * 7 / 100) + 3000);
  assert.strictEqual(d.estimado, true);
});

test('solo cuentan las compras que siguen en el registro de ventas', async () => {
  const x = servicio();
  const a = await x.gira('a@gmail.com', 'p7');
  const b = await x.gira('b@gmail.com', 'd3000');
  await x.s.marcarUsado(a, 'orden-a', { descuento: 4830, unidades: 1 });
  await x.s.marcarUsado(b, 'orden-quitada', { descuento: 3000, unidades: 1 });
  const d = (await x.s.gastoPorDia({ buscarVenta: o => (o === 'orden-a' ? { orden: o, unidades: 1 } : null) }))['2026-11-20'];
  assert.strictEqual(d.ruleta, 4830);
  assert.strictEqual(d.usados, 1);
});

test('el día es el de la compra en hora de Chile, no el del giro', async () => {
  const x = servicio();
  const a = await x.gira('a@gmail.com', 'p7');
  const b = await x.gira('b@gmail.com', 'tapones');
  x.en('2026-11-21T02:30:00Z');            // 23:30 del 20 en Chile
  await x.s.marcarUsado(a, 'orden-a', { descuento: 4830, unidades: 1 });
  x.en('2026-11-21T03:30:00Z');            // 00:30 del 21 en Chile
  await x.s.marcarUsado(b, 'orden-b', { descuento: 0, unidades: 1 });
  const g = await x.s.gastoPorDia();
  assert.strictEqual(g['2026-11-20'].ruleta, 4830);
  assert.strictEqual(g['2026-11-21'].tapones, 1);
  assert.strictEqual(g['2026-11-21'].ruleta, 0);
});

test('un reaviso de la pasarela no cambia lo que se guardó de la compra', async () => {
  const x = servicio();
  const a = await x.gira('a@gmail.com', 'p7');
  assert.strictEqual(await x.s.marcarUsado(a, 'orden-a', { descuento: 4830, unidades: 1 }), true);
  assert.strictEqual(await x.s.marcarUsado(a, 'orden-a', { descuento: 99999, unidades: 9 }), false);
  assert.strictEqual((await x.s.gastoPorDia())['2026-11-20'].ruleta, 4830);
});

test('la utilidad lleva el gasto de la ruleta como dato y no lo resta dos veces', () => {
  const base = { fecha: '2026-11-20', pedidos: 2, unidades: 2, ingresos: 64160 + 65990 };
  const sin = u.calcularDia(base, 20000);
  const con = u.calcularDia({ ...base, ruleta: 7830, ruletaUsados: 2, ruletaCorreas: 1, ruletaTapones: 0, ruletaEstimado: true,
    ruletaDetalle: { '7% OFF': { n: 1, pesos: 4830 } } }, 20000);
  assert.strictEqual(con.utilidad, sin.utilidad, 'el descuento ya está dentro de lo vendido');
  assert.strictEqual(con.ruleta, 7830);
  assert.strictEqual(con.ruletaUsados, 2);
  assert.strictEqual(con.ruletaCorreas, 1);
  assert.strictEqual(con.ruletaEstimado, true);
  assert.strictEqual(sin.ruleta, 0);
  const t = u.totalizar([con, con, sin]);
  assert.strictEqual(t.ruleta, 15660);
  assert.strictEqual(t.ruletaUsados, 4);
  assert.strictEqual(t.ruletaCorreas, 2);
});

test('el servidor suma la ruleta a cada día y las tres pasarelas guardan el descuento al pagar', () => {
  const server = leer('server.js');
  assert.match(server, /gastoPorDia\(\{ buscarVenta: metrics\.buscarVenta \}\)/);
  assert.match(server, /marcarUsado\(codigoPremioPago, info\.id, \{ descuento: descuentoPago, unidades: pedido\.cantidad \}\)/);
  assert.match(leer('routes', 'transbank.js'), /marcarUsado\(pedido\.codigoPremio, result\.buy_order, \{ descuento: pedido\.descuento, unidades: pedido\.cantidad \}\)/);
  assert.match(leer('routes', 'flow.js'), /marcarUsado\(pedido\.codigoPremio, st\.commerceOrder, \{ descuento: pedido\.descuento, unidades: pedido\.cantidad \}\)/);
});

test('el panel muestra la columna, la tarjeta y la explicación de la ruleta en la utilidad diaria', () => {
  const admin = leer('admin.html');
  assert.match(admin, /<th class="ruleta" title="[^"]*Ya está descontado de lo vendido[^"]*">🎡 Ruleta<\/th>/);
  assert.match(admin, /kpi\('Gastado en la ruleta', money0\(t\.ruleta \|\| 0\)/);
  assert.match(admin, /celdaRuleta\(r, 'td'\)/);
  assert.match(admin, /function celdaRuleta\(r, tag\)\{/);
  assert.match(admin, /no se resta de nuevo/);
});
