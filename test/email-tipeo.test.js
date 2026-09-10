'use strict';
// Regresión: se perdió una venta porque el cliente escribió "gmail.con".
// La validación solo exigía un @ y un punto, así que el correo pasaba, el
// pedido entraba, el comprobante rebotaba y no quedaba forma de contactarlo.
//
// Criterio del arreglo: SUGERIR, no bloquear. Un bloqueo con falso positivo
// bota la venta igual que el correo malo. Solo se frena en terminaciones que
// no existen en internet, donde el falso positivo es imposible.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extraer(nombre) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + nombre + '\\s*\\(');
  const i = SRC.search(re);
  assert.ok(i >= 0, 'no encontré function ' + nombre + '() en index.html');
  let j = SRC.indexOf('{', i), prof = 0;
  for (let k = j; k < SRC.length; k++) {
    if (SRC[k] === '{') prof++;
    else if (SRC[k] === '}' && --prof === 0) return SRC.slice(i, k + 1);
  }
  throw new Error('llaves sin cerrar en ' + nombre);
}

// Las listas viven fuera de las funciones: se extraen del HTML tal cual, para
// que el test se rompa si alguien las cambia sin pensar.
function extraerConst(nombre) {
  const i = SRC.indexOf('const ' + nombre + ' = ');
  assert.ok(i >= 0, 'no encontré const ' + nombre);
  const fin = SRC.indexOf('];', i);
  return SRC.slice(i, fin + 2);
}

const ctx = { Math, Array, String };
vm.createContext(ctx);
vm.runInContext(
  extraerConst('DOMINIOS_COMUNES') + '\n' +
  extraerConst('TLD_IMPOSIBLES') + '\n' +
  extraer('distanciaTexto') + '\n' +
  extraer('normalizarEmail') + '\n' +
  extraer('sugerenciaEmail') + '\n' +
  extraer('tldImposible') + '\n' +
  extraer('telefonoUsable') + '\n', ctx);

const sugerir = e => vm.runInContext('sugerenciaEmail(' + JSON.stringify(e) + ')', ctx);
const imposible = e => vm.runInContext('tldImposible(' + JSON.stringify(e) + ')', ctx);
const fono = t => vm.runInContext('telefonoUsable(' + JSON.stringify(t) + ')', ctx);

// ── El caso que costó la venta ───────────────────────────────────────────
test('gmail.con se detecta y se corrige', () => {
  assert.strictEqual(imposible('juan@gmail.con'), true);
  assert.strictEqual(sugerir('juan@gmail.con'), 'juan@gmail.com');
});

test('las terminaciones inventadas se frenan', () => {
  for (const tld of ['con', 'cmo', 'comm', 'ocm', 'vom', 'xom']) {
    assert.strictEqual(imposible('a@gmail.' + tld), true, '.' + tld + ' debería frenarse');
  }
});

// ── Y lo más importante: NO romper correos válidos ───────────────────────
test('.co, .cm, .om y .cl NO se frenan: son países reales', () => {
  for (const e of ['a@gmail.co', 'a@algo.cm', 'a@algo.om', 'a@empresa.cl', 'a@uc.cl']) {
    assert.strictEqual(imposible(e), false, e + ' es válido y no debe frenarse');
  }
});

test('un correo bien escrito no genera sugerencia', () => {
  for (const e of ['juan@gmail.com', 'a@hotmail.com', 'a@outlook.com', 'a@vtr.net']) {
    assert.strictEqual(sugerir(e), null, e + ' está bien y no debe sugerir nada');
  }
});

test('los dominios propios no se confunden con tipeos', () => {
  for (const e of ['contacto@deusbrand.cl', 'a@miempresa.cl', 'a@universidad.edu']) {
    assert.strictEqual(sugerir(e), null, e + ' no debe recibir sugerencia');
  }
});

// ── Tipeos frecuentes ────────────────────────────────────────────────────
test('tipeos del nombre del dominio', () => {
  assert.strictEqual(sugerir('juan@gmial.com'), 'juan@gmail.com');
  assert.strictEqual(sugerir('juan@hotmial.com'), 'juan@hotmail.com');
  assert.strictEqual(sugerir('juan@gmai.com'), 'juan@gmail.com');
});

test('gmail.cl no existe: se sugiere gmail.com', () => {
  assert.strictEqual(sugerir('juan@gmail.cl'), 'juan@gmail.com');
});

test('gmail.co se sugiere pero NO se frena', () => {
  assert.strictEqual(sugerir('juan@gmail.co'), 'juan@gmail.com');
  assert.strictEqual(imposible('juan@gmail.co'), false);
});

test('mayúsculas y espacios no rompen la detección', () => {
  assert.strictEqual(sugerir(' Juan@GMAIL.CON '), 'juan@gmail.com');
});

test('entradas rotas no explotan', () => {
  for (const e of ['', null, undefined, '@', 'sinarroba', 'a@']) {
    assert.strictEqual(sugerir(e), null);
  }
});

// ── Teléfono ─────────────────────────────────────────────────────────────
test('el teléfono necesita al menos 8 dígitos para coordinar la entrega', () => {
  assert.strictEqual(fono('912345678'), true);
  assert.strictEqual(fono('+56 9 1234 5678'), true);
  assert.strictEqual(fono('123'), false);
  assert.strictEqual(fono('no tengo'), false);
  assert.strictEqual(fono(''), false);
});

// ── El cableado, no solo las funciones ───────────────────────────────────
test('validarCheckout frena el TLD imposible y revisa el teléfono', () => {
  const cuerpo = extraer('validarCheckout');
  assert.ok(/tldImposible\(/.test(cuerpo), 'debe frenar terminaciones inexistentes');
  assert.ok(/telefonoUsable\(/.test(cuerpo), 'debe validar el teléfono');
});

test('el pedido viaja con el correo normalizado', () => {
  assert.ok(/normalizarEmail\(/.test(extraer('datosPedido')),
    'datosPedido debe normalizar el correo antes de mandarlo al backend');
});

test('el campo de correo llama a revisarEmail mientras se escribe', () => {
  const input = SRC.match(/<input[^>]*id="co-email"[^>]*>/);
  assert.ok(input, 'no encontré el input co-email');
  assert.ok(/oninput="revisarEmail\(\)"/.test(input[0]), 'debe revisar al escribir');
});
