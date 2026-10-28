'use strict';
// Reporte de ventas de Mercado Libre (el Excel de ML, convertido por
// scripts/ml_reporte.py en services/datos/mercadolibre-*.json). Cada venta va
// en su DÍA DE COMPRA con lo que deposita ML; cada devolución resta lo que
// cobró ML y no cuenta pedido ni banda; las canceladas no entran. En sus
// fechas el reporte reemplaza a las ventas de ML cargadas a mano, y cada
// reporte se aplica una sola vez. Desde el 28-sep-2026 (los 30 días del
// resumen de ML) las ventas entran con su precio completo y los cargos de ML,
// y las devoluciones en $0 (su costo va dentro de esos cargos).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const metrics = require('../services/metrics');
const u = require('../services/utilidad');

const DIR = path.join(__dirname, '..', 'services', 'datos');
const diaChile = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const hace = n => Date.now() - n * 86400000;
// Pide los días que hagan falta para llegar a `fecha`, aunque sea vieja.
const deDia = (fecha) => metrics.ventasPorDia(Math.max(30, Math.ceil((Date.now() - Date.parse(fecha)) / 86400000) + 2))
  .find(d => d.fecha === fecha);
// Días de antes del precio completo: ahí manda lo depositado.
const DEPOSITADO = ['2026-09-20', '2026-09-21', '2026-09-22'];
const mediodia = dia => dia + 'T15:00:00Z';

test('el precio completo corre desde el 28-sep, y los días de lo depositado son anteriores', () => {
  assert.strictEqual(metrics.ML_PRECIO_COMPLETO_DESDE, '2026-09-28');
  assert.ok(DEPOSITADO.every(d => d < metrics.ML_PRECIO_COMPLETO_DESDE));
});

test('las ventas caen en su día de compra y las devoluciones restan sin pedido ni banda', () => {
  const id = 'ml-test-' + Date.now();
  const dVenta = DEPOSITADO[0], dDev = DEPOSITADO[1];
  const antesV = deDia(dVenta), antesD = deDia(dDev);
  const r = metrics.importarMercadoLibre({ id, ventas: [
    { orden: id + '-1', fecha: mediodia(dVenta), monto: 57461, precio: 68990, unidades: 1 },
    { orden: id + '-2', fecha: mediodia(dDev), monto: -9750, unidades: 0, devolucion: true },
  ] });
  assert.ok(r.aplicado);
  const v = deDia(dVenta), d = deDia(dDev);
  assert.strictEqual(v.pedidos, antesV.pedidos + 1);
  assert.strictEqual(v.pedidosExternos, antesV.pedidosExternos + 1);
  assert.strictEqual(v.unidades, antesV.unidades + 1, 'la venta lleva su banda');
  assert.strictEqual(v.ingresos, antesV.ingresos + 57461);
  assert.strictEqual(v.brutoML, antesV.brutoML, 'antes del 28-sep manda lo depositado, aunque venga el precio');
  assert.strictEqual(d.devoluciones, antesD.devoluciones + 1);
  assert.strictEqual(d.pedidos, antesD.pedidos, 'una devolución no es un pedido');
  assert.strictEqual(d.unidades, antesD.unidades, 'la banda volvió: no se resta su costo');
  assert.strictEqual(d.ingresos, antesD.ingresos - 9750, 'resta lo que cobró ML');
  // En la utilidad: la devolución baja lo mismo que cobró ML, sin envío ni pasarela.
  const sin = u.calcularDia({ ...antesD }, 0), con = u.calcularDia({ ...d }, 0);
  assert.strictEqual(con.utilidad, sin.utilidad - 9750);
  assert.strictEqual(con.devoluciones, (antesD.devoluciones || 0) + 1);
  assert.strictEqual(u.totalizar([con, con]).devoluciones, 2 * con.devoluciones);
});

test('cada reporte se aplica una sola vez', () => {
  const id = 'ml-test-una-' + Date.now();
  const dia = diaChile(hace(4));
  const lote = { id, ventas: [{ orden: id + '-1', fecha: new Date(hace(4)).toISOString(), monto: 50000, unidades: 1 }] };
  const antes = deDia(dia).ingresos;
  assert.ok(metrics.importarMercadoLibre(lote).aplicado);
  assert.strictEqual(metrics.importarMercadoLibre(lote).aplicado, false, 'el segundo arranque no lo vuelve a sumar');
  assert.strictEqual(deDia(dia).ingresos, antes + 50000);
});

