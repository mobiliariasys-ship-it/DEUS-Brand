'use strict';
// Orden del panel (pedido del dueño, 30-oct-2026): "Dentro del checkout" va
// justo debajo de la utilidad diaria y el gasto por hora después, las
// secciones van agrupadas (Plata, Conversión, Operación) y las últimas ventas
// y los tickets del sorteo quedan plegados al final.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const pos = id => { const i = HTML.indexOf('<section id="' + id + '"'); assert.ok(i >= 0, 'falta ' + id); return i; };

test('el checkout va justo debajo de la utilidad diaria y el gasto por hora después', () => {
  const ids = [...HTML.matchAll(/<section id="(sec-[a-z]+)"/g)].map(m => m[1]);
  const u = ids.indexOf('sec-utilidad');
  assert.deepStrictEqual(ids.slice(u, u + 3), ['sec-utilidad', 'sec-checkout', 'sec-gastoh']);
});

test('las secciones van agrupadas y los registros plegados al final', () => {
  const orden = ['sec-utilidad', 'sec-checkout', 'sec-gastoh', 'sec-ads', 'sec-canales', 'sec-embudo', 'sec-conducta',
    'sec-convierte', 'sec-negocio', 'sec-pedidos', 'sec-resenas', 'sec-chat', 'sec-ventas', 'sec-sorteo'];
  const posiciones = orden.map(pos);
  assert.deepStrictEqual(posiciones, posiciones.slice().sort((a, b) => a - b), 'orden de las secciones');
  assert.strictEqual((HTML.match(/<div class="grupo-h">/g) || []).length, 4);
  for (const id of ['sec-ventas', 'sec-sorteo']) {
    assert.match(HTML, new RegExp('<section id="' + id + '" class="plegable cerrada">'), id + ' empieza plegada');
    assert.match(HTML, new RegExp("onclick=\"plegar\\('" + id + "'\\)\">Mostrar ▾</button>"));
  }
});

