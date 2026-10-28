'use strict';
// Top bar: "ENVÍO GRATIS" y "1-2 días de envío a todo Chile", sin contador.
// El reloj de 24 h que iba debajo se sacó a pedido del dueño; estas pruebas
// avisan si vuelve a aparecer y si el HTML de la página deja de coincidir con
// el que arma htmlTopBar() (si difieren, la barra cambia de forma al cargar).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Saca `function nombre(...) { ... }` del HTML balanceando llaves.
function extraer(nombre) {
  const i = SRC.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
  assert.ok(i >= 0, 'no encontré function ' + nombre + '() en index.html');
  let prof = 0;
  for (let k = SRC.indexOf('{', i); k < SRC.length; k++) {
    if (SRC[k] === '{') prof++;
    else if (SRC[k] === '}' && --prof === 0) return SRC.slice(i, k + 1);
  }
  throw new Error('llaves sin cerrar en ' + nombre);
}

function htmlTopBar() {
  const ctx = vm.createContext({ ofertaActiva: () => true });
  vm.runInContext(extraer('htmlTopBar'), ctx);
  return ctx.htmlTopBar();
}

test('la barra lleva "ENVÍO GRATIS" y el envío a todo Chile, sin contador', () => {
  const html = htmlTopBar();
  assert.match(html, /ENVÍO GRATIS/);
  assert.match(html, /1-2 días de envío a todo Chile/);
  assert.doesNotMatch(html, /ab-reloj|abcd-box|role="timer"/, 'volvió a aparecer un contador en la barra');
});

test('el HTML de la página trae el mismo marcado que arma htmlTopBar()', () => {
  const m = SRC.match(/<div class="announce-bar" id="offer-bar">([\s\S]*?)<\/div><\/div>/);
  assert.ok(m, 'no encontré el top bar en el HTML');
  assert.strictEqual(m[1] + '</div>', htmlTopBar());
});

test('no queda el reloj de 24 h en el código', () => {
  for (const t of ['id="ab-reloj"', 'function pintarReloj', 'setInterval(pintarReloj', 'RELOJ_HORA']) {
    assert.ok(!SRC.includes(t), 'quedó en index.html: ' + t);
  }
});