test('en sus fechas reemplaza las ventas de ML cargadas a mano, y no toca las de la web ni las de otras fechas', () => {
  const id = 'ml-test-repl-' + Date.now();
  const dia = diaChile(hace(3)), fuera = diaChile(hace(20));
  metrics.registrarVenta({ monto: 55555, metodo: 'Mercado Libre', orden: 'manual-' + id, fecha: new Date(hace(3)).toISOString(), unidades: 1 });
  metrics.registrarVenta({ monto: 44444, metodo: 'Mercado Libre', orden: 'manual-fuera-' + id, fecha: new Date(hace(20)).toISOString(), unidades: 1 });
  const antes = deDia(dia), antesFuera = deDia(fuera);
  const r = metrics.importarMercadoLibre({ id, ventas: [
    { orden: id + '-1', fecha: new Date(hace(3) + 3600000).toISOString(), monto: 57461, unidades: 1 },
  ] });
  assert.ok(r.reemplazadas >= 1, 'la cargada a mano en esas fechas se reemplaza');
  const ahora = deDia(dia);
  assert.strictEqual(ahora.pedidosExternos, antes.pedidosExternos, 'la manual sale y entra la del reporte: queda una');
  assert.strictEqual(ahora.ingresosExternos, antes.ingresosExternos - 55555 + 57461);
  assert.strictEqual(ahora.pedidos - ahora.pedidosExternos, antes.pedidos - antes.pedidosExternos, 'las de la web no se tocan');
  assert.deepStrictEqual(deDia(fuera), antesFuera, 'fuera de las fechas del reporte no cambia nada');
});

test('un reporte nuevo actualiza una venta que terminó en devolución', () => {
  const base = 'ml-test-upd-' + Date.now();
  const dia = DEPOSITADO[2];
  const antes = deDia(dia);
  const fecha = mediodia(dia);
  metrics.importarMercadoLibre({ id: base + '-a', ventas: [{ orden: base + '-1', fecha, monto: 57461, unidades: 1 }] });
  metrics.importarMercadoLibre({ id: base + '-b', ventas: [{ orden: base + '-1', fecha, monto: -9750, unidades: 0, devolucion: true }] });
  const d = deDia(dia);
  assert.strictEqual(d.pedidos, antes.pedidos, 'ya no cuenta como venta');
  assert.strictEqual(d.devoluciones, antes.devoluciones + 1);
  assert.strictEqual(d.ingresos, antes.ingresos - 9750);
});

test('desde el 28-sep las ventas del reporte van con su precio completo y las devoluciones en $0', () => {
  const id = 'ml-test-bruto-' + Date.now();
  const dVenta = diaChile(hace(6)), dDev = diaChile(hace(5)), dSin = diaChile(hace(4));
  const antesV = deDia(dVenta), antesD = deDia(dDev), antesS = deDia(dSin);
  metrics.importarMercadoLibre({ id, ventas: [
    { orden: id + '-1', fecha: new Date(hace(6)).toISOString(), estimado: true, monto: 57461, precio: 68990, unidades: 1 },
    { orden: id + '-2', fecha: new Date(hace(5)).toISOString(), estimado: true, monto: -9750, unidades: 0, devolucion: true },
    // Sin el precio (un reporte armado con el script viejo) queda lo depositado.
    { orden: id + '-3', fecha: new Date(hace(4)).toISOString(), monto: 57561, unidades: 1 },
  ] });
  const v = deDia(dVenta), d = deDia(dDev), s = deDia(dSin);
  assert.strictEqual(v.ingresos, antesV.ingresos + 68990, '"Vendido" es el precio completo');
  assert.strictEqual(v.brutoML, antesV.brutoML + 68990, 'lleva los cargos de ML');
  assert.strictEqual(v.unidades, antesV.unidades + 1);
  assert.strictEqual(v.mlEstimado, antesV.mlEstimado, 'con el precio no queda nada estimado');
  assert.strictEqual(d.devoluciones, antesD.devoluciones + 1, 'la devolución se sigue viendo');
  assert.strictEqual(d.ingresos, antesD.ingresos, 'pero no resta: su costo va en los cargos de ML');
  assert.strictEqual(d.mlEstimado, antesD.mlEstimado);
  assert.strictEqual(s.ingresos, antesS.ingresos + 57561);
  assert.strictEqual(s.brutoML, antesS.brutoML);
  // En la utilidad, la venta deja lo mismo que una cargada a mano con $68.990.
  const sin = u.calcularDia({ ...antesV }, 0), con = u.calcularDia({ ...v }, 0);
  assert.strictEqual(con.utilidad - sin.utilidad, 68990 - 20956 - u.COSTO_BANDA);
});

