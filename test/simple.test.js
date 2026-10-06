'use strict';
// Orden de "Así de simple" (#simple): todo va en el mismo panel, con tarjetas de
// vidrio. Si una sección queda afuera, bajo la tabla, la página se ve "suelta"
// (pasó con La app y Diseño sin distracciones).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('La app y Diseño sin distracciones van dentro de #simple, antes de la tabla', () => {
  const ini = html.indexOf('<section class="soft" id="simple">');
  const fin = html.indexOf('</section>', ini);
  assert.ok(ini !== -1 && fin !== -1, 'falta la sección #simple');
  const pos = s => html.indexOf(s, ini);
  const orden = [
    ['los pasos', pos('Póntela y optimízate')],
    ['el 360°', pos('id="tecnologia"')],
    ['las +14 funciones', pos('+14 funciones en una sola app')],
    ['La app', pos('<div class="soft-block" id="app">')],
    ['Materiales y sensor', pos('class="bat-card"')],
    ['Diseño sin distracciones', pos('<div class="soft-block" id="diseno">')],
    ['la tabla', pos('Por qué DEUS Band')],
  ];
  for (const [nombre, p] of orden) assert.ok(p > ini && p < fin, nombre + ' tiene que ir dentro de #simple');
  for (let i = 1; i < orden.length; i++) {
    assert.ok(orden[i - 1][1] < orden[i][1], orden[i - 1][0] + ' va antes que ' + orden[i][0]);
  }
  assert.strictEqual(html.indexOf('class="app-sec"'), -1, 'no puede quedar la sección suelta de La app');
});

test('La app y Diseño usan la tarjeta de vidrio del 360° y no pierden su funcionamiento', () => {
  assert.match(html, /<div class="vidrio-card app-card">/);
  assert.match(html, /<div class="vidrio-card diseno-card">/);
  assert.match(html, /\.r360-card,\.vidrio-card\{/, 'mismo vidrio que la tarjeta del 360°');
  // El video se sigue cargando recién cuando la persona se acerca
  const diseno = html.slice(html.indexOf('<div class="soft-block" id="diseno">'), html.indexOf('Por qué DEUS Band'));
  assert.match(diseno, /data-lazy-src="img\/diseno-video\.mp4"/);
  // El carrusel de pantallas busca #appStage al cargar: su script va después
  assert.ok(html.indexOf("getElementById('appStage')") > html.indexOf('id="appStage"'),
    'el script del carrusel de la app tiene que ir después del carrusel');
});

test('el video del ciclista no parte invisible y se reintenta con cada toque', () => {
  // En iPhone, un video que arranca dentro de algo con opacidad 0 (la animación
  // de aparición del panel) queda congelado en la primera imagen. Pasó.
  const css = html.match(/\.soft\.rev \.soft-head,[^{]*\{opacity:0;/);
  const js = html.match(/querySelectorAll\('(\.soft-head,[^']+)'\)/);
  assert.ok(css && js, 'no se encontró la animación de aparición de #simple');
  for (const lista of [css[0], js[1]]) {
    assert.ok(!/vidrio-card|diseno-card/.test(lista), 'la tarjeta del video no puede entrar con la animación de aparición');
  }
  // El refuerzo de autoplay no puede ser de un solo gesto: el primer toque de la
  // visita llega antes de que el video (carga diferida) tenga archivo.
  const refuerzo = html.slice(html.indexOf('// Refuerzo de autoplay'), html.indexOf('// Pulso "en vivo"'));
  assert.ok(refuerzo.length > 0, 'falta el refuerzo de autoplay');
  assert.ok(!/once:\s*true/.test(refuerzo), 'el reintento con toque tiene que valer para cada toque');
  assert.match(refuerzo, /'canplay'/, 'se reintenta cuando el video termina de cargar');
});
