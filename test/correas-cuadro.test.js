'use strict';
// Las correas extra del checkout como una obra en un cuadro: cada una cuelga
// de un hilo y se mece como un péndulo al cambiar el color o al agarrarla, para
// dar ganas de tocarlas (el % de pedidos con correas se mide en el panel).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const IMG = n => path.join(__dirname, '..', 'img', n);

test('las tres correas recortadas existen, con transparencia y livianas', () => {
  for (const n of ['correa-silicona.webp', 'correa-nylon-negra.webp', 'correa-nylon-gris.webp']) {
    assert.ok(fs.existsSync(IMG(n)), 'falta ' + n);
    const b = fs.readFileSync(IMG(n));
    assert.strictEqual(b.toString('ascii', 8, 12), 'WEBP', n);
    assert.ok(b.toString('ascii', 12, 16) === 'VP8X' && (b[20] & 0x10), n + ': sin canal alfa (el fondo no sería transparente)');
    assert.ok(b.length < 60 * 1024, n + ' pesa ' + Math.round(b.length / 1024) + ' KB');
  }
});

test('la miniatura y el cuadro grande cuelgan las dos correas, y el nylon sigue al color', () => {
  assert.match(HTML, /class="upsell-zoom cq-abrir" onclick="abrirCuadroCorreas\(event\)"/);
  assert.strictEqual((HTML.match(/<span class="cq-col cq-sil">/g) || []).length, 2, 'silicona en los dos cuadros');
  assert.strictEqual((HTML.match(/class="cq-nylon" src="img\/correa-nylon-negra\.webp"/g) || []).length, 2, 'parten en negro');
  assert.ok(HTML.includes("const nylon = 'img/correa-nylon-' + (correaColor === 'grises' ? 'gris' : 'negra') + '.webp';"));
  assert.ok(HTML.includes('<div class="cq-grande" id="cq-grande" onclick="event.stopPropagation()" hidden>'),
    'tocar o arrastrar en el cuadro grande no agrega ni quita las correas');
  assert.ok(HTML.includes('onclick="verFotosCorreas(event)">Ver fotos'), 'las fotos reales siguen a un toque');
  assert.match(HTML, /if \(cambio\) cuadroCorreas\.empujar\(/, 'cambiar el color las mece');
});

function motor(reducir) {
  const i = HTML.indexOf('const cuadroCorreas = (function () {');
  const fin = HTML.indexOf('return { empujar };', i);
  assert.ok(i >= 0 && fin > i, 'falta cuadroCorreas');
  const src = HTML.slice(i, HTML.indexOf('})();', fin) + 5);
  const col = cls => ({ style: {}, classList: { contains: c => c === cls, add() {}, remove() {} }, addEventListener() {} });
  const cols = [col('cq-sil'), col('cq-nyl')];
  const cola = [];
  let t = 0;
  const ctx = {
    Math, setTimeout: f => f(), performance: { now: () => t },
    requestAnimationFrame: f => cola.push(f),
    window: { matchMedia: () => ({ matches: reducir }) },
    document: { querySelectorAll: q => (q === '.cq' ? [{ classList: { contains: c => c === 'cq-big' }, querySelectorAll: () => cols }] : []) }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.cuadroCorreas = cuadroCorreas;', ctx);
  const ang = c => Number((c.style.transform || 'rotate(0rad)').match(/rotate\(([-\d.]+)rad\)/)[1]);
  const correr = () => {
    const nylon = [];
    let cuadros = 0;
    while (cola.length && cuadros < 3000) { t += 16; cola.shift()(t); nylon.push(ang(cols[1])); cuadros++; }
    return { nylon, cuadros };
  };
  return { ctx, cols, cola, correr, ang };
}

test('se mece como un péndulo: oscila, rebota dentro del marco y se detiene', () => {
  const m = motor(false);
  m.ctx.cuadroCorreas.empujar(2.6);
  const { nylon, cuadros } = m.correr();
  const cambios = nylon.slice(1).filter((a, k) => Math.sign(a) !== Math.sign(nylon[k]) && a !== 0).length;
  assert.ok(cambios >= 3, 'tiene que ir y volver varias veces: ' + cambios);
  assert.ok(Math.max(...nylon.map(Math.abs)) <= 0.4 + 1e-9, 'no pasa del tope del marco');
  assert.ok(cuadros < 1500, 'se queda quieta sola (y deja de dibujar): ' + cuadros + ' cuadros');
  assert.strictEqual(m.ang(m.cols[1]), 0, 'termina colgando derecha');
  assert.strictEqual(m.cola.length, 0, 'quieta no gasta animación');
  // La silicona también se mueve, menos que el nylon.
  m.ctx.cuadroCorreas.empujar(2.6);
  let maxSil = 0, maxNyl = 0, t2 = 1e6;
  while (m.cola.length) { t2 += 16; m.cola.shift()(t2); maxSil = Math.max(maxSil, Math.abs(m.ang(m.cols[0]))); maxNyl = Math.max(maxNyl, Math.abs(m.ang(m.cols[1]))); }
  assert.ok(maxSil > 0 && maxSil < maxNyl);
});

test('con "reducir movimiento" no se mecen', () => {
  const m = motor(true);
  m.ctx.cuadroCorreas.empujar(2.6);
  assert.strictEqual(m.cola.length, 0);
});
