'use strict';
// Colores por unidad: comprar 2 bandas y que cada una lleve su color.
// Lo que se prueba acá es que el pedido no pueda quedar mal armado — una
// unidad sin color, un largo que no cuadre con lo cobrado, o un texto en el
// sitio distinto del que llega al correo de despacho.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../services/colores');

// ── normalizar: el largo SIEMPRE cuadra con lo que se cobra ──────────────
test('devuelve exactamente una entrada por unidad', () => {
  assert.deepStrictEqual(C.normalizar(['negra', 'gris'], 2, 'negra'), ['negra', 'gris']);
  assert.strictEqual(C.normalizar(['negra'], 5, 'negra').length, 5);
  assert.strictEqual(C.normalizar(['negra', 'gris', 'rosada'], 1, 'negra').length, 1,
    'si mandan más colores que unidades, se cobra 1 y se despacha 1');
});

test('las unidades sin color caen al color base, nunca quedan vacías', () => {
  assert.deepStrictEqual(C.normalizar(['gris'], 3, 'negra'), ['gris', 'negra', 'negra']);
  assert.deepStrictEqual(C.normalizar(null, 2, 'rosada'), ['rosada', 'rosada']);
  assert.deepStrictEqual(C.normalizar([], 1, undefined), ['negra'], 'sin base válida, negra');
});

test('un color inventado no llega al pedido', () => {
  // El arreglo viene del navegador: nada impide que alguien mande basura.
  assert.deepStrictEqual(C.normalizar(['azul', 'negra'], 2, 'gris'), ['gris', 'negra']);
  assert.deepStrictEqual(C.normalizar(['<script>', null, 7], 3, 'negra'), ['negra', 'negra', 'negra']);
});

test('respeta el tope de 10 por pedido que aceptan las rutas de pago', () => {
  assert.strictEqual(C.normalizar([], 99, 'negra').length, C.MAX_UNIDADES);
  assert.strictEqual(C.normalizar([], 0, 'negra').length, 1);
  assert.strictEqual(C.normalizar([], -3, 'negra').length, 1);
});

// ── resumen: lo que ve el dueño en el correo ─────────────────────────────
test('un solo color se ve igual que siempre, aunque sean varias unidades', () => {
  // Importa: así los correos y la tabla de pedidos no cambian para la mayoría
  // de las compras, que siguen siendo de un color.
  assert.strictEqual(C.resumen(['negra']), 'negra');
  assert.strictEqual(C.resumen(['negra', 'negra', 'negra']), 'negra');
});

test('los colores mezclados se desglosan con cantidad', () => {
  assert.strictEqual(C.resumen(['negra', 'negra', 'gris']), '2 negras + 1 gris');
  assert.strictEqual(C.resumen(['gris', 'gris', 'rosada', 'rosada']), '2 grises + 2 rosadas');
  assert.strictEqual(C.resumen(['negra', 'gris', 'rosada']), '1 negra + 1 gris + 1 rosada');
});

test('el desglose sale en el orden del catálogo, no en el que llegó', () => {
  assert.strictEqual(C.resumen(['rosada', 'negra']), C.resumen(['negra', 'rosada']));
  assert.strictEqual(C.resumen(['rosada', 'negra']), '1 negra + 1 rosada');
});

test('contar cuadra con el total de unidades', () => {
  const arr = C.normalizar(['negra', 'gris', 'negra'], 3, 'negra');
  assert.deepStrictEqual(C.contar(arr), { negra: 2, gris: 1 });
  assert.strictEqual(Object.values(C.contar(arr)).reduce((a, b) => a + b, 0), arr.length);
});

// ── el sitio y el correo tienen que decir lo mismo ───────────────────────
test('el texto del checkout coincide con el que va al correo', () => {
  // El navegador pinta el desglose en la tarjeta del producto y el backend lo
  // arma de nuevo para el pedido. Son dos implementaciones: si se separan, el
  // cliente ve un desglose en pantalla y al dueño le llega otro.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const plural = {};
  const m = html.match(/const COLOR_PLURAL = \{([^}]*)\}/);
  assert.ok(m, 'no encontré COLOR_PLURAL en index.html');
  for (const par of m[1].split(',')) {
    const [k, v] = par.split(':').map(x => x.trim().replace(/^'|'$/g, ''));
    if (k) plural[k] = v;
  }
  assert.deepStrictEqual(plural, C.PLURAL, 'los plurales del sitio y del backend se separaron');

  // Y la misma regla de armado, sobre los mismos casos.
  const comoElSitio = arr => {
    const cuenta = {};
    for (const c of arr) cuenta[c] = (cuenta[c] || 0) + 1;
    const claves = C.COLORES.filter(c => cuenta[c]);
    if (claves.length === 1) return claves[0];
    return claves.map(c => cuenta[c] + ' ' + (cuenta[c] > 1 ? plural[c] : c)).join(' + ');
  };
  for (const caso of [['negra'], ['negra', 'negra'], ['negra', 'gris'],
                      ['gris', 'gris', 'rosada'], ['negra', 'gris', 'rosada']]) {
    assert.strictEqual(comoElSitio(caso), C.resumen(caso), 'difieren en ' + JSON.stringify(caso));
  }
});

// ── el front manda lo que el back espera ─────────────────────────────────
test('index.html manda el arreglo de colores en el pedido', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/colores: checkoutTapones \? \[\] : checkoutColores\.slice\(0, checkoutQty\)/.test(html),
    'datosPedido() debe mandar un color por unidad, recortado a la cantidad cobrada');
  assert.ok(/function setColorUnidad/.test(html), 'falta el selector por unidad');
});

test('el pedido real del navegador se guarda con el desglose', () => {
  // Payload capturado de un checkout real en Chromium (2 bandas, una de cada
  // color) pasado por la misma transformación que hacen las rutas de pago.
  const body = { colores: ['negra', 'gris'], cantidad: 2, selectedColor: 'negra', soloTapones: false };
  const arr = C.normalizar(body.colores, body.cantidad, body.selectedColor);
  assert.deepStrictEqual(arr, ['negra', 'gris']);
  assert.strictEqual(C.resumen(arr), '1 negra + 1 gris', 'es lo que verá el correo de despacho');
  assert.deepStrictEqual(C.contar(arr), { negra: 1, gris: 1 }, 'y lo que suma la reposición');
});

test('comprar solo tapones no arrastra un color de banda', () => {
  // Antes el pedido de tapones guardaba color 'negra' porque copiaba
  // selectedColor tal cual, y ensuciaba el conteo de qué reponer.
  for (const f of ['../server.js', '../routes/flow.js', '../routes/transbank.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(/soloTapones \? \[\] : colores_\.normalizar/.test(src), f + ': falta el guarda de tapones');
    assert.ok(/soloTapones \? null : colores_\.resumen/.test(src), f + ': tapones debe quedar sin color');
  }
});

test('las tres rutas de pago arman el color desde el arreglo', () => {
  for (const f of ['../server.js', '../routes/flow.js', '../routes/transbank.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    assert.ok(/services\/colores/.test(src), f + ' no usa el servicio de colores');
    assert.ok(/colores_\.normalizar\(colores, cantidad, selectedColor\)/.test(src),
      f + ' debe normalizar el arreglo del navegador antes de guardarlo');
    assert.ok(/color: colorPedido/.test(src), f + ' debe guardar el resumen, no selectedColor crudo');
  }
});
