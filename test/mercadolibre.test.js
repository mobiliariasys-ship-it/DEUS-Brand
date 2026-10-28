'use strict';
// Ventas de Mercado Libre cargadas a mano en la utilidad diaria. Desde el
// 28-oct-2026 se cargan con el PRECIO COMPLETO (bruto) y la utilidad les resta
// los cargos de ML (30,4%: publicidad, comisión, envío y devoluciones) y la
// banda: de $68.990 ML se queda $20.959, deposita $48.031 y quedan $31.031.
// Las de antes (y las del reporte de ML) traen lo que DEPOSITA ML, ya sin su
// envío ni su comisión: a esas solo se les resta la banda. Ej.: ML deposita
// $57.000 y la utilidad es $57.000 − $17.000 = $40.000.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const u = require('../services/utilidad');
const metrics = require('../services/metrics');

test('una venta de Mercado Libre deja lo depositado menos la banda, nada más', () => {
  const r = u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 57000,
                            pedidosExternos: 1, unidadesExternas: 1, ingresosExternos: 57000 }, 0);
  assert.strictEqual(r.costoBandas, u.COSTO_BANDA, 'la banda sí se resta');
  assert.strictEqual(r.costoEnvios, 0, 'el envío ya lo descontó Mercado Libre');
  assert.strictEqual(r.pasarela, 0, 'la comisión ya la descontó Mercado Libre');
  assert.strictEqual(r.utilidad, 40000);
});

test('en un día mixto, envío y pasarela se restan solo a las ventas de la web', () => {
  const r = u.calcularDia({ pedidos: 2, unidades: 2, ingresos: 68990 + 57000,
                            pedidosExternos: 1, unidadesExternas: 1, ingresosExternos: 57000 }, 0);
  assert.strictEqual(r.costoBandas, 2 * u.COSTO_BANDA);
  assert.strictEqual(r.costoEnvios, u.COSTO_ENVIO, 'un solo envío: el de la venta web');
  assert.strictEqual(r.pasarela, Math.round(68990 * u.TASA_PASARELA), 'pasarela solo sobre la venta web');
  assert.strictEqual(r.utilidad, (68990 - 17000 - 4000 - 2415) + 40000);
  const t = u.totalizar([r, r]);
  assert.strictEqual(t.pedidosExternos, 2);
  assert.strictEqual(t.unidadesExternas, 2);
  assert.strictEqual(t.ingresosExternos, 114000);
});

test('cargada desde el panel, suma en la utilidad del día y no en las métricas de la web', () => {
  const ORD = 'ml-' + Date.now();
  const antes = metrics.snapshot();
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const diaAntes = metrics.ventasPorDia(30).find(d => d.fecha === fecha) || { pedidos: 0, ingresos: 0, pedidosExternos: 0 };
  const ticket = metrics.registrarVenta({ monto: 57000, metodo: 'Mercado Libre', orden: ORD,
                                          fecha: fecha + 'T12:00:00-03:00', unidades: 1 });
  assert.strictEqual(ticket, null, 'una venta de Mercado Libre no recibe ticket del sorteo');
  const dia = metrics.ventasPorDia(30).find(d => d.fecha === fecha);
  assert.ok(dia, 'la venta tiene que caer en su día');
  assert.strictEqual(dia.pedidos, diaAntes.pedidos + 1);
  assert.strictEqual(dia.ingresos, diaAntes.ingresos + 57000);
  assert.strictEqual(dia.pedidosExternos, (diaAntes.pedidosExternos || 0) + 1);
  const despues = metrics.snapshot();
  assert.strictEqual(despues.ventas.total.count, antes.ventas.total.count, 'no cuenta como venta de la web');
  assert.strictEqual(despues.ticketsTotal, antes.ticketsTotal, 'no entra al sorteo');
  assert.strictEqual(despues.conducta['co:5pago'] || 0, antes.conducta['co:5pago'] || 0, 'no pasó por el checkout');
  // Ninguna métrica de conversión se mueve: ni la histórica ni la de hoy, ni
  // el embudo, ni las ventas por día/periodo con que el panel calcula las
  // conversiones de hoy, semana, mes y el gráfico diario.
  assert.strictEqual(despues.conversion, antes.conversion, 'conversión histórica');
  assert.strictEqual(despues.conversionHoy, antes.conversionHoy, 'conversión de hoy');
  assert.deepStrictEqual(despues.embudo, antes.embudo, 'embudo');
  assert.strictEqual(despues.ventasRecientes.length, antes.ventasRecientes.length, 'ventas del periodo (conversión semana/mes)');
  const suma30 = s => s.ventas30.reduce((x, d) => x + (d.ventas || 0), 0);
  assert.strictEqual(suma30(despues), suma30(antes), 'gráfico de conversión diaria');
  assert.strictEqual(despues.ticketPromedio, antes.ticketPromedio, 'ticket promedio de la web');
  assert.ok(metrics.ventaYaRegistrada(ORD), 'la orden queda registrada');
  // Cargarla dos veces no la suma dos veces.
  metrics.registrarVenta({ monto: 57000, metodo: 'Mercado Libre', orden: ORD, fecha: fecha + 'T12:00:00-03:00', unidades: 1 });
  assert.strictEqual(metrics.ventasPorDia(30).find(d => d.fecha === fecha).pedidos, dia.pedidos);
});

