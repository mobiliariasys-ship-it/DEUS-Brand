'use strict';
// Panel: al elegir días en el gráfico de Conversión, "Utilidad diaria" muestra
// solo esos días, para saber cuánto se ganó en los días que uno quiera.
//
// El test corre las funciones REALES extraídas de admin.html sobre un DOM
// mínimo y compara la suma del panel con totalizar() del servidor: si alguien
// agrega un campo a la utilidad y se olvida del panel, esto falla.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const u = require('../services/utilidad');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');

// Saca `function nombre(...) { ... }` del HTML balanceando llaves.
function extraer(nombre) {
  const i = SRC.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
  assert.ok(i >= 0, 'no encontré function ' + nombre + '() en admin.html');
  let prof = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') prof++;
    else if (SRC[k] === '}' && --prof === 0) return SRC.slice(i, k + 1);
  }
  throw new Error('llaves sin cerrar en ' + nombre);
}

// 30 días de Chile con ventas web, una de Mercado Libre, tapones y gasto en Meta.
function treintaDias() {
  const filas = [];
  for (let i = 29; i >= 0; i--) {
    const fecha = new Date(Date.UTC(2026, 9, 6) - i * 86400000).toISOString().slice(0, 10);
    const ventas = i % 3 === 0
      ? { fecha, pedidos: 2, unidades: 3, ingresos: 188970, conTapones: 1 }
      : i % 7 === 0
        ? { fecha, pedidos: 1, unidades: 1, ingresos: 57000, pedidosExternos: 1, unidadesExternas: 1, ingresosExternos: 57000 }
        : { fecha, pedidos: 0, unidades: 0, ingresos: 0 };
    filas.push(u.calcularDia(ventas, 20000 + i * 1000));
  }
  return filas;
}

function montar() {
  const els = {};
  const elem = () => ({ innerHTML: '', textContent: '', style: {}, classList: { toggle() {}, add() {}, remove() {} } });
  const pedidos = [];
  // Los botones 7/14/30 de la sección: se guarda cuál quedó marcado.
  const botones = [7, 14, 30].map(n => ({ n, on: n === 14, getAttribute: () => String(n),
    classList: { toggle(c, v) { if (c === 'on') this.dueno.on = !!v; } } }));
  botones.forEach(x => { x.classList.dueno = x; });
  const marcado = () => botones.filter(x => x.on).map(x => x.n);
  const filas30 = treintaDias();
  const respuesta = dias => {
    const filas = filas30.slice(-dias);
    return { dias, adsOk: true, filas, total: u.totalizar(filas), diagnostico: { diasQueCalzan: dias },
             costos: { banda: u.COSTO_BANDA, envio: u.COSTO_ENVIO, pasarela: u.TASA_PASARELA, iva: u.IVA } };
  };
  const ctx = {
    console, Date, Number, Object, Math,
    BASE: '', clave: 'prueba',
    CONV_SEL: {},
    document: { getElementById: id => els[id] || (els[id] = elem()),
                querySelectorAll: q => (q === '[data-udias]' ? botones : []) },
    fetch: url => {
      const dias = Number(new URL('http://x' + url).searchParams.get('dias'));
      pedidos.push(dias);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(respuesta(dias)) });
    },
    irA() {}
  };
  vm.createContext(ctx);
  const estado = SRC.match(/var utilSt = \{[^\n]*\};\n\s*var UTIL30_VIGENCIA = [^\n]*;/);
  assert.ok(estado, 'no encontré el estado de la utilidad (utilSt / UTIL30_VIGENCIA)');
  vm.runInContext(
    estado[0] + '\n' +
    ['diasElegidosUtil', 'utilDeDias', 'utilidadSegunSel', 'pintarUtilSelResumen', 'marcarRangoUtil', 'cargarUtilidad',
     'pintarUtilidad', 'kpi', 'money0', 'marcarAct'].map(extraer).join('\n') +
    // Como en el panel: refrescarSel termina llamando a utilidadSegunSel.
    '\nfunction refrescarSel(){ utilidadSegunSel(); }', ctx);
  return { ctx, els, pedidos, filas30, marcado };
}
const esperar = () => new Promise(r => setImmediate(r));
const run = (h, js) => vm.runInContext(js, h.ctx);

