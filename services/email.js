const https = require('https');
const nodemailer = require('nodemailer');

const money = n => '$' + (n || 0).toLocaleString('es-CL');

// A quién le llegan los pedidos
function destinatario() {
  return process.env.MAIL_TO || process.env.GMAIL_USER;
}

// ── Envío por Resend (HTTPS — funciona en Render) ──
// `to` opcional: si no se indica, va al dueño (destinatario()).
function enviarViaResend(subject, html, attachments, to) {
  return new Promise(resolve => {
    const key = process.env.RESEND_API_KEY;
    const dest = to || destinatario();
    if (!key || !dest) return resolve(false);

    const body = {
      from: process.env.MAIL_FROM || 'DEUS Band <onboarding@resend.dev>',
      to: [dest],
      subject,
      html
    };
    // Reply-To: como wellness@ no tiene bandeja, las respuestas del cliente
    // se dirigen a un buzón real (por defecto, el Gmail del dueño).
    const replyTo = process.env.MAIL_REPLY_TO || process.env.GMAIL_USER;
    if (replyTo) body.reply_to = replyTo;
    if (attachments && attachments.length) body.attachments = attachments;
    const payload = JSON.stringify(body);

    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('[email] Enviado vía Resend');
          resolve(true);
        } else {
          console.error('[email] Resend error', res.statusCode, raw.substring(0, 250));
          resolve(false);
        }
      });
    });
    req.on('error', e => { console.error('[email] Resend req error', e.message); resolve(false); });
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
    req.write(payload);
    req.end();
  });
}

// ── Respaldo: Gmail SMTP (sirve en local; en Render suele estar bloqueado) ──
function getTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 8000
  });
}

async function enviarViaGmail(subject, html, to) {
  const t = getTransport();
  if (!t) return false;
  try {
    const replyTo = process.env.MAIL_REPLY_TO || process.env.GMAIL_USER;
    await t.sendMail({ from: `"DEUS Band" <${process.env.GMAIL_USER}>`, to: to || destinatario(), subject, html, replyTo });
    console.log('[email] Enviado vía Gmail');
    return true;
  } catch (e) { console.error('[email] Gmail error', e.message); return false; }
}

// Intenta Resend primero, luego Gmail. `to` opcional (por defecto, el dueño).
async function enviarCorreo(subject, html, attachments, to) {
  if (await enviarViaResend(subject, html, attachments, to)) return true;
  if (await enviarViaGmail(subject, html, to)) return true;
  console.log('[email] No se pudo enviar (configura RESEND_API_KEY en Render)');
  return false;
}

