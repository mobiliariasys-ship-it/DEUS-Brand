require('dotenv').config();
const express = require('express');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const shippingRoutes = require('./routes/shipping');
const transbankRoutes = require('./routes/transbank');
const flowRoutes = require('./routes/flow');
const { enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente, enviarEnvioDespachado, enviarTicketSorteo, enviarResena, enviarPagoFallido, diagnostico } = require('./services/email');
const { getStock, decrementStock, setStock } = require('./services/stock');
const metrics = require('./services/metrics');
const persist = require('./services/persist');
const { programarRecuperacion, marcarPagadoPorEmail } = require('./services/recovery');
const metaCapi = require('./services/meta-capi');

// Oferta de lanzamiento hasta el 17-jul-2026 07:00 (Chile). Al vencer, el
// precio sube a $44.990 y el envío pasa a ser gratis (el front envía costo 0).
// El front usa esta misma fecha, así el cambio ocurre solo y sincronizado.
const OFERTA_END = new Date('2026-08-01T00:00:00-04:00').getTime();
// Precio normal $54.990. Cuando el stock llega a 0, el sitio pasa a MODO RESERVA
// y el precio baja a $52.990 (con descuento) hasta que llega el restock (~10 días).
// Este es el precio AUTORITATIVO que se cobra; el front muestra lo mismo mirando
// /stock. getStock()<=0 es el mismo umbral que usa el front (window.modoReserva).
const precioBanda = () => (getStock() <= 0 ? 52990 : 54990);
const TAPONES_PRICE = 14990; // compra de solo tapones de oído (sin banda)

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

// Pedidos: se guardan en disco (o en Postgres si hay DATABASE_URL) para
// sobrevivir a reinicios del servidor. Se cargan de forma async al arrancar,
// ver arranque() al final del archivo.
const pedidos = [];
function guardarPedidos() { persist.save('pedidos.json', pedidos).catch(e => console.error('[pedidos] Error guardando:', e.message)); }

