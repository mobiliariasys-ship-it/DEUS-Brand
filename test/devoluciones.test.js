'use strict';
// Devoluciones pagadas a clientes (10-nov-2026): la utilidad por mes resta la
// plata que el dueño devolvió. Salen de su cartola de Banco Falabella (se
// identifican cada mes y quedan en services/datos/devoluciones-*.json) y de
// las que agrega a mano en el panel. Estos tests cuidan tres cosas: que no se
// reste dos veces la misma devolución, que el archivo del repositorio (que es
// PÚBLICO) no lleve nombres, y que el mes cuadre.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const dv = require('../services/devoluciones');
const u = require('../services/utilidad');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// Almacenamiento en memoria, reloj fijo y una cartola de prueba.
function servicio(cartola) {
  const datos = {};
  let t = Date.parse('2026-11-10T15:00:00Z');
  const s = dv.crearServicio({
    load: async (k, f) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : f),
    save: async (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); },
    ahora: () => t,
    cartola: cartola || { meses: ['2026-10'], devoluciones: [
      { id: 'c1', fecha: '2026-10-07', monto: 68990, nota: 'Devolución completa', origen: 'cartola' },
      { id: 'c2', fecha: '2026-10-29', monto: 62840, nota: '', origen: 'cartola' },
    ] },
  });
  return { s, datos, avanzar: ms => { t += ms; } };
}

test('la cartola del repositorio: 4 devoluciones en septiembre y 4 en octubre, sin nombres', () => {
  const c = dv.leerCartolas();
  assert.deepStrictEqual(c.meses, ['2026-07', '2026-09', '2026-10']);
  const suma = mes => c.devoluciones.filter(d => d.fecha.startsWith(mes)).reduce((a, d) => a + d.monto, 0);
  assert.strictEqual(c.devoluciones.length, 8);
  assert.strictEqual(suma('2026-09'), 235960);
  assert.strictEqual(suma('2026-10'), 257660);
  assert.ok(c.devoluciones.every(d => d.origen === 'cartola' && dv.fechaValida(d.fecha)));
  // El repositorio es público: en estos archivos va solo fecha, monto y una
  // nota genérica. Nada de "Transf. para <nombre>", RUT ni números de cuenta.
  const dir = path.join(__dirname, '..', 'services', 'datos');
  for (const f of fs.readdirSync(dir).filter(x => /^devoluciones-.*\.json$/.test(x))) {
    const crudo = fs.readFileSync(path.join(dir, f), 'utf8');
    const j = JSON.parse(crudo);
    for (const d of j.devoluciones) {
      assert.deepStrictEqual(Object.keys(d).sort(), ['fecha', 'monto', 'nota'], f + ': solo fecha, monto y nota');
      assert.match(d.nota, /^Devolución( a cliente| completa| con el envío descontado: \$[\d.]+ − \$[\d.]+)$/, f + ': nota genérica, sin nombres');
    }
    assert.ok(!/transf|rut\b|\d{2}-\d{3}-/i.test(crudo), f + ': no lleva datos de la cuenta ni de personas');
  }
});

test('lo que se resta por mes: la cartola más lo cargado a mano', async () => {
  const { s } = servicio();
  assert.deepStrictEqual(await s.porMes(), { '2026-10': { n: 2, monto: 131830 } });
  const a = await s.agregar({ fecha: '2026-11-03', monto: 68990, nota: 'no le gustó' });
  assert.match(a.id, /^m-/);
  // Mismo monto que la del 29-oct de la cartola y a 10 días: igual es OTRA
  // devolución (noviembre no tiene cartola y el banco no la registra antes de
  // que se pague), así que se cuenta.
  const nueva = await s.agregar({ fecha: '2026-11-08', monto: '62840' });
  assert.strictEqual((await s.lista()).find(x => x.id === nueva.id).enCartola, false);
  assert.deepStrictEqual(await s.porMes(), { '2026-10': { n: 2, monto: 131830 }, '2026-11': { n: 2, monto: 131830 } });
  const l = await s.lista();
  assert.deepStrictEqual(l.map(x => x.fecha), ['2026-11-08', '2026-11-03', '2026-10-29', '2026-10-07'], 'de la más nueva a la más vieja');
  assert.deepStrictEqual(l.map(x => x.origen), ['manual', 'manual', 'cartola', 'cartola']);
  assert.deepStrictEqual(s.mesesRevisados(), ['2026-10']);
});

test('una devolución cargada a mano que después llega en la cartola NO se resta dos veces', async () => {
  // El dueño la anotó el 6-oct; en la cartola figura el 7-oct por el mismo monto.
  const { s } = servicio();
  const m = await s.agregar({ fecha: '2026-10-06', monto: 68990 });
  let l = await s.lista();
  assert.strictEqual(l.find(x => x.id === m.id).enCartola, true);
  assert.deepStrictEqual(await s.porMes(), { '2026-10': { n: 2, monto: 131830 } }, 'sigue restando solo las 2 de la cartola');
  // Otra del mismo monto ese mes: la cartola tiene UNA de $68.990, así que la
  // segunda cargada a mano sí es una devolución distinta y se cuenta.
  const m2 = await s.agregar({ fecha: '2026-10-12', monto: 68990 });
  l = await s.lista();
  assert.strictEqual(l.find(x => x.id === m2.id).enCartola, false);
  assert.strictEqual((await s.porMes())['2026-10'].n, 3);
  // La anotó el 28-sep y el banco la registró el 7-oct (septiembre sin cartola
  // todavía): es la misma, porque el banco la muestra DESPUÉS de anotada.
  const { s: s3 } = servicio();
  const antes = await s3.agregar({ fecha: '2026-09-28', monto: 68990 });
  assert.strictEqual((await s3.lista()).find(x => x.id === antes.id).enCartola, true);
  assert.strictEqual((await s3.porMes())['2026-09'], undefined);
  // Mismo monto pero a más de 10 días de la de la cartola: no es la misma.
  const { s: s2 } = servicio();
  const lejos = await s2.agregar({ fecha: '2026-09-20', monto: 68990 });
  assert.strictEqual((await s2.lista()).find(x => x.id === lejos.id).enCartola, false);
  assert.deepStrictEqual((await s2.porMes())['2026-09'], { n: 1, monto: 68990 });
});

