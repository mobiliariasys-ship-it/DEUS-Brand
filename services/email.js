const https = require('https');
const nodemailer = require('nodemailer');
const { CORREAS, normalizarCorreas, CORREA_PREMIO } = require('./precio');

const money = n => '$' + (n || 0).toLocaleString('es-CL');

// A quién le llegan los pedidos
function destinatario() {
  return process.env.MAIL_TO || process.env.GMAIL_USER;
}

// ── Envío por Resend (HTTPS — funciona en Render) ──
// `to` opcional: si no se indica, va al dueño (destinatario()).
function enviarViaResend(subject, html, attachments, to) {
  return resendDetallado(subject, html, attachments, to).then(r => r.ok);
}

// Igual que enviarViaResend, pero dice QUÉ respondió Resend ({ ok, status,
// cuerpo }): el correo 11:11 lo necesita para detenerse cuando se acaba la
// cuota del día (429) en vez de seguir generando códigos que no llegan.
function resendDetallado(subject, html, attachments, to) {
  return new Promise(resolve => {
    const key = process.env.RESEND_API_KEY;
    const dest = to || destinatario();
    if (!key || !dest) return resolve({ ok: false, status: 0, cuerpo: 'Falta RESEND_API_KEY o destinatario' });

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
          resolve({ ok: true, status: res.statusCode, cuerpo: '' });
        } else {
          console.error('[email] Resend error', res.statusCode, raw.substring(0, 250));
          resolve({ ok: false, status: res.statusCode, cuerpo: raw.substring(0, 400) });
        }
      });
    });
    req.on('error', e => { console.error('[email] Resend req error', e.message); resolve({ ok: false, status: 0, cuerpo: e.message }); });
    req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, status: 0, cuerpo: 'timeout' }); });
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

// Primera fila de los correos al dueño: el color de la banda. Gmail arma la
// vista previa de la bandeja (y el aviso del celular) con el primer texto del
// correo, así que el color se ve sin abrirlo. Antes lo primero era el
// encabezado y el color quedaba a mitad del correo.
function filaColor(pedido) {
  const color = (pedido?.color || '').toString().trim();
  const texto = color ? 'Color: ' + color.toUpperCase() : (pedido?.soloTapones ? 'Solo tapones · sin banda' : '');
  return texto
    ? `<div style="background:#f4f4f4;border-bottom:1px solid #e2e2e2;color:#111;padding:10px 24px;font-size:16px;font-weight:bold">${texto}</div>`
    : '';
}

