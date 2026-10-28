'use strict';
// Limpieza única del 28-oct-2026: las ventas de ML cargadas a mano con lo que
// depositaba ML (el dueño usaba $57.990) se sacan, porque las vuelve a subir
// con el precio completo. Las del reporte de ML y las de precio completo quedan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const metrics = require('../services/metrics');

test('saca solo las de ML cargadas a mano con lo depositado, y una sola vez', () => {
  const fecha = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }) + 'T12:00:00-03:00';
  const hoy = () => metrics.ventasPorDia(1)[0];
  const antes = hoy();
  const id = 'limpieza-' + Date.now();
  // El reporte va primero: si no, reemplazaría las cargadas a mano de su día.
  metrics.importarMercadoLibre({ id: id + '-reporte', ventas: [{ orden: 'ml-' + id, fecha, monto: 57461, unidades: 1 }] });
  metrics.registrarVenta({ monto: 57990, metodo: 'Mercado Libre', orden: id + '-neta', fecha, unidades: 1 });
  metrics.registrarVenta({ monto: 115980, metodo: 'Mercado Libre', orden: id + '-neta-2', fecha, unidades: 2 });
  metrics.registrarVenta({ monto: 68990, metodo: 'Mercado Libre', orden: id + '-bruta', fecha, unidades: 1, bruto: true });
  assert.strictEqual(hoy().pedidosExternos, antes.pedidosExternos + 4);

  const r = metrics.quitarMLNetasCargadasAMano();
  assert.strictEqual(r.aplicado, true);
  assert.deepStrictEqual(r.quitadas.map(x => x.monto), [57990, 115980]);
  const despues = hoy();
  assert.strictEqual(despues.pedidosExternos, antes.pedidosExternos + 2, 'quedan la del reporte y la de precio completo');
  assert.strictEqual(despues.ingresosExternos, antes.ingresosExternos + 57461 + 68990);
  assert.strictEqual(despues.brutoML, antes.brutoML + 68990);
  assert.ok(!metrics.ventaYaRegistrada(id + '-neta'));
  assert.ok(metrics.ventaYaRegistrada(id + '-bruta'));
  assert.ok(metrics.ventaYaRegistrada('ml-' + id));

  // Una sola vez: un reinicio no vuelve a barrer lo que se cargue después.
  metrics.registrarVenta({ monto: 57990, metodo: 'Mercado Libre', orden: id + '-despues', fecha, unidades: 1 });
  assert.deepStrictEqual(metrics.quitarMLNetasCargadasAMano(), { aplicado: false });
  assert.ok(metrics.ventaYaRegistrada(id + '-despues'));
});

test('el servidor la corre al arrancar, después de aplicar los reportes de ML', () => {
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = srv.indexOf('function importarReportesML()');
  const fin = srv.indexOf('\n}\n', i);
  const cuerpo = srv.slice(i, fin);
  assert.ok(cuerpo.indexOf('metrics.quitarMLNetasCargadasAMano()') > cuerpo.indexOf('metrics.importarMercadoLibre('),
    'la limpieza va dentro de importarReportesML, después de los reportes');
});
