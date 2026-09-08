'use strict';
// Regresión del pixel: una campaña optimizada a "Añadir al carrito" quemó
// $31.792 en un día — 41 AddToCart a $775 y CERO compras — mientras solid,
// optimizada a Compra, pagaba $11.137 por AddToCart y sí vendía.
//
// La causa: AddToCart salía dentro de abrirCheckout(), o sea a UN CLIC de
// cualquier CTA y sin ninguna fricción en el medio. El evento no era falso;
// era barato de producir, y el optimizador de Meta hizo exactamente lo que le
// pedimos: buscar gente que abre el modal y se va.
//
// Estos tests corren las funciones REALES extraídas de index.html. Si alguien
// vuelve a emitir AddToCart en el abrir del checkout, fallan.
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

// Monta reportarAddToCart/armarAddToCart/dispararAddToCart reales sobre un fbq
// espía, más el `const addToCartVistos` y el `let addToCartPendiente` que viven
// fuera de las funciones.
function montar() {
  const track = [];
  const ctx = {
    Set, JSON, console: { error() {}, log() {} },
    fbq: (tipo, evento, datos) => { if (tipo === 'track') track.push({ evento, datos }); },
  };
  ctx.window = { fbq: ctx.fbq };
  vm.createContext(ctx);
  vm.runInContext(
    'const addToCartVistos = new Set();\nlet addToCartPendiente = null;\n' +
    extraer('reportarAddToCart') + '\n' +
    extraer('armarAddToCart') + '\n' +
    extraer('dispararAddToCart') + '\n',
    ctx
  );
  return { ctx, track, atc: () => track.filter(t => t.evento === 'AddToCart') };
}

test('abrir el checkout NO emite AddToCart: solo lo deja armado', () => {
  const { ctx, atc } = montar();
  vm.runInContext("armarAddToCart('negra', 'DEUS Band', 1, 62990)", ctx);
  assert.strictEqual(atc().length, 0, 'armar no debe disparar el pixel');
  assert.notStrictEqual(vm.runInContext('addToCartPendiente', ctx), null);
});

test('el AddToCart sale recién con la interacción real', () => {
  const { ctx, atc } = montar();
  vm.runInContext("armarAddToCart('negra', 'DEUS Band', 2, 62990); dispararAddToCart()", ctx);
  assert.strictEqual(atc().length, 1);
  // Los objetos nacen dentro del vm, con otro Object.prototype: comparamos
  // el contenido serializado, no la identidad del prototipo.
  assert.strictEqual(JSON.stringify(atc()[0].datos.contents),
    JSON.stringify([{ id: 'negra', quantity: 2, item_price: 62990 }]));
  assert.strictEqual(atc()[0].datos.value, 125980);
});

test('abrir y cerrar sin tocar nada no deja rastro (el caso de los $775)', () => {
  const { ctx, atc } = montar();
  // Tres aperturas seguidas del modal, cero interacción: el patrón exacto que
  // el optimizador encontró barato.
  for (let i = 0; i < 3; i++) vm.runInContext("armarAddToCart('negra', 'DEUS Band', 1, 62990)", ctx);
  assert.strictEqual(atc().length, 0);
});

test('mirar negra -> gris -> negra emite 2 AddToCart, no 3', () => {
  const { ctx, atc } = montar();
  const ver = c => vm.runInContext("armarAddToCart('" + c + "', 'DEUS Band', 1, 62990); dispararAddToCart()", ctx);
  ver('negra'); ver('gris'); ver('negra');
  assert.strictEqual(atc().length, 2, 'el Set dedupea la combinación repetida');
  assert.strictEqual(atc().map(t => t.datos.content_ids[0]).join(','), 'negra,gris');
});

test('disparar dos veces la misma intención emite un solo evento', () => {
  const { ctx, atc } = montar();
  vm.runInContext("armarAddToCart('negra', 'DEUS Band', 1, 62990); dispararAddToCart(); dispararAddToCart()", ctx);
  assert.strictEqual(atc().length, 1);
});

test('cambiar la cantidad sí es un AddToCart nuevo', () => {
  const { ctx, atc } = montar();
  vm.runInContext("armarAddToCart('negra', 'DEUS Band', 1, 62990); dispararAddToCart()", ctx);
  vm.runInContext("armarAddToCart('negra', 'DEUS Band', 3, 62990); dispararAddToCart()", ctx);
  assert.strictEqual(atc().length, 2);
  assert.strictEqual(atc()[1].datos.contents[0].quantity, 3);
});

// ── El cableado en el HTML, no solo las funciones ────────────────────────
test('abrirCheckout arma el AddToCart pero no lo reporta', () => {
  const cuerpo = extraer('abrirCheckout');
  assert.ok(/armarAddToCart\(/.test(cuerpo), 'abrirCheckout debe ARMAR el evento');
  assert.ok(!/reportarAddToCart\(/.test(cuerpo) && !/dispararAddToCart\(/.test(cuerpo),
    'abrirCheckout NO debe emitir AddToCart: eso lo volvería a dejar a un clic de cualquier CTA');
  assert.ok(/fbq\('track', 'ViewContent'/.test(cuerpo), 'abrir el modal es ViewContent');
});

test('el primer campo del checkout dispara el AddToCart pendiente', () => {
  const input = SRC.match(/<input[^>]*id="co-nombre"[^>]*>/);
  assert.ok(input, 'no encontré el input co-nombre');
  assert.ok(/dispararAddToCart\(\)/.test(input[0]), 'escribir el nombre debe emitir el AddToCart armado');
});

test('elegir color y cambiar cantidad también lo disparan', () => {
  assert.ok(/dispararAddToCart\(\)/.test(extraer('setColorUnidad')), 'setColorUnidad');
  assert.ok(/dispararAddToCart\(\)/.test(extraer('cambiarCantidadCheckout')), 'cambiarCantidadCheckout');
});

test('el carrito de verdad sigue reportando al toque', () => {
  // confirmarCantidad() es un "agregar al carrito" literal: ahí no hay que
  // diferir nada, la fricción ya ocurrió.
  assert.ok(/reportarAddToCart\(/.test(extraer('confirmarCantidad')));
});