// ── Correo: nuevo pedido ──
async function enviarPedidoNuevo(pedido) {
  const dir = pedido.shipping.address || {};
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      ${filaColor(pedido)}
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
        ${pedido.regaloTapones ? '<p style="margin-top:6px;color:#0a7d2c"><b>🎁 + Tapones de oído DEUS GRATIS (regalo)</b></p>' : ''}
        ${CORREA_PREMIO[pedido.correaPremio] ? `<p style="margin-top:6px;color:#183a73"><b>🎡 + ${CORREA_PREMIO[pedido.correaPremio].nombre}</b></p>` : ''}
        ${pedido.descuento ? `<p style="margin-top:6px;color:#0a7d2c"><b>🎡 Premio ruleta ${pedido.codigoPremio || ''}: −${money(pedido.descuento)}</b></p>` : ''}
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
  await enviarCorreo(`🛒 Nuevo pedido DEUS Band${(normalizarCorreas(pedido.correas).length || pedido.correaPremio) ? ' + correas' : ''}${pedido.regaloTapones ? ' + 🎁 tapones' : ''} — ${pedido.customer?.name || dir.commune || 'sin nombre'} (${money(pedido.total)}) #${refPedido}`, html);
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
  const correas = normalizarCorreas(pedido?.correas);
  // Lo que hay que meter en el paquete además de la banda: las correas extra
  // pagadas y la correa de tela del premio de la ruleta.
  const correaPremio = CORREA_PREMIO[pedido?.correaPremio] || null;
  const incluir = correas.map(k => CORREAS[k].nombre).concat(correaPremio ? [correaPremio.nombre] : []);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      ${filaColor(pedido)}
      <div style="background:#0a7d2c;color:#fff;padding:20px 24px">
        <h2 style="margin:0">✅ PAGO CONFIRMADO — DESPACHAR</h2>
      </div>
      ${pedido?.regaloTapones ? '<div style="background:#fff4d6;border-bottom:2px solid #e0a800;color:#5c4400;padding:12px 24px;font-size:15px;font-weight:bold">🎁 REGALO: + TAPONES DE OÍDO GRATIS — INCLUIR EN EL PAQUETE</div>' : ''}
      ${incluir.length ? `<div style="background:#e8f1ff;border-bottom:2px solid #2f6fd6;color:#183a73;padding:12px 24px;font-size:15px;font-weight:bold">➕ INCLUIR EN EL PAQUETE: ${incluir.map(n => n.toUpperCase()).join(' + ')}</div>` : ''}
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
          ${correas.map(k => fila('Extra', CORREAS[k].nombre + ' (' + CORREAS[k].detalle.toLowerCase() + ')')).join('')}
          ${correaPremio ? fila('🎡 Premio', correaPremio.nombre + ' (' + correaPremio.detalle + ')') : ''}
          ${pedido?.regaloTapones ? fila('🎁 Regalo', '+ Tapones de oído DEUS GRATIS — INCLUIR EN EL PAQUETE') : ''}
          ${pedido?.descuento ? fila('🎡 Descuento', 'Premio ruleta ' + (pedido.codigoPremio || '') + ': −' + money(pedido.descuento)) : ''}
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
  await enviarCorreo(`✅ Pago confirmado DEUS Band${incluir.length ? ' + ➕ CORREAS' : ''}${pedido?.regaloTapones ? ' + 🎁 TAPONES GRATIS' : ''}${nombre} (${money(payment.transaction_amount)}) #${refPago}`, html);
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
  const correas = normalizarCorreas(datos.correas);
  const correaPremio = CORREA_PREMIO[datos.correaPremio] || null;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #eee">
      <div style="background:#080808;color:#fff;padding:28px 24px;text-align:center">
        <img src="https://deusbrand.cl/img/logo-email.png" alt="DEUS BRAND" width="190" style="width:190px;max-width:72%;height:auto;display:inline-block;border:0;line-height:100%;outline:none;text-decoration:none;">
      </div>
      <div style="padding:32px 28px;color:#222;font-size:15px;line-height:1.6">
        <div style="text-align:center;font-size:40px;margin-bottom:8px">✅</div>
        <h2 style="text-align:center;margin:0 0 20px;font-size:20px;color:#0a7d2c">¡Tu compra fue recibida!</h2>
        <p>Hola <b>${nombre}</b>,</p>
        <p>Recibimos tu compra correctamente y ya estamos preparando tu <b>DEUS Band</b>${correas.length ? ' con tus <b>correas extra</b>' : ''}${datos.regaloTapones ? ' y tus <b>tapones de oído de regalo</b>' : ''}. <b>Pronto haremos tu envío</b>.</p>
        ${datos.regaloTapones ? `<div style="margin:18px 0 0;background:#eef8f1;border:1px solid #b9e0c5;border-radius:10px;padding:14px 16px;text-align:center">
          <div style="font-size:24px;line-height:1;margin-bottom:6px">🎁</div>
          <b style="color:#0a7d2c;font-size:16px">+ Tapones de oído DEUS GRATIS</b>
          <div style="font-size:13px;color:#3d6b4b;margin-top:4px">Son tu regalo por tu compra. Van en el mismo paquete que tu DEUS Band, no tienes que hacer nada más.</div>
        </div>` : ''}
        <div style="background:#f7f7f7;border-radius:10px;padding:18px 20px;margin:22px 0">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:5px 0;color:#888">Producto</td><td style="text-align:right"><b>DEUS Band${datos.color ? ' — ' + String(datos.color).toUpperCase() : ''}</b></td></tr>
            ${correas.map(k => `<tr><td style="padding:5px 0;color:#888">Extra</td><td style="text-align:right"><b>${CORREAS[k].nombre}</b></td></tr>`).join('')}
            ${correaPremio ? `<tr><td style="padding:5px 0;color:#888">🎡 Premio</td><td style="text-align:right"><b>${correaPremio.nombre.replace(' (premio ruleta)', '')}</b> <span style="display:inline-block;background:#0a7d2c;color:#ffffff;font-size:11px;font-weight:bold;border-radius:4px;padding:2px 6px">GRATIS</span></td></tr>` : ''}
            ${datos.descuento ? `<tr><td style="padding:5px 0;color:#888">🎡 Premio ruleta</td><td style="text-align:right;color:#0a7d2c"><b>−${money(datos.descuento)}</b></td></tr>` : ''}
            ${datos.regaloTapones ? `<tr><td style="padding:5px 0;color:#888">🎁 Regalo</td><td style="text-align:right"><b>+ Tapones de oído DEUS</b> <span style="display:inline-block;background:#0a7d2c;color:#ffffff;font-size:11px;font-weight:bold;letter-spacing:1px;border-radius:10px;padding:2px 8px;margin-left:4px">GRATIS</span></td></tr>` : ''}
            ${datos.carrier ? `<tr><td style="padding:5px 0;color:#888">Envío</td><td style="text-align:right">${datos.carrier}</td></tr>` : ''}
            ${lugar ? `<tr><td style="padding:5px 0;color:#888">Dirección</td><td style="text-align:right">${lugar}</td></tr>` : ''}
            <tr><td style="padding:10px 0 0;color:#888;border-top:1px solid #e2e2e2">Total pagado</td><td style="text-align:right;padding-top:10px;border-top:1px solid #e2e2e2"><b style="font-size:16px">${money(datos.monto)}</b></td></tr>
          </table>
        </div>
        <p style="margin:22px 0 6px">El envío llega en <b>1 a 3 días hábiles</b>.</p>
        <p style="margin-top:26px;color:#555">Gracias por confiar en DEUS. ✨</p>
      </div>
      <div style="background:#f0f0f0;padding:16px 24px;text-align:center;color:#999;font-size:12px">
        DEUS Band · deusbrand.cl${datos.id ? ' · Pedido ' + String(datos.id).slice(-8) : ''}
      </div>
    </div>`;
  const ok = await enviarCorreo(`✅ Recibimos tu compra — DEUS Band${datos.regaloTapones ? ' + tapones de oído gratis' : ''}`, html, null, email);
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
          <tr><td style="padding:7px 0;color:#888">N° de ticket</td><td style="text-align:right"><b>${t.numero ? '#' + String(t.numero).padStart(4, '0') : '—'}</b></td></tr>
          <tr><td style="padding:7px 0;color:#888">Nombre</td><td style="text-align:right"><b>${(t.nombre||'—').replace(/</g,'&lt;')}</b></td></tr>
          <tr><td style="padding:7px 0;color:#888">Instagram</td><td style="text-align:right"><b>${(t.instagram||'—').replace(/</g,'&lt;')}</b></td></tr>
          <tr><td style="padding:7px 0;color:#888">N° de orden de envío</td><td style="text-align:right"><b>${(t.orden||'—').replace(/</g,'&lt;')}</b></td></tr>
        </table>
        <p style="margin-top:16px;font-size:12px;color:#999">Fecha: ${new Date(t.fecha||Date.now()).toLocaleString('es-CL')}<br>Guarda este correo: es tu registro de participantes del mes.</p>
      </div>
    </div>`;
  await enviarCorreo(`🎟️ Ticket sorteo — ${t.nombre || 'sin nombre'} (orden ${t.orden || '—'})`, html);
}

