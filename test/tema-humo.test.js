'use strict';
// Paleta "gris humo" (Combinación 3 · las 4 juntas), pedido del dueño el
// 21-nov-2026, un tono más oscuro que la maqueta: fondo #2a2d33, tarjetas
// #33363c, bordes #45484e y texto #f4f4f4. Va directo en las reglas (sin un
// bloque aparte que pise reglas más específicas: con html.tema-humo delante,
// p. ej. `.how-img` le ganaba a `.how-img.seamless{background:transparent}`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('la paleta del sitio es el gris humo', () => {
  assert.match(index, /:root \{\s*--black:#2a2d33; --dark:#303339; --card:#33363c;\s*--border:#45484e; --white:#f4f4f4;/);
  assert.match(index, /\.checkout-modal\{--card:#393c42;--border:#4b4e54;--silver:#a9b1be;--dark:#34373d;/);
});

test('sin bloque de tema aparte ni clase en <html>', () => {
  assert.ok(!index.includes('id="tema-humo"'));
  assert.ok(!/<html[^>]*tema-humo/.test(index));
});

test('las reglas más específicas siguen ganando (fondos transparentes intactos)', () => {
  assert.ok(index.includes('.how-img.seamless{background:transparent;border:none;}'));
});

test('no toca los colores del producto ni la ruleta', () => {
  // El círculo del negro y el de la correa negra siguen con su color.
  assert.ok(index.includes('<div class="cdot active" style="background:#111;" title="Negro"'));
  assert.ok(index.includes('<i style="background:#1b1b1b"></i>Negra'));
  // La ventana de la ruleta conserva su tarjeta oscura.
  assert.ok(index.includes('.rl-card{position:relative;width:100%;max-width:370px;max-height:calc(100dvh - 24px);overflow:hidden auto;background:linear-gradient(180deg,#1c1c21 0%,#141417 100%);'));
});
