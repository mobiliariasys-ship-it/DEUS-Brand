'use strict';
// Las 3 fotos principales: las dos bandas de cada una se mecen como péndulos
// al cambiar de color o al tocarlas (pedido del dueño). Encima de la foto va
// un parche del fondo sin bandas y las bandas recortadas, en el mismo lugar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const DIR = path.join(__dirname, '..', 'img', 'hero-bandas');

test('cada color tiene su parche de fondo y sus dos bandas, en dos tamaños y livianas', () => {
  let total800 = 0;
  for (const c of ['negra', 'gris', 'rosada']) for (const pieza of ['placa', 'silicona', 'nylon']) for (const base of [800, 1200]) {
    const f = path.join(DIR, `${c}-${pieza}-${base}.webp`);
    assert.ok(fs.existsSync(f), 'falta ' + path.basename(f));
    const b = fs.readFileSync(f);
    assert.strictEqual(b.toString('ascii', 8, 12), 'WEBP');
    if (pieza !== 'placa') assert.ok(b.toString('ascii', 12, 16) === 'VP8X' && (b[20] & 0x10), path.basename(f) + ': la banda necesita fondo transparente');
    if (base === 800) total800 += b.length;
  }
  assert.ok(total800 < 220 * 1024, 'en el celular los 3 colores pesan ' + Math.round(total800 / 1024) + ' KB');
});

test('cada foto del carrusel lleva su capa de bandas, y la foto principal sigue igual', () => {
  for (const c of ['negra', 'gris', 'rosada']) {
    assert.match(HTML, new RegExp('<div class="slide-w"><img class="slide" [^\\n]*data-color="' + c + '"[^\\n]*><div class="sl-arte" data-color="' + c + '" aria-hidden="true"></div></div>'));
  }
  assert.match(HTML, /<img class="slide" loading="eager" fetchpriority="high"[^\n]*src="img\/slide-negra-800\.webp"/, 'la foto principal se sigue pidiendo primero');
  // La capa se arma recién con la página cargada.
  assert.match(HTML, /window\.addEventListener\('load', function \(\) \{ setTimeout\(function \(\) \{ bandasHero\.armar\(colorOrder\[currentSlide\]\); \}, 700\); \}\);/);
  assert.match(HTML, /if \(!bandasHero\.tocar\(e\.target, e\.changedTouches\[0\]\.clientX\)\) abrirZoom\(\);/, 'tocar una banda la mece; el resto abre el zoom');
  assert.match(HTML, /bandasHero\.empujar\(colorOrder\[currentSlide\], haciaAdelante \? -0\.16 : 0\.16\);/, 'cambiar de color las mece');
});

function motor(reducir, ventana) {
  const i = HTML.indexOf('var BANDAS_HERO = ');
  const fin = HTML.indexOf("setTimeout(function () { colorOrder.forEach(function (c) { bandasHero.armar(c); }); }, 3500);", i);
  assert.ok(i >= 0 && fin > i, 'falta el motor de las bandas');
  const src = HTML.slice(i, fin);
  const cola = [];
  let t = 0;
  const elem = () => {
    const e = { style: {}, className: '', hijos: [], on: {},
      addEventListener(ev, f) { (this.on[ev] = this.on[ev] || []).push(f); },
      appendChild(h) { this.hijos.push(h); }, remove() { this.quitado = true; },
      getBoundingClientRect: () => ({ left: 0, width: 10 }) };
    e.closest = () => e;
    return e;
  };
  function Img() { this.style = {}; }
  Object.defineProperty(Img.prototype, 'srcset', { set(v) { this._s = v; if (this.onload) this.onload(); }, get() { return this._s; } });
  const capas = {};
  const timers = [];
  const marco = elem();
  const ctx = {
    Math, Object, Image: Img, performance: { now: () => t }, setTimeout: f => timers.push(f),
    requestAnimationFrame: f => cola.push(f),
    colorOrder: ['negra', 'gris', 'rosada'], currentSlide: 0,
    window: Object.assign({ matchMedia: () => ({ matches: reducir }), addEventListener() {} }, ventana),
    document: {
      readyState: 'loading', createElement: elem, getElementById: id => (id === 'galSlider' ? marco : null),
      querySelector: q => { const c = q.match(/data-color="(\w+)"/)[1]; return capas[c] || (capas[c] = Object.assign(elem(), { classList: { add() { this.lista = true; }, remove() {} } })); }
    }
  };
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.bandasHero = bandasHero;', ctx);
  const ang = el => Number((el.style.transform || 'rotate(0rad)').match(/rotate\(([-\d.]+)rad\)/)[1]);
  const bandas = c => capas[c].hijos.filter(h => h.className === 'sl-banda');
  const correr = (c, cadaCuadro) => { let n = 0; while (cola.length && n < 4000) { t += 16; cola.shift()(t); n++; if (cadaCuadro) cadaCuadro(bandas(c).map(ang)); } return n; };
  const cuadro = () => { if (cola.length) { t += 16; cola.shift()(t); } };
  return { ctx, cola, capas, bandas, ang, correr, cuadro, timers, marco };
}