// ── Aviso al dueño cuando NO se pudo iniciar un pago ──────────────────────
// Se dispara cuando la pasarela (Flow, Webpay o MercadoPago) rechaza o no
// responde al crear el pago: el cliente ve "No pudimos conectar" y se va sin
// comprar. Antes esto solo se veía en los logs de Render, así que las ventas
// perdidas pasaban inadvertidas hasta que alguien reclamaba.
//
// Antirrepetición: el front reintenta hasta 4 veces seguidas, y sin esto
// llegarían 4 correos idénticos por un mismo intento. Se manda como máximo
// uno por combinación medio+cliente cada VENTANA_AVISO.
const ultimoAvisoFallo = new Map();
const VENTANA_AVISO = 5 * 60 * 1000; // 5 minutos

async function enviarPagoFallido(datos) {
  const c = datos.cliente || {};
  const clave = (datos.metodo || '?') + '|' + (c.email || c.phone || 'anonimo');
  const ahora = Date.now();
  const previo = ultimoAvisoFallo.get(clave);
  if (previo && (ahora - previo) < VENTANA_AVISO) return; // ya avisado recién
  ultimoAvisoFallo.set(clave, ahora);
  // Limpieza para que el Map no crezca indefinidamente
  if (ultimoAvisoFallo.size > 200) {
    for (const [k, t] of ultimoAvisoFallo) if (ahora - t > VENTANA_AVISO) ultimoAvisoFallo.delete(k);
  }

  const esc = s => String(s == null ? '—' : s).replace(/</g, '&lt;');
  const dir = datos.direccion || {};
  const wa = (c.phone || '').replace(/[^0-9]/g, '');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      <div style="background:#4a1010;color:#fff;padding:20px 24px">
        <h2 style="margin:0;letter-spacing:1px">⚠️ PAGO FALLIDO — venta en riesgo</h2>
        <p style="margin:6px 0 0;color:#f0b8b8;font-size:13px">El cliente NO pudo pagar con ${esc(datos.metodo)}. No se le cobró nada.</p>
      </div>
      <div style="padding:24px">
        <div style="background:#fff6f6;border-left:3px solid #c0392b;padding:12px 14px;margin-bottom:18px;font-size:13px">
          <b>Motivo técnico:</b><br><span style="color:#a33">${esc(datos.error)}</span>
        </div>
        <h3 style="margin:0 0 12px">Contacta al cliente para rescatar la venta</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888">Nombre</td><td style="text-align:right"><b>${esc(c.name)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Teléfono</td><td style="text-align:right"><b>${esc(c.phone)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Correo</td><td style="text-align:right"><b>${esc(c.email)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">RUT</td><td style="text-align:right">${esc(c.rut)}</td></tr>
        </table>
        ${wa ? `<p style="margin:16px 0"><a href="https://wa.me/${wa.startsWith('56') ? wa : '56' + wa}" style="background:#25d366;color:#fff;padding:11px 18px;border-radius:7px;text-decoration:none;font-weight:bold;display:inline-block">Escribirle por WhatsApp</a></p>` : ''}
        <h3 style="margin:20px 0 12px">Pedido que intentó hacer</h3>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr><td style="padding:6px 0;color:#888">Producto</td><td style="text-align:right"><b>${esc(datos.producto)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Monto</td><td style="text-align:right"><b>${money(datos.monto)}</b></td></tr>
          <tr><td style="padding:6px 0;color:#888">Color</td><td style="text-align:right">${esc(datos.color)}</td></tr>
          <tr><td style="padding:6px 0;color:#888">Destino</td><td style="text-align:right">${esc(dir.commune)}, ${esc(dir.region)}</td></tr>
        </table>
        <p style="margin-top:18px;font-size:12px;color:#999">
          Fecha: ${new Date().toLocaleString('es-CL')}<br>
          Si te llegan varios de estos seguidos con el mismo motivo, revisa las credenciales de la pasarela en Render (Environment) — puede estar fallándole a TODOS los clientes.
        </p>
      </div>
    </div>`;
  await enviarCorreo(`⚠️ Pago fallido (${datos.metodo}) — ${c.name || 'cliente'} · ${money(datos.monto)}`, html);
}

// ── Correo AL CLIENTE: su premio de la ruleta "Gira y gana" ──
// datos: { email, codigo, premio: { id, etiqueta, tipo, monto?, pct? }, vence (ISO) }
// Los botones abren deusbrand.cl con el código ya puesto (?premio=CODIGO), así
// no tiene que copiarlo; con la correa, cada color tiene su botón.
const SITIO = 'https://deusbrand.cl';
async function enviarPremioRuleta(datos) {
  const email = (datos && datos.email || '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
  const { precioBanda } = require('./precio');
  const premio = datos.premio || {};
  const codigo = String(datos.codigo || '');
  const link = (extra) => `${SITIO}/?premio=${encodeURIComponent(codigo)}${extra || ''}`;
  const titulo = premio.tipo === 'correa' ? 'Correa extra'
    : premio.tipo === 'tapones' ? 'Tapones de oído'
    : premio.etiqueta;
  // "viernes 6 de noviembre a las 15:42" (hora de Chile).
  const fv = new Date(datos.vence);
  const vence = fv.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')
    + ' a las ' + fv.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
  const precio = precioBanda();
  const descuento = premio.monto ? premio.monto : (premio.pct ? Math.ceil(precio * premio.pct / 100) : 0);
  const check = (texto) => `<tr><td style="padding:9px 0;width:30px;vertical-align:middle"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:#0a7d2c;color:#ffffff;font-weight:bold;font-size:13px;line-height:22px;text-align:center">✓</span></td><td style="padding:9px 0;font-size:14px;color:#222;text-align:left">${texto}</td></tr>`;
  const beneficios = (premio.tipo === 'correa'
    ? check('<b>Correa de tela extra</b> de regalo, negra o gris')
    : premio.tipo === 'tapones'
      ? check('<b>Tapones de oído DEUS</b> de regalo con tu banda')
      : check(`<b>${premio.monto ? money(premio.monto) + ' de descuento' : premio.pct + '% de descuento'}</b> en tu DEUS Band`))
    + check('<b>Envío gratis</b> a todo Chile, llega en 1 a 2 días');
  const lead = premio.tipo === 'correa'
    ? 'Tu DEUS Band llega con <b>3 correas</b>: las 2 de siempre más 1 de tela extra, del color que elijas.'
    : premio.tipo === 'tapones'
      ? 'Tus tapones de oído DEUS van de regalo en el mismo paquete que tu banda.'
      : 'Este es tu premio. El botón de abajo abre la tienda con tu código ya aplicado.';
  // La correa: el color (negra o gris) se elige en la web al usar el código,
  // no acá (pedido del dueño: elegir en dos lugares confundía).
  const medio = premio.tipo === 'correa'
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eeeeee;border-radius:10px;margin:0 0 18px"><tr>
         <td style="padding:10px 6px 10px 12px;width:84px;text-align:center"><img src="${SITIO}/img/correa-nylon-negra.webp" alt="" height="64" style="height:64px;border:0"> <img src="${SITIO}/img/correa-nylon-gris.webp" alt="" height="64" style="height:64px;border:0"></td>
         <td style="padding:10px 12px 10px 4px;text-align:left;font-size:13.5px;color:#444;line-height:1.45"><b style="color:#111">Negra o gris:</b> el color lo eliges en la web cuando uses tu código.</td>
       </tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eeeeee;border-radius:10px;margin:0 0 18px"><tr>
         <td style="padding:10px;width:88px"><img src="${SITIO}/img/thumb-negra.webp" alt="DEUS Band" width="78" height="78" style="width:78px;height:78px;border-radius:8px;display:block;border:0"></td>
         <td style="padding:10px 10px 10px 4px;text-align:left"><b style="font-size:15px;color:#111">DEUS Band</b><br>
           ${descuento ? `<s style="color:#999;font-size:13px">${money(precio)}</s> <b style="font-size:20px;color:#111">${money(precio - descuento)}</b>` : `<b style="font-size:20px;color:#111">${money(precio)}</b>`}<br>
           <span style="font-size:12px;color:#0a7d2c;font-weight:bold">Envío gratis · 3 cuotas sin interés</span></td>
       </tr></table>`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #eee">
      <div style="background:#080808;padding:24px;text-align:center">
        <img src="${SITIO}/img/logo-email.png" alt="DEUS BRAND" width="190" style="width:190px;max-width:72%;height:auto;display:inline-block;border:0;outline:none;text-decoration:none;">
      </div>
      <div style="padding:28px 24px 24px;text-align:center;color:#222">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#b0812f;font-weight:bold">Ganaste en la ruleta</div>
        <h1 style="font-size:25px;line-height:1.2;margin:8px 0 6px;color:#111">${titulo} + envío gratis</h1>
        <p style="font-size:14.5px;color:#555;line-height:1.5;margin:0 0 16px">${lead}</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border-radius:10px;margin:0 0 16px"><tr><td style="padding:4px 14px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${beneficios}</table>
        </td></tr></table>
        <div style="border:2px dashed #d9b46c;background:#fbf6ec;border-radius:10px;padding:12px;margin:0 0 16px">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#888">Tu código</div>
          <div style="font-size:27px;font-weight:bold;letter-spacing:4px;color:#111;margin-top:4px">${codigo}</div>
        </div>
        ${medio}
        <a href="${link()}" style="display:block;background:#111111;color:#e7cf9c;text-decoration:none;font-weight:bold;letter-spacing:1.5px;font-size:14px;text-transform:uppercase;border-radius:10px;padding:16px">${premio.tipo === 'descuento' ? 'Usar mi descuento' : 'Usar mi premio'}</a>
        <p style="font-size:12.5px;color:#888;margin:14px 0 0;line-height:1.5">Tu código vence el <b>${vence}</b>. Un solo uso, en una compra hecha con <b>este mismo correo</b>.</p>
      </div>
      <div style="border-top:1px solid #eee;padding:14px 20px 18px;font-size:11.5px;color:#999;text-align:center;line-height:1.6">
        Recibiste este correo porque giraste la ruleta en deusbrand.cl.<br>DEUS Brand · Santiago, Chile
      </div>
    </div>`;
  const asunto = `🎁 Ganaste en la ruleta DEUS: ${premio.tipo === 'descuento' ? titulo : titulo.toLowerCase()} + envío gratis`;
  const ok = await enviarCorreo(asunto, html, null, email);
  console.log(ok ? '[email] Premio de la ruleta enviado: ' + email : '[email] No se pudo enviar el premio de la ruleta: ' + email);
  return ok;
}

// Correo "11:11" (pedido del dueño, 11-nov-2026): a quien dejó su correo y no
// compró, 10% OFF por 24 horas. Lo manda services/promo.js, de a uno.
// El asunto es lo que se ve en la notificación del celular: parte con la
// varita (pedido del dueño) y dice de qué se trata, como pide el art. 28 B de
// la Ley 19.496 para los correos promocionales; el pie da cómo darse de baja.
// Solo por Resend: devuelve { ok, status, cuerpo } para que el envío masivo
// sepa si se acabó la cuota del día.
const ASUNTO_1111 = '🪄 ¿Estabas buscando una DEUS Band? Tu 10% del 11:11 ✨ solo por 24 horas';
function html1111({ codigo, vence }) {
  const { precioBanda } = require('./precio');
  const precio = precioBanda();
  const descuento = Math.ceil(precio * 10 / 100); // igual que descuentoPremio()
  const link = `${SITIO}/?premio=${encodeURIComponent(codigo)}`;
  const fv = new Date(vence);
  const venceTxt = fv.toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')
    + ' a las ' + fv.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', hour12: false });
  const check = (texto) => `<tr><td style="padding:8px 0;width:30px;vertical-align:middle"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:#0a7d2c;color:#ffffff;font-weight:bold;font-size:13px;line-height:22px;text-align:center">✓</span></td><td style="padding:8px 0;font-size:14.5px;color:#222;text-align:left;vertical-align:middle">${texto}</td></tr>`;
  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">✨ Pide un deseo: 10% OFF en tu DEUS Band. Tu código vence en 24 horas.</div>
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #eee">
      <div style="background:#fff4d6;border-bottom:1px solid #f0d58a;color:#7a5200;padding:11px 16px;text-align:center;font-size:13.5px;font-weight:bold">⚠️ Aviso: tu 10% de descuento vence en 24 horas</div>
      <div style="background:#080808;padding:22px 24px 18px;text-align:center">
        <img src="${SITIO}/img/logo-email.png" alt="DEUS BRAND" width="190" style="width:190px;max-width:72%;height:auto;display:inline-block;border:0;outline:none;text-decoration:none;">
        <div style="margin-top:14px;font-size:12px;letter-spacing:3px;color:#e7cf9c;font-weight:bold">🪄 11:11 · PIDE UN DESEO ✨</div>
      </div>
      <div style="padding:26px 24px 24px;text-align:center;color:#222">
        <h1 style="font-size:25px;line-height:1.2;margin:0 0 10px;color:#111">¿Estabas buscando una DEUS Band?</h1>
        <p style="font-size:15px;color:#444;line-height:1.55;margin:0 0 18px">Hoy es 11.11, y a las 11:11 se piden deseos ✨. Si el tuyo era tu DEUS Band, acá te dejamos un <b>10% de descuento</b> para tu compra. Válido solo por <b>24 horas</b>.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;border-radius:10px;margin:0 0 16px"><tr><td style="padding:4px 14px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${check('<b>10% de descuento</b> en tu DEUS Band')}
            ${check('<b>Envío gratis</b> a todo Chile, llega en 1 a 2 días')}
            ${check('<b>3 cuotas sin interés</b>')}
          </table>
        </td></tr></table>
        <div style="border:2px dashed #d9b46c;background:#fbf6ec;border-radius:10px;padding:12px;margin:0 0 16px">
          <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#888">Tu código mágico 🪄</div>
          <div style="font-size:27px;font-weight:bold;letter-spacing:4px;color:#111;margin-top:4px">${codigo}</div>
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eeeeee;border-radius:10px;margin:0 0 18px"><tr>
          <td style="padding:10px;width:88px"><img src="${SITIO}/img/thumb-negra.webp" alt="DEUS Band" width="78" height="78" style="width:78px;height:78px;border-radius:8px;display:block;border:0"></td>
          <td style="padding:10px 10px 10px 4px;text-align:left"><b style="font-size:15px;color:#111">DEUS Band</b><br>
            <s style="color:#999;font-size:13px">${money(precio)}</s> <b style="font-size:20px;color:#111">${money(precio - descuento)}</b><br>
            <span style="font-size:12px;color:#0a7d2c;font-weight:bold">Envío gratis · 3 cuotas sin interés</span></td>
        </tr></table>
        <a href="${link}" style="display:block;background:#111111;color:#e7cf9c;text-decoration:none;font-weight:bold;letter-spacing:1.5px;font-size:14px;text-transform:uppercase;border-radius:10px;padding:16px">🪄 Usar mi 10% ahora</a>
        <p style="font-size:12.5px;color:#888;margin:14px 0 0;line-height:1.5">Tu código vence el <b>${venceTxt}</b>, 24 horas después de este correo. Un solo uso, en una compra hecha con <b>este mismo correo</b>.</p>
      </div>
      <div style="border-top:1px solid #eee;padding:14px 20px 18px;font-size:11.5px;color:#999;text-align:center;line-height:1.6">
        Recibiste este correo porque dejaste tu correo en deusbrand.cl.<br>Si no quieres recibir más promociones, responde este correo con la palabra BAJA.<br>DEUS Brand · Santiago, Chile
      </div>
    </div>`;
}
async function enviarPromo1111(datos) {
  const email = (datos && datos.email || '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, status: 0, cuerpo: 'correo inválido' };
  return resendDetallado(ASUNTO_1111, html1111(datos), null, email);
}

module.exports = { enviarCorreo, enviarPedidoNuevo, enviarPagoConfirmado, enviarConfirmacionCliente, enviarEnvioDespachado, enviarTicketSorteo, enviarResena, enviarPagoFallido, enviarPremioRuleta, enviarPromo1111, ASUNTO_1111, html1111, diagnostico };
