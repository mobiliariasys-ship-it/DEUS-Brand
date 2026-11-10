'use strict';
// Color agotado (10-nov-2026): el dueño pidió marcar el GRIS como "agotado ·
// pronto restock" en el mismo selector de color, no en la barra de arriba.
// Todo sale de la tabla AGOTADOS de index.html: al reponer stock se vacía y
// el círculo, el aviso y los bloqueos de compra se apagan solos.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const extraer = nombre => {
  const i = HTML.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
  assert.ok(i >= 0, 'falta ' + nombre);
  let prof = 0;
  for (let k = HTML.indexOf('{', i); k < HTML.length; k++) {
    if (HTML[k] === '{') prof++;
    else if (HTML[k] === '}' && --prof === 0) return HTML.slice(i, k + 1);
  }
};
const tabla = () => JSON.parse(HTML.match(/const AGOTADOS = (\{[^}]*\});/)[1].replace(/(\w+):/g, '"$1":'));

test('el gris está marcado como agotado y el aviso va en la fila de colores', () => {
  assert.deepStrictEqual(tabla(), { gris: true });
  // El aviso vive dentro de .colors-row (no en la barra de arriba) y arranca oculto.
  const fila = HTML.slice(HTML.indexOf('<div class="colors-row">'), HTML.indexOf('id="color-mismatch"'));
  assert.ok(fila.includes('<div class="color-agotado" id="color-agotado" style="display:none"></div>'));
  const barra = HTML.slice(HTML.indexOf('id="offer-bar"'), HTML.indexOf('id="topbar"'));
  assert.ok(!/agotad|restock/i.test(barra), 'la barra de arriba no habla del color agotado');
});

test('el texto sale de la tabla: con stock de nuevo no queda ningún aviso', () => {
  const src = "const TEXTO_RESTOCK = 'pronto restock';\n" + extraer('textoAgotados') + '\n' + extraer('textoStock');
  const correr = agotados => {
    const ctx = { AGOTADOS: agotados, colorOrder: ['negra', 'gris', 'rosada'], COLOR_LABEL: { negra: 'negro', gris: 'gris', rosada: 'rosado' }, window: {} };
    vm.createContext(ctx); vm.runInContext(src, ctx);
    return { aviso: vm.runInContext('textoAgotados()', ctx), stock: c => vm.runInContext('textoStock(' + JSON.stringify(c) + ')', ctx) };
  };
  const hoy = correr({ gris: true });
  assert.strictEqual(hoy.aviso, 'Gris agotado · pronto restock');
  assert.strictEqual(hoy.stock('gris'), 'Color GRIS agotado · pronto restock — disponible en negro y rosado');
  assert.strictEqual(hoy.stock('negra'), '');
  const repuesto = correr({});
  assert.strictEqual(repuesto.aviso, '');
  assert.strictEqual(repuesto.stock('gris'), '');
});

test('un color agotado no se puede elegir, ni en la página ni en el checkout', () => {
  // setColor: mueve la galería para mostrarlo, pero no lo deja como color del pedido.
  assert.ok(extraer('setColor').includes('if (AGOTADOS[color]) { goSlide(idx); return; }'));
  // Selector por banda del checkout: el punto agotado no lleva onclick.
  assert.ok(HTML.includes("(ago ? '' : ' onclick=\"setColorUnidad(' + i + ',\\'' + c + '\\')\"')"));
  assert.ok(extraer('setColorUnidad').includes('AGOTADOS[color]) return;'));
  // El chatbot dice lo mismo que la tienda.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'services', 'chat.js'), 'utf8'), /la GRIS está agotada y vuelve pronto/);
});
