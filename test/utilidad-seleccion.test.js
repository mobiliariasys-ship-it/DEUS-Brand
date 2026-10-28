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
  const pedidosIva = [];   // consultas de la tarjeta "Utilidad histórica" (dias=iva)
  // Los botones 7/14/30 de la sección: se guarda cuál quedó marcado.
  const botones = [7, 14, 30, 'iva'].map(n => ({ n, on: n === 14, getAttribute: () => String(n),
    classList: { toggle(c, v) { if (c === 'on') this.dueno.on = !!v; } } }));
  botones.forEach(x => { x.classList.dueno = x; });
  const marcado = () => botones.filter(x => x.on).map(x => x.n);
  const filas30 = treintaDias();
  const respuesta = dias => {
    const filas = filas30.slice(-dias);
    return { dias, adsOk: true, filas, total: u.totalizar(filas), diagnostico: { diasQueCalzan: dias },
             costos: { banda: u.COSTO_BANDA, envio: u.COSTO_ENVIO, pasarela: u.TASA_PASARELA, iva: u.IVA } };
  };
  // dias=iva: todo lo que hay desde que los ads se cuentan con IVA.
  const respuestaIva = { ...respuesta(30), desde: u.IVA_DESDE };
  const ctx = {
    console, Date, Number, Object, Math,
    BASE: '', clave: 'prueba',
    CONV_SEL: {},
    document: { getElementById: id => els[id] || (els[id] = elem()),
                querySelectorAll: q => (q === '[data-udias]' ? botones : []) },
    fetch: url => {
      const q = new URL('http://x' + url).searchParams.get('dias');
      if (q === 'iva') {
        pedidosIva.push(q);
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ctx.RESP_IVA || respuestaIva) });
      }
      const dias = Number(q);
      pedidos.push(dias);
      return Promise.resolve({ ok: true, json: () => Promise.resolve(respuesta(dias)) });
    },
    irA() {}
  };
  vm.createContext(ctx);
  // La tarjeta de arriba escribe en el primer nodo de texto del valor.
  els['s-util'] = { childNodes: [{ nodeValue: '' }], style: {} };
  const estado = SRC.match(/var utilSt = \{[^\n]*\};\n\s*var UTIL30_VIGENCIA = [^\n]*;/);
  assert.ok(estado, 'no encontré el estado de la utilidad (utilSt / UTIL30_VIGENCIA)');
  const estadoHist = SRC.match(/var utilHist = \{[^\n]*\};/);
  assert.ok(estadoHist, 'no encontré el estado de la tarjeta de utilidad (utilHist)');
  vm.runInContext(
    estado[0] + '\n' + estadoHist[0] + '\n' +
    ['diasElegidosUtil', 'utilDeDias', 'utilidadSegunSel', 'pintarUtilSelResumen', 'marcarRangoUtil', 'cargarUtilidad',
     'proyeccionMensual', 'pintarUtilidad', 'kpi', 'money0', 'marcarAct',
     'cargarUtilHist', 'utilTarjeta', 'pintarUtilTarjeta', 'verUtilHistorica'].map(extraer).join('\n') +
    // Como en el panel: refrescarSel termina llamando a utilidadSegunSel.
    '\nfunction refrescarSel(){ utilidadSegunSel(); }', ctx);
  return { ctx, els, pedidos, pedidosIva, filas30, marcado };
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

test('la proyección mensual lleva a 30 días el promedio de los días que se están mirando', async () => {
  const h = montar();
  const f = h.filas30;
  const plata = n => '$' + Math.round(n).toLocaleString('es-CL');
  run(h, 'cargarUtilidad()'); await esperar();                // sin selección: últimos 14 días
  const catorce = u.totalizar(f.slice(-14));
  assert.match(h.els['util-kpis'].innerHTML, /Proyección mensual/);
  assert.ok(h.els['util-kpis'].innerHTML.includes(plata(catorce.utilidad / 14 * 30)), 'promedio de 14 días × 30');
  assert.ok(h.els['util-kpis'].innerHTML.includes('promedio de 14 días × 30'));

  // Con días elegidos en Conversión, la proyección sale solo de esos días
  h.ctx.CONV_SEL[f[3].fecha] = true; h.ctx.CONV_SEL[f[20].fecha] = true; h.ctx.CONV_SEL[f[21].fecha] = true;
  h.els['conv-sel-util'] = { innerHTML: '', textContent: '', style: {} };
  run(h, 'refrescarSel()'); await esperar();
  const tres = u.totalizar([f[3], f[20], f[21]]);
  assert.ok(h.els['util-kpis'].innerHTML.includes(plata(tres.utilidad / 3 * 30)), 'promedio de los 3 días elegidos × 30');
  assert.ok(h.els['util-kpis'].innerHTML.includes('promedio de 3 días × 30'));
  assert.ok(!h.els['util-kpis'].innerHTML.includes('incluye hoy'), 'estos días ya terminaron');
  assert.strictEqual(run(h, 'proyeccionMensual(1000, 0)'), 0, 'sin días no hay proyección');
});

