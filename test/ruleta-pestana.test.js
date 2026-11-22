'use strict';
// La pestaña lateral "Gira y gana" se arrastra hacia arriba o hacia abajo
// (pedido del dueño, 22-nov-2026: que no moleste al bajar por la página).
// Un toque la sigue abriendo; la altura queda guardada en el navegador.
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

test('el script de arrastre va junto a la pestaña', () => {
  assert.ok(script.includes("getElementById('ruleta-tab')"), 'el script que sigue a la pestaña es el del arrastre');
  for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    assert.ok(script.includes("'" + ev + "'"), 'escucha ' + ev);
  }
  // Al soltar después de arrastrar, el click no abre la ruleta.
  assert.match(script, /addEventListener\('click',[\s\S]*suprimir[\s\S]*\}, true\)/);
});

test('el teléfono no se lleva el gesto (touch-action) y no se selecciona el texto', () => {
  assert.match(html, /\.rifa-tab\{touch-action:none;[^}]*user-select:none;/);
});

test('no se mete bajo la barra de arriba ni bajo la barra de compra', () => {
  assert.ok(script.includes("'.announce-bar'") && script.includes("'.sticky-buy'"));
});

test('la altura se guarda en el navegador sin romper si no hay almacenamiento', () => {
  assert.ok(script.includes("'deus-ruleta-tab'"));
  for (const m of script.matchAll(/localStorage\.(getItem|setItem)/g)) {
    const antes = script.slice(Math.max(0, m.index - 80), m.index);
    assert.ok(/try \{[^}]*$/.test(antes), 'localStorage.' + m[1] + ' va dentro de try');
  }
});