test('el panel ofrece Mercado Libre y no lo cuenta en el costo por venta de los anuncios', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.includes('<option>Mercado Libre</option>'), 'falta la opción en "Agregar venta"');
  assert.ok(html.includes('id="vm-ml-btn"') && html.includes('onclick="vmToggleML()"'),
    'falta el botón de un toque "Venta de Mercado Libre"');
  assert.ok(/var unidadesAds = t\.unidades - \(t\.unidadesExternas \|\| 0\);/.test(html),
    'el costo por venta tiene que dividir solo por las bandas vendidas por la web');
  assert.ok(/var pedidosWeb = t\.pedidos - \(t\.pedidosExternos \|\| 0\);/.test(html) && html.includes("' de ' + pedidosWeb"),
    'el % de pedidos con tapones tiene que contar solo pedidos de la web');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(srv.includes('metrics.ventaYaRegistrada('), '/admin/venta tiene que reconocer también las de Mercado Libre como ya cargadas');
});

// ── Precio completo (desde el 28-oct-2026) ─────────────────────────────────
const VENTA_ML_BRUTA = { pedidos: 1, unidades: 1, ingresos: 68990, pedidosExternos: 1,
                         unidadesExternas: 1, ingresosExternos: 68990, brutoML: 68990 };

test('una venta de ML con precio completo descuenta los cargos de ML y la banda', () => {
  const r = u.calcularDia(VENTA_ML_BRUTA, 0);
  assert.strictEqual(r.mlPublicidad, 8886);
  assert.strictEqual(r.mlComision, 8279);
  assert.strictEqual(r.mlEnvio, 3415);
  assert.strictEqual(r.mlDevolucion, 379);
  assert.strictEqual(r.cargosML, 20959);
  assert.strictEqual(r.costoBandas, u.COSTO_BANDA);
  assert.strictEqual(r.costoEnvios, 0, 'el envío de la web no corre: lo cobra ML');
  assert.strictEqual(r.pasarela, 0, 'tampoco la pasarela de la web');
  assert.strictEqual(r.ads, 0, 'la publicidad de ML no se mezcla con la de Meta');
  assert.strictEqual(r.utilidad, 68990 - 20959 - 17000);
  const t = u.totalizar([r, r]);
  assert.strictEqual(t.cargosML, 2 * 20959);
  assert.strictEqual(t.mlPublicidad, 2 * 8886);
});

test('los cargos de ML calzan con su resumen de los últimos 30 días', () => {
  // 17 ventas × $68.990 = $1.172.830 vendido; $356.257 de cargos e
  // inversiones (30,4%); $816.573 recibido.
  const c = u.CARGOS_ML;
  assert.ok(Math.abs(1172830 * (c.publicidad + c.comision + c.envio + c.devolucion) - 356257) < 100, '30,4% en total');
  // "Distribución de tus costos": cada parte con su % de los cargos.
  const parte = (k, pct) => assert.ok(Math.abs(1172830 * c[k] - 356257 * pct) < 200, k);
  parte('publicidad', 0.424); parte('comision', 0.395); parte('envio', 0.163); parte('devolucion', 0.018);
  // Lo que queda de cada venta es lo que ML dice que deposita en promedio.
  const r = u.calcularDia(VENTA_ML_BRUTA, 0);
  assert.ok(Math.abs((68990 - r.cargosML) - 816573 / 17) < 10);
});

