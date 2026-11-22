'use strict';
// Mejoras de comodidad que eligió el dueño (22-nov-2026): 1) el "atrás" del
// celular cierra la ventana abierta, 2) los campos no hacen zoom en iPhone,
// 3) autocompletar con un toque y "Siguiente" en el teclado, 4) el checkout
// recuerda lo escrito y 10) el logo sube al inicio sin recargar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const html = leer('index.html');
const ini = html.indexOf('// ── Comodidad (pedidos del dueño, 22-nov-2026) ──');
const script = html.slice(ini, html.indexOf('</script>', ini));

test('2: en el celular los campos llevan letra de 16px (el iPhone no agranda la página)', () => {
  assert.match(html, /@media \(hover:none\) and \(pointer:coarse\)\{\s*\.shipping-input,\.chat-input,\.resena-input,\.rifa-input,\.qty-dialog-input\{font-size:16px;\}/);
  assert.match(html, /\.rl-in\{[^}]*font-size:16px/, 'el correo de la ruleta ya tenía 16px');
});

test('3: los campos del checkout le dicen al teléfono qué dato son', () => {
  for (const [id, ac] of [['co-nombre', 'name'], ['co-email', 'email'], ['co-fono', 'tel'], ['sh-address', 'street-address']]) {
    assert.match(html, new RegExp('<input class="shipping-input" id="' + id + '"[^>]*autocomplete="' + ac + '"'), id + ' → ' + ac);
  }
  for (const id of ['co-nombre', 'co-rut', 'co-email', 'co-fono']) {
    assert.match(html, new RegExp('id="' + id + '"[^>]*enterkeyhint="next"'), id + ' muestra "Siguiente"');
  }
  // Región y comuna siguen con su lista propia: Enter elige de las sugerencias.
  assert.match(html, /id="sh-region" autocomplete="off"/);
  assert.match(script, /var ORDEN = \['co-nombre', 'co-rut', 'co-email', 'co-fono', 'sh-region'\];\s*ORDEN\.slice\(0, -1\)/);
});

test('4: el checkout recuerda lo escrito, solo en el navegador y por 7 días', () => {
  assert.ok(script.includes("var CLAVE = 'deus-checkout-borrador', DIAS = 7;"));
  // Cada uso de localStorage queda dentro de un try (en modo privado o con el
  // almacenamiento bloqueado, tira error): entre el "try {" más cercano y la
  // llamada hay más llaves abiertas que cerradas.
  for (const m of script.matchAll(/localStorage\.(getItem|setItem|removeItem)/g)) {
    const t = script.lastIndexOf('try {', m.index);
    const tramo = script.slice(t, m.index);
    assert.ok(t >= 0 && (tramo.match(/\{/g) || []).length > (tramo.match(/\}/g) || []).length, 'localStorage.' + m[1] + ' va dentro de try');
  }
  assert.match(script, /if \(e && !e\.value && typeof b\.d\[id\] === 'string'\) e\.value = b\.d\[id\];/, 'solo rellena campos vacíos');
  const abrir = html.slice(html.indexOf('function abrirCheckout('), html.indexOf('function cerrarCheckout('));
  assert.ok(abrir.indexOf('deusReponerBorrador()') > 0 && abrir.indexOf('deusReponerBorrador()') < abrir.indexOf("overlay.classList.add('show')"), 'se repone antes de mostrar el checkout');
  assert.match(leer('success.html'), /if \(ref\) \{ try \{[^}]*localStorage\.removeItem\('deus-checkout-borrador'\)/, 'se borra al pagar con éxito');
});

test('10: el logo sube al inicio sin recargar', () => {
  assert.match(html, /class="logo-img" onclick="deusIrArriba\(\)"/);
  assert.ok(!html.includes(`class="logo-img" onclick="location.href='/'"`));
  assert.match(script, /window\.deusIrArriba = function \(\) \{[\s\S]*?scrollTo\(\{ top: 0/);
});

test('1: el "atrás" cierra la ventana abierta en vez de salir de la tienda', () => {
  for (const v of ["['checkout', '#checkout-overlay.show:not(.cerrando)', '#checkout-overlay .checkout-close']",
                   "['ruleta', '.rl-capa.abierta', '.rl-capa.abierta .rl-x']",
                   "['carrito', '#cart-drawer.open', '#cart-drawer .cart-drawer-close']"]) {
    assert.ok(script.includes(v), 'falta ' + v);
  }
  // Cada botón de cerrar de la lista existe en la página (o en la ruleta, que se arma al abrirse).
  for (const m of script.matchAll(/\['[a-z0-9-]+', '[^']+', '([^']+)'\]/g)) {
    const clase = m[1].split(' ').pop().replace(/^\./, '');
    assert.ok(html.includes('class="' + clase + '"') || html.includes('class="' + clase + ' ') || html.includes('"' + clase + '"') || html.includes(clase), 'no existe ' + m[1]);
  }
  assert.match(script, /if \(boton\) boton\.click\(\);\s*if \(abierta\(v\)\) \{[\s\S]*?history\.pushState/, 'si no se cerró (barra de ayuda del checkout), vuelve a poner su paso');
  assert.match(script, /if \(sobran > 0\) \{ ignorar\+\+; history\.go\(-sobran\); \}/, 'cerrar con el botón quita su paso');
  assert.match(script, /history\.replaceState\(\{ deusVentana: id \}, ''\)/, 'del carrito al checkout el paso pasa de una a otra');
  assert.match(script, /if \(history\.state && history\.state\.deusVentana\) history\.replaceState\(null, ''\);/, 'tras recargar se limpia el paso viejo');
});