app.post('/crear-preferencia', async (req, res) => {
  const { customerName, customerRut, customerEmail, customerPhone, selectedColor, shippingCarrier, shippingCost, shippingAddress, cantidad, tapones, soloTapones, acciones } = req.body;

  try {
    const preference = new Preference(client);

    // Cantidad acotada a un rango razonable
    const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));

    // Compra de SOLO tapones (sin banda): el único ítem es el estuche de tapones.
    const items = soloTapones
      ? [
          {
            title: 'Tapones de oído DEUS',
            description: 'Tapones de oído — 3 tamaños incluidos',
            unit_price: TAPONES_PRICE,
            quantity: qty,
            currency_id: 'CLP'
          }
        ]
      : [
          {
            title: 'DEUS Band',
            description: 'Smart Band — Monitor de salud y bienestar',
            unit_price: precioBanda(),
            quantity: qty,
            currency_id: 'CLP'
          }
        ];

    if (!soloTapones && tapones) {
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

    const totalPedido = soloTapones
      ? TAPONES_PRICE * qty + (Number(shippingCost) || 0)
      : precioBanda() * qty + (tapones ? 12990 : 0) + (Number(shippingCost) || 0);

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
        soloTapones: !!soloTapones,
        shipping_carrier: shippingCarrier,
        shipping_cost: shippingCost,
        shipping_address: shippingAddress,
        // Acciones de la sesión → para atribuir la compra a la conducta aunque
        // se confirme por webhook (el cliente no vuelve a success.html).
        acciones_sesion: Array.isArray(acciones) ? acciones.join(',').slice(0, 500) : ''
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
      product: soloTapones
        ? 'Tapones de oído DEUS' + (qty > 1 ? ` x${qty}` : '')
        : 'DEUS Band' + (qty > 1 ? ` x${qty}` : '') + (tapones ? ' + Tapones de oído' : ''),
      product_price: soloTapones ? TAPONES_PRICE * qty : precioBanda() * qty + (tapones ? 12990 : 0),
      cantidad: qty,
      tapones: !!tapones,
      soloTapones: !!soloTapones,
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
    guardarPedidos();

    // Enviar correo con los datos del pedido (no bloquea la respuesta)
    enviarPedidoNuevo(pedido).catch(err => console.error('[email] Error:', err.message));

    // Si en 10 min no hay pago confirmado, correo de recuperación al cliente
    programarRecuperacion(result.id, pedido);

    res.json({ id: result.id, init_point: result.init_point });
  } catch (error) {
    console.error('Error creando preferencia:', error);
    // Aviso al dueño: el cliente se quedó sin poder pagar (venta rescatable)
    enviarPagoFallido({
      metodo: 'Mercado Pago',
      error: error.message || String(error),
      cliente: { name: customerName, rut: customerRut, email: customerEmail, phone: customerPhone },
      producto: soloTapones ? 'Tapones de oído DEUS' : 'DEUS Band',
      monto: (soloTapones ? TAPONES_PRICE : precioBanda()) * Math.max(1, Math.min(10, parseInt(cantidad) || 1)) + (Number(shippingCost) || 0),
      color: selectedColor,
      direccion: shippingAddress
    }).catch(err => console.error('[email] aviso pago fallido:', err.message));
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
        // La METADATA del pago describe exactamente lo que el cliente pagó
        // (color, cantidad, dirección). Es la fuente autoritativa: un mismo
        // email puede tener varios pedidos pendientes (p. ej. configuró negro
        // y después pagó rosado), y buscar por email a secas devolvía el
        // pedido equivocado → el correo de DESPACHO mostraba un color distinto
        // al de la compra. Ahora el color sale del pago real, no del primer
        // pedido que calce.
        const meta = info.metadata || {};
        const emailCliente = meta.customer_email || info.payer?.email;
        // Pedido en memoria (el más RECIENTE que calce) solo para completar lo
        // que no viaje en la metadata.
        const enMemoria = [...pedidos].reverse().find(p => (p.customer?.email || '').toLowerCase() === (emailCliente || '').toLowerCase()) || {};
        const taponesPago = meta.tapones !== undefined ? (meta.tapones === true || meta.tapones === 'true') : !!enMemoria.tapones;
        const soloTaponesPago = meta.soloTapones !== undefined ? (meta.soloTapones === true || meta.soloTapones === 'true') : !!enMemoria.soloTapones;
        const costoPago = (meta.shipping_cost !== undefined && meta.shipping_cost !== null && meta.shipping_cost !== '') ? Number(meta.shipping_cost) : enMemoria.shipping?.cost;
        const pedido = {
          product: enMemoria.product || 'DEUS Band',
          color: meta.selected_color || enMemoria.color,
          cantidad: Number(meta.cantidad) || enMemoria.cantidad,
          tapones: taponesPago,
          method: enMemoria.method || 'MercadoPago',
          customer: {
            name: meta.customer_name || enMemoria.customer?.name,
            rut: meta.customer_rut || enMemoria.customer?.rut,
            email: emailCliente,
            phone: meta.customer_phone || enMemoria.customer?.phone
          },
          shipping: {
            carrier: meta.shipping_carrier || enMemoria.shipping?.carrier,
            cost: costoPago,
            address: meta.shipping_address || enMemoria.shipping?.address
          }
        };

        await enviarPagoConfirmado(info, pedido);
        // Purchase a Meta desde el SERVIDOR (Conversions API): captura el 100%
        // de las ventas aunque el cliente no vuelva a success.html. Mismo
        // event_id que el píxel del navegador → Meta deduplica si llegan ambos.
        metaCapi.enviarPurchase({ orden: info.id, valor: info.transaction_amount, email: emailCliente, phone: pedido.customer.phone })
          .catch(err => console.error('[capi] Error inesperado:', err.message));
        // Atribución de conducta: cuenta esta compra con las acciones que hizo
        // la sesión (viajaron en la metadata). Idempotente por n° de pago, así
        // que no se duplica si además el cliente cae en success.html.
        metrics.registrarConversion((meta.acciones_sesion || '').split(',').filter(Boolean), info.id, false);
        if (!soloTaponesPago) decrementStock(info.id, true); // esMP: la sincronización con MP ya cuenta este pago; solo tapones no descuenta stock de banda
        // Registra la venta y asigna automáticamente el ticket del sorteo (1 por compra)
        const ticketMP = metrics.registrarVenta({ monto: info.transaction_amount, metodo: 'MercadoPago', nombre: pedido.customer.name, orden: info.id, email: emailCliente });

        // Correo de confirmación al cliente (mismos datos autoritativos del pago).
        marcarPagadoPorEmail(emailCliente); // cancela el correo de recuperación
        enviarConfirmacionCliente({
          email: emailCliente,
          name: pedido.customer.name,
          monto: info.transaction_amount,
          id: info.id,
          color: pedido.color,
          carrier: pedido.shipping.carrier,
          address: pedido.shipping.address,
          ticket: ticketMP && ticketMP.numero
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

// ── Sorteo mensual ──
// El ticket se asigna AUTOMÁTICAMENTE al confirmarse el pago (1 por compra, en
// metrics.registrarVenta). Este endpoint es opcional: el comprador agrega su
// Instagram a su ticket ya existente para que le avisemos si gana.
app.post('/sorteo', async (req, res) => {
  const nombre = (req.body?.nombre || '').toString().trim().slice(0, 90);
  const orden = (req.body?.orden || '').toString().trim().slice(0, 60);
  const instagram = (req.body?.instagram || '').toString().trim().slice(0, 60);

  if (!orden || !instagram) {
    return res.status(400).json({ error: 'Completa n° de orden e Instagram.' });
  }

  // Solo si ese n° de orden corresponde a un pago YA CONFIRMADO (los 3 métodos).
  const r = metrics.reclamarInstagram({ orden, instagram, nombre });
  if (!r) {
    return res.status(404).json({ error: 'No encontramos ese n° de orden entre los pagos confirmados. Revisa el número en tu correo de confirmación de compra.' });
  }
  // Avisamos al dueño (registro en su correo).
  enviarTicketSorteo(r.ticket).catch(e => console.error('[sorteo] email:', e.message));

  res.json({ ok: true, duplicado: r.yaTenia, ticket: r.ticket.numero });
});

// Lista de tickets del mes (admin, protegida con STOCK_KEY)
// Uso: /sorteo/lista?clave=MICLAVE
app.get('/sorteo/lista', (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).json({ error: 'No disponible' });
  if ((req.query.clave || '') !== clave) return res.status(403).json({ error: 'Clave incorrecta' });
  const tks = metrics.obtenerTickets();
  res.json({ total: tks.length, tickets: tks });
});

// ── Presencia: latido de cada visitante para contar "en vivo" ──
// esOwner=true marca la sesión como del dueño y no se cuenta en las métricas.
app.post('/track/ping', (req, res) => {
  metrics.ping(req.body?.sid, !!req.body?.nueva, !!req.body?.esOwner);
  res.sendStatus(204);
});

// Paso intermedio del embudo: el visitante abrió el checkout.
app.post('/track/checkout', (req, res) => {
  metrics.registrarCheckout(!!req.body?.esOwner);
  res.sendStatus(204);
});

// Conducta del visitante: scroll por secciones, clicks, dispositivo, fuente.
app.post('/track/event', (req, res) => {
  metrics.registrarEvento(req.body?.ev, !!req.body?.esOwner);
  res.sendStatus(204);
});

// Conversión: al pagar, success.html manda las acciones que hizo la sesión,
// para cruzar qué acción lleva más a comprar (p. ej. girar el 360°).
app.post('/track/conversion', (req, res) => {
  metrics.registrarConversion(req.body?.acciones, req.body?.orden, !!req.body?.esOwner);
  res.sendStatus(204);
});

// ── Panel de administración (protegido con STOCK_KEY) ──
// Uso: /admin/stats?clave=MICLAVE
app.get('/admin/stats', (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).json({ error: 'No disponible' });
  if ((req.query.clave || '') !== clave) return res.status(403).json({ error: 'Clave incorrecta' });
  const snap = metrics.snapshot();
  const pedidosRecientes = pedidos.slice(-15).reverse().map(p => ({
    fecha: p.created_at, nombre: p.customer?.name, comuna: p.shipping?.address?.commune,
    color: p.color, total: p.total, estado: p.status, id: p.preference_id
  }));
  res.json({
    ...snap,
    pedidos: pedidosRecientes,
    stock: getStock()
  });
});

// Reinicia el promedio de tiempo (limpia el tiempo del dueño ya contado). Protegido.
app.post('/admin/reset-tiempo', (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).json({ error: 'No disponible' });
  if ((req.query.clave || '') !== clave) return res.status(403).json({ error: 'Clave incorrecta' });
  metrics.resetTiempoPromedio();
  res.json({ ok: true });
});

// ── Aviso de envío al cliente ──
// Lo dispara el Google Apps Script del Gmail del dueño cuando llega el correo
// de ChileExpress/Starken con el n° de seguimiento. El script extrae el correo
// del cliente (que viene en ese correo oficial) y el tracking, y hace POST aquí.
// Se envía al correo EXACTO de la transportadora → cliente correcto garantizado.
// Protegido con STOCK_KEY. Dedupe por (correo+tracking) mientras viva el proceso;
// el dedupe real lo hace la etiqueta "procesado" del Apps Script.
const enviosNotificados = new Set();
app.post('/envio/despachado', async (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).json({ error: 'No disponible' });
  if (((req.body && req.body.clave) || req.query.clave || '') !== clave) {
    return res.status(403).json({ error: 'Clave incorrecta' });
  }
  const email = (req.body?.email || '').toString().trim();
  const tracking = (req.body?.tracking || '').toString().trim();
  const carrier = (req.body?.carrier || '').toString().trim();
  const name = (req.body?.name || '').toString().trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Correo del cliente inválido' });
  }
  if (!tracking) return res.status(400).json({ error: 'Falta el n° de seguimiento' });

  const dedupeKey = (email + '|' + tracking).toLowerCase();
  if (enviosNotificados.has(dedupeKey)) {
    return res.json({ ok: true, duplicado: true });
  }
  enviosNotificados.add(dedupeKey);

  // Si el pedido sigue en memoria, enriquecemos con nombre/color/transportadora.
  const pedido = pedidos.find(p => (p.customer?.email || '').toLowerCase() === email.toLowerCase());

  try {
    const ok = await enviarEnvioDespachado({
      email,
      name: name || pedido?.customer?.name,
      tracking,
      carrier: carrier || pedido?.shipping?.carrier,
      color: pedido?.color
    });
    if (!ok) {
      // No se pudo enviar (p. ej. correo caído): no lo damos por procesado
      // para que el Apps Script reintente en su próxima pasada.
      enviosNotificados.delete(dedupeKey);
      return res.status(502).json({ ok: false, error: 'No se pudo enviar el aviso, reintentar' });
    }
    if (pedido) { pedido.status = 'enviado'; guardarPedidos(); }
    res.json({ ok: true, cliente: email, tracking, encontrado_en_pedidos: !!pedido });
  } catch (e) {
    enviosNotificados.delete(dedupeKey); // permite reintentar si falló
    console.error('[envio] Error avisando al cliente:', e.message);
    res.status(500).json({ error: 'No se pudo avisar al cliente' });
  }
});

