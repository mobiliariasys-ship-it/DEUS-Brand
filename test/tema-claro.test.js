'use strict';
// Tema claro "blanco con negro" (pedido del dueño, 11-oct-2026). Todo cuelga
// de la clase html.tema-claro: quitándola vuelve la web oscura de antes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const leer = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const index = leer('index.html');

// Bloque del tema: desde su comentario de cabecera hasta el cierre del <style>.
function bloqueTema() {
  const ini = index.indexOf('/* ── Tema claro "blanco con negro"');
  assert.ok(ini > 0, 'falta el bloque del tema claro');
  return index.slice(ini, index.indexOf('</style>', ini));
}

test('la tienda lleva la clase tema-claro desde el HTML (sin parpadeo)', () => {
  assert.match(index, /<html lang="es" class="tema-claro">/);
  assert.match(bloqueTema(), /html\.tema-claro\{--black:#ffffff;[^}]*--white:#141416;/);
});

test('cada regla del tema depende de html.tema-claro (quitar la clase lo apaga entero)', () => {
  const sinComentarios = bloqueTema().replace(/\/\*[\s\S]*?\*\//g, '');
  const reglas = sinComentarios.split('}').map(r => r.trim()).filter(Boolean);
  assert.ok(reglas.length > 50);
  for (const r of reglas) {
    // las comas dentro de [style*="68, 68, 68"] no separan selectores
    const selectores = r.slice(0, r.indexOf('{')).replace(/"[^"]*"/g, '""').split(',').map(s => s.trim());
    for (const s of selectores) assert.ok(s.startsWith('html.tema-claro'), 'regla sin la clase: ' + s);
  }
});

test('encabezado, barra de compra, panel "Así de simple" y pie siguen en negro', () => {
  const t = bloqueTema();
  const zonas = t.match(/html\.tema-claro header,html\.tema-claro \.sticky-buy,html\.tema-claro \.soft-in,html\.tema-claro \.announce-bar\{([^}]*)\}/);
  assert.ok(zonas, 'las zonas oscuras no re-declaran sus colores');
  assert.match(zonas[1], /--white:#f2f2f2;/);
  assert.match(t, /html\.tema-claro \.banner,[^{]*\{--black:#121214;[^}]*--white:#f2f2f2;/);
  assert.match(t, /html\.tema-claro \.btn-p\{background:#0b0b0c;color:#fff;\}/);
});

test('el carrito cerrado no proyecta sombra sobre la página', () => {
  const t = bloqueTema();
  assert.match(t, /html\.tema-claro \.cart-drawer\{box-shadow:none;\}/);
  assert.match(t, /html\.tema-claro \.cart-drawer\.open\{box-shadow:/);
});

test('las páginas de pago y la 404 usan el mismo tema', () => {
  for (const f of ['success.html', 'failure.html', 'pending.html', '404.html']) {
    const s = leer(f);
    assert.match(s, /<html lang="es" class="tema-claro">/, f);
    assert.match(s, /html\.tema-claro body\{background:#fff;color:#141416;\}/, f);
  }
});
