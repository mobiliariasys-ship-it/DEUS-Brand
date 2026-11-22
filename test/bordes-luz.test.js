'use strict';
// Bordes "luz desde arriba" (pedido del dueño, 22-nov-2026): las superficies
// principales llevan un borde celeste (#94e0fd, el del pulso) más brillante
// arriba, fijo y sin animación; el checkout, de un azul más intenso. El borde
// es un ::after con máscara: sin soporte de máscaras taparía la tarjeta entera,
// por eso tiene que ir dentro de @supports. Esto se prueba acá.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ini = html.indexOf('/* ── Bordes "luz desde arriba"');
const bloque = html.slice(ini, html.indexOf('</style>', ini));

test('el bloque de los bordes existe y usa el celeste del pulso', () => {
  assert.ok(ini > 0, 'falta el bloque de los bordes');
  assert.ok(bloque.includes('#94e0fd'));
  assert.match(html, /\.hdr-pulse \.mon path\{[^}]*stroke:#94e0fd/, 'el pulso del encabezado sigue siendo ese celeste');
});

test('el borde con máscara solo se pinta donde el navegador soporta máscaras', () => {
  const sup = bloque.indexOf('@supports ((-webkit-mask-composite:xor) or (mask-composite:exclude)){');
  assert.ok(sup >= 0, 'falta el @supports');
  // Todo lo que deja el borde transparente o dibuja el ::after va adentro.
  let prof = 0, fin = -1;
  for (let k = bloque.indexOf('{', sup); k < bloque.length; k++) {
    if (bloque[k] === '{') prof++;
    else if (bloque[k] === '}' && --prof === 0) { fin = k; break; }
  }
  const dentro = bloque.slice(sup, fin), fuera = bloque.slice(0, sup) + bloque.slice(fin);
  assert.ok(dentro.includes('border-color:transparent') && dentro.includes('::after'));
  assert.ok(!fuera.includes('border-color:transparent'), 'sin máscaras, el borde gris de antes tiene que quedar');
  assert.ok(!/::after/.test(fuera.replace(/\/\*[\s\S]*?\*\//g, '')), 'ningún ::after fuera del @supports');
});

test('va en las superficies principales y no en la ruleta, los colores del producto ni lo chico y repetido', () => {
  for (const s of ['header::after', '.detail::after', '.buybox::after', '.spec::after', '.soft-in::after', '.r360-card::after', '.checkout-modal::after']) {
    assert.ok(bloque.includes(s), 'falta ' + s);
  }
  for (const s of ['.rl-', '.cdot', '.fn-', 'faq', '.guarantee']) assert.ok(!bloque.includes(s), 'no va en ' + s);
  // Fijo: sin animación.
  assert.ok(!/animation|@keyframes/.test(bloque.replace(/\/\*[\s\S]*?\*\//g, '')));
});

test('el checkout lleva su azul más intenso y su luz desde arriba', () => {
  assert.match(bloque, /\.checkout-modal::after\{padding:1\.5px;background:linear-gradient\(180deg,#c6edff/);
  assert.match(bloque, /\.checkout-modal\{background:radial-gradient\(110% 34% at 50% 0%,rgba\(72,166,255,\.17\)/);
});
