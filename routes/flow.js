const express = require('express');
const router = express.Router();
const https = require('https');
const crypto = require('crypto');
const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente } = require('../services/email');
const { decrementStock, getStock } = require('../services/stock');
const { programarRecuperacion, marcarPagado } = require('../services/recovery');
const metrics = require('../services/metrics');
const metaCapi = require('../services/meta-capi');

// Oferta de lanzamiento hasta el 17-jul-2026 07:00 (Chile); después $44.990
const OFERTA_END = new Date('2026-08-01T00:00:00-04:00').getTime();
const PRODUCT_PRICE = 54990;
// Precio reserva-aware: si no queda stock, modo reserva a $52.990 (igual que
// server.js/MercadoPago). Antes cobraba fijo $54.990 aunque el sitio mostrara $52.990.
const precioBanda = () => (getStock() <= 0 ? 52990 : 54990);
const pedidosFlow = new Map();

// Producción por defecto; sandbox si FLOW_ENV=sandbox
function flowHost() {
  return (process.env.FLOW_ENV === 'sandbox') ? 'sandbox.flow.cl' : 'www.flow.cl';
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Firma Flow: concatenar nombre+valor ordenados alfabéticamente, HMAC-SHA256 con la secret
function firmar(params) {
  const keys = Object.keys(params).sort();
  let str = '';
  keys.forEach(k => { str += k + params[k]; });
  return crypto.createHmac('sha256', (process.env.FLOW_SECRET_KEY || '').trim()).update(str).digest('hex');
}

function flowReq(method, path, params) {
  return new Promise((resolve, reject) => {
    const s = firmar(params);
    const qs = new URLSearchParams(Object.assign({}, params, { s })).toString();
    const isPost = method === 'POST';
    const options = {
      hostname: flowHost(),
      path: '/api' + path + (isPost ? '' : '?' + qs),
      method,
      headers: isPost ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(qs) } : {}
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { reject(new Error('Respuesta Flow inválida (' + res.statusCode + '): ' + raw.substring(0, 160))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout Flow')); });
    if (isPost) req.write(qs);
    req.end();
  });
}

// Iniciar pago con Flow
router.post('/flow/crear', async (req, res) => {
  const { customerName, customerRut, customerEmail, customerPhone, selectedColor, shippingCarrier, shippingCost, shippingAddress, cantidad, tapones } = req.body;
  try {
    const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));
    const amount = precioBanda() * qty + (tapones ? 12990 : 0) + (Number(shippingCost) || 0);
    const commerceOrder = 'deus-' + Date.now();
    const base = getBaseUrl(req);

    const params = {
      apiKey: (process.env.FLOW_API_KEY || "").trim(),
      commerceOrder: commerceOrder,
      subject: 'DEUS Band' + (qty > 1 ? ' x' + qty : '') + (tapones ? ' + Tapones' : ''),
      currency: 'CLP',
      amount: String(amount),
      email: customerEmail || 'cliente@deusbrand.cl',
      urlConfirmation: base + '/flow/confirmacion',
      urlReturn: base + '/flow/retorno'
    };

    const r = await flowReq('POST', '/payment/create', params);
    if (!r.body || !r.body.url || !r.body.token) {
      throw new Error('Flow no devolvió url/token: ' + JSON.stringify(r.body).substring(0, 180));
    }

    const pedido = {
      preference_id: commerceOrder,
      created_at: new Date().toISOString(),
      product: 'DEUS Band' + (qty > 1 ? ` x${qty}` : '') + (tapones ? ' + Tapones de oído' : ''),
      product_price: precioBanda() * qty + (tapones ? 12990 : 0),
      cantidad: qty, tapones: !!tapones,
      color: selectedColor,
      customer: { name: customerName, rut: customerRut, email: customerEmail, phone: customerPhone },
      shipping: { carrier: shippingCarrier, cost: shippingCost, address: shippingAddress },
      total: amount, status: 'pending', method: 'Flow'
    };
    pedidosFlow.set(commerceOrder, pedido);
    enviarPedidoNuevo(pedido).catch(e => console.error('[email]', e.message));
    // Si en 10 min no hay pago confirmado, correo de recuperación al cliente
    programarRecuperacion(commerceOrder, pedido);

    console.log('[flow/crear] orden=' + commerceOrder + ' monto=' + amount);
    res.json({ url: r.body.url + '?token=' + r.body.token });
  } catch (e) {
    console.error('[flow/crear] Error:', e.message);
    res.status(500).json({ error: 'No se pudo iniciar el pago con Flow' });
  }
});

// Webhook servidor-a-servidor (Flow confirma el pago aquí)
router.post('/flow/confirmacion', async (req, res) => {
  res.sendStatus(200);
  const token = req.body && req.body.token;
  if (!token) return;
  try {
    const r = await flowReq('GET', '/payment/getStatus', { apiKey: (process.env.FLOW_API_KEY || "").trim(), token });
    const st = r.body;
    const pedido = pedidosFlow.get(st.commerceOrder);
    console.log('[flow/confirmacion] ' + st.commerceOrder + ' status=' + st.status);
    if (st.status === 2) {
      if (pedido) pedido.status = 'paid';
      marcarPagado(st.commerceOrder); // cancela el correo de recuperación
      decrementStock(st.commerceOrder);
      // Registra la venta y asigna automáticamente el ticket del sorteo (1 por compra)
      const ticketFlow = metrics.registrarVenta({ monto: st.amount, metodo: 'Flow', nombre: pedido && pedido.customer && pedido.customer.name, orden: st.commerceOrder, email: (pedido && pedido.customer && pedido.customer.email) || st.payer });
      // Respaldo server-side del píxel (mismo event_id 'purchase-<orden>' que
      // success.html) por si el cliente no llega a disparar el píxel en el navegador.
      metaCapi.enviarPurchase({ orden: st.commerceOrder, valor: st.amount, email: (pedido && pedido.customer && pedido.customer.email) || st.payer, phone: pedido && pedido.customer && pedido.customer.phone })
        .catch(e => console.error('[capi]', e.message));
      enviarPagoConfirmado({
        payer: { email: (st.payer) || (pedido && pedido.customer && pedido.customer.email) || '(Flow)' },
        transaction_amount: st.amount,
        id: st.commerceOrder
      }, pedido).catch(e => console.error('[email]', e.message));
      // Confirmación al cliente
      enviarConfirmacionCliente({
        email: (pedido && pedido.customer && pedido.customer.email) || st.payer,
        name: pedido && pedido.customer && pedido.customer.name,
        monto: st.amount,
        id: st.commerceOrder,
        color: pedido && pedido.color,
        carrier: pedido && pedido.shipping && pedido.shipping.carrier,
        address: pedido && pedido.shipping && pedido.shipping.address,
        ticket: ticketFlow && ticketFlow.numero
      }).catch(e => console.error('[email] Confirmación cliente:', e.message));
    } else if (pedido) pedido.status = 'rejected';
  } catch (e) { console.error('[flow/confirmacion] Error:', e.message); }
});

// Retorno del navegador del cliente
async function retorno(req, res) {
  const token = (req.body && req.body.token) || (req.query && req.query.token);
  if (!token) return res.redirect('/failure.html');
  try {
    const r = await flowReq('GET', '/payment/getStatus', { apiKey: (process.env.FLOW_API_KEY || "").trim(), token });
    if (r.body && r.body.status === 2) {
      const monto = Number(r.body.amount) || '';
      const orden = encodeURIComponent(r.body.commerceOrder || '');
      return res.redirect(`/success.html?monto=${monto}&orden=${orden}`);
    }
    return res.redirect('/failure.html');
  } catch (e) { console.error('[flow/retorno] Error:', e.message); return res.redirect('/failure.html'); }
}
router.post('/flow/retorno', retorno);
router.get('/flow/retorno', retorno);

module.exports = router;