test('el conteo de tickets pasa a la sección plegada y la barra lateral la abre', () => {
  assert.ok(!HTML.includes('<div class="k">Tickets sorteo</div>'), 'ya no va en las tarjetas de arriba');
  assert.strictEqual((HTML.match(/id="s-tickets"/g) || []).length, 1);
  assert.match(HTML, /function irA\(id, el\)\{ var t=document\.getElementById\(id\); if\(t && t\.classList\.contains\('cerrada'\)\) plegar\(id, true\);/);
  // Barra lateral en el mismo orden que el panel.
  const nav = [...HTML.matchAll(/onclick="irA\('(sec-[a-z]+)',this\)"/g)].map(m => m[1]).filter(id => id !== 'sec-graficos');
  const enPanel = nav.slice().sort((a, b) => pos(a) - pos(b));
  assert.deepStrictEqual(nav, enPanel);
});

// Tema constelación (31-oct-2026): fondo con la foto del dragón de estrellas
// del dueño y el panel en sus tonos (índigo, pervinca y celeste hielo).
const tramoTema = () => {
  const i = HTML.indexOf('/* ══ Tema constelación');
  assert.ok(i >= 0, 'falta la capa del tema');
  return HTML.slice(i, HTML.indexOf('</style>', i));
};

test('el tema respeta los colores: sin verde ni violeta de adorno', () => {
  const tema = tramoTema();
  assert.ok(tema.length > 500, 'falta la capa del tema');
  assert.match(tema, /backdrop-filter:blur/);
  assert.ok(!/9b8cff|var\(--green\)|#8fce4a/.test(tema), 'el tema no usa verde ni violeta');
  assert.ok(!/#9b8cff|#cfc6ff/.test(HTML), 'los gráficos no usan violeta');
});

test('el fondo del dragón de estrellas existe, es liviano y va detrás del vidrio', () => {
  const img = path.join(__dirname, '..', 'img', 'panel-constelacion.webp');
  assert.ok(fs.existsSync(img), 'falta img/panel-constelacion.webp');
  const kb = fs.statSync(img).size / 1024;
  assert.ok(kb < 300, 'el fondo pesa ' + Math.round(kb) + ' KB: tiene que cargar rápido en el celular');
  const tema = tramoTema();
  // En un ::before fijo: background-attachment:fixed no anda en el iPhone.
  assert.match(tema, /body::before\{content:'';position:fixed;inset:0;z-index:-1;[^}]*url\(img\/panel-constelacion\.webp\)/);
  assert.ok(!tema.includes('panel-dragones'), 'quedó el fondo anterior');
  assert.match(tema, /backdrop-filter:blur\(22px\)/);
});

test('las tarjetas de arriba van en bento: ventas, conversión de hoy y utilidad primero y más grandes', () => {
  const grid = HTML.slice(HTML.indexOf('<div class="grid bento">'), HTML.indexOf('<div class="rango-bar">'));
  const ids = [...grid.matchAll(/<div class="stat([^"]*)"[^>]*>.*?id="(s-[a-z-]+)"/g)].map(m => [m[2], m[1].trim()]);
  assert.strictEqual(ids.length, 12, 'son 12 tarjetas');
  assert.deepStrictEqual(ids.slice(0, 3).map(x => x[0]), ['s-vent-hoy', 's-conv-hoy', 's-util-k']);
  for (const [id, cls] of ids.slice(0, 3)) assert.match(cls, /\bhero\b/, id + ' va grande');
  assert.deepStrictEqual(ids.slice(-3).map(x => x[0]), ['s-conv-sem', 's-conv-mes', 's-conv']);
  const tema = tramoTema();
  assert.match(tema, /\.grid\.bento\{grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
  // Las fuentes son las del sitio: nada de afuera.
  assert.match(tema, /url\(\/fonts\/michroma-400-lat\.woff2\)/);
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(HTML));
});

test('el checkout ya no va arriba de todo: queda después de los gráficos, en el grupo de la plata', () => {
  assert.ok(pos('sec-checkout') > HTML.indexOf('id="sec-graficos"'));
  assert.ok(pos('sec-checkout') > HTML.indexOf('<div class="grupo-h">💰 Plata'));
  assert.ok(pos('sec-checkout') < HTML.indexOf('<div class="grupo-h">🫗 Conversión'));
});

test('el checkout tiene su filtro propio: hoy, ayer, semana, mes y todo', () => {
  const vm = require('vm');
  const extraer = nombre => {
    const i = HTML.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
    assert.ok(i >= 0, 'falta ' + nombre);
    let prof = 0;
    for (let k = HTML.indexOf('{', i); k < HTML.length; k++) {
      if (HTML[k] === '{') prof++;
      else if (HTML[k] === '}' && --prof === 0) return HTML.slice(i, k + 1);
    }
  };
  for (const [n, txt] of [['1', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['0', 'Todo']]) {
    assert.ok(HTML.includes('data-co="' + n + '" onclick="setRangoCheckout(') && HTML.includes('>' + txt + '</button>'), 'falta ' + txt);
  }
  // Los días de Chile: hoy y ayer, para armar los datos de prueba.
  const hoyCl = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const dia = n => { const d = new Date(hoyCl); d.setDate(hoyCl.getDate() - n); return d.toLocaleDateString('en-CA'); };
  const data = {
    conducta: { 'co:1abrio': 100, 'co:5pago': 9 },             // histórico
    conductaPorDia: { [dia(0)]: { 'co:1abrio': 4, 'co:5pago': 1 }, [dia(1)]: { 'co:1abrio': 6, 'co:5pago': 2 } }
  };
  const botones = ['1', 'ayer', 'semana', 'mes', '0'].map(n => ({ n, on: false, getAttribute: () => n,
    classList: { toggle(c, v) { this.d.on = !!v; } } }));
  botones.forEach(b => { b.classList.d = b; });
  const nota = { textContent: '' };
  let pintado = null;
  const ctx = { Date, Number, String, Object, localStorage: { getItem: () => null, setItem() {} },
    document: { querySelectorAll: q => (q === '.co-rango' ? botones : []), getElementById: id => (id === 'co-nota' ? nota : null) },
    pintarCheckout: c => { pintado = c; } };
  vm.createContext(ctx);
  const rangoLbl = HTML.match(/var RANGO_LBL = \{[^}]*\};/)[0];
  vm.runInContext(rangoLbl + '\nvar ULT_DATA = null;\n' + ['diasChile', 'conductaRango', 'pintarCheckoutRango', 'setRangoCheckout'].map(extraer).join('\n') +
    '\n' + HTML.match(/var CO_RANGO = \(function\(\)\{[\s\S]*?\}\)\(\);/)[0], ctx);
  ctx.ULT_DATA = data;
  // JSON: los objetos armados dentro del vm traen otro Object.prototype.
  const ver = n => { vm.runInContext('setRangoCheckout(' + JSON.stringify(n) + ')', ctx); return JSON.parse(JSON.stringify(pintado)); };
  assert.strictEqual(vm.runInContext('CO_RANGO', ctx), 'semana', 'arranca en esta semana');
  assert.deepStrictEqual(ver(1), { 'co:1abrio': 4, 'co:5pago': 1 }, 'hoy');
  assert.match(nota.textContent, /^hoy · 4 abrieron · 1 pagó$/);
  assert.deepStrictEqual(ver('ayer'), { 'co:1abrio': 6, 'co:5pago': 2 }, 'ayer');
  assert.deepStrictEqual(ver(0), data.conducta, 'todo = histórico');
  assert.match(nota.textContent, /^acumulado histórico/);
  assert.deepStrictEqual(botones.filter(b => b.on).map(b => b.n), ['0'], 'se marca el botón elegido');
  // El periodo general no apaga los botones del checkout.
  assert.match(HTML, /document\.querySelectorAll\('\.rango-btn\[data-rango\]'\)/);
});