// Stock restante (para el contador de unidades en la web). Incluye `precio`
// (lo que el backend cobraría AHORA) como diagnóstico: si la respuesta trae
// "precio":52990 con remaining 0, la reserva está activa y cobrando bien.
app.get('/stock', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({ remaining: getStock(), precio: precioBanda() });
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

// Pone en cero conducta + conversión-por-acción (deja denominador y numerador
// contando la misma ventana). Protegido con la misma clave admin STOCK_KEY.
// NO borra ventas, tickets ni stock. Uso: /metrics/reset-conducta?clave=MICLAVE
app.get('/metrics/reset-conducta', (req, res) => {
  const clave = (process.env.STOCK_KEY || '').trim();
  if (!clave) return res.status(404).send('No disponible');
  if ((req.query.clave || '') !== clave) return res.status(403).send('Clave incorrecta');
  metrics.resetConducta();
  res.json({ ok: true, mensaje: 'Conducta y conversión-por-acción reseteadas. Ventas y tickets intactos.' });
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

// Carga lo guardado (disco o Postgres) antes de aceptar tráfico, así ninguna
// venta/ticket/vista que llegue justo al arrancar se registra sobre datos vacíos.
async function arrancar() {
  await metrics.init(); // carga ventas, tickets y vistas persistidos
  const pedidosGuardados = await persist.load('pedidos.json', []);
  pedidos.push(...pedidosGuardados);

  app.listen(PORT, () => {
    console.log(`Servidor DEUS corriendo en http://localhost:${PORT}`);
  });
}
arrancar();