// ── Correo: nueva reseña para aprobar ──
async function enviarResena(review) {
  const estrellas = '★'.repeat(Math.max(1, Math.min(5, Number(review.rating) || 5)));
  const ig = (review.instagram || '').replace(/^@/, '');
  const fotos = Array.isArray(review.photos) ? review.photos : [];
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      <div style="background:#080808;color:#fff;padding:20px 24px">
        <h2 style="margin:0;letter-spacing:2px">DEUS BAND — NUEVA RESEÑA (por aprobar)</h2>
      </div>
      <div style="padding:24px;font-size:14px">
        <p style="font-size:20px;color:#e9c46a;margin:0 0 10px">${estrellas}</p>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#888">Nombre</td><td style="text-align:right"><b>${review.name || '—'}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Instagram</td><td style="text-align:right"><b>${ig ? '@' + ig : '—'}</b></td></tr>
        </table>
        <h3 style="margin:20px 0 8px">Comentario</h3>
        <p style="background:#f7f7f7;padding:14px;border-radius:8px;line-height:1.6">${(review.comment || '').replace(/</g, '&lt;')}</p>
        <p style="color:#888;margin-top:16px">📷 Fotos adjuntas: <b>${fotos.length}</b></p>
        <p style="margin-top:20px;padding-top:14px;border-top:2px solid #080808;font-size:13px;color:#555">
          Si la apruebas, responde este correo o avísame para publicarla en la web.
        </p>
      </div>
    </div>`;
  const attachments = fotos.slice(0, 4).map((f, i) => ({
    filename: f.filename || ('resena-foto-' + (i + 1) + '.jpg'),
    content: (f.base64 || '').replace(/^data:image\/\w+;base64,/, '')
  })).filter(a => a.content);
  await enviarCorreo(`⭐ Nueva reseña por aprobar${ig ? ' — @' + ig : ''}`, html, attachments);
}

// ── Diagnóstico ──
async function diagnostico() {
  const info = {
    resend_configurado: !!process.env.RESEND_API_KEY,
    gmail_user: process.env.GMAIL_USER || null,
    destinatario: destinatario() || null
  };
  try {
    const ok = await enviarViaResend('✅ Prueba DEUS (Resend)', '<p>Si ves esto, el correo por Resend funciona.</p>');
    info.resend = ok ? 'ENVIADO OK' : 'FALLÓ (revisa RESEND_API_KEY)';
  } catch (e) { info.resend = 'ERROR: ' + e.message; }
  return info;
}

// ── Correo: nuevo pedido ──
async function enviarPedidoNuevo(pedido) {
  const dir = pedido.shipping.address || {};
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      <div style="background:#080808;color:#fff;padding:20px 24px">
        <h2 style="margin:0;letter-spacing:2px">DEUS BAND — NUEVO PEDIDO</h2>
        <p style="margin:6px 0 0;color:#bbb;font-size:13px">Estado: PENDIENTE DE PAGO · ${pedido.method || 'MercadoPago'}</p>
      </div>
      <div style="padding:24px">
        <h3 style="margin:0 0 12px">Quien recibe</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888">Nombre</td><td style="text-align:right"><b>${pedido.customer?.name || '—'}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">RUT</td><td style="text-align:right"><b>${pedido.customer?.rut || '—'}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Correo</td><td style="text-align:right"><b>${pedido.customer?.email || '—'}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Teléfono</td><td style="text-align:right"><b>${pedido.customer?.phone || '—'}</b></td></tr>
        </table>
        <h3 style="margin:20px 0 12px">Producto</h3>
        <p>${pedido.product || 'DEUS Band'} — ${money(pedido.product_price)}</p>
        <p style="margin-top:6px"><b>Color elegido: ${(pedido.color || '—').toUpperCase()}</b></p>
        <h3 style="margin:20px 0 12px">Envío</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888">Empresa</td><td style="text-align:right"><b>${pedido.shipping.carrier || '—'}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Costo envío</td><td style="text-align:right">${(!pedido.shipping.cost || pedido.shipping.cost == 0) ? '<b>GRATIS (lanzamiento — paga la tienda)</b>' : money(pedido.shipping.cost)}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Región</td><td style="text-align:right">${dir.region || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Comuna</td><td style="text-align:right">${dir.commune || '—'}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Dirección</td><td style="text-align:right">${dir.address || '—'}</td></tr>
        </table>
        <div style="margin-top:20px;padding-top:16px;border-top:2px solid #080808;display:flex;justify-content:space-between">
          <b style="font-size:16px">TOTAL</b>
          <b style="font-size:16px">${money(pedido.total)}</b>
        </div>
        <p style="margin-top:24px;font-size:12px;color:#999">
          ID: ${pedido.preference_id}<br>
          Fecha: ${new Date(pedido.created_at).toLocaleString('es-CL')}<br><br>
          ⚠️ Confirma que el pago esté aprobado antes de despachar.
        </p>
      </div>
    </div>`;
  // Asunto único por pedido: si se repite el asunto, Gmail agrupa los correos en un solo hilo
  const refPedido = String(pedido.preference_id || Date.now()).slice(-6);
  await enviarCorreo(`🛒 Nuevo pedido DEUS Band — ${pedido.customer?.name || dir.commune || 'sin nombre'} (${money(pedido.total)}) #${refPedido}`, html);
}

