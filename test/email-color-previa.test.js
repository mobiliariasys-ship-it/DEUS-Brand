'use strict';
// El dueño quiere ver el color de la banda en la vista previa de Gmail (la
// línea gris debajo del asunto, y el aviso del celular), sin abrir el correo.
// Esa vista previa sale del primer texto del correo, así que el color tiene
// que ser lo primero en los dos correos que le llegan: el de pedido nuevo y
// el de pago confirmado.
const test = require('node:test');
const assert = require('node:assert');
const https = require('https');
const { EventEmitter } = require('events');

// Captura lo que se le mandaría a Resend, sin red.
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

// El texto con que Gmail arma la vista previa: el correo sin etiquetas.
const textoPrevia = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const base = { preference_id: 'deus-1', created_at: new Date().toISOString(), product: 'DEUS Band', product_price: 68990, total: 68990, cantidad: 1, customer: { name: 'Prueba' }, shipping: { carrier: 'Starken', cost: 0, address: {} } };

async function correosDelDueno(pedido) {
  const { enviarPedidoNuevo, enviarPagoConfirmado } = require('../services/email');
  const cap = capturarCorreos();
  try {
    await enviarPedidoNuevo(pedido);
    await enviarPagoConfirmado({ id: 'pago-1', transaction_amount: 68990 }, pedido);
  } finally { cap.restaurar(); }
  assert.strictEqual(cap.enviados.length, 2);
  return cap.enviados;
}

test('el color de la banda es lo primero del correo de pedido nuevo y del de pago confirmado', async () => {
  for (const c of await correosDelDueno({ ...base, color: 'negra' })) {
    assert.ok(textoPrevia(c.html).startsWith('Color: NEGRA '), c.subject + ' → ' + textoPrevia(c.html).slice(0, 60));
  }
});

test('con colores mezclados la primera fila trae el desglose', async () => {
  for (const c of await correosDelDueno({ ...base, cantidad: 3, color: '2 negras + 1 gris' })) {
    assert.ok(textoPrevia(c.html).startsWith('Color: 2 NEGRAS + 1 GRIS '), textoPrevia(c.html).slice(0, 60));
  }
});

test('una compra de solo tapones dice que no lleva banda, y sin color no se inventa uno', async () => {
  for (const c of await correosDelDueno({ ...base, color: null, soloTapones: true })) {
    assert.ok(textoPrevia(c.html).startsWith('Solo tapones · sin banda '), textoPrevia(c.html).slice(0, 60));
  }
  for (const c of await correosDelDueno({ ...base, color: undefined })) {
    assert.doesNotMatch(textoPrevia(c.html).slice(0, 40), /Color:|sin banda/);
  }
});
