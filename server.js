require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const shippingRoutes = require('./routes/shipping');
const transbankRoutes = require('./routes/transbank');
const flowRoutes = require('./routes/flow');
const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente, enviarResena, diagnostico } = require('./services/email');
const { getStock, decrementStock, setStock } = require('./services/stock');
const { programarRecuperacion, marcarPagadoPorEmail } = require('./services/recovery');

// Oferta de lanzamiento hasta el 15-jul-2026 18:00 (Chile). Al vencer, el
// precio sube a $44.990 y el envío pasa a ser gratis (el front envía costo 0).
// El front usa esta misma fecha, así el cambio ocurre solo y sincronizado.
const OFERTA_END = new Date('2026-07-15T17:59:59-04:00').getTime();
const precioBanda = () => Date.now() < OFERTA_END ? 38990 : 44990;

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// URL pública del backend: en producción usa PUBLIC_URL; en local usa localhost.
function getBaseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  // Detección automática desde la petición (respeta proxys como Render/Railway)
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

// CORS: permite que un frontend en otro dominio consuma este backend.
// En producción puedes restringir ALLOWED_ORIGIN a tu dominio real.
app.use((req, res, next) => {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  res.header('Access-Control-Allow-Origin', allowed);
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '10mb' })); // límite alto: reseñas con fotos en base64
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Webpay retorna form-urlencoded
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    // El HTML nunca se cachea: siempre la última versión (evita imágenes viejas)
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use(shippingRoutes);
app.use(transbankRoutes);
app.use(flowRoutes);

const client = new MercadoPagoConfig({
  accessToken: process.env.ACCESS_TOKEN,
  options: { timeout: 5000 }
});

// Almacén temporal de pedidos (en producción usar base de datos)
const pedidos = [];

app.post('/crear-preferencia', async (req, res) => {
  const { customerName, customerRut, customerEmail, customerPhone, selectedColor, shippingCarrier, shippingCost, shippingAddress, cantidad, tapones } = req.body;

  try {
    const preference = new Preference(client);

    // Cantidad de bandas acotada a un rango razonable
    const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));

    const items = [
      {
        title: 'DEUS Band',
        description: 'Smart Band — Monitor de salud y bienestar',
        unit_price: precioBanda(),
        quantity: qty,
        currency_id: 'CLP'
      }
    ];

    if (tapones) {
      items.push({
        title: 'Tapones de oído DEUS',
        description: 'Tapones de oído — 3 tamaños incluidos',
        unit_price: 12990,
        quantity: 1,
        currency_id: 'CLP'
      });
    }

    if (shippingCost && shippingCost > 0) {
      items.push({
        title: `Envío ${shippingCarrier || 'estándar'}`,
        description: `Envío a ${shippingAddress?.commune || 'domicilio'}`,
        unit_price: shippingCost,
        quantity: 1,
        currency_id: 'CLP'
      });
    }

    const baseUrl = getBaseUrl(req);
    const isLocalhost = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1');

    const totalPedido = precioBanda() * qty + (tapones ? 12990 : 0) + (Number(shippingCost) || 0);

    const prefBody = {
      items,
      statement_descriptor: 'DEUS BAND',
      metadata: {
        customer_name: customerName,
        customer_rut: customerRut,
        customer_email: customerEmail,
        customer_phone: customerPhone,
        selected_color: selectedColor,
        cantidad: qty,
        tapones: !!tapones,
        shipping_carrier: shippingCarrier,
        shipping_cost: shippingCost,
        shipping_address: shippingAddress
      }
    };

    // MercadoPago rechaza localhost en back_urls. Solo las agregamos con URL pública.
    if (!isLocalhost) {
      prefBody.back_urls = {
        // monto: total real (producto + envío) para que el píxel reporte el valor correcto
        success: `${baseUrl}/success.html?monto=${totalPedido}`,
        failure: `${baseUrl}/failure.html`,
        pending: `${baseUrl}/pending.html`
      };
      prefBody.auto_return = 'approved';
      prefBody.notification_url = `${baseUrl}/notificaciones`;
    }

    console.log(`[crear-preferencia] baseUrl=${baseUrl} | back_urls=${!isLocalhost}`);

    const result = await preference.create({ body: prefBody });

    // Guardar pedido
    const pedido = {
      preference_id: result.id,
      created_at: new Date().toISOString(),
      product: 'DEUS Band' + (qty > 1 ? ` x${qty}` : '') + (tapones ? ' + Tapones de oído' : ''),
      product_price: precioBanda() * qty + (tapones ? 12990 : 0),
      cantidad: qty,
      tapones: !!tapones,
      color: selectedColor,
      customer: {
        name: customerName,
        rut: customerRut,
        email: customerEmail,
        phone: customerPhone
      },
      shipping: {
        carrier: shippingCarrier,
        cost: shippingCost,
        address: shippingAddress
      },
      total: totalPedido,
      status: 'pending'
    };
    pedidos.push(pedido);

    // Enviar correo con los datos del pedido (no bloquea la respuesta)
    enviarPedidoNuevo(pedido).catch(err => console.error('[email] Error:', err.message));

    // Si en 10 min no hay pago confirmado, correo de recuperación al cliente
    programarRecuperacion(result.id, pedido);

    res.json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error('Error creando preferencia:', error);
    res.status(500).json({ error: 'Error al crear la preferencia de pago' });
  }
});

