'use strict';
// Tema "gris humo" (Combinación 3 · las 4 juntas), pedido del dueño el
// 21-nov-2026: fondo #313439, tarjetas #3a3d43, bordes #4b4f57 y texto
// #f4f4f4. Solo cambian fondos, tarjetas y bordes; textos, botones, fotos y
// los colores del producto quedan igual. Todo cuelga de html.tema-humo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function bloque() {
  const ini = index.indexOf('<style id="tema-humo">');
  assert.ok(ini > 0, 'falta el bloque del tema gris humo');
  return index.slice(ini, index.indexOf('</style>', ini));
}

test('la tienda lleva la clase tema-humo desde el HTML (sin parpadeo)', () => {
  assert.match(index, /<html lang="es" class="tema-humo">/);
});

test('la paleta es la de la maqueta aprobada', () => {
  assert.match(bloque(), /html\.tema-humo\{--black:#313439;--dark:#36393f;--card:#3a3d43;--border:#4b4f57;--white:#f4f4f4;\}/);
});

test('cada regla depende de html.tema-humo (quitar la clase vuelve al grafito)', () => {
  const css = bloque().replace('<style id="tema-humo">', '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Las reglas dentro de @media también: se sacan los @media(...){ antes de partir.
  const reglas = css.replace(/@media[^{]*\{/g, '').split('}').map(r => r.trim()).filter(Boolean);
  assert.ok(reglas.length > 60);
  for (const r of reglas) {
    for (const s of r.slice(0, r.indexOf('{')).split(',').map(x => x.trim())) {
      assert.ok(s.startsWith('html.tema-humo'), 'regla sin la clase: ' + s);
    }
  }
});

test('no toca los colores del producto ni la ruleta', () => {
  const b = bloque();
  assert.ok(!/\.cdot|\.rl-|\.rifa-rueda|\.ck\{/.test(b), 'el tema no cambia círculos de color, ruleta ni checks');
  // El círculo del negro y el de la correa negra siguen con su color.
  assert.ok(index.includes('<div class="cdot active" style="background:#111;" title="Negro"'));
  assert.ok(index.includes('<i style="background:#1b1b1b"></i>Negra'));
});
