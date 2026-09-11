'use strict';
// La cuenta con la que se deciden los presupuestos. Los dos errores fáciles:
// cobrar el envío por unidad (un pedido de 3 bandas se despacha UNA vez) y el
// costo de banda por pedido (un pedido de 3 bandas cuesta el TRIPLE).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const u = require('../services/utilidad');

test('un día normal: 3 pedidos de 1 banda', () => {
  const r = u.calcularDia({ fecha: '2026-09-08', pedidos: 3, unidades: 3, ingresos: 188970 }, 62454);
  assert.strictEqual(r.costoBandas, 51000);   // 3 x 17.000
  assert.strictEqual(r.costoEnvios, 12000);   // 3 x 4.000
  assert.strictEqual(r.pasarela, 6614);       // 3,5% de 188.970
  assert.strictEqual(r.adsNeto, 62454);       // lo que reporta la API
  assert.strictEqual(r.ads, 74320);           // lo que se cobra, con IVA
  assert.strictEqual(r.utilidad, 188970 - 51000 - 12000 - 6614 - 74320);
  assert.strictEqual(r.utilidad, 45036);
});

test('el envío es por PEDIDO, no por unidad', () => {
  // Un solo pedido de 3 bandas: 3 costos de banda, UN envío.
  const r = u.calcularDia({ fecha: '2026-09-08', pedidos: 1, unidades: 3, ingresos: 188970 }, 0);
  assert.strictEqual(r.costoBandas, 51000, 'la banda se cobra por unidad');
  assert.strictEqual(r.costoEnvios, 4000, 'el envío se cobra UNA vez por pedido');
});

test('el costo de banda es por UNIDAD, no por pedido', () => {
  const uno = u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 62990 }, 0);
  const tres = u.calcularDia({ pedidos: 1, unidades: 3, ingresos: 188970 }, 0);
  assert.strictEqual(tres.costoBandas, uno.costoBandas * 3);
});

test('un día sin ventas es el gasto de ads en rojo', () => {
  const r = u.calcularDia({ fecha: '2026-09-10', pedidos: 0, unidades: 0, ingresos: 0 }, 78000);
  // Con IVA: 78.000 x 1,19. Un dia sin ventas duele 19% mas de lo que dice la API.
  assert.strictEqual(r.utilidad, -92820);
});

test('un día con pocas ventas puede dar negativo', () => {
  // 1 venta con $66.708 de ads: el caso real del 9/9.
  const r = u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 62990 }, 66708);
  assert.ok(r.utilidad < 0, 'una venta no paga 66.708 de publicidad');
  assert.strictEqual(r.utilidad, 62990 - 17000 - 4000 - 2205 - Math.round(66708 * 1.19));
});

test('el punto de equilibrio calza con el margen de $38.785', () => {
  // Margen por banda = 62.990 - 17.000 - 4.000 - 2.205 (3,5%) = 39.785.
  // Sin ads, un pedido de 1 banda deja exactamente eso.
  const r = u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 62990 }, 0);
  assert.strictEqual(r.utilidad, 39785);
});

test('entradas vacías o basura no rompen la cuenta', () => {
  const r = u.calcularDia({}, undefined);
  assert.strictEqual(r.utilidad, 0);
  assert.strictEqual(r.pedidos, 0);
});

test('el total suma todas las columnas', () => {
  const filas = [
    u.calcularDia({ pedidos: 2, unidades: 2, ingresos: 125980 }, 53910),
    u.calcularDia({ pedidos: 0, unidades: 0, ingresos: 0 }, 78000),
    u.calcularDia({ pedidos: 4, unidades: 5, ingresos: 314950 }, 70814)
  ];
  const t = u.totalizar(filas);
  assert.strictEqual(t.pedidos, 6);
  assert.strictEqual(t.unidades, 7);
  assert.strictEqual(t.adsNeto, 53910 + 78000 + 70814);
  assert.strictEqual(t.ads, Math.round(53910 * 1.19) + Math.round(78000 * 1.19) + Math.round(70814 * 1.19));
  assert.strictEqual(t.utilidad, filas.reduce((a, f) => a + f.utilidad, 0));
});

// ── Cableado ─────────────────────────────────────────────────────────────
test('el endpoint usa el módulo y no recalcula por su cuenta', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/utilidad_\.calcularDia\(/.test(srv));
  assert.ok(/utilidad_\.totalizar\(/.test(srv));
  assert.ok(!/const COSTO_BANDA = /.test(srv), 'los costos viven en services/utilidad.js, no duplicados en server.js');
});