app.post('/notificaciones', async (req, res) => {
  const { type, data } = req.body;
  console.log('Webhook — tipo:', type, '| id:', data?.id);

  // Respondemos 200 de inmediato (MercadoPago lo exige) y procesamos después
  res.sendStatus(200);

  if (type === 'payment' && data?.id) {
    try {
      const payment = new Payment(client);
      const info = await payment.get({ id: data.id });
      console.log(`[webhook] Pago ${info.id} — estado: ${info.status}`);

      if (info.status === 'approved') {
        // Datos del pedido (metadata del pago + pedido en memoria) para tener
        // dirección y comprador completos en el correo de despacho.
        const meta = info.metadata || {};
        const emailCliente = meta.customer_email || info.payer?.email;
        const pedido = pedidos.find(p => p.customer?.email && p.customer.email === emailCliente);

        await enviarPagoConfirmado(info, pedido);
        decrementStock(info.id, true); // esMP: la sincronización con MP ya cuenta este pago

        // Correo de confirmación al cliente (usa metadata + pedido en memoria).
        marcarPagadoPorEmail(emailCliente); // cancela el correo de recuperación
        enviarConfirmacionCliente({
          email: emailCliente,
          name: meta.customer_name || pedido?.customer?.name,
          monto: info.transaction_amount,
          id: info.id,
          color: meta.selected_color || pedido?.color,
          carrier: meta.shipping_carrier || pedido?.shipping?.carrier,
          address: pedido?.shipping?.address
        }).catch(err => console.error('[email] Confirmación cliente:', err.message));
      }
    } catch (err) {
      console.error('[webhook] Error consultando pago:', err.message);
    }
  }
});

app.get('/pedidos', (req, res) => {
  res.json(pedidos);
});

// Stock restante (para el contador de unidades en la web)
app.get('/stock', (req, res) => {
  res.json({ remaining: getStock() });
});

// Ajuste manual del stock, protegido con la clave STOCK_KEY de Render.
// Uso: /stock/ajustar?unidades=12&clave=MICLAVE
app.get('/stock/ajustar', (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).send('No disponible');
  if ((req.query.clave || '') !== clave) return res.status(403).send('Clave incorrecta');
  const n = parseInt(req.query.unidades, 10);
  if (isNaN(n) || n < 0) return res.status(400).send('unidades debe ser un número >= 0');
  res.json({ remaining: setStock(n) });
});

// Diagnóstico de correo: envía un correo de prueba real al dueño y confirma
// si Resend está configurado. Protegido con STOCK_KEY (misma clave admin).
// Uso: /email/diagnostico?clave=MICLAVE
app.get('/email/diagnostico', async (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).send('No disponible');
  if ((req.query.clave || '') !== clave) return res.status(403).send('Clave incorrecta');
  try {
    res.json(await diagnostico());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Endpoint liviano para keep-alive (cron-job.org / UptimeRobot).
// Devuelve una respuesta mínima para que no descargue toda la página.
app.get('/ping', (req, res) => {
  res.type('text/plain').send('ok');
});

// Reseña enviada por un cliente → llega al correo para aprobar
app.post('/resenas', async (req, res) => {
  try {
    const { name, instagram, rating, comment, photos } = req.body || {};
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Falta el comentario.' });
    }
    const review = {
      name: (name || '').toString().slice(0, 80),
      instagram: (instagram || '').toString().slice(0, 60),
      rating: Math.max(1, Math.min(5, Number(rating) || 5)),
      comment: comment.toString().slice(0, 1000),
      photos: Array.isArray(photos) ? photos.slice(0, 4) : []
    };
    enviarResena(review).catch(e => console.error('[resena] email:', e.message));
    res.json({ ok: true });
  } catch (e) {
    console.error('[resena] Error:', e.message);
    res.status(500).json({ error: 'No se pudo enviar la reseña.' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor DEUS corriendo en http://localhost:${PORT}`);
});
