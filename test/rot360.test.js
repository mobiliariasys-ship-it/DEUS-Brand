'use strict';
// Visor 360° dentro de la tarjeta de vidrio. Los cuadros (la carpeta que pide src()) no traen
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

const cuadro = k => 'f_' + String(k).padStart(3, '0') + '.webp';
// La carpeta sale del propio index.html: se prueba lo que de verdad carga la web.
const usada = (html.match(/function src\(i\)\{ return '([^']+)\/f_'/) || [])[1];

test('los 85 cuadros que carga la web tienen fondo transparente', () => {
  assert.ok(usada, 'no se encontró la carpeta de cuadros en src()');
  for (let k = 1; k <= N_CUADROS; k++) {
    const buf = fs.readFileSync(path.join(RAIZ, usada, cuadro(k)));
    assert.ok(tieneAlfa(buf), usada + '/' + cuadro(k) + ' no tiene canal alfa (¿se subió con el fondo negro?)');
  }
});

test('img/rot360 conserva los cuadros con fondo para las páginas cargadas antes del cambio', () => {
  // Esas páginas piden img/rot360 y dibujan sin limpiar el canvas: con cuadros
  // transparentes en esa ruta la banda queda con estela (pasó en producción).
  assert.notStrictEqual(usada, 'img/rot360', 'los cuadros sin fondo van en una carpeta nueva, no en img/rot360');
  for (let k = 1; k <= N_CUADROS; k++) {
    const buf = fs.readFileSync(path.join(RAIZ, 'img', 'rot360', cuadro(k)));
    assert.ok(!tieneAlfa(buf), 'img/rot360/' + cuadro(k) + ' tiene que seguir con su fondo negro');
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

test('la tarjeta 360° va en la tarjeta de vidrio, con "DEUS BAND" y el visor adentro', () => {
  const ini = html.indexOf('<div class="soft-block" id="tecnologia">');
  assert.ok(ini !== -1, 'falta el bloque #tecnologia');
  const fin = html.indexOf('<!-- /r360-card -->', ini);
  assert.ok(fin !== -1, 'falta el cierre de la tarjeta');
  const bloque = html.slice(ini, fin);
  assert.match(bloque, /<div class="r360-card">/);
  assert.match(bloque, /<h2 class="r360-marca">DEUS BAND<\/h2>/);
  assert.ok(bloque.indexOf('r360-marca') < bloque.indexOf('id="rot360"'), 'el título va arriba del visor');
  assert.ok(bloque.includes('id="rot360"'), 'el visor va dentro de la tarjeta');
  assert.match(html, /\.r360-marca\{font-family:'Michroma'/, 'el título usa la letra ancha de la marca');
});

test('el 360° va en "Así de simple", entre los pasos y las funciones de la app', () => {
  const simple = html.indexOf('<section class="soft" id="simple">');
  const finSimple = html.indexOf('</section>', simple);
  const pasos = html.indexOf('Póntela y optimízate', simple);
  const tarjeta = html.indexOf('<div class="soft-block" id="tecnologia">');
  const app = html.indexOf('App Da Halo · gratis', simple);
  assert.ok(simple !== -1 && pasos !== -1 && app !== -1, 'faltan los bloques de #simple');
  assert.ok(simple < pasos && pasos < tarjeta && tarjeta < app && app < finSimple,
    'el 360° va dentro de #simple, después de los pasos y arriba de "App Da Halo · gratis"');
  // El script del visor busca el canvas apenas carga: si quedara antes de la
  // tarjeta no lo encontraría y la banda no giraría.
  const script = html.indexOf("document.getElementById('rot360-canvas')");
  assert.ok(script > html.indexOf('<!-- /r360-card -->'), 'el script del visor tiene que ir después de la tarjeta');
});