test('las ventas guardan la cantidad en las tres pasarelas', () => {
  // Sin esto el costo de banda se estima desde el monto y un pedido de 3
  // bandas se cuenta como 1.
  for (const f of ['server.js', 'routes/flow.js', 'routes/transbank.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    // Nada de [^)]* acá: el argumento `email` lleva paréntesis propios
    // (`email: (pedido && ...) || st.payer`) y el patrón se cortaba ahí,
    // dando por faltante algo que sí estaba.
    const i = src.indexOf('registrarVenta(');
    assert.ok(i >= 0, f + ' debe registrar la venta');
    const llamada = src.slice(i, i + 600);
    assert.ok(/unidades:/.test(llamada), f + ' debe pasar unidades a registrarVenta');
    assert.ok(/soloTapones:/.test(llamada), f + ' debe marcar los pedidos de solo tapones');
  }
});

test('el gasto en ads tiene respaldo cuando Meta bloquea el nodo de la cuenta', () => {
  // Esta cuenta responde "API access blocked" a /act_XXX/insights pero sí
  // contesta /{campaignId}/insights, que es lo que usa el gráfico de CTR.
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'meta-ads.js'), 'utf8');
  const i = src.indexOf('async function getGastoDiarioCuenta');
  assert.ok(i >= 0);
  const fn = src.slice(i, src.indexOf('\n}', i));
  assert.ok(/listCampaigns\(\)/.test(fn), 'debe poder sumar campaña por campaña');
  assert.ok(/getInsightsDiarios\(/.test(fn), 'el respaldo usa el endpoint que sí responde');
  // Las campañas PAUSADAS gastaron plata mientras corrían: filtrar por ACTIVE
  // acá subestimaría el gasto y sobrestimaría la utilidad.
  assert.ok(!/status\s*===\s*'ACTIVE'/.test(fn), 'no debe filtrar por campañas activas');
});

test('el endpoint entiende el nuevo retorno {mapa, via}', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/r\.mapa/.test(srv), 'debe leer el mapa del retorno');
  assert.ok(/via/.test(srv), 'debe reportar por qué camino vino el dato');
});

test('el gasto en ads lleva el 19% de IVA', () => {
  // Meta REPORTA sin IVA y COBRA con IVA. Verificado contra el recibo de
  // agosto: campañas $88.898 -> cargo $105.789, que es 88.898 x 1,19.
  const r = u.calcularDia({ pedidos: 0, unidades: 0, ingresos: 0 }, 88898);
  assert.strictEqual(r.adsNeto, 88898);
  assert.strictEqual(r.ads, 105789, 'tiene que dar el cargo real del recibo');
  assert.strictEqual(r.ivaAds, 105789 - 88898);
  assert.strictEqual(r.utilidad, -105789, 'un día sin ventas pierde el cargo CON IVA');
});

test('el IVA no se aplica dos veces al totalizar', () => {
  const filas = [u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 62990 }, 50000),
                 u.calcularDia({ pedidos: 0, unidades: 0, ingresos: 0 }, 30000)];
  const t = u.totalizar(filas);
  assert.strictEqual(t.adsNeto, 80000);
  assert.strictEqual(t.ads, Math.round(50000 * 1.19) + Math.round(30000 * 1.19));
  assert.strictEqual(t.ivaAds, t.ads - t.adsNeto);
});

test('una venta de la noche no se corre al día siguiente', () => {
  // Render corre en UTC; las ventas se agrupan por día de CHILE. Una compra a
  // las 22:00 del 10 en Chile son las 01:00 UTC del 11: si se agrupara por
  // fecha del servidor, aparecería como venta del 11 y el día 10 saldría vacío.
  const enChile = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  assert.strictEqual(enChile(Date.UTC(2026, 8, 11, 1, 0, 0)), '2026-09-10');
  // Y a la 01:25 de la madrugada del 11 en Chile, "hoy" es el 11.
  assert.strictEqual(enChile(Date.UTC(2026, 8, 11, 4, 25, 0)), '2026-09-11');
});

test('metrics agrupa por día de Chile, no por el reloj del servidor', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'metrics.js'), 'utf8');
  const i = src.indexOf('function ventasPorDia');
  assert.ok(i >= 0);
  const fn = src.slice(i, src.indexOf('\n}', i));
  assert.ok((fn.match(/America\/Santiago/g) || []).length >= 2,
    'tanto las ventas como los días del rango tienen que ir en hora de Chile');
});
