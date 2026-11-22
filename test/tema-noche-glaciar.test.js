'use strict';
// Paleta "Noche glaciar" (elegida por el dueño el 22-nov-2026 entre 100
// combinaciones): grises en azul noche suave, un solo acento celeste glaciar,
// un solo verde para el ahorro y el botón IA DEUS en azul hielo. Se mantienen
// las estrellas doradas, el botón blanco de compra, el dorado de − / + y de
// "Aplicar" en el checkout, los colores del producto y la ruleta. Va directo en
// las reglas (sin un bloque aparte que pise reglas más específicas: con
// html.tema-humo delante, `.how-img` le ganaba a `.how-img.seamless`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('la paleta del sitio es Noche glaciar', () => {
  assert.match(index, /:root \{\s*--black:#252933; --dark:#2a2f3a; --card:#2c313d;\s*--border:#3b4151; --white:#f4f4f4;/);
  assert.match(index, /\.checkout-modal\{--card:#313744;--border:#3f4758;--silver:#a9afbe;--dark:#2d323e;/);
  assert.match(index, /<meta name="theme-color" content="#1e2129">/, 'la barra del navegador del celular calza con la barra de arriba');
});

test('el botón IA DEUS va en azul hielo', () => {
  assert.match(index, /\.chat-fab\{[^}]*background:linear-gradient\(135deg,#97c1ec 0%,#89b5e2 50%,#5f9bd7 100%\)/);
});

test('se mantienen el dorado de las estrellas y de − / + y "Aplicar" en el checkout', () => {
  assert.ok(index.includes('.prod-rating .stars{color:#e9c46a'));
  assert.match(index, /\.cart-qty-btn\{[^}]*color:#e8b464/);
  assert.match(index, /\.rlc-btn\{[^}]*border:1px solid #e8b464;background:transparent;color:#e8b464/);
});

test('el botón blanco de compra no cambia', () => {
  assert.match(index, /\.btn-p\{\s*background:linear-gradient\(180deg,#ffffff,#eaf0f4\);color:#0d1014;/);
});

test('sin bloque de tema aparte ni clase en <html>', () => {
  assert.ok(!index.includes('id="tema-humo"'));
  assert.ok(!/<html[^>]*tema-humo/.test(index));
});

test('las reglas más específicas siguen ganando (fondos transparentes intactos)', () => {
  assert.ok(index.includes('.how-img.seamless{background:transparent;border:none;}'));
});

test('no toca los colores del producto, la ruleta ni los logos de marcas', () => {
  assert.ok(index.includes('<div class="cdot active" style="background:#111;" title="Negro"'));
  assert.ok(index.includes('<i style="background:#1b1b1b"></i>Negra'));
  assert.ok(index.includes('.rl-card{position:relative;width:100%;max-width:370px;max-height:calc(100dvh - 24px);overflow:hidden auto;background:linear-gradient(180deg,#1c1c21 0%,#141417 100%);'));
  assert.ok(index.includes('fill="#00D7FE"'), 'Google Play conserva sus colores');
  assert.ok(index.includes('background:#FC4C02'), 'Strava conserva su naranjo');
});
