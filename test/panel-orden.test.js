'use strict';
// Orden del panel (pedido del dueño, 30-oct-2026): el gasto por hora va justo
// debajo de la utilidad diaria, las secciones van agrupadas (Plata,
// Conversión, Operación) y las últimas ventas y los tickets del sorteo quedan
// plegados al final.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const pos = id => { const i = HTML.indexOf('<section id="' + id + '"'); assert.ok(i >= 0, 'falta ' + id); return i; };

test('el gasto por hora va justo debajo de la utilidad diaria', () => {
  const ids = [...HTML.matchAll(/<section id="(sec-[a-z]+)"/g)].map(m => m[1]);
  assert.strictEqual(ids[ids.indexOf('sec-utilidad') + 1], 'sec-gastoh');
});

test('las secciones van agrupadas y los registros plegados al final', () => {
  const orden = ['sec-utilidad', 'sec-gastoh', 'sec-ads', 'sec-canales', 'sec-embudo', 'sec-checkout', 'sec-conducta',
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

test('el tema respeta los colores: sin verde ni violeta de adorno', () => {
  const tema = HTML.slice(HTML.indexOf('/* ══ Tema vidrio'), HTML.indexOf('</style>'));
  assert.ok(tema.length > 500, 'falta la capa del tema');
  assert.match(tema, /backdrop-filter:blur/);
  assert.ok(!/9b8cff|var\(--green\)|#8fce4a/.test(tema), 'el tema no usa verde ni violeta');
  assert.ok(!/#9b8cff|#cfc6ff/.test(HTML), 'los gráficos no usan violeta');
});

test('el fondo de dragones existe, es liviano y va detrás del vidrio', () => {
  const img = path.join(__dirname, '..', 'img', 'panel-dragones.webp');
  assert.ok(fs.existsSync(img), 'falta img/panel-dragones.webp');
  const kb = fs.statSync(img).size / 1024;
  assert.ok(kb < 300, 'el fondo pesa ' + Math.round(kb) + ' KB: tiene que cargar rápido en el celular');
  const tema = HTML.slice(HTML.indexOf('/* ══ Tema vidrio'), HTML.indexOf('</style>'));
  // En un ::before fijo: background-attachment:fixed no anda en el iPhone.
  assert.match(tema, /body::before\{content:'';position:fixed;inset:0;z-index:-1;[^}]*url\(img\/panel-dragones\.webp\)/);
  assert.match(tema, /backdrop-filter:blur\(22px\)/);
});
