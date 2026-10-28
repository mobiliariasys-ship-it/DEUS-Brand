'use strict';
// Ventas de Mercado Libre cargadas a mano en la utilidad diaria. Se cargan con
// lo que DEPOSITA ML (ya sin su envío ni su comisión): el panel solo les resta
// el costo de la banda. Ej.: vendida a $68.990, ML deposita $57.000 y la
// utilidad real es $57.000 − $17.000 = $40.000.
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
