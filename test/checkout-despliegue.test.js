'use strict';
// Apertura del checkout (pedido del dueño, 22-nov-2026, inspirado en el panel
// lateral de Spotify; segunda versión, elegida entre tres): el fondo se
// oscurece de a poco, la ventana baja un poco y se asienta, y el contenido
// aparece en cascada de arriba hacia abajo. Lo que cuidan estas pruebas: la
// ventana nunca es translúcida (la primera versión partía en opacidad .35 y en
// iPhone se veía la página a través) ni se recorta, y el cierre de JS espera lo
// mismo que dura la animación.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const bloqueCss = html.slice(html.indexOf('/* Apertura del checkout'), html.indexOf('@media (prefers-reduced-motion: reduce){', html.indexOf('/* Apertura del checkout')));

test('al abrir: fondo que se oscurece y ventana que baja y se asienta, siempre opaca', () => {
  assert.match(html, /\.checkout-overlay\.show\{animation:coVelo [^}]*backwards;\}/);
  assert.match(html, /\.checkout-overlay\.show \.checkout-modal\{transform-origin:50% 0;animation:coBaja [^}]*backwards;\}/);
  const baja = html.match(/@keyframes coBaja\{[^}]*\}\}/);
  assert.ok(baja, 'falta coBaja');
  assert.ok(!/opacity|clip-path/.test(baja[0]), 'la ventana no se transparenta ni se recorta al abrir: ' + baja[0]);
  assert.ok(!/clip-path/.test(bloqueCss.replace(/\/\*[\s\S]*?\*\//g, '')), 'sin recorte (en iPhone no corría)');
});

test('el contenido aparece en cascada, de arriba hacia abajo', () => {
  const ini = html.indexOf('function desplegarCheckout(m)');
  assert.ok(ini > 0, 'falta desplegarCheckout');
  const fn = html.slice(ini, html.indexOf('\n        }\n', ini));
  assert.ok(fn.includes("matchMedia('(prefers-reduced-motion: reduce)')"), 'respeta reducir movimiento');
  assert.ok(fn.includes('!m.animate'), 'donde no hay API de animaciones, no corre');
  assert.match(fn, /delay: i \* 30/, 'cada bloque un poco después del anterior');
  assert.match(fn, /fill: 'backwards'/, 'al terminar no deja nada puesto');
  // Con todo ya pintado: el total aparece recién en actualizarTotalCheckout()
  // y, si la cascada corría antes, quedaba fuera y se veía de entrada.
  const abrir = html.slice(html.indexOf('function abrirCheckout('), html.indexOf('function cerrarCheckout('));
  const total = abrir.indexOf('actualizarTotalCheckout();'), cascada = abrir.indexOf("desplegarCheckout(overlay.querySelector('.checkout-modal'));");
  assert.ok(total > 0 && cascada > total, 'la cascada corre después de pintar el total');
});

test('al cerrar: se repliega y JS espera lo mismo que la animación', () => {
  const css = html.match(/\.checkout-overlay\.show\.cerrando \.checkout-modal\{animation:coRepliegue \.(\d+)s/);
  assert.ok(css, 'falta la animación de cierre');
  const js = html.match(/var CIERRE_CHECKOUT_MS = (\d+);/);
  assert.ok(js, 'falta CIERRE_CHECKOUT_MS');
  assert.strictEqual(Number(js[1]), Number(css[1]) * 10, 'el JS oculta la ventana justo cuando termina de replegarse');
  assert.match(html, /overlay\.classList\.add\('cerrando'\);[\s\S]{0,260}setTimeout\(\(\) => overlay\.classList\.remove\('show', 'cerrando'\), sinMovimiento \? 0 : CIERRE_CHECKOUT_MS\)/);
});

test('si se vuelve a abrir mientras se cierra, el cierre se corta y parte desde arriba', () => {
  assert.match(html, /clearTimeout\(cierreCheckout\);\s*overlay\.classList\.remove\('cerrando'\);\s*overlay\.scrollTop = 0;\s*overlay\.classList\.add\('show'\);/);
});

test('con "reducir movimiento", sin animación', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\s*\.checkout-overlay\.show,\.checkout-overlay\.show \.checkout-modal,\s*\.checkout-overlay\.show\.cerrando,\.checkout-overlay\.show\.cerrando \.checkout-modal\{animation:none;\}/);
});
