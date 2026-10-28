'use strict';
// Garantías: 30 días de satisfacción y 60 ante cualquier falla técnica (decisión
// del dueño), más la garantía legal de 6 meses (la ley chilena no deja acortarla).
// La página, los datos para Google, el chatbot y el correo tienen que decir lo
// mismo: si uno queda con los 60 días de satisfacción de antes, se contradicen.
// En los resúmenes (bajo el botón, bajo la tabla, el bloque final, el texto de
// abajo y el correo) va "6 meses de garantía · 30 días de satisfacción", a
// pedido del dueño; el detalle con los 60 días va en la FAQ y el chatbot.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const html = leer('index.html');
const chat = leer('services', 'chat.js');
const recovery = leer('services', 'recovery.js');

test('la satisfacción es de 30 días en todos lados (ya no 60)', () => {
  const viejos = ['Garantía 60 días', 'Garantía de 60 días', 'satisfacción · 60 días</b>',
    '60 días de satisfacción', 'satisfacción de 60 días', 'Devolución por satisfacción (60 días)', 'garantía de 60 días'];
  for (const [nombre, txt] of [['index.html', html], ['chatbot', chat], ['correo de carrito', recovery]]) {
    for (const v of viejos) assert.ok(!txt.includes(v), nombre + ' todavía dice "' + v + '"');
  }
  assert.match(html, /6 meses de garantía · 30 días de satisfacción/);
  assert.match(chat, /30 días de satisfacción/);
  assert.match(recovery, /6 meses de garantía · 30 días de satisfacción/);
});

test('las fallas técnicas tienen 60 días y la garantía legal de 6 meses sigue', () => {
  const ini = html.indexOf('<summary>Envíos, garantías y devoluciones</summary>');
  assert.ok(ini !== -1, 'falta "Envíos, garantías y devoluciones" en las preguntas frecuentes');
  const item = html.slice(ini, html.indexOf('</details>', ini));
  assert.match(item, /30 días desde que recibes tu DEUS Band/);
  assert.match(item, /Garantía técnica · 60 días/);
  assert.match(item, /6 meses de garantía legal/);
  assert.match(item, /embalaje original/, 'condiciones de la devolución por satisfacción');
  assert.match(item, /sin necesidad de la caja/, 'por falla técnica no se exige la caja');
  assert.ok(!/Wellband/i.test(item), 'quedó el nombre de otra marca en el texto');
  assert.match(chat, /Garantía técnica \(60 días\)/);
  assert.match(chat, /garantía legal de 6 meses/);
});

test('los datos para Google dicen 30 días y que el envío de vuelta lo paga el cliente', () => {
  const m = html.match(/"hasMerchantReturnPolicy": \{[\s\S]*?\}/);
  assert.ok(m, 'falta la política de devolución en los datos estructurados');
  assert.match(m[0], /"merchantReturnDays": 30/);
  assert.match(m[0], /ReturnFeesCustomerResponsibility/);
});

test('los resúmenes de garantía dicen 6 meses de garantía y 30 días de satisfacción', () => {
  const bloque = (desde, hasta) => { const i = html.indexOf(desde); assert.ok(i !== -1, 'falta ' + desde); return html.slice(i, html.indexOf(hasta, i)); };
  const resumenes = {
    'bajo el botón de compra': bloque('<div class="reassure">', '<div class="resist-badge app-badge">'),
    'bajo la tabla comparativa': bloque('<div class="soft-cta-note">', '</div>'),
    'bloque de garantía del final': bloque('<div class="guarantee"', '</div>'),
    'texto de abajo (SEO)': bloque('<section class="seo-block">', '</section>'),
    'correo de carrito': recovery,
  };
  for (const [donde, txt] of Object.entries(resumenes)) {
    assert.match(txt, /6 meses/, donde + ': falta la garantía de 6 meses');
    assert.match(txt, /30 días de satisfacción/, donde + ': falta 30 días de satisfacción');
  }
});
