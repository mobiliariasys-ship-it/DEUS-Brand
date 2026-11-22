'use strict';
// La pestaña lateral "Gira y gana" va quieta, al medio a la izquierda, como
// siempre. Se probó que se arrastrara y después que bajara sola con la página;
// el dueño pidió volver a como estaba (22-nov-2026: "ponelo quieto como antes").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('un toque la abre', () => {
  assert.ok(html.includes('id="ruleta-tab" onclick="abrirRuleta()"'));
});

test('va quieta al medio a la izquierda', () => {
  assert.match(html, /\.rifa-tab\{position:fixed;left:0;top:50%;transform:translateY\(-50%\);/);
});

test('sin arrastre ni movimiento con la página', () => {
  assert.ok(!/getElementById\('ruleta-tab'\)/.test(html), 'ningún script la mueve');
  assert.ok(!html.includes("'deus-ruleta-tab'"), 'no guarda una altura');
  assert.ok(!/\.rifa-tab\{touch-action:none/.test(html), 'el dedo sobre ella mueve la página');
  assert.ok(!/\.rifa-tab\{transition:[^}]*transform/.test(html), 'sin transición de posición');
});