test('el reporte guardado, más la venta posterior, da lo mismo que el resumen de ML de 30 días', () => {
  const f = fs.readdirSync(DIR).filter(x => /^mercadolibre-.*\.json$/.test(x)).sort().pop();
  const lote = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const enVentana = lote.ventas.filter(v => diaChile(Date.parse(v.fecha)) >= metrics.ML_PRECIO_COMPLETO_DESDE);
  const ventas = enVentana.filter(v => !v.devolucion);
  assert.strictEqual(ventas.length, 16, 'el Excel trae 16 de las 17 del resumen');
  for (const v of ventas) {
    assert.strictEqual(v.precio, 68990 * v.unidades, v.orden + ': precio de la publicación');
    // Lo depositado + 12% de ML + envío ($3.150 o $3.250) = precio completo.
    assert.ok([3150, 3250].includes(v.precio - Math.round(v.precio * 0.12) - v.monto), v.orden + ': no calza con lo depositado');
  }
  assert.strictEqual(enVentana.filter(v => v.devolucion).length, 2);
  // Por día, como en el panel, más la venta 17 (posterior al Excel).
  const porDia = {};
  for (const v of ventas) { const k = diaChile(Date.parse(v.fecha)); porDia[k] = (porDia[k] || 0) + v.precio; }
  const filas = Object.values(porDia).concat([68990]).map(b => u.calcularDia({ pedidos: 1, unidades: 1, ingresos: b,
    pedidosExternos: 1, unidadesExternas: 1, ingresosExternos: b, brutoML: b }, 0));
  const t = u.totalizar(filas);
  assert.strictEqual(t.ingresos, 1172830, 'ventas concretadas del resumen');
  assert.ok(Math.abs(t.cargosML - 356257) <= 5, 'cargos e inversiones: ' + t.cargosML);
  assert.ok(Math.abs(t.ingresos - t.cargosML - 816573) <= 5, 'recibiste: ' + (t.ingresos - t.cargosML));
});

test('el reporte guardado no trae datos de los compradores y sus números calzan', () => {
  const archivos = fs.readdirSync(DIR).filter(f => /^mercadolibre-.*\.json$/.test(f));
  assert.ok(archivos.length, 'falta el reporte de Mercado Libre en services/datos');
  for (const f of archivos) {
    const lote = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    assert.strictEqual('mercadolibre-' + lote.id.replace(/^ml-/, '') + '.json', f, 'el id tiene que calzar con el nombre del archivo');
    const ordenes = new Set();
    let ventas = 0, devs = 0, depositado = 0, cobrado = 0;
    for (const v of lote.ventas) {
      for (const k of Object.keys(v)) assert.ok(['orden', 'fecha', 'monto', 'precio', 'unidades', 'devolucion', 'estimado'].includes(k), f + ': campo de más ' + k);
      if (v.precio !== undefined) assert.ok(!v.devolucion && v.precio >= v.monto, f + ': precio completo inválido en ' + v.orden);
      assert.match(v.orden, /^ml-\d+$/);
      assert.ok(!ordenes.has(v.orden), f + ': orden repetida ' + v.orden);
      ordenes.add(v.orden);
      assert.ok(!isNaN(Date.parse(v.fecha)), f + ': fecha inválida');
      if (v.devolucion) { devs++; cobrado += v.monto; assert.ok(v.monto <= 0 && v.unidades === 0); }
      else { ventas++; depositado += v.monto; assert.ok(v.monto > 0 && v.unidades >= 1); }
    }
    assert.deepStrictEqual([ventas, devs, depositado, cobrado],
      [lote.resumen.ventas, lote.resumen.devoluciones, lote.resumen.depositado, lote.resumen.cobradoPorDevoluciones]);
  }
  // Ni siquiera en el resto del archivo: ningún RUT, nombre ni dirección.
  const txt = archivos.map(f => fs.readFileSync(path.join(DIR, f), 'utf8')).join('\n');
  assert.doesNotMatch(txt, /RUT|comprador|direcci|domicilio|@/i);
});

test('el servidor aplica los reportes al arrancar, después de cargar las métricas', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(srv, /await metrics\.init\(\);[^\n]*\n\s*importarReportesML\(\);/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.includes("'conCorreas','devoluciones','pedidosExternos'"), 'el panel tiene que sumar las devoluciones');
});
