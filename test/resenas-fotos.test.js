'use strict';
// Las fotos de las reseñas se demoraban (el dueño, 22-nov-2026): el carrusel es
// horizontal y con carga diferida, y el iPhone pedía cada foto recién cuando su
// tarjeta entraba en pantalla. Ahora se piden todas al acercarse la sección, y
// el recuadro tiene fondo mientras carga.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');

test('las fotos del carrusel se piden antes de llegar a las reseñas', () => {
  const ini = html.indexOf("var carr = document.getElementById('reviewsCarr');");
  assert.ok(ini > 0, 'falta la precarga de las fotos de las reseñas');
  const bloque = html.slice(ini, ini + 900);
  assert.match(bloque, /setAttribute\('loading', 'eager'\)/);
  assert.match(bloque, /rootMargin: '1200px 0px'/);
});

test('el recuadro de la foto tiene fondo mientras carga', () => {
  assert.match(html, /\.review-photo\{[^}]*background:#343a47;\}/);
});

test('ninguna foto de reseña pesa de más (todas bajo 120 KB)', () => {
  for (const f of new Set(html.match(/img\/resena-[a-z0-9-]+\.webp/g))) {
    const kb = fs.statSync(path.join(raiz, f)).size / 1024;
    assert.ok(kb < 120, f + ' pesa ' + kb.toFixed(0) + ' KB');
  }
});
