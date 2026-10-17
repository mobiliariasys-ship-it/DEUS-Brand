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
    ['los pasos', pos('Cómo usar la DEUS Band')],
    ['las funciones (bloque propio, arriba del 360°)', pos('<div class="soft-block" id="funciones">')],
    ['el 360°', pos('id="tecnologia"')],
    ['La app', pos('<div class="soft-block" id="app">')],
    ['"se conecta con" de la app', pos('class="app-tri"')],
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
  assert.match(diseno, /data-lazy-src="img\/diseno-video-v2\.mp4"/);
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
  // Los reintentos no pueden ser de un solo gesto: el primer toque de la
  // visita llega antes de que el video (carga diferida) tenga archivo.
  const bloque = html.slice(html.indexOf('// Video del ciclista ("Diseño sin distracciones")'), html.indexOf('// Pulso "en vivo"'));
  assert.ok(bloque.length > 0, 'falta el script del video del ciclista');
  assert.ok(!/once:\s*true/.test(bloque), 'el reintento con toque tiene que valer para cada toque');
  assert.match(bloque, /'canplay'/, 'se reintenta cuando el video termina de cargar');
});

test('el video del ciclista se maneja como el de la reseña y no se queda pegado en 4G', () => {
  const ini = html.indexOf('<div class="diseno-video">');
  const video = html.slice(ini, html.indexOf('</video>', ini));
  // Sin autoplay: con él Safari aplica su regla de "autoplay fuera de pantalla"
  // y, con la carga diferida, quedaba en la portada. Lo reproduce el script.
  assert.ok(!/\sautoplay[\s>]/.test(video), 'el video no lleva el atributo autoplay');
  assert.match(video, /\bmuted\b/);
  assert.match(video, /\bplaysinline\b/);
  assert.match(video, /data-poster="img\/diseno-poster-v2\.webp"/, 'portada = primer cuadro del video');
  // Esquinas en el propio video, sin contenedor con overflow:hidden
  const cont = html.match(/\.diseno-video\{[^}]*\}/);
  assert.ok(cont && !/overflow:hidden/.test(cont[0]), 'el contenedor del video no puede recortar con overflow:hidden');
  assert.match(html, /\.diseno-video video\{[^}]*border-radius:/);
  // Ahorro de batería: si el iPhone no deja reproducir solo, aparece el play
  const bloque = html.slice(html.indexOf('// Video del ciclista ("Diseño sin distracciones")'), html.indexOf('// Pulso "en vivo"'));
  assert.match(bloque, /NotAllowedError/);
  assert.match(bloque, /vid-bloqueado/);
  assert.match(html.slice(ini, html.indexOf('</div>', ini)), /class="vid-play"/, 'falta el botón de play de respaldo');
  // Archivo liviano y con el índice al principio (empieza a verse mientras baja)
  const mp4 = fs.readFileSync(path.join(__dirname, '..', 'img', 'diseno-video-v2.mp4'));
  assert.ok(mp4.length <= 700 * 1024, 'el video pesa ' + Math.round(mp4.length / 1024) + ' KB: en 4G se queda en la portada');
  const moov = mp4.indexOf('moov'), mdat = mp4.indexOf('mdat');
  assert.ok(moov !== -1 && moov < mdat, 'el índice (moov) tiene que ir antes de los datos (faststart)');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'img', 'diseno-poster-v2.webp')), 'falta la portada nueva');
});

test('las funciones se nombran sin cantidad ("Funciones", no "14 funciones") en la web y el chatbot', () => {
  // Se mira el texto visible y los scripts, sin los comentarios del código.
  const visible = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/\b14 funciones/i.test(visible), 'quedó "14 funciones" en la web');
  const chat = fs.readFileSync(path.join(__dirname, '..', 'services', 'chat.js'), 'utf8');
  assert.ok(!/\b14 funciones/i.test(chat), 'quedó "14 funciones" en el chatbot');
});

test('"Materiales y sensor" va dentro de la tarjeta del 360°, debajo del visor y sin foto', () => {
  const ini = html.indexOf('<div class="soft-block" id="tecnologia">');
  const fin = html.indexOf('<!-- /r360-card -->', ini);
  const tarjeta = html.slice(ini, fin);
  const mat = tarjeta.indexOf('Materiales y sensor');
  assert.ok(mat !== -1, 'Materiales y sensor tiene que estar en la tarjeta del 360°');
  assert.ok(tarjeta.indexOf('id="rot360"') < mat, 'va debajo de la banda girando');
  for (const t of ['Ligera, resistente y con sensor de alta calidad', 'bat-stats', 'Certificaciones CE · FCC · RoHS']) {
    assert.ok(tarjeta.includes(t), 'falta en la tarjeta: ' + t);
  }
  assert.ok(!/<img[^>]*deus-caja/.test(html), 'la foto de la caja ya no va');
  assert.strictEqual(html.indexOf('class="bat-card"'), -1, 'no puede quedar la tarjeta suelta de materiales');
});

test('las funciones van siempre a la vista: 12, sin desplegable, sin HRV ni Ritmo y cadencia', () => {
  const ini = html.indexOf('<div class="soft-block" id="funciones">');
  const fin = html.indexOf('</ul>', ini);
  assert.ok(ini !== -1 && fin !== -1, 'falta el bloque de funciones');
  const bloque = html.slice(ini, fin);
  assert.ok(bloque.includes('Funciones de la DEUS Band'), 'el título va en el bloque');
  const ids = [...bloque.matchAll(/data-fn="([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ['fc', 'spo2', 'estres', 'recup', 'fases', 'dur', 'pasos', 'cal', 'dep', 'act', 'alarma', 'avisos']);
  assert.ok(!/id="fn-ver"|fn-plegable/.test(html), 'no puede quedar el botón "Ver las funciones" ni el desplegable');
  // Cada función que se ve tiene su ficha en el modal
  for (const id of ids) assert.match(html, new RegExp('\\b' + id + ":\\{t:'"), 'falta la ficha de ' + id);
});