// ── Correo: pago confirmado ──
// pedido (opcional): trae los datos completos de despacho del comprador.
async function enviarPagoConfirmado(payment, pedido) {
  const c = pedido?.customer || {};
  const dir = pedido?.shipping?.address || {};
  const correoCliente = c.email || payment.payer?.email || '—';
  const fila = (label, val) => val
    ? `<tr><td style="padding:6px 0;color:#888">${label}</td><td style="text-align:right"><b>${val}</b></td></tr>`
    : '';
  const envioCosto = pedido?.shipping?.cost;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      <div style="background:#0a7d2c;color:#fff;padding:20px 24px">
        <h2 style="margin:0">✅ PAGO CONFIRMADO — DESPACHAR</h2>
      </div>
      <div style="padding:24px;font-size:14px">
        <h3 style="margin:0 0 12px">Quien recibe</h3>
        <table style="width:100%;border-collapse:collapse">
          ${fila('Nombre', c.name)}
          ${fila('RUT', c.rut)}
          ${fila('Correo', correoCliente)}
          ${fila('Teléfono', c.phone)}
        </table>

        <h3 style="margin:20px 0 12px">Producto</h3>
        <table style="width:100%;border-collapse:collapse">
          ${fila('Detalle', pedido?.product || 'DEUS Band')}
          ${fila('Color', (pedido?.color || '').toString().toUpperCase())}
          ${pedido?.cantidad ? fila('Cantidad', pedido.cantidad) : ''}
          ${pedido?.tapones ? fila('Extra', 'Tapones de oído DEUS') : ''}
        </table>

        <h3 style="margin:20px 0 12px">Dirección de envío</h3>
        <table style="width:100%;border-collapse:collapse">
          ${fila('Empresa', pedido?.shipping?.carrier)}
          ${fila('Región', dir.region)}
          ${fila('Comuna', dir.commune)}
          ${fila('Dirección', dir.address)}
          ${fila('Costo envío', (envioCosto === 0) ? 'GRATIS' : (envioCosto ? money(envioCosto) : ''))}
        </table>

        <div style="margin-top:20px;padding-top:16px;border-top:2px solid #0a7d2c;display:flex;justify-content:space-between">
          <b style="font-size:16px">TOTAL PAGADO</b>
          <b style="font-size:16px">${money(payment.transaction_amount)}</b>
        </div>
        <p style="margin-top:14px;font-size:12px;color:#999">ID de pago: ${payment.id}${pedido?.method ? ' · ' + pedido.method : ''}</p>
        <p style="margin-top:14px;color:#0a7d2c"><b>Pago aprobado — ya puedes coordinar el envío.</b></p>
      </div>
    </div>`;
  // Asunto único por pago para que Gmail no junte pagos distintos en un mismo hilo
  const refPago = String(payment.id || Date.now()).slice(-8);
  const nombre = c.name ? ` — ${c.name}` : '';
  await enviarCorreo(`✅ Pago confirmado DEUS Band${nombre} (${money(payment.transaction_amount)}) #${refPago}`, html);
}

