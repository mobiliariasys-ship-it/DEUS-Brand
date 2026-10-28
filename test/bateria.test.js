'use strict';
// Batería: hasta 20 días por carga (decisión del dueño; antes decía 30 y "una
// carga al mes"). La página, los datos para Google y redes, la cifra animada
// bajo el botón, la tabla comparativa y el chatbot tienen que decir lo mismo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const html = leer('index.html');
const chat = leer('services', 'chat.js');

test('la batería es de 20 días en todos lados (ya no 30 ni "una carga al mes")', () => {
  const viejos = ['30 días de batería', '30 días por carga', 'Hasta 30 días', 'aguanta hasta 30',
    'una carga al mes', 'se carga una vez al mes', 'cargarla una vez al mes', 'la cargas una vez al mes',
    'Hasta un mes con una sola carga', 'data-hasta="30"'];
  for (const [nombre, txt] of [['index.html', html], ['chatbot', chat]]) {
    for (const v of viejos) assert.ok(!txt.includes(v), nombre + ' todavía dice "' + v + '"');
  }
  assert.match(html, /<b data-hasta="20">20<\/b><small>días<\/small>/, 'la cifra animada bajo el botón');
  assert.match(html, /<span class="cv">Hasta 20 días<\/span>/, 'la tabla comparativa');
  assert.match(html, /<meta name="description" content="[^"]*hasta 20 días de batería/, 'la descripción para Google');
  assert.match(chat, /Batería: hasta 20 días por carga/);
});
