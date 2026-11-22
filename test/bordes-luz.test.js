'use strict';
// Bordes "luz desde arriba" (pedido del dueño, 22-nov-2026): las superficies
// principales llevan un borde celeste (el glaciar de la paleta Noche glaciar,
// el mismo del pulso; antes #94e0fd) un poco más
// marcado arriba, fijo y sin animación; el checkout, de un azul más intenso.
// Tenue: la primera versión partía casi blanca y con halo, y el dueño la
// encontró sobreiluminada; pidió más tranquilidad en los colores. El borde
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
  // Celeste glaciar #9dd7f4 = rgb(157,215,244): el borde y el pulso del encabezado usan el mismo.
  assert.ok(bloque.includes('rgba(157,215,244,'), 'el borde usa el celeste glaciar del pulso');
  assert.match(html, /\.hdr-pulse \.mon path\{[^}]*stroke:#9dd7f4/, 'el pulso del encabezado es ese mismo celeste');
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
  assert.match(bloque, /\.checkout-modal::after\{padding:1\.25px;background:linear-gradient\(180deg,rgba\(110,196,239,/);
  assert.match(bloque, /\.checkout-modal\{background:radial-gradient\(110% 34% at 50% 0%,rgba\(90,188,237,\.17\)/);
});

test('colores tranquilos: sin blancos, finos y sin halo celeste', () => {
  const css = bloque.replace(/\/\*[\s\S]*?\*\//g, '');
  // Los degradados de los bordes, sin colores opacos (los casi blancos de antes
  // iban en hex) y con poca opacidad: el general hasta .5 y el checkout hasta .7.
  const anillo = css.match(/::after\{\s*content:""[^}]*\}/);
  assert.ok(anillo, 'falta la regla del borde');
  const checkout = css.match(/\.checkout-modal::after\{[^}]*\}/);
  assert.ok(checkout, 'falta el borde del checkout');
  for (const [regla, tope] of [[anillo[0], 0.5], [checkout[0], 0.7]]) {
    const deg = regla.slice(regla.indexOf('background:'));
    const grad = deg.slice(0, deg.indexOf(';'));
    assert.ok(!/#[0-9a-f]{3,6}\b/i.test(grad), 'sin colores opacos en el borde: ' + grad);
    const alfas = [...grad.matchAll(/rgba\(\d+,\d+,\d+,([\d.]+)\)/g)].map(m => Number(m[1]));
    assert.ok(alfas.length >= 2, 'el degradado va en rgba: ' + grad);
    for (const a of alfas) assert.ok(a <= tope, `opacidad ${a} sobre ${tope} en ${grad}`);
  }
  assert.match(anillo[0], /padding:1px;/, 'el borde general mide 1px');
  // Sin halo celeste alrededor de las tarjetas (solo el checkout, apenas).
  for (const m of css.matchAll(/box-shadow:[^;}]*/g)) {
    assert.ok(!m[0].includes('157,215,244'), 'sin halo celeste: ' + m[0]);
  }
});
