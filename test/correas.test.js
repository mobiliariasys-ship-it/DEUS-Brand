'use strict';
// Correas extra: desde el 27-oct-2026 son el upsell del checkout en vez de los
// tapones (decisión del dueño). Dos pares de $14.990 cada uno (bajaron de
// $18.990 el 31-oct-2026) — silicona negra + nylon negro, o silicona negra +
// nylon gris — y se puede llevar uno o los
// dos. El navegador solo manda las claves; lo que se cobra lo calcula
// services/precio.js y las tres pasarelas lo usan igual. El correo de despacho
// tiene que decir qué par incluir en el paquete.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { EventEmitter } = require('events');
const { calcularMonto, nombreProducto, normalizarCorreas, CORREAS_PRICE, precioBanda } = require('../services/precio');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const HTML = leer('index.html');

test('cada par de correas suma $14.990 y solo se cobran pares conocidos', () => {
  const banda = precioBanda();
  assert.strictEqual(CORREAS_PRICE, 14990);
  assert.strictEqual(calcularMonto({ cantidad: 1 }).total, banda);
  assert.strictEqual(calcularMonto({ cantidad: 1, correas: ['negras'] }).total, banda + 14990);
  assert.strictEqual(calcularMonto({ cantidad: 1, correas: ['grises', 'negras'] }).total, banda + 2 * 14990);
  // Repetidos y claves inventadas no suman: no se puede cobrar (ni regalar) de más.
  assert.deepStrictEqual(calcularMonto({ cantidad: 2, correas: ['negras', 'negras', 'rosadas'] }).correas, ['negras']);
  assert.strictEqual(calcularMonto({ cantidad: 2, correas: ['negras', 'negras', 'rosadas'] }).total, 2 * banda + 14990);
  // Las correas son de la banda: en una compra de solo tapones no van.
  assert.deepStrictEqual(calcularMonto({ cantidad: 1, correas: ['negras'], soloTapones: true }).correas, []);
  // La metadata de Mercado Pago las devuelve como texto.
  assert.deepStrictEqual(normalizarCorreas('grises,negras'), ['negras', 'grises']);
  assert.deepStrictEqual(normalizarCorreas(undefined), []);
});

test('el pedido dice qué correas lleva', () => {
  assert.strictEqual(nombreProducto({ qty: 1 }), 'DEUS Band');
  assert.strictEqual(nombreProducto({ qty: 2, correas: ['grises'] }), 'DEUS Band x2 + Correas extra grises');
  assert.strictEqual(nombreProducto({ qty: 1, correas: ['negras', 'grises'] }), 'DEUS Band + Correas extra negras + Correas extra grises');
  assert.strictEqual(nombreProducto({ qty: 1, soloTapones: true, correas: ['negras'] }), 'Tapones de oído DEUS');
});

test('las tres pasarelas cobran con las correas que mandó el checkout', () => {
  for (const archivo of [['server.js'], ['routes', 'flow.js'], ['routes', 'transbank.js']]) {
    const src = leer(...archivo);
    const nombre = archivo.join('/');
    assert.match(src, /cantidad, tapones, correas, soloTapones, [^}]*\} = req\.body/, nombre + ': no lee las correas del pedido');
    // El cobro y el aviso de pago fallido: los dos con las correas.
    assert.strictEqual((src.match(/calcularMonto\(\{ cantidad, tapones, correas, soloTapones, shippingCost \}\)/g) || []).length, 2, nombre + ': algún calcularMonto quedó sin correas');
    assert.match(src, /correas: m\.correas/, nombre + ': el pedido guardado no anota las correas');
  }
  // Mercado Pago confirma por webhook: las correas tienen que viajar en la metadata.
  assert.match(leer('server.js'), /correas: m\.correas\.join\(','\)/);
});

