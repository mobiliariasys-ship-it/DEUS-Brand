'use strict';
// Top bar: "ENVÍO GRATIS" (con "hasta el <fecha>" mientras dure el plazo de la
// promo), "1-2 días de envío a todo Chile" y, mientras dure ese plazo, el
// contador "Termina en". El reloj de 24 h que iba debajo se sacó a pedido del
// dueño y no debe volver. Estas pruebas avisan si el HTML de la página deja de
// coincidir con lo que arma el JS (si difieren, la barra cambia de forma al
// cargar) y si al vencer el plazo quedara la fecha o el contador.
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

// Una línea `var NOMBRE = ...;` del HTML, tal cual.
function variable(nombre) {
  const m = SRC.match(new RegExp('^var ' + nombre + '\\s*=.*;', 'm'));
  assert.ok(m, 'no encontré var ' + nombre + ' en index.html');
  return m[0];
}

const DIA = 86400000;
// Arma la barra como el JS de la página, con `msRestante` de plazo.
function barra(msRestante) {
  const ctx = vm.createContext({ ofertaActiva: () => true, msRestanteOferta: () => msRestante });
  vm.runInContext([variable('FIN_PROMO_TEXTO'), variable('OFERTA_UNIDADES_DIAS'), variable('OFERTA_UNIDADES_HORAS'),
    extraer('unidadesOferta'), extraer('firmaUnidadesOferta'), extraer('htmlCajitasOferta'),
    extraer('htmlContadorBarra'), extraer('htmlTopBar')].join('\n'), ctx);
  return { titulo: ctx.htmlTopBar(), contador: ctx.htmlContadorBarra(msRestante) };
}

test('con plazo: "ENVÍO GRATIS hasta el <fecha>", el envío a todo Chile y el contador aparte', () => {
  const { titulo, contador } = barra(5 * DIA);
  assert.match(titulo, /ENVÍO GRATIS<span class="ab-hasta"> hasta el \d+ de [a-z]+<\/span>/);
  assert.match(titulo, /1-2 días de envío a todo Chile/);
  assert.doesNotMatch(titulo, /ab-reloj|abcd-box|role="timer"/, 'el contador va en htmlContadorBarra(), no en el título');
  assert.match(contador, /Termina en/);
  assert.match(contador, /<b id="ofcd-d">--<\/b><small>días<\/small>/);
});

test('sin plazo (ya vencido): sin fecha y sin contador, queda "ENVÍO GRATIS"', () => {
  const { titulo, contador } = barra(0);
  assert.match(titulo, /ENVÍO GRATIS/);
  assert.doesNotMatch(titulo, /hasta el/);
  assert.strictEqual(contador, '');
  assert.ok(extraer('quitarContadorVencido').includes('.ab-hasta'), 'al vencer hay que sacar también la fecha del título');
});

test('el HTML de la página trae ya pintado lo mismo que arma el JS', () => {
  const { titulo, contador } = barra(5 * DIA);
  assert.ok(SRC.includes('<div class="announce-bar" id="offer-bar">' + titulo + contador + '</div>'),
    'el top bar del HTML no coincide con htmlTopBar() + htmlContadorBarra()');
});

test('no queda el reloj de 24 h en el código', () => {
  for (const t of ['id="ab-reloj"', 'function pintarReloj', 'setInterval(pintarReloj', 'RELOJ_HORA']) {
    assert.ok(!SRC.includes(t), 'quedó en index.html: ' + t);
  }
});
