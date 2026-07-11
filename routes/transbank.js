const express = require('express');
const router = express.Router();
const { WebpayPlus, Options, IntegrationApiKeys, IntegrationCommerceCodes, Environment } = require('transbank-sdk');
const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente } = require('../services/email');
const { decrementStock } = require('../services/stock');

const PRODUCT_PRICE = 38990;
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
  const { customerName, customerRut, customerEmail, customerPhone, selectedColor, shippingCarrier, shippingCost, shippingAddress, cantidad, tapones } = req.body;
  try {
    const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));
    const amount = PRODUCT_PRICE * qty + (tapones ? 12990 : 0) + (Number(shippingCost) || 0);
    const buyOrder = 'deus-' + Date.now();
    const sessionId = 'sess-' + Date.now();
    const returnUrl = `${getBaseUrl(req)}/webpay/retorno`;

    const tx = getTx();
    const resp = await tx.create(buyOrder, sessionId, amount, returnUrl);

    const pedido = {
      preference_id: buyOrder,
      created_at: new Date().toISOString(),
      product: 'DEUS Band' + (qty > 1 ? ` x${qty}` : '') + (tapones ? ' + Tapones de oído' : ''),
      product_price: PRODUCT_PRICE * qty + (tapones ? 12990 : 0),
      cantidad: qty,
      tapones: !!tapones,
      color: selectedColor,
      customer: { name: customerName, rut: customerRut, email: customerEmail, phone: customerPhone },
      shipping: { carrier: shippingCarrier, cost: shippingCost, address: shippingAddress },
      total: amount,
      status: 'pending',
      method: 'Webpay'
    };
    pedidosWebpay.set(buyOrder, pedido);
    enviarPedidoNuevo(pedido).catch(e => console.error('[email]', e.message));

    console.log(`[webpay/crear] buyOrder=${buyOrder} | monto=${amount}`);
    res.json({ url: resp.url, token: resp.token });
  } catch (e) {
    console.error('[webpay/crear] Error:', e.message);
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
      decrementStock(result.buy_order);
      enviarPagoConfirmado({
        payer: { email: (pedido && pedido.customer && pedido.customer.email) || '(Pago con Webpay)' },
        transaction_amount: result.amount,
        id: result.buy_order
      }).catch(e => console.error('[email]', e.message));
      // Confirmación al cliente (el correo lo tomamos del pedido guardado)
      enviarConfirmacionCliente({
        email: pedido && pedido.customer && pedido.customer.email,
        name: pedido && pedido.customer && pedido.customer.name,
        monto: result.amount,
        id: result.buy_order,
        color: pedido && pedido.color,
        carrier: pedido && pedido.shipping && pedido.shipping.carrier,
        address: pedido && pedido.shipping && pedido.shipping.address
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