test('solo se quitan las cargadas a mano; las de la cartola no', async () => {
  const { s, datos } = servicio();
  const m = await s.agregar({ fecha: '2026-11-03', monto: 68990 });
  assert.strictEqual(await s.quitar('c1'), null, 'una de la cartola no se puede quitar desde el panel');
  assert.strictEqual(await s.quitar('no-existe'), null);
  const q = await s.quitar(m.id);
  assert.strictEqual(q.monto, 68990);
  assert.deepStrictEqual(datos[dv.ARCHIVO], { manuales: [] }, 'queda guardado');
  assert.strictEqual((await s.porMes())['2026-11'], undefined);
});

test('no acepta fechas futuras o imposibles ni montos sin sentido', async () => {
  const { s } = servicio();
  const falla = async (x, re) => { await assert.rejects(() => s.agregar(x), e => e.deUsuario === true && re.test(e.message)); };
  await falla({ fecha: '2026-11-11', monto: 68990 }, /futura/);          // hoy (Chile) es 10-nov
  await falla({ fecha: '2026-02-31', monto: 68990 }, /fecha/);
  await falla({ fecha: '10/11/2026', monto: 68990 }, /fecha/);
  await falla({ fecha: '2026-11-05', monto: 68 }, /monto/);              // "68.990" mal tipeado
  await falla({ fecha: '2026-11-05', monto: 99999999 }, /monto/);
  await falla({ fecha: '2026-11-05', monto: 'abc' }, /monto/);
  assert.deepStrictEqual(await s.porMes(), { '2026-10': { n: 2, monto: 131830 } }, 'nada de eso quedó guardado');
  const ok = await s.agregar({ fecha: '2026-11-10', monto: 54990, nota: 'x'.repeat(200) });
  assert.strictEqual(ok.nota.length, 80);
});

test('la utilidad del mes resta las devoluciones completas y deja ver la cuenta sin ellas', () => {
  const filas = [
    u.calcularDia({ fecha: '2026-09-30', pedidos: 2, unidades: 2, ingresos: 137980 }, 20000),
    u.calcularDia({ fecha: '2026-10-01', pedidos: 3, unidades: 3, ingresos: 206970 }, 30000),
    u.calcularDia({ fecha: '2026-10-02', pedidos: 1, unidades: 1, ingresos: 68990 }, 10000),
  ];
  const octDias = filas[1].utilidad + filas[2].utilidad;
  const meses = u.agruparPorMes(filas, { '2026-10': { n: 2, monto: 131830 } });
  assert.deepStrictEqual(meses.map(m => [m.mes, m.devolN, m.devolMonto]), [['2026-09', 0, 0], ['2026-10', 2, 131830]]);
  assert.strictEqual(meses[1].utilidadAntesDevol, octDias);
  assert.strictEqual(meses[1].utilidad, octDias - 131830);
  assert.strictEqual(meses[0].utilidad, filas[0].utilidad, 'un mes sin devoluciones queda igual');
  // Sin devoluciones (o con basura) es la suma de los días, como antes.
  assert.strictEqual(u.agruparPorMes(filas)[1].utilidad, octDias);
  assert.strictEqual(u.agruparPorMes(filas, { '2026-10': { n: 'x', monto: -5 } })[1].utilidad, octDias);
  // Un mes del principio sin ventas pero con una devolución no se descarta.
  const conDev = u.agruparPorMes([u.calcularDia({ fecha: '2026-08-31' }), filas[0]], { '2026-08': { n: 1, monto: 54990 } });
  assert.deepStrictEqual(conDev.map(m => m.mes), ['2026-08', '2026-09']);
  assert.strictEqual(conDev[0].utilidad, -54990);
});

test('el panel las muestra y las carga con su clave; lo cargado a mano no va al repositorio', () => {
  const srv = leer('server.js');
  for (const ruta of ["app.get('/admin/devoluciones'", "app.post('/admin/devolucion'", "app.post('/admin/devolucion/quitar'"]) {
    const i = srv.indexOf(ruta);
    assert.ok(i > 0, 'falta ' + ruta);
    assert.ok(srv.slice(i, i + 120).includes('if (!clavePanelOk(req, res)) return;'), ruta + ' pide la clave del panel');
  }
  assert.ok(srv.includes('meses: utilidad_.agruparPorMes(d.filas, await dv.porMes()), mesesRevisados: dv.mesesRevisados(),'));
  assert.match(leer('.gitignore'), /^\/devoluciones\.json$/m);
  const admin = leer('admin.html');
  assert.ok(admin.includes('id="dv-fondo"'));
  assert.ok(admin.includes("fetch(BASE + '/admin/devoluciones?clave='"));
  assert.ok(admin.includes('<th title="Plata que devolviste a clientes ese mes">Devoluc.</th>'));
  // Una de la cartola no trae botón de quitar.
  assert.ok(admin.includes("(d.origen === 'manual' ? '<button class=\"qv-btn\" onclick=\"quitarDevolucion(' + i + ')\">Quitar</button>' : '')"));
});
