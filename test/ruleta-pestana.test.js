'use strict';
// La pestaña lateral "Gira y gana" baja sola a medida que se baja por la
// página (pedido del dueño, 22-nov-2026): arriba va al medio y, cuando llega la
// caja de compra, ya está abajo, para no tapar el precio ni el botón. Antes se
// podía arrastrar; el dueño pidió que mejor no se moviera a mano.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const tab = html.indexOf('id="ruleta-tab"');
const ini = html.indexOf('<script>', tab);
const script = html.slice(ini, html.indexOf('</script>', ini));

test('un toque la sigue abriendo', () => {
  assert.ok(html.includes('id="ruleta-tab" onclick="abrirRuleta()"'));
});

test('ya no se arrastra: el dedo sobre ella vuelve a mover la página', () => {
  assert.ok(!/pointerdown|pointermove|setPointerCapture/.test(script), 'sin arrastre');
  assert.ok(!/\.rifa-tab\{touch-action:none/.test(html), 'sin touch-action:none, deslizar sobre ella baja la página');
  assert.ok(!html.includes("'deus-ruleta-tab'"), 'ya no se guarda una altura elegida a mano');
});

test('baja con la página, hasta quedar bajo la caja de compra', () => {
  assert.ok(script.includes("getElementById('ruleta-tab')"), 'el script que sigue a la pestaña es el que la mueve');
  assert.match(script, /addEventListener\('scroll', pedir, \{ passive: true \}\)/, 'escucha el scroll sin trabarlo');
  assert.ok(script.includes('requestAnimationFrame'), 'se mueve una vez por cuadro');
  assert.ok(script.includes("'.buybox'"), 'el recorrido termina cuando llega la caja de compra');
  assert.ok(script.includes("'.sticky-buy'"), 'abajo deja libre la barra de compra');
  assert.match(script, /tab\.style\.transform = 'translateY\(-50%\) translateY\('/, 'se mueve con transform');
  assert.match(html, /\.rifa-tab\{transition:padding \.2s,filter \.2s,transform \.35s/, 'el movimiento es suave');
});
