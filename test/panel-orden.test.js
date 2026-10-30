'use strict';
// Orden del panel (pedido del dueño, 30-oct-2026): "Dentro del checkout" va
// justo debajo de la utilidad diaria y el gasto por hora después, las
// secciones van agrupadas (Plata, Conversión, Operación) y las últimas ventas
// y los tickets del sorteo quedan plegados al final.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const pos = id => { const i = HTML.indexOf('<section id="' + id + '"'); assert.ok(i >= 0, 'falta ' + id); return i; };

test('el checkout va justo debajo de la utilidad diaria y el gasto por hora después', () => {
  const ids = [...HTML.matchAll(/<section id="(sec-[a-z]+)"/g)].map(m => m[1]);
  const u = ids.indexOf('sec-utilidad');
  assert.deepStrictEqual(ids.slice(u, u + 3), ['sec-utilidad', 'sec-checkout', 'sec-gastoh']);
});

test('las secciones van agrupadas y los registros plegados al final', () => {
  const orden = ['sec-utilidad', 'sec-checkout', 'sec-gastoh', 'sec-ads', 'sec-canales', 'sec-embudo', 'sec-conducta',
    'sec-convierte', 'sec-negocio', 'sec-pedidos', 'sec-resenas', 'sec-chat', 'sec-ventas', 'sec-sorteo'];
  const posiciones = orden.map(pos);
  assert.deepStrictEqual(posiciones, posiciones.slice().sort((a, b) => a - b), 'orden de las secciones');
  assert.strictEqual((HTML.match(/<div class="grupo-h">/g) || []).length, 4);
  for (const id of ['sec-ventas', 'sec-sorteo']) {
    assert.match(HTML, new RegExp('<section id="' + id + '" class="plegable cerrada">'), id + ' empieza plegada');
    assert.match(HTML, new RegExp("onclick=\"plegar\\('" + id + "'\\)\">Mostrar ▾</button>"));
  }
});