// ── Correo AL CLIENTE: su compra fue recibida ──
// datos: { email, name, monto, id, color, carrier, address }
async function enviarConfirmacionCliente(datos) {
  const email = (datos.email || '').trim();
  // Sin correo válido no hay a quién escribir (ej: Webpay no entrega el email del comprador)
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log('[email] Cliente sin correo válido, no se envía confirmación:', email || '(vacío)');
    return false;
  }
  const nombre = (datos.name || '').trim().split(' ')[0] || 'Hola';
  const dir = datos.address || {};
  const lugar = [dir.address, dir.commune, dir.region].filter(Boolean).join(', ');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #eee">
      <div style="background:#080808;color:#fff;padding:28px 24px;text-align:center">
        <img src="https://deusbrand.cl/img/logo-email.png" alt="DEUS BRAND" width="190" style="width:190px;max-width:72%;height:auto;display:inline-block;border:0;line-height:100%;outline:none;text-decoration:none;">
      </div>
      <div style="padding:32px 28px;color:#222;font-size:15px;line-height:1.6">
        <div style="text-align:center;font-size:40px;margin-bottom:8px">✅</div>
        <h2 style="text-align:center;margin:0 0 20px;font-size:20px;color:#0a7d2c">¡Tu compra fue recibida!</h2>
        <p>Hola <b>${nombre}</b>,</p>
        <p>Recibimos tu compra correctamente y ya estamos preparando tu <b>DEUS Band</b>. <b>Pronto haremos tu envío</b>.</p>
        <div style="background:#f7f7f7;border-radius:10px;padding:18px 20px;margin:22px 0">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:5px 0;color:#888">Producto</td><td style="text-align:right"><b>DEUS Band${datos.color ? ' — ' + String(datos.color).toUpperCase() : ''}</b></td></tr>
            ${datos.carrier ? `<tr><td style="padding:5px 0;color:#888">Envío</td><td style="text-align:right">${datos.carrier}</td></tr>` : ''}
            ${lugar ? `<tr><td style="padding:5px 0;color:#888">Dirección</td><td style="text-align:right">${lugar}</td></tr>` : ''}
            <tr><td style="padding:10px 0 0;color:#888;border-top:1px solid #e2e2e2">Total pagado</td><td style="text-align:right;padding-top:10px;border-top:1px solid #e2e2e2"><b style="font-size:16px">${money(datos.monto)}</b></td></tr>
          </table>
        </div>
        <p style="margin:22px 0 6px">El envío llega en <b>1 a 3 días hábiles</b>.</p>
        <div style="margin:22px 0 6px;background:#fbf6ec;border:1px solid #e6d6b3;border-radius:10px;padding:16px 18px;text-align:center">
          <div style="font-size:26px;line-height:1;margin-bottom:6px">🎁</div>
          <b style="color:#8a6d2f">¡Ya estás participando en el sorteo mensual!</b>
          <div style="font-size:13px;color:#7a6a4a;margin-top:6px">Con tu compra ganaste tu ticket para el sorteo de <b>una DEUS Band + Tapones de oído</b>. Sorteamos 1 vez al mes — te avisamos si ganas.</div>
        </div>
        <p style="margin-top:26px;color:#555">Gracias por confiar en DEUS. ✨</p>
      </div>
      <div style="background:#f0f0f0;padding:16px 24px;text-align:center;color:#999;font-size:12px">
        DEUS Band · deusbrand.cl${datos.id ? ' · Pedido ' + String(datos.id).slice(-8) : ''}
      </div>
    </div>`;
  const ok = await enviarCorreo(`✅ Recibimos tu compra — DEUS Band`, html, null, email);
  console.log(ok ? '[email] Confirmación enviada al cliente: ' + email : '[email] No se pudo enviar confirmación al cliente: ' + email);
  return ok;
}

// ── Correo AL CLIENTE: su pedido fue despachado (con n° de seguimiento) ──
// datos: { email, name, tracking, carrier, color }
async function enviarEnvioDespachado(datos) {
  const email = (datos.email || '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.log('[email] Envío: cliente sin correo válido, no se avisa:', email || '(vacío)');
    return false;
  }
  const nombre = (datos.name || '').trim().split(' ')[0] || 'Hola';
  const tracking = (datos.tracking || '').toString().trim();
  const carrier = (datos.carrier || 'la transportadora').toString().trim();
  // Link de seguimiento según la empresa
  const carrierLow = carrier.toLowerCase();
  let trackUrl = '';
  if (/chilexpress/.test(carrierLow)) trackUrl = 'https://www.chilexpress.cl/seguimiento-en-linea';
  else if (/starken/.test(carrierLow)) trackUrl = 'https://www.starken.cl/seguimiento';
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #eee">
      <div style="background:#080808;color:#fff;padding:28px 24px;text-align:center">
        <img src="https://deusbrand.cl/img/logo-email.png" alt="DEUS BRAND" width="190" style="width:190px;max-width:72%;height:auto;display:inline-block;border:0;line-height:100%;outline:none;text-decoration:none;">
      </div>
      <div style="padding:32px 28px;color:#222;font-size:15px;line-height:1.6">
        <div style="text-align:center;font-size:40px;margin-bottom:8px">📦</div>
        <h2 style="text-align:center;margin:0 0 20px;font-size:20px;color:#0a7d2c">¡Tu DEUS Band ya fue enviada!</h2>
        <p>Hola <b>${nombre}</b>,</p>
        <p>Tu pedido ya está en camino con <b>${carrier}</b>. Puedes seguir tu envío con este número de orden:</p>
        <div style="background:#f7f7f7;border:1px dashed #cfcfcf;border-radius:10px;padding:18px 20px;margin:22px 0;text-align:center">
          <div style="color:#888;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">N° de seguimiento</div>
          <div style="font-size:22px;font-weight:bold;letter-spacing:1px;color:#080808">${tracking || '—'}</div>
          ${datos.color ? `<div style="margin-top:10px;color:#888;font-size:13px">DEUS Band — ${String(datos.color).toUpperCase()}</div>` : ''}
        </div>
        ${trackUrl ? `<p style="text-align:center;margin:0 0 22px"><a href="${trackUrl}" style="display:inline-block;background:#080808;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-size:14px">Seguir mi envío</a></p>` : ''}
        <p style="margin:0 0 6px">El envío llega en <b>1 a 3 días hábiles</b>.</p>
        <p style="margin-top:26px;color:#555">Gracias por confiar en DEUS. ✨</p>
      </div>
      <div style="background:#f0f0f0;padding:16px 24px;text-align:center;color:#999;font-size:12px">
        DEUS Band · deusbrand.cl
      </div>
    </div>`;
  const ok = await enviarCorreo(`📦 Tu DEUS Band va en camino — N° ${tracking}`, html, null, email);
  console.log(ok ? '[email] Aviso de envío enviado al cliente: ' + email : '[email] No se pudo avisar el envío al cliente: ' + email);
  return ok;
}

