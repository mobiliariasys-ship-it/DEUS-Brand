const express = require('express');
const router = express.Router();
const { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } = require('transbank-sdk');
const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente, enviarPagoFallido } = require('../services/email');
const { decrementStock, getStock } = require('../services/stock');
const { programarRecuperacion, marcarPagado } = require('../services/recovery');
const metrics = require('../services/metrics');
const metaCapi = require('../services/meta-capi');

// Precio único $54.990, con stock y en modo reserva (igual que server.js y
// flow.js, y que lo que muestra el sitio).
const { precioBanda } = require('../services/precio');
const TAPONES_PRICE = 14990; // compra de solo tapones de oído (sin banda)
const pedidosWebpay = new Map(); // buyOrder -> pedido

// Producción si hay credenciales reales; si no, integración (pruebas)
function getTx() {
  const code = process.env.TRANSBANK_COMMERCE_CODE;
  const key = process.env.TRANSBANK_API_KEY;
  if (code && key && process.env.TRANSBANK_ENV === 'production') {
    return new WebpayPlus.Transaction(new Options(code, key, Environment.Production));
  }
  return new WebpayPlus.Transaction(
    new Options(IntegrationCommerceCodes.WEBPAY_PLUS, IntegrationApiKeys.WEBPAY, Environment.Integration)
  );
}

function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// Inicia el pago con Webpay
router.post('/webpay/crear', async (req, res) => {
  const { customerName, customerRut, customerEmail, customerPhone, selectedColor, shippingCarrier, shippingCost, shippingAddress, cantidad, tapones, soloTapones } = req.body;
  try {
    const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));
    const amount = soloTapones
      ? TAPONES_PRICE * qty + (Number(shippingCost) || 0)
      : precioBanda() * qty + (tapones ? 12990 : 0) + (Number(shippingCost) || 0);
    const buyOrder = 'deus-' + Date.now();
    const sessionId = 'sess-' + Date.now();
    const returnUrl = `${getBaseUrl(req)}/webpay/retorno`;

    const tx = getTx();
    const resp = await tx.create(buyOrder, sessionId, amount, returnUrl);

    const pedido = {
      preference_id: buyOrder,
      created_at: new Date().toISOString(),
      product: soloTapones
        ? 'Tapones de oído DEUS' + (qty > 1 ? ` x${qty}` : '')
        : 'DEUS Band' + (qty > 1 ? ` x${qty}` : '') + (tapones ? ' + Tapones de oído' : ''),
      product_price: soloTapones ? TAPONES_PRICE * qty : precioBanda() * qty + (tapones ? 12990 : 0),
      cantidad: qty,
      tapones: !!tapones,
      soloTapones: !!soloTapones,
      color: selectedColor,
      customer: { name: customerName, rut: customerRut, email: customerEmail, phone: customerPhone },
      shipping: { carrier: shippingCarrier, cost: shippingCost, address: shippingAddress },
      // Datos del navegador del cliente para la Conversions API de Meta (mejor
      // emparejamiento). Se capturan acá, no en el retorno/webhook.
      clientIp: (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.ip || '',
      clientUa: req.headers['user-agent'] || '',
      fbp: (req.body && req.body.fbp) || '', fbc: (req.body && req.body.fbc) || '',
      total: amount,
      status: 'pending',
      method: 'Webpay'
    };
    pedidosWebpay.set(buyOrder, pedido);
    // AddPaymentInfo a Meta desde el SERVIDOR, con el mismo event_id que acaba
    // de emitir el píxel de index.html → Meta deduplica y cuenta uno solo.
    // Acá el evento viaja con el emparejamiento completo (nombre, comuna,
    // región, RUT), no solo con la IP y el user agent como el del navegador.
    metaCapi.enviarAddPaymentInfo({
      eventId: req.body && req.body.apiEventId,
      valor: amount,
      email: customerEmail, phone: customerPhone,
      nombre: customerName, rut: customerRut,
      comuna: shippingAddress && shippingAddress.commune,
      region: shippingAddress && shippingAddress.region,
      clientIp: pedido.clientIp, clientUa: pedido.clientUa,
      fbp: pedido.fbp, fbc: pedido.fbc
    }).catch(e => console.error('[capi]', e.message));
    enviarPedidoNuevo(pedido).catch(e => console.error('[email]', e.message));
    // Si en 10 min no hay pago confirmado, correo de recuperación al cliente
    programarRecuperacion(buyOrder, pedido);

    console.log(`[webpay/crear] buyOrder=${buyOrder} | monto=${amount}`);
    res.json({ url: resp.url, token: resp.token });
  } catch (e) {
    console.error('[webpay/crear] Error:', e.message);
    // Aviso al dueño: el cliente se quedó sin poder pagar (venta rescatable)
    enviarPagoFallido({
      metodo: 'Webpay (Transbank)',
      error: e.message,
      cliente: { name: customerName, rut: customerRut, email: customerEmail, phone: customerPhone },
      producto: soloTapones ? 'Tapones de oído DEUS' : 'DEUS Band',
      monto: (soloTapones ? TAPONES_PRICE : precioBanda()) * Math.max(1, Math.min(10, parseInt(cantidad) || 1)) + (Number(shippingCost) || 0),
      color: selectedColor,
      direccion: shippingAddress
    }).catch(err => console.error('[email] aviso pago fallido:', err.message));
    res.status(500).json({ error: 'No se pudo iniciar el pago con Webpay' });
  }
});