test('cargada con precio completo, el día la suma en brutoML; con lo depositado, no', () => {
  const ORD = 'ml-bruto-' + Date.now();
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const dia = () => metrics.ventasPorDia(30).find(d => d.fecha === fecha) || { brutoML: 0, ingresos: 0, pedidosExternos: 0 };
  const antes = dia();
  metrics.registrarVenta({ monto: 68990, metodo: 'Mercado Libre', orden: ORD, fecha: fecha + 'T12:00:00-03:00',
                           unidades: 1, bruto: true });
  const conBruta = dia();
  assert.strictEqual(conBruta.brutoML, antes.brutoML + 68990);
  assert.strictEqual(conBruta.ingresos, antes.ingresos + 68990, '"Vendido" muestra el precio completo');
  assert.strictEqual(conBruta.pedidosExternos, antes.pedidosExternos + 1);
  // Como se cargaban antes: lo depositado ya viene sin los cargos de ML.
  metrics.registrarVenta({ monto: 57461, metodo: 'Mercado Libre', orden: ORD + '-neto', fecha: fecha + 'T12:00:00-03:00', unidades: 1 });
  assert.strictEqual(dia().brutoML, conBruta.brutoML);
  // Una venta de la web nunca lleva cargos de ML, aunque llegue marcada.
  metrics.registrarVenta({ monto: 68990, metodo: 'Webpay', orden: ORD + '-web', fecha: fecha + 'T12:00:00-03:00', unidades: 1, bruto: true });
  assert.strictEqual(dia().brutoML, conBruta.brutoML);
});

test('el panel pide el precio completo de ML y el servidor lo recibe como bruto', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(html.includes("'Precio de venta en ML'"), 'el formulario pide el precio completo');
  assert.ok(!html.includes('Lo que te deja Mercado Libre'), 'ya no pide lo depositado');
  assert.ok(/bruto: ml\n/.test(html), 'el formulario manda bruto en las ventas de ML');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(/soloTapones, tapones, bruto \} = req\.body/.test(srv) && srv.includes('bruto: !!bruto'),
    '/admin/venta le pasa bruto a metrics');
  assert.ok(srv.includes('ml: utilidad_.CARGOS_ML'), 'el panel recibe los % de ML para hacer la cuenta');
});

test('el formulario muestra cuánto se queda ML con la misma cuenta del servidor', () => {
  const vm = require('vm');
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const extraer = nombre => {
    const i = SRC.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
    assert.ok(i >= 0, 'no encontré function ' + nombre + '() en admin.html');
    let prof = 0;
    for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
      if (SRC[k] === '{') prof++;
      else if (SRC[k] === '}' && --prof === 0) return SRC.slice(i, k + 1);
    }
    throw new Error('llaves sin cerrar en ' + nombre);
  };
  const els = { 'vm-metodo': { value: 'Mercado Libre' }, 'vm-monto': { value: '68990' }, 'vm-unidades': { value: '1' },
                'vm-tapones': { checked: false }, 'vm-ml-calc': { textContent: '' } };
  const ctx = { document: { getElementById: id => els[id] }, Math, Number, parseInt,
                COSTOS_UTIL: { banda: u.COSTO_BANDA, ml: u.CARGOS_ML } };
  vm.createContext(ctx);
  vm.runInContext(['cargosDeML', 'vmCalcML', 'money0'].map(extraer).join('\n'), ctx);
  const calc = () => { vm.runInContext('vmCalcML()', ctx); return els['vm-ml-calc'].textContent; };
  assert.strictEqual(calc(), 'Mercado Libre se queda $20.959 · te deposita $48.031 · menos la banda: $31.031');
  els['vm-unidades'].value = '2'; els['vm-monto'].value = '137980';
  assert.strictEqual(calc(), 'Mercado Libre se queda $41.919 · te deposita $96.061 · menos la banda: $62.061');
  els['vm-tapones'].checked = true;
  assert.strictEqual(calc(), 'Mercado Libre se queda $41.919 · te deposita $96.061', 'sin banda si son solo tapones');
  els['vm-metodo'].value = 'Webpay';
  assert.strictEqual(calc(), '', 'fuera de ML no hay cuenta');
});
