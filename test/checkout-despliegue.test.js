'use strict';
// El checkout se abre desenrollándose de arriba hacia abajo y se cierra
// replegándose (pedido del dueño, 22-nov-2026, inspirado en el panel lateral
// de Spotify). Lo delicado: el recorte del despliegue NO puede quedar puesto al
// terminar (taparía los botones de pago al bajar), por eso el relleno es
// "backwards"; y el cierre de JS espera lo mismo que dura la animación.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('al abrir: el fondo se oscurece de a poco y la ventana se desenrolla', () => {
  assert.match(html, /\.checkout-overlay\.show\{animation:coVelo [^}]*backwards;\}/);
  assert.match(html, /\.checkout-overlay\.show \.checkout-modal\{animation:coDespliegue [^}]*backwards;\}/,
    'con "both" el recorte final quedaría puesto y taparía lo de más abajo');
  assert.match(html, /@keyframes coDespliegue\{[\s\S]*?clip-path:inset\(0 0 calc\(100% - 72px\) 0 round 10px\)[\s\S]*?clip-path:inset\(0 0 calc\(100% - 100vh\) 0 round 10px\)/);
});

test('al cerrar: se repliega y JS espera lo mismo que la animación', () => {
  const css = html.match(/\.checkout-overlay\.show\.cerrando \.checkout-modal\{animation:coRepliegue \.(\d+)s/);
  assert.ok(css, 'falta la animación de cierre');
  const js = html.match(/var CIERRE_CHECKOUT_MS = (\d+);/);
  assert.ok(js, 'falta CIERRE_CHECKOUT_MS');
  assert.strictEqual(Number(js[1]), Number(css[1]) * 10, 'el JS oculta la ventana justo cuando termina de replegarse');
  assert.match(html, /overlay\.classList\.add\('cerrando'\);[\s\S]{0,120}setTimeout\(\(\) => overlay\.classList\.remove\('show', 'cerrando'\), CIERRE_CHECKOUT_MS\)/);
});

test('si se vuelve a abrir mientras se cierra, el cierre se corta y parte desde arriba', () => {
  assert.match(html, /clearTimeout\(cierreCheckout\);\s*overlay\.classList\.remove\('cerrando'\);\s*overlay\.scrollTop = 0;\s*overlay\.classList\.add\('show'\);/);
});

test('con "reducir movimiento" solo aparece y desaparece', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)\{\s*\.checkout-overlay\.show \.checkout-modal\{animation:coAparece/);
});