test('el conteo de tickets pasa a la sección plegada y la barra lateral la abre', () => {
  assert.ok(!HTML.includes('<div class="k">Tickets sorteo</div>'), 'ya no va en las tarjetas de arriba');
  assert.strictEqual((HTML.match(/id="s-tickets"/g) || []).length, 1);
  assert.match(HTML, /function irA\(id, el\)\{ var t=document\.getElementById\(id\); if\(t && t\.classList\.contains\('cerrada'\)\) plegar\(id, true\);/);
  // Barra lateral en el mismo orden que el panel.
  const nav = [...HTML.matchAll(/onclick="irA\('(sec-[a-z]+)',this\)"/g)].map(m => m[1]).filter(id => id !== 'sec-graficos');
  const enPanel = nav.slice().sort((a, b) => pos(a) - pos(b));
  assert.deepStrictEqual(nav, enPanel);
});

// Tema constelación (31-oct-2026): nació con la foto del dragón de estrellas
// del dueño; el mismo día eligió de fondo una tinta líquida negra con vetas
// turquesa, en movimiento (humo con brillo de gel), y el panel pasó a sus tonos.
const tramoTema = () => {
  const i = HTML.indexOf('/* ══ Tema constelación');
  assert.ok(i >= 0, 'falta la capa del tema');
  return HTML.slice(i, HTML.indexOf('</style>', i));
};

test('el tema respeta los colores: sin verde ni violeta de adorno', () => {
  const tema = tramoTema();
  assert.ok(tema.length > 500, 'falta la capa del tema');
  assert.match(tema, /backdrop-filter:blur/);
  assert.ok(!/9b8cff|var\(--green\)|#8fce4a/.test(tema), 'el tema no usa verde ni violeta');
  assert.ok(!/#9b8cff|#cfc6ff/.test(HTML), 'los gráficos no usan violeta');
});

test('el fondo de tinta existe en 1080 y 4K, liviano, y va detrás del vidrio', () => {
  // Agrandado ×4 con Real-ESRGAN y exportado por alto (lo que manda en 16:9).
  for (const [archivo, alto, maxKb] of [['panel-fondo.webp', 1080, 300], ['panel-fondo-4k.webp', 2160, 600]]) {
    const img = path.join(__dirname, '..', 'img', archivo);
    assert.ok(fs.existsSync(img), 'falta img/' + archivo);
    const kb = fs.statSync(img).size / 1024;
    assert.ok(kb < maxKb, archivo + ' pesa ' + Math.round(kb) + ' KB: tiene que cargar rápido');
    // Alto del WebP (VP8 con pérdida: bytes 28-29 del archivo, 14 bits).
    const buf = fs.readFileSync(img);
    assert.strictEqual(buf.toString('ascii', 12, 16), 'VP8 ', archivo + ' no es un WebP con pérdida');
    assert.strictEqual(buf.readUInt16LE(28) & 0x3fff, alto, archivo + ' no mide ' + alto + ' px de alto');
  }
  const tema = tramoTema();
  // En un ::before fijo: background-attachment:fixed no anda en el iPhone.
  assert.match(tema, /body::before\{content:'';position:fixed;inset:0;z-index:-1;[^}]*url\(img\/panel-fondo\.webp\)/);
  // El 4K solo en pantallas grandes o de alta densidad.
  assert.match(tema, /@media\(min-width:1921px\),\(min-width:821px\) and \(min-resolution:1\.5dppx\)\{\s*body::before\{[^}]*url\(img\/panel-fondo-4k\.webp\)/);
  assert.ok(!/panel-dragones|panel-constelacion/.test(tema), 'quedó un fondo anterior');
  assert.match(tema, /backdrop-filter:blur\(22px\)/);
});

test('las tarjetas de arriba van en bento: ventas, conversión de hoy y utilidad primero y más grandes', () => {
  const grid = HTML.slice(HTML.indexOf('<div class="grid bento">'), HTML.indexOf('<div class="rango-bar">'));
  const ids = [...grid.matchAll(/<div class="stat([^"]*)"[^>]*>.*?id="(s-[a-z-]+)"/g)].map(m => [m[2], m[1].trim()]);
  assert.strictEqual(ids.length, 12, 'son 12 tarjetas');
  assert.deepStrictEqual(ids.slice(0, 3).map(x => x[0]), ['s-vent-hoy', 's-conv-hoy', 's-util-k']);
  for (const [id, cls] of ids.slice(0, 3)) assert.match(cls, /\bhero\b/, id + ' va grande');
  assert.deepStrictEqual(ids.slice(-3).map(x => x[0]), ['s-conv-sem', 's-conv-mes', 's-conv']);
  const tema = tramoTema();
  assert.match(tema, /\.grid\.bento\{grid-template-columns:repeat\(12,minmax\(0,1fr\)\)/);
  // Las fuentes son las del sitio: nada de afuera.
  assert.match(tema, /url\(\/fonts\/michroma-400-lat\.woff2\)/);
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(HTML));
});

test('el checkout ya no va arriba de todo: queda después de los gráficos, en el grupo de la plata', () => {
  assert.ok(pos('sec-checkout') > HTML.indexOf('id="sec-graficos"'));
  assert.ok(pos('sec-checkout') > HTML.indexOf('<div class="grupo-h">💰 Plata'));
  assert.ok(pos('sec-checkout') < HTML.indexOf('<div class="grupo-h">🫗 Conversión'));
});

test('el checkout tiene su filtro propio: hoy, ayer, semana, mes y todo', () => {
  const vm = require('vm');
  const extraer = nombre => {
    const i = HTML.search(new RegExp('function\\s+' + nombre + '\\s*\\('));
    assert.ok(i >= 0, 'falta ' + nombre);
    let prof = 0;
    for (let k = HTML.indexOf('{', i); k < HTML.length; k++) {
      if (HTML[k] === '{') prof++;
      else if (HTML[k] === '}' && --prof === 0) return HTML.slice(i, k + 1);
    }
  };
  for (const [n, txt] of [['1', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes'], ['0', 'Todo']]) {
    assert.ok(HTML.includes('data-co="' + n + '" onclick="setRangoCheckout(') && HTML.includes('>' + txt + '</button>'), 'falta ' + txt);
  }
  // Los días de Chile: hoy y ayer, para armar los datos de prueba.
  const hoyCl = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const dia = n => { const d = new Date(hoyCl); d.setDate(hoyCl.getDate() - n); return d.toLocaleDateString('en-CA'); };
  const data = {
    conducta: { 'co:1abrio': 100, 'co:5pago': 9 },             // histórico
    conductaPorDia: { [dia(0)]: { 'co:1abrio': 4, 'co:5pago': 1 }, [dia(1)]: { 'co:1abrio': 6, 'co:5pago': 2 } }
  };
  const botones = ['1', 'ayer', 'semana', 'mes', '0'].map(n => ({ n, on: false, getAttribute: () => n,
    classList: { toggle(c, v) { this.d.on = !!v; } } }));
  botones.forEach(b => { b.classList.d = b; });
  const nota = { textContent: '' };
  let pintado = null;
  const ctx = { Date, Number, String, Object, localStorage: { getItem: () => null, setItem() {} },
    document: { querySelectorAll: q => (q === '.co-rango' ? botones : []), getElementById: id => (id === 'co-nota' ? nota : null) },
    pintarCheckout: c => { pintado = c; } };
  vm.createContext(ctx);
  const rangoLbl = HTML.match(/var RANGO_LBL = \{[^}]*\};/)[0];
  vm.runInContext(rangoLbl + '\nvar ULT_DATA = null;\n' + ['diasChile', 'conductaRango', 'pintarCheckoutRango', 'setRangoCheckout'].map(extraer).join('\n') +
    '\n' + HTML.match(/var CO_RANGO = \(function\(\)\{[\s\S]*?\}\)\(\);/)[0], ctx);
  ctx.ULT_DATA = data;
  // JSON: los objetos armados dentro del vm traen otro Object.prototype.
  const ver = n => { vm.runInContext('setRangoCheckout(' + JSON.stringify(n) + ')', ctx); return JSON.parse(JSON.stringify(pintado)); };
  assert.strictEqual(vm.runInContext('CO_RANGO', ctx), 'semana', 'arranca en esta semana');
  assert.deepStrictEqual(ver(1), { 'co:1abrio': 4, 'co:5pago': 1 }, 'hoy');
  assert.match(nota.textContent, /^hoy · 4 abrieron · 1 pagó$/);
  assert.deepStrictEqual(ver('ayer'), { 'co:1abrio': 6, 'co:5pago': 2 }, 'ayer');
  assert.deepStrictEqual(ver(0), data.conducta, 'todo = histórico');
  assert.match(nota.textContent, /^acumulado histórico/);
  assert.deepStrictEqual(botones.filter(b => b.on).map(b => b.n), ['0'], 'se marca el botón elegido');
  // El periodo general no apaga los botones del checkout.
  assert.match(HTML, /document\.querySelectorAll\('\.rango-btn\[data-rango\]'\)/);
});

test('la tinta del fondo se mueve en la PC, y queda quieta en el celular o con "reducir movimiento"', () => {
  assert.ok(HTML.includes('<canvas id="fondo-vivo" aria-hidden="true"></canvas>'));
  const i = HTML.indexOf('// ── Fondo vivo');
  assert.ok(i >= 0, 'falta el arranque del fondo vivo');
  const js = HTML.slice(i, HTML.indexOf('</script>', i));
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /\(max-width:820px\)/);
  assert.match(js, /3840\*2160/, 'el canvas con tope en 4K');
  assert.match(js, /img\/panel-fondo-4k\.webp/);
  // Solo con la tinta andando se saca la foto quieta del ::before.
  assert.match(tramoTema(), /html\.fondo-vivo body::before\{background:linear-gradient\([^)]*\)[^;]*\);\}/);
});

test('la tinta se dibuja en un hilo aparte, así los refrescos del panel no la traban', () => {
  const i = HTML.indexOf('// ── Fondo vivo');
  const js = HTML.slice(i, HTML.indexOf('</script>', i));
  assert.match(js, /new Worker\('fondo-vivo\.js'\)/);
  assert.match(js, /transferControlToOffscreen\(\)/);
  assert.match(js, /visibilitychange/, 'se pausa con la pestaña oculta');
  assert.ok(!/getContext\('webgl'/.test(HTML), 'el hilo principal no dibuja la tinta');
  const hilo = fs.readFileSync(path.join(__dirname, '..', 'fondo-vivo.js'), 'utf8');
  // Ritmo parejo hasta 60 cuadros por segundo (con 30 y un umbral justo de 33 ms
  // se salteaba cuadros de más y el movimiento se quedaba pegado).
  assert.match(hilo, /var MIN_ENTRE_CUADROS = 1000 \/ 60 - 3;/);
  assert.match(hilo, /if \(ahora - ultimo < MIN_ENTRE_CUADROS\) return;/);
  assert.match(hilo, /t0 \+= performance\.now\(\) - pausaDesde/, 'al volver a la pestaña no salta');
  assert.match(hilo, /webglcontextlost/);
  // Ni Netlify ni el servidor bloquean el archivo.
  const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
  assert.ok(!/from = "\/(\*\.js|fondo-vivo\.js)"/.test(toml), 'netlify.toml bloquea fondo-vivo.js');
});

test('las métricas usan todo el ancho de la pantalla', () => {
  assert.match(tramoTema(), /\.main\{max-width:none;\}/);
});
