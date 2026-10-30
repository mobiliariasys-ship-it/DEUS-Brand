'use strict';
// Quitar una venta cargada mal desde el panel. Solo se pueden quitar las
// cargadas a mano ("Agregar venta"): las de las pasarelas y las del reporte de
// ML no aparecen ni se pueden borrar desde ahí.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const metrics = require('../services/metrics');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const SRV = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const delDia = () => metrics.ventasPorDia(1)[0];

test('lista y quita solo las cargadas a mano, y la de la web se lleva su ticket', () => {
  const f = hoy() + 'T12:00:00-03:00', id = 'qv-' + Date.now();
  const antes = delDia();
  // De verdad: una del reporte de ML (va primero: el reporte reemplaza las de
  // ML cargadas a mano en su día) y una de Webpay.
  metrics.importarMercadoLibre({ id: id + '-rep', ventas: [{ orden: 'ml-' + id, fecha: f, monto: 57461, precio: 68990, unidades: 1 }] });
  metrics.registrarVenta({ monto: 68990, metodo: 'Webpay', orden: id + '-pasarela', fecha: f, unidades: 1 });
  // Cargadas a mano: de ML, de la web con la marca nueva y de la web vieja ("manual-…").
  metrics.registrarVenta({ monto: 68990, metodo: 'Mercado Libre', orden: id + '-ml', fecha: f, unidades: 1, bruto: true });
  metrics.registrarVenta({ monto: 68990, metodo: 'Transferencia', orden: id + '-web', fecha: f, unidades: 1, manual: true });
  metrics.registrarVenta({ monto: 54990, metodo: 'Presencial', orden: 'manual-' + id, fecha: f, unidades: 1 });

  const lista = metrics.ventasManualesDelDia(hoy()).map(v => v.orden).filter(o => o.includes(id));
  assert.deepStrictEqual(lista.sort(), [id + '-web', 'manual-' + id, id + '-ml'].sort());
  assert.strictEqual(delDia().manuales, antes.manuales + 3, 'el día sabe cuántas cargadas a mano tiene');

  assert.ok(metrics.ventaYaRegistrada(id + '-web'), 'la de la web tiene su ticket del sorteo');
  const q = metrics.quitarVentaManual(id + '-web');
  assert.strictEqual(q.monto, 68990);
  assert.ok(!metrics.ventaYaRegistrada(id + '-web'), 'se fue con su ticket');
  assert.ok(metrics.quitarVentaManual(id + '-ml'));
  assert.ok(metrics.quitarVentaManual('manual-' + id), 'las viejas se reconocen por la orden manual-…');

  assert.strictEqual(metrics.quitarVentaManual(id + '-pasarela'), null, 'una de la pasarela no se toca');
  assert.strictEqual(metrics.quitarVentaManual('ml-' + id), null, 'una del reporte de ML no se toca');
  assert.strictEqual(metrics.quitarVentaManual(''), null);
  assert.strictEqual(metrics.quitarVentaManual(id + '-web'), null, 'la segunda vez ya no está');

  const d = delDia();
  assert.strictEqual(d.manuales, antes.manuales);
  assert.strictEqual(d.pedidos, antes.pedidos + 2, 'quedan la de la pasarela y la del reporte');
  assert.strictEqual(d.ingresos, antes.ingresos + 68990 + 68990);
  // El próximo ticket no repite número aunque se haya borrado uno.
  const nums = metrics.obtenerTickets().map(t => t.numero);
  assert.strictEqual(new Set(nums).size, nums.length);
});

test('el servidor lista y quita con la clave del panel, y marca como manuales las de "Agregar venta"', () => {
  for (const ruta of ["app.get('/admin/ventas-manuales'", "app.post('/admin/venta/quitar'"]) {
    const i = SRV.indexOf(ruta);
    assert.ok(i >= 0, 'falta ' + ruta);
    const bloque = SRV.slice(i, i + 700);
    assert.match(bloque, /clavePanelOk\(req, res\)/, ruta + ' sin clave');
    assert.ok(!/metaCapi|enviarPurchase|decrementStock/.test(bloque), ruta + ': no puede tocar Meta ni el stock');
  }
  assert.match(SRV, /bruto: !!bruto, manual: true/, '/admin/venta tiene que marcar la venta como manual');
});

test('la tabla ofrece "−" solo en los días con ventas cargadas a mano', () => {
  assert.match(HTML, /\(r\.manuales \? '<button class="util-add util-quitar"[^\n]*onclick="abrirQuitarVenta\(/);
});

test('el panel lista las ventas del día y quita la elegida, con confirmación', async () => {
  const extraer = nombre => {
    const i = HTML.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
    assert.ok(i >= 0, 'falta ' + nombre);
    let prof = 0;
    for (let k = HTML.indexOf('{', i); k < HTML.length; k++) {
      if (HTML[k] === '{') prof++;
      else if (HTML[k] === '}' && --prof === 0) return HTML.slice(i, k + 1);
    }
  };
  const els = {};
  const el = id => els[id] || (els[id] = { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, contains: () => false } });
  const pedidos = [];
  let confirmo = true, recargas = 0;
  const ctx = {
    BASE: '', clave: 'k', JSON, Promise, encodeURIComponent,
    document: { getElementById: el },
    confirm: () => confirmo,
    cargarUtilidad: () => { recargas++; },
    fetch: (url, op) => {
      pedidos.push({ url, op });
      const cuerpo = url.startsWith('/admin/ventas-manuales')
        ? { fecha: '2026-10-29', ventas: [] }
        : { ok: true, quitada: {} };
      return Promise.resolve({ ok: true, json: () => Promise.resolve(cuerpo) });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(['money0', 'esc', 'pintarQuitarVenta', 'cargarQuitarVenta', 'quitarVenta'].map(extraer).join('\n') +
    '\nvar qvFecha = "2026-10-29", qvLista = [];', ctx);
  vm.runInContext('pintarQuitarVenta([{ orden: "manual-1", monto: 68990, metodo: "Mercado Libre", nombre: "<b>Ana</b>", unidades: 1 }])', ctx);
  assert.match(els['qv-lista'].innerHTML, /\$68\.990/);
  assert.match(els['qv-lista'].innerHTML, /&lt;b&gt;Ana/, 'el nombre va escapado');
  assert.match(els['qv-lista'].innerHTML, /onclick="quitarVenta\(0\)"/);

  confirmo = false;
  vm.runInContext('quitarVenta(0)', ctx);
  assert.strictEqual(pedidos.length, 0, 'si no confirma, no se borra nada');

  confirmo = true;
  await vm.runInContext('quitarVenta(0)', ctx);
  assert.strictEqual(pedidos[0].url, '/admin/venta/quitar?clave=k');
  assert.deepStrictEqual(JSON.parse(pedidos[0].op.body), { orden: 'manual-1' });
  assert.match(els['qv-msg'].textContent, /se quitó la venta de \$68\.990/);
  assert.strictEqual(recargas, 1, 'la utilidad se vuelve a cargar');
  assert.ok(pedidos.some(p => p.url.startsWith('/admin/ventas-manuales?fecha=2026-10-29')), 'y la lista del día');
});
