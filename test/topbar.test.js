'use strict';
// Top bar: el reloj de 24 h cuenta hasta las 02:00 de Chile y
// vuelve a 24 h justo a esa hora, todos los días. Corre las funciones REALES
// de index.html con un reloj fijo, en invierno (UTC-4) y en verano (UTC-3),
// para que nadie lo pase a una hora fija en UTC sin darse cuenta.
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

function variable(nombre) {
  const m = SRC.match(new RegExp('var ' + nombre + ' = [^\\n]*;'));
  assert.ok(m, 'no encontré var ' + nombre + ' en index.html');
  return m[0];
}

// Arma las funciones con el reloj clavado en `iso` (UTC).
function conReloj(iso) {
  const fijo = new Date(iso).getTime();
  class RelojFijo extends Date {
    constructor(...a) { if (a.length) super(...a); else super(fijo); }
    static now() { return fijo; }
  }
  const ctx = vm.createContext({ Date: RelojFijo, ofertaActiva: () => true });
  vm.runInContext([
    variable('RELOJ_HORA'),
    extraer('ahoraChile'), extraer('msHastaReinicio'), extraer('textoReloj'), extraer('htmlTopBar'),
  ].join('\n'), ctx);
  return ctx;
}

test('el reloj llega a cero a las 02:00 de Chile y vuelve a 24 h (verano, UTC-3)', () => {
  assert.strictEqual(conReloj('2026-10-13T04:59:59Z').textoReloj(), '00:00:01', '01:59:59 → falta 1 segundo');
  assert.strictEqual(conReloj('2026-10-13T05:00:00Z').textoReloj(), '24:00:00', '02:00:00 → vuelve a 24 h');
  assert.strictEqual(conReloj('2026-10-13T05:00:01Z').textoReloj(), '23:59:59');
  assert.strictEqual(conReloj('2026-10-12T17:00:00Z').textoReloj(), '12:00:00', '14:00 → faltan 12 h');
  assert.strictEqual(conReloj('2026-10-13T02:30:00Z').textoReloj(), '02:30:00', '23:30 → faltan 2 h 30');
});

test('en invierno (UTC-4) el reinicio sigue a las 02:00 de Chile, no a una hora fija en UTC', () => {
  assert.strictEqual(conReloj('2026-07-15T06:00:00Z').textoReloj(), '24:00:00', '02:00 de Chile en julio');
  assert.strictEqual(conReloj('2026-07-15T05:00:00Z').textoReloj(), '01:00:00', '01:00 de Chile en julio');
});

test('el reloj nunca pasa de 24 h ni queda en cero', () => {
  for (let h = 0; h < 24; h++) {
    const ms = conReloj(`2026-10-12T${String(h).padStart(2, '0')}:17:42Z`).msHastaReinicio();
    assert.ok(ms > 0 && ms <= 86400000, `a las ${h}:17Z dio ${ms}`);
  }
});

test('la barra lleva el envío a todo Chile y el reloj solo, sin etiqueta', () => {
  const c = conReloj('2026-10-12T17:00:00Z');
  const con = c.htmlTopBar(false);
  assert.match(con, /1-2 días de envío a todo Chile/);
  assert.match(con, /id="ab-reloj"[^>]*>12:00:00<\/b><\/div>$/, 'el reloj cierra la barra, sin texto al lado');
  const sin = c.htmlTopBar(true);
  assert.match(sin, /class="ab-in sin-reloj"/);
  assert.doesNotMatch(sin, /ab-reloj/, 'con un plazo de promo real, sus cajitas reemplazan al reloj');
});

test('el HTML de la página trae el mismo marcado que arma htmlTopBar()', () => {
  // Si difieren, la barra cambia de forma apenas corre aplicarReserva().
  const m = SRC.match(/<div class="announce-bar" id="offer-bar">([\s\S]*?)<\/div><\/div>/);
  assert.ok(m, 'no encontré el top bar en el HTML');
  const reloj = /(id="ab-reloj"[^>]*>)[^<]*</;
  const html = (m[1] + '</div>').replace(reloj, '$1X<');
  const js = conReloj('2026-10-12T17:00:00Z').htmlTopBar(false).replace(reloj, '$1X<');
  assert.strictEqual(html, js);
});