test('la suma de los días elegidos es la misma que la del servidor, campo por campo', () => {
  const h = montar();
  const fechas = [h.filas30[2].fecha, h.filas30[9].fecha, h.filas30[27].fecha, h.filas30[29].fecha];
  h.ctx.FILAS = h.filas30; h.ctx.FECHAS = fechas;
  const r = JSON.parse(run(h, 'JSON.stringify(utilDeDias(FILAS, FECHAS))'));
  assert.deepStrictEqual(r.filas.map(f => f.fecha), fechas, 'solo los días elegidos, en orden');
  const servidor = u.totalizar(h.filas30.filter(f => fechas.includes(f.fecha)));
  assert.deepStrictEqual(r.total, servidor);
});

test('al elegir días, Utilidad diaria muestra solo esos y no consulta Meta en cada toque', async () => {
  const h = montar();
  const f = h.filas30;
  run(h, 'cargarUtilidad()'); await esperar();               // carga normal: 14 días
  assert.deepStrictEqual(h.pedidos, [14]);

  // Se eligen 2 días en el gráfico de Conversión
  h.ctx.CONV_SEL[f[3].fecha] = true; h.ctx.CONV_SEL[f[20].fecha] = true;
  h.els['conv-sel-util'] = { innerHTML: '', textContent: '', style: {} };
  run(h, 'refrescarSel()'); await esperar();
  assert.deepStrictEqual(h.pedidos, [14, 30], 'con selección se piden los 30 días del gráfico');
  const dos = u.totalizar([f[3], f[20]]);
  assert.match(h.els['util-kpis'].innerHTML, /2 días elegidos/);
  assert.match(h.els['util-tabla'].innerHTML, new RegExp(f[3].fecha.slice(5)));
  assert.ok(!h.els['util-tabla'].innerHTML.includes(f[10].fecha.slice(5) + '<'), 'no muestra días no elegidos');
  assert.strictEqual(h.els['util-sel'].style.display, '', 'avisa que muestra los días elegidos');
  assert.deepStrictEqual(h.marcado(), [], 'con días elegidos no queda marcado ningún 7/14/30');
  const plata = n => (n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('es-CL');
  assert.ok(h.els['conv-sel-util'].innerHTML.includes(plata(dos.utilidad)),
    'el recuadro de Conversión muestra la utilidad de esos días');

  // Más toques: se filtra lo ya traído, sin otra consulta
  h.ctx.CONV_SEL[f[29].fecha] = true;
  run(h, 'refrescarSel()'); await esperar();
  delete h.ctx.CONV_SEL[f[3].fecha];
  run(h, 'refrescarSel()'); await esperar();
  assert.deepStrictEqual(h.pedidos, [14, 30], 'tocar barras no repite la consulta');
  assert.match(h.els['util-kpis'].innerHTML, /2 días elegidos/);
  assert.deepStrictEqual(h.marcado(), [], 'tampoco al repintar desde lo ya traído');
  const otra = u.totalizar([f[20], f[29]]);
  assert.ok(h.els['util-kpis'].innerHTML.includes('$' + Math.round(otra.utilidad).toLocaleString('es-CL')),
    'la utilidad de arriba es la de los días elegidos ahora');

  // "Ver últimos 14 días" suelta la selección y vuelve a lo normal
  run(h, 'cargarUtilidad(utilSt.dias)'); await esperar();
  assert.deepStrictEqual(Object.keys(h.ctx.CONV_SEL), []);
  assert.deepStrictEqual(h.pedidos, [14, 30, 14]);
  assert.match(h.els['util-kpis'].innerHTML, /Utilidad 14 días/);
  assert.strictEqual(h.els['util-sel'].style.display, 'none');
  assert.deepStrictEqual(h.marcado(), [14]);
});

test('el refresco del panel no dispara consultas si la selección no cambió', async () => {
  const h = montar();
  run(h, 'cargarUtilidad()'); await esperar();
  for (let i = 0; i < 5; i++) { run(h, 'refrescarSel()'); await esperar(); }
  assert.deepStrictEqual(h.pedidos, [14]);
  assert.match(SRC, /arrancarChart\('chartConv'\); \}\n\s*utilidadSegunSel\(\);/,
    'refrescarSel avisa a la utilidad cuando cambian los días elegidos');
});