// ── Correo AL DUEÑO: alguien canjeó un ticket del sorteo mensual ──
async function enviarTicketSorteo(t) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #eee">
      <div style="background:#20160a;color:#e7cf9c;padding:18px 22px">
        <h2 style="margin:0;letter-spacing:1px">🎟️ NUEVO TICKET — Sorteo mensual</h2>
      </div>
      <div style="padding:22px;font-size:14px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:7px 0;color:#888">Nombre</td><td style="text-align:right"><b>${(t.nombre||'—').replace(/</g,'&lt;')}</b></td></tr>
          <tr><td style="padding:7px 0;color:#888">RUT</td><td style="text-align:right"><b>${(t.rut||'—').replace(/</g,'&lt;')}</b></td></tr>
          <tr><td style="padding:7px 0;color:#888">N° de orden de envío</td><td style="text-align:right"><b>${(t.orden||'—').replace(/</g,'&lt;')}</b></td></tr>
          <tr><td style="padding:7px 0;color:#888">Orden verificada en el sistema</td><td style="text-align:right"><b style="color:${t.verificado?'#0a7d2c':'#c0392b'}">${t.verificado?'SÍ ✓':'no encontrada — revisar manualmente'}</b></td></tr>
        </table>
        <p style="margin-top:16px;font-size:12px;color:#999">Fecha: ${new Date(t.fecha||Date.now()).toLocaleString('es-CL')}<br>Guarda este correo: es tu registro de participantes del mes.</p>
      </div>
    </div>`;
  await enviarCorreo(`🎟️ Ticket sorteo — ${t.nombre || 'sin nombre'} (orden ${t.orden || '—'})`, html);
}

module.exports = { enviarCorreo, enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente, enviarEnvioDespachado, enviarTicketSorteo, enviarResena, diagnostico };