test('al cambiar de color se mecen de lado, poco, y se quedan quietas solas', () => {
  const m = motor(false);
  const tope = Number(HTML.match(/TOPE = ([\d.]+);/)[1]);
  m.ctx.bandasHero.armar('negra');
  assert.ok(m.capas.negra.classList.lista, 'la capa se muestra cuando cargaron las 3 piezas');
  m.ctx.bandasHero.empujar('negra', -0.16);
  const sil = [];
  const n = m.correr('negra', a => sil.push(a[0]));
  const cambios = sil.slice(1).filter((a, k) => a !== 0 && Math.sign(a) !== Math.sign(sil[k])).length;
  assert.ok(cambios >= 3, 'va y vuelve: ' + cambios);
  assert.ok(Math.max(...sil.map(Math.abs)) <= tope + 1e-9, 'no pasa del tope');
  assert.ok(n < 2500, 'se queda quieta sola: ' + n + ' cuadros');
  assert.deepStrictEqual(m.bandas('negra').map(m.ang), [0, 0], 'terminan colgando derechas');
});

test('si una banda va contra la otra, chocan y se pasan el impulso en vez de atravesarse', () => {
  const m = motor(false);
  const choque = Number(HTML.match(/CHOQUE = ([\d.]+);/)[1]);
  m.ctx.bandasHero.armar('gris');
  const [sil, nyl] = m.bandas('gris');
  // Toque del lado derecho del nylon: se va hacia la izquierda, contra la silicona.
  assert.strictEqual(m.ctx.bandasHero.tocar(nyl, 9), true);
  let peor = -1, siliconaSeMovio = false;
  m.correr('gris', ([s, n]) => { peor = Math.max(peor, n - s); if (s > 0.004) siliconaSeMovio = true; });
  assert.ok(peor <= choque + 1e-6, 'nunca se atraviesan: ' + peor);
  assert.ok(siliconaSeMovio, 'la silicona recibe el golpe y se mueve');
  assert.strictEqual(m.ctx.bandasHero.tocar(null, 0), false, 'fuera de una banda no hace nada (abre el zoom)');
});

test('con "reducir movimiento" no se arma nada: queda la foto original', () => {
  const m = motor(true);
  m.ctx.bandasHero.empujar('negra', -0.16);
  assert.strictEqual(m.cola.length, 0);
  assert.ok(!m.capas.negra || !m.capas.negra.hijos.length);
});

// Ancho y alto de un webp VP8X (las bandas, que tienen transparencia).
function medidas(f) {
  const b = fs.readFileSync(f);
  return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
}

test('las bandas arrancan por encima de la foto: al ladearse no se ve dónde terminan', () => {
  // Se veían cortadas arriba al moverse: la banda empezaba justo en el borde
  // y, al girar, dejaba una esquina vacía.
  const m = motor(false);
  const tope = Number(HTML.match(/TOPE = ([\d.]+);/)[1]);
  const clavo = Number(HTML.match(/CLAVO = ([\d.]+);/)[1]);
  const conf = JSON.parse(HTML.match(/var BANDAS_HERO = (\{.*\});/)[1]);
  // Ancho / alto de cada foto original (la del carrusel las muestra a 1200/1306).
  const FOTOS = { negra: 1200 / 1306, gris: 1200 / 1309, rosada: 1178 / 1280 };
  for (const c of ['negra', 'gris', 'rosada']) {
    const FOTO = FOTOS[c];
    m.ctx.bandasHero.armar(c);
    ['silicona', 'nylon'].forEach((n, i) => {
      const { y, h, w } = conf[c][n];
      const el = m.bandas(c)[i];
      assert.ok(y <= -0.05, c + ' ' + n + ': arranca por encima de la foto');
      // El recorte tiene las mismas proporciones que dice la configuración.
      const img = medidas(path.join(DIR, `${c}-${n}-1200.webp`));
      assert.ok(Math.abs(img.h / img.w - (h / FOTO) / w) < 0.01, c + ' ' + n + ': proporción del recorte');
      // El clavo sigue en el mismo lugar (CLAVO de alto de foto sobre el borde).
      assert.strictEqual(el.style.top, (y * 100).toFixed(3) + '%');
      const origen = Number(el.style.transformOrigin.match(/^50% ([-\d.]+)%$/)[1]) / 100;
      assert.ok(Math.abs(y + origen * h + clavo) < 1e-4, c + ' ' + n + ': clavo en ' + (y + origen * h));
      // En el ángulo máximo, la esquina de arriba que baja sigue fuera de la foto.
      const d = y + clavo, mitad = (w * FOTO) / 2;
      const esquina = -clavo + d * Math.cos(tope) + mitad * Math.sin(tope);
      assert.ok(esquina < -0.02, c + ' ' + n + ': la esquina queda en ' + esquina.toFixed(4));
    });
  }
});

test('no usan el movimiento del celular ni piden permiso', () => {
  // El dueño probó que se movieran con el celular y prefirió sacarlo: que no
  // pida permiso (iPhone) y que no se muevan al mover el teléfono.
  assert.ok(!/devicemotion|deviceorientation|requestPermission/i.test(HTML));
});

test('mantener presionada una banda no la saca como foto (menú de imagen del iPhone)', () => {
  // El toque cae en el contenedor .sl-banda y no en la imagen recortada.
  assert.match(HTML, /\.sl-banda img\{[^}]*pointer-events:none/);
  assert.match(HTML, /\.sl-banda\{[^}]*-webkit-touch-callout:none/);
  assert.match(HTML, /\.sl-arte img\{[^}]*-webkit-touch-callout:none/);
});