test('la tarjeta de arriba muestra la utilidad desde el IVA, o la de los días elegidos en Conversión', async () => {
  const h = montar();
  const f = h.filas30;
  const plata = n => (n < 0 ? '−' : '') + '$' + Math.round(Math.abs(n)).toLocaleString('es-CL');
  const valor = () => h.els['s-util'].childNodes[0].nodeValue.trim();

  // Sin días elegidos: la histórica desde que los ads van con IVA
  run(h, 'refrescarSel()'); await esperar();
  assert.deepStrictEqual(h.pedidosIva, ['iva'], 'pide la utilidad desde el IVA');
  assert.strictEqual(h.els['s-util-k'].textContent, 'Utilidad histórica');
  assert.strictEqual(valor(), plata(u.totalizar(f).utilidad));
  assert.strictEqual(h.els['s-util-m'].textContent, '30 días · con IVA', 'los días transcurridos, no la fecha');

  // Con días elegidos: la de esos días, sin volver a consultar
  h.ctx.CONV_SEL[f[3].fecha] = true; h.ctx.CONV_SEL[f[20].fecha] = true;
  h.els['conv-sel-util'] = { innerHTML: '', textContent: '', style: {} };
  run(h, 'refrescarSel()'); await esperar();
  assert.strictEqual(h.els['s-util-k'].textContent, 'Utilidad · 2 días elegidos');
  assert.strictEqual(valor(), plata(u.totalizar([f[3], f[20]]).utilidad));

  // Soltar la selección vuelve a la histórica
  h.ctx.CONV_SEL = {};
  run(h, 'refrescarSel()'); await esperar();
  assert.strictEqual(h.els['s-util-k'].textContent, 'Utilidad histórica');
  assert.strictEqual(valor(), plata(u.totalizar(f).utilidad));

  // El panel se refresca cada pocos segundos: no se le pide a Meta en cada refresco
  for (let i = 0; i < 5; i++) { run(h, 'refrescarSel()'); await esperar(); }
  assert.deepStrictEqual(h.pedidosIva, ['iva'], 'una sola consulta mientras está vigente');
});

test('si Meta no respondió, la tarjeta lo avisa en vez de mostrar una utilidad inflada', async () => {
  const h = montar();
  h.ctx.RESP_IVA = { dias: 30, desde: u.IVA_DESDE, adsOk: false, filas: h.filas30, total: u.totalizar(h.filas30) };
  run(h, 'refrescarSel()'); await esperar();
  assert.strictEqual(h.els['s-util-m'].textContent, '⚠ sin gasto de Meta');
});

test('el servidor cuenta los días desde la fecha del IVA, incluidos los dos extremos', () => {
  assert.strictEqual(u.diasDesdeIva(u.IVA_DESDE), 1);
  assert.strictEqual(u.diasDesdeIva('2026-10-15'), 35);
  assert.strictEqual(u.diasDesdeIva('2030-01-01'), 400, 'tope de lo que se le pide a Meta');
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(srv, /diasParam === 'iva'/, 'el endpoint acepta dias=iva');
});

test('con un servidor sin actualizar (ignora dias=iva) la tarjeta no muestra 14 días como si fueran la histórica', async () => {
  const h = montar();
  h.ctx.RESP_IVA = { dias: 14, adsOk: true, filas: h.filas30.slice(-14), total: u.totalizar(h.filas30.slice(-14)) };
  run(h, 'refrescarSel()'); await esperar();
  assert.strictEqual(h.els['s-util'].childNodes[0].nodeValue.trim(), '—');
  assert.strictEqual(h.els['s-util-m'].textContent, 'falta actualizar el servidor');
});

test('arriba de "Utilidad diaria", "Desde el IVA" muestra el histórico día por día', async () => {
  const h = montar();
  assert.match(SRC, /<button data-udias="iva" onclick="cargarUtilidad\('iva'\)">Desde el IVA<\/button>/);
  run(h, 'cargarUtilidad()'); await esperar();
  run(h, "cargarUtilidad('iva')"); await esperar();
  assert.deepStrictEqual(h.pedidosIva, ['iva']);
  assert.match(h.els['util-kpis'].innerHTML, /Utilidad histórica · 30 días/);
  assert.ok(!h.els['util-kpis'].innerHTML.includes(u.IVA_DESDE.slice(8) + '-' + u.IVA_DESDE.slice(5, 7)), 'sin la fecha');
  assert.deepStrictEqual(h.marcado(), ['iva'], 'queda marcado "Desde el IVA"');
  // La misma respuesta llena la tarjeta de arriba, sin otra consulta
  run(h, 'refrescarSel()'); await esperar();
  assert.deepStrictEqual(h.pedidosIva, ['iva']);
  assert.strictEqual(h.els['s-util-k'].textContent, 'Utilidad histórica');
  // Tocar la tarjeta lleva a la sección con el histórico
  assert.match(SRC, /onclick="verUtilHistorica\(\)"/);
});
