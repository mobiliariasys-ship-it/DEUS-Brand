'use strict';
// Ruleta en tema Neón (elegido por el dueño el 25-nov-2026 entre 4 ideas en
// azul): negro + cian #18c3ff y azul eléctrico #1a6dff, durante Black Friday y
// después. Black Friday solo pone el título grande y el aviso x2.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ini = HTML.indexOf('<style id="ruleta-estilos">');
const fin = HTML.indexOf('</script>', HTML.indexOf('window.abrirRuleta = function'));
const RULETA = HTML.slice(ini, fin);

test('la ruleta no tiene rosado, rojo ni dorado', () => {
  assert.ok(ini > 0 && fin > ini);
  for (const c of ['#f0c3ca', '240,195,202', '#ff2d3c', '255,45,60', '#ff5fa2', '255,95,162', '#e2b766', '#f3cf8c', '#c88e3a', '#e8b464']) {
    assert.ok(!RULETA.includes(c), 'quedó ' + c);
  }
});

test('gajos negro, azul eléctrico y cian; el $10.000 blanco con letras azules; una sola paleta', () => {
  assert.ok(RULETA.includes("var PALETA = [['#0b1622', '#04080d', '#ffffff'], ['#1a6dff', '#0d47c9', '#ffffff'], ['#18c3ff', '#0a8fd6', '#00152b'], ['#ffffff', '#c9f1ff', '#0d47c9']];"));
  assert.strictEqual((RULETA.match(/PALETA = \[/g) || []).length, 1, 'Black Friday no cambia los gajos');
});

test('puntero, rayos, destello y gajo ganador en azul', () => {
  assert.match(RULETA, /stop-color="#a6ecff"\/><stop offset="1" stop-color="#0a8fd6"\/>/);
  assert.ok(RULETA.includes("ctx.shadowColor = '#18c3ff';"));
  assert.ok(RULETA.includes('fill="rgba(24,195,255,.34)" stroke="#ffffff"'));
  assert.match(RULETA, /\.rl-flash\{[^}]*rgba\(24,195,255,\.4\)/);
});

test('tarjeta negra con borde cian; botón y etiqueta cian con letras oscuras', () => {
  assert.match(RULETA, /\.rl-card\{[^}]*linear-gradient\(180deg,#061019,#020406\);border:1px solid rgba\(24,195,255,\.6\)/);
  assert.match(RULETA, /\.rl-btn\{[^}]*background:linear-gradient\(180deg,#5ad8ff,#12aef0\);color:#00152b;/);
  assert.match(RULETA, /\.rl-tag\{[^}]*color:#00152b;border:1px solid #18c3ff;background:#18c3ff;/);
});

test('Black Friday solo agrega el título grande y el aviso x2 (hasta el 1-dic), sin cambiar colores', () => {
  assert.ok(RULETA.includes("var BLACK_FRIDAY = Date.now() < Date.parse('2026-12-01T03:00:00Z');"));
  const reglas = (RULETA.match(/\.rl-capa\.bf [^{]+\{/g) || []).map(r => r.slice(0, -1));
  assert.deepStrictEqual(reglas, ['.rl-capa.bf .rl-bf', '.rl-capa.bf .rl-bf span', '.rl-capa.bf .rl-tit', '.rl-capa.bf .rl-tit b']);
  assert.ok(!HTML.includes('deus-bf'), 'la pestaña ya no cambia con Black Friday');
});

test('pestaña lateral en cian, con la miniatura en los colores de la ruleta', () => {
  assert.match(HTML, /\.rifa-tab\{[^}]*background:linear-gradient\(135deg,#2fd0ff,#0a8fd6\);color:#00152b;/);
  const i = HTML.indexOf('<svg class="rifa-rueda-tab"');
  const svg = HTML.slice(i, HTML.indexOf('</svg>', i));
  const gajos = [...svg.matchAll(/<path d="M20,26[^>]*fill="(#[0-9a-f]{6})"/g)].map(m => m[1]);
  assert.deepStrictEqual(gajos, ['#0b1622', '#1a6dff', '#18c3ff', '#0b1622', '#1a6dff', '#18c3ff', '#ffffff']);
});