test('el checkout ofrece las correas en un solo recuadro con el color a elegir', () => {
  assert.match(HTML, new RegExp('const CORREAS_PRICE = ' + CORREAS_PRICE + ';'), 'el checkout tiene que sumar lo mismo que cobra el backend');
  assert.strictEqual((HTML.match(/class="upsell-card\b/g) || []).length, 1, 'las correas van en UN recuadro');
  assert.ok(HTML.includes('id="upsell-correas" onclick="toggleCorreas()"'));
  for (const color of ['negras', 'grises']) {
    assert.ok(HTML.includes(`data-color="${color}"`) && HTML.includes(`onclick="elegirColorCorreas(event,'${color}')"`), 'falta el color ' + color);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'img', `correas-${color}.webp`)), 'falta la foto grande de las correas ' + color);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'img', `correas-${color}-mini.webp`)), 'falta la miniatura de las correas ' + color);
  }
  assert.ok(HTML.includes('<div class="upsell-price">+ $14.990</div>'));
  // Las negras primero (pedido del dueño): en el selector, como color de
  // entrada y en la galería de fotos.
  assert.ok(HTML.indexOf(`data-color="negras"`) < HTML.indexOf(`data-color="grises"`), 'el selector tiene que mostrar Negro primero');
  assert.match(HTML, /class="cc-op on" data-color="negras"/, 'Negro viene elegido de entrada');
  assert.match(HTML, /correaColor = 'negras';\s*correaAgregada = false;/, 'al reabrir el checkout vuelve a Negro');
  assert.ok(HTML.includes("abrirVisorFotos(['img/correas-negras.webp', 'img/correas-grises.webp']"), 'en la galería, las negras primero');
  // Pedido del dueño: "el par" suena informal, no va en la página.
  assert.doesNotMatch(HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, ''), /el par\b/i);
  assert.match(HTML, /return correaAgregada \? \[correaColor\] : \[\];/, 'al pago va solo el color elegido, y solo si están agregadas');
  // El recuadro cierra todos sus <div>: uno de más cerraba antes de tiempo el
  // cuerpo del checkout y la tarjeta del total quedaba más ancha que el resto.
  const ini = HTML.indexOf('<div class="upsell-card upsell-correas" id="upsell-correas"');
  const bloque = HTML.slice(ini, HTML.indexOf('<!-- El total se ve desde que abre el checkout.', ini)).replace(/<!--[\s\S]*?-->/g, '');
  assert.strictEqual((bloque.match(/<div\b/g) || []).length, (bloque.match(/<\/div>/g) || []).length, 'el recuadro de correas tiene que cerrar exactamente sus <div>');
  assert.match(HTML, /correas: checkoutTapones \? \[\] : listaCorreas\(\),/, 'el pago no manda las correas elegidas');
  // El upsell de tapones ya no está en el checkout de la banda.
  assert.ok(!HTML.includes('id="upsell-card"'), 'quedó la tarjeta de tapones en el checkout');
  assert.ok(!/toggleUpsell|upsellTapones|UPSELL_PRICE/.test(HTML), 'quedó código del upsell de tapones');
});

test('el checkout muestra el precio completo, no "$22.990 x 3 cuotas"', () => {
  // Igual que la página (un precio grande y las cuotas en una línea aparte):
  // la cuota como número grande se leía como el precio de la banda.
  assert.ok(!HTML.includes('x 3 cuotas</small>'), 'la línea de la banda volvió a mostrar la cuota como precio');
  assert.ok(HTML.includes('const precioTxt = `<span class="co-price-now">${clp(bandTotal)}</span>`;'));
  assert.ok(HTML.includes(`'<div class="pe-top"><div class="pe-k">Total a pagar</div><div class="pe-v">' + clp(total) + '</div></div>'`), 'el número grande de la tarjeta tiene que ser el total');
  assert.ok(HTML.includes(`o <span class="pe-cg">3 cuotas sin interés</span> de <b>' + clp(cuotaDe(total)) + '</b>`), 'las cuotas van como línea secundaria');
});

// Captura lo que se le mandaría a Resend, sin red (igual que en promo-tapones).
function capturarCorreos() {
  const enviados = [];
  const orig = https.request;
  const entorno = { k: process.env.RESEND_API_KEY, t: process.env.MAIL_TO };
  process.env.RESEND_API_KEY = 'test';
  process.env.MAIL_TO = 'despacho@ejemplo.com';
  https.request = (opts, cb) => {
    const req = new EventEmitter();
    let cuerpo = '';
    req.setTimeout = () => req;
    req.destroy = () => {};
    req.write = c => { cuerpo += c; };
    req.end = () => {
      enviados.push(JSON.parse(cuerpo));
      const res = new EventEmitter();
      res.statusCode = 200;
      cb(res);
      res.emit('data', '{}');
      res.emit('end');
    };
    return req;
  };
  return {
    enviados,
    restaurar() {
      https.request = orig;
      if (entorno.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = entorno.k;
      if (entorno.t === undefined) delete process.env.MAIL_TO; else process.env.MAIL_TO = entorno.t;
    }
  };
}

test('el correo de despacho avisa qué correas incluir y el del cliente las lista', async () => {
  const { enviarPagoConfirmado, enviarConfirmacionCliente } = require('../services/email');
  const cap = capturarCorreos();
  try {
    const pedido = { product: 'DEUS Band + Correas extra grises', color: 'negra', cantidad: 1, correas: ['grises'], customer: { name: 'Prueba Correas' }, shipping: { carrier: 'Starken', cost: 0, address: {} } };
    await enviarPagoConfirmado({ id: 'correas-1', transaction_amount: 87980 }, pedido);
    await enviarConfirmacionCliente({ email: 'cliente@ejemplo.com', name: 'Prueba', monto: 87980, id: 'correas-1', color: 'negra', correas: ['grises'] });
    await enviarPagoConfirmado({ id: 'sin-1', transaction_amount: 68990 }, { ...pedido, product: 'DEUS Band', customer: { name: 'Prueba Normal' }, correas: [] });
  } finally { cap.restaurar(); }
  assert.strictEqual(cap.enviados.length, 3);
  const [despacho, cliente, sinCorreas] = cap.enviados;
  assert.match(despacho.html, /INCLUIR EN EL PAQUETE: CORREAS EXTRA GRISES/);
  assert.match(despacho.html, /Correa de silicona negra \+ correa de nylon gris/i);
  assert.match(despacho.subject, /\+ ➕ CORREAS/);
  assert.match(cliente.html, /<b>Correas extra grises<\/b>/);
  assert.doesNotMatch(cliente.html, /Correas extra negras/);
  assert.doesNotMatch(sinCorreas.html + sinCorreas.subject, /CORREAS/i);
});
