'use strict';
// Visor 360° dentro de la tarjeta de vidrio. Los cuadros (img/rot360) no traen
// fondo: la banda queda sobre el gris de la tarjeta. Si alguien vuelve a subir
// cuadros con fondo negro, o se pierde el clearRect del canvas, el sitio se ve
// mal sin que nada falle — por eso se prueba acá.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const N_CUADROS = 85;

// WebP con transparencia = contenedor extendido (VP8X) con la marca de alfa
// (bit 0x10 del byte 20) y un bloque ALPH con la máscara. Se lee la cabecera a
// mano para no depender de sharp en los tests.
function tieneAlfa(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return false;
  if (buf.toString('ascii', 12, 16) !== 'VP8X') return false;
  if (!(buf[20] & 0x10)) return false;
  for (let p = 12; p + 8 <= buf.length;) {
    const tipo = buf.toString('ascii', p, p + 4);
    if (tipo === 'ALPH') return true;
    p += 8 + buf.readUInt32LE(p + 4) + (buf.readUInt32LE(p + 4) & 1);
  }
  return false;
}

test('los 85 cuadros del 360° tienen fondo transparente', () => {
  for (let k = 1; k <= N_CUADROS; k++) {
    const n = 'f_' + String(k).padStart(3, '0') + '.webp';
    const buf = fs.readFileSync(path.join(RAIZ, 'img', 'rot360', n));
    assert.ok(tieneAlfa(buf), n + ' no tiene canal alfa (¿se subió con el fondo negro?)');
  }
});

test('el canvas se limpia antes de dibujar cada cuadro (si no, la banda deja estela)', () => {
  const draw = html.match(/function draw\(\)\{[^\n]*\}/);
  const drawFull = html.match(/function drawFull\(\)\{[^\n]*\}/);
  assert.ok(draw && drawFull, 'no se encontraron draw() y drawFull()');
  for (const [nombre, cuerpo, ctx] of [['draw', draw[0], 'ctx'], ['drawFull', drawFull[0], 'fctx']]) {
    const limpia = cuerpo.indexOf(ctx + '.clearRect(');
    const dibuja = cuerpo.indexOf(ctx + '.drawImage(');
    assert.ok(limpia !== -1 && dibuja !== -1 && limpia < dibuja, nombre + '() tiene que hacer clearRect antes de drawImage');
  }
});

test('la sección 360° va en la tarjeta, con "DEUS BAND" y el visor adentro', () => {
  const ini = html.indexOf('<section class="how" id="tecnologia">');
  assert.ok(ini !== -1, 'falta la sección #tecnologia');
  const seccion = html.slice(ini, html.indexOf('</section>', ini));
  assert.match(seccion, /<div class="r360-card">/);
  assert.match(seccion, /<h2 class="r360-marca">DEUS BAND<\/h2>/);
  assert.ok(seccion.indexOf('r360-marca') < seccion.indexOf('id="rot360"'), 'el título va arriba del visor');
  assert.ok(seccion.indexOf('id="rot360"') < seccion.indexOf('<!-- /r360-card -->'), 'el visor va dentro de la tarjeta');
  assert.match(html, /\.r360-marca\{font-family:'Michroma'/, 'el título usa la letra ancha de la marca');
});
