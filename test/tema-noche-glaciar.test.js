'use strict';
// Paleta "Noche glaciar" (elegida por el dueño el 22-nov-2026 entre 100
// combinaciones): grises en azul noche suave, un solo acento celeste glaciar,
// un solo verde para el ahorro y el botón IA DEUS en gris mate. Se mantienen
// las estrellas doradas, el botón blanco de compra, el dorado de − / + en el
// carrito, los colores del producto y la ruleta. Va directo en
// las reglas (sin un bloque aparte que pise reglas más específicas: con
// html.tema-humo delante, `.how-img` le ganaba a `.how-img.seamless`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('la paleta del sitio es Noche glaciar, suavizada', () => {
  // Mezcla entre Noche glaciar y el gris humo (el dueño la encontró "muy azul"):
  // los grises azulados al 90 por ciento de su saturación (entre la mezcla con
  // el gris humo y Noche glaciar).
  assert.match(index, /:root \{\s*--black:#262a33; --dark:#2b303a; --card:#2d323d;\s*--border:#3d4350; --white:#f4f4f4;/);
  assert.match(index, /\.checkout-modal\{--card:#323844;--border:#414857;--silver:#aab0bd;--dark:#2e333e;/);
  assert.match(index, /<meta name="theme-color" content="#1f2229">/, 'la barra del navegador del celular calza con la barra de arriba');
});

test('el botón IA DEUS va en gris mate (pedido del dueño, 23-nov-2026; antes azul hielo)', () => {
  assert.match(index, /\.chat-fab\{[^}]*background:#5d626b;color:#f2f3f5;/);
  const fab = index.match(/\.chat-fab\{[^}]*\}/)[0];
  assert.ok(!/linear-gradient|137,181,226|inset/.test(fab), 'mate: sin degradé, sin halo de color ni brillo');
});

test('se mantienen el dorado de las estrellas y de − / + en el carrito', () => {
  assert.ok(index.includes('.prod-rating .stars{color:#e9c46a'));
  assert.match(index, /\.cart-qty-btn\{[^}]*color:#e8b464/);
});

test('"Aplicar" del código de la ruleta va en cian, como la ruleta Neón (pedido del dueño, 25-nov-2026; antes dorado)', () => {
  assert.match(index, /\.rlc-btn\{[^}]*border:1px solid #18c3ff;background:transparent;color:#18c3ff/);
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
  // La ruleta tiene su propio tema (Neón desde el 25-nov-2026, ver ruleta-neon.test.js).
  assert.ok(index.includes('.rl-card{position:relative;width:100%;max-width:370px;max-height:calc(100dvh - 24px);overflow:hidden auto;background:repeating-linear-gradient(135deg,rgba(255,255,255,.018) 0 10px,transparent 10px 20px),linear-gradient(180deg,#061019,#020406);'));
  assert.ok(index.includes('fill="#00D7FE"'), 'Google Play conserva sus colores');
  assert.ok(index.includes('background:#FC4C02'), 'Strava conserva su naranjo');
});

test('los rojos con significado siguen rojos (la conversión de paleta los había pasado a celeste)', () => {
  assert.ok(index.includes('.rlc-msg.mal{color:#ff8a8a;}'), 'el aviso de código inválido es rojo');
  assert.match(index, /\.cart-item-remove\{color:#e05555;/, '"Eliminar" del carrito es rojo');
  assert.match(index, /\.bpm-heart\{color:#e05555;/, 'el corazón del pulso es rojo');
  assert.match(index, /\.offer-pill\{[^}]*background:linear-gradient\(135deg,#911f1f,#6b1313\);color:#ffdede;/, 'la etiqueta roja de oferta con su texto claro cálido');
});