// Transbank redirige aquí tras el pago (POST form-urlencoded con token_ws)
async function handleRetorno(req, res) {
  const token = req.body?.token_ws || req.query?.token_ws;
  const tbkToken = req.body?.TBK_TOKEN || req.query?.TBK_TOKEN;

  // El usuario anuló el pago en Webpay
  if (!token && tbkToken) return res.redirect('/failure.html');
  if (!token) return res.redirect('/failure.html');

  try {
    const tx = getTx();
    const result = await tx.commit(token);
    const aprobado = result.status === 'AUTHORIZED' && result.response_code === 0;

    const pedido = pedidosWebpay.get(result.buy_order);
    if (pedido) pedido.status = aprobado ? 'paid' : 'rejected';

    console.log(`[webpay/retorno] ${result.buy_order} — ${result.status} (${result.response_code})`);

    if (aprobado) {
      marcarPagado(result.buy_order); // cancela el correo de recuperación
      if (!(pedido && pedido.soloTapones)) decrementStock(result.buy_order); // solo tapones no descuenta stock de banda
      // Registra la venta y asigna automáticamente el ticket del sorteo (1 por compra)
      const ticketWP = metrics.registrarVenta({ monto: result.amount, metodo: 'Webpay', nombre: pedido && pedido.customer && pedido.customer.name, orden: result.buy_order, email: pedido && pedido.customer && pedido.customer.email });
      // Respaldo server-side del píxel (mismo event_id 'purchase-<orden>' que
      // success.html) por si el cliente no llega a disparar el píxel en el navegador.
      metaCapi.enviarPurchase({
        orden: result.buy_order, valor: result.amount,
        email: pedido && pedido.customer && pedido.customer.email,
        phone: pedido && pedido.customer && pedido.customer.phone,
        clientIp: pedido && pedido.clientIp, clientUa: pedido && pedido.clientUa,
        fbp: pedido && pedido.fbp, fbc: pedido && pedido.fbc,
        nombre: pedido && pedido.customer && pedido.customer.name,
        rut: pedido && pedido.customer && pedido.customer.rut,
        comuna: pedido && pedido.shipping && pedido.shipping.address && pedido.shipping.address.commune,
        region: pedido && pedido.shipping && pedido.shipping.address && pedido.shipping.address.region
      })
        .catch(e => console.error('[capi]', e.message));
      enviarPagoConfirmado({
        payer: { email: (pedido && pedido.customer && pedido.customer.email) || '(Pago con Webpay)' },
        transaction_amount: result.amount,
        id: result.buy_order
      }, pedido).catch(e => console.error('[email]', e.message));
      // Confirmación al cliente (el correo lo tomamos del pedido guardado)
      enviarConfirmacionCliente({
        email: pedido && pedido.customer && pedido.customer.email,
        name: pedido && pedido.customer && pedido.customer.name,
        monto: result.amount,
        id: result.buy_order,
        color: pedido && pedido.color,
        carrier: pedido && pedido.shipping && pedido.shipping.carrier,
        address: pedido && pedido.shipping && pedido.shipping.address,
        ticket: ticketWP && ticketWP.numero
      }).catch(e => console.error('[email] Confirmación cliente:', e.message));
      return res.redirect(`/success.html?monto=${Number(result.amount) || ''}&orden=${encodeURIComponent(result.buy_order || '')}`);
    }
    return res.redirect('/failure.html');
  } catch (e) {
    console.error('[webpay/retorno] Error:', e.message);
    return res.redirect('/failure.html');
  }
}
router.post('/webpay/retorno', handleRetorno);
router.get('/webpay/retorno', handleRetorno);

module.exports = router;
