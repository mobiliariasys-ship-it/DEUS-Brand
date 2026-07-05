const https = require('https');
const nodemailer = require('nodemailer');

const money = n => '$' + (n || 0).toLocaleString('es-CL');

// A quién le llegan los pedidos
function destinatario() {
  return process.env.MAIL_TO || process.env.GMAIL_USER;
}

// ── Envío por Resend (HTTPS — funciona en Render) ──
function enviarViaResend(subject, html, attachments) {
  return new Promise(resolve => {
    const key = process.env.RESEND_API_KEY;
    const to = destinatario();
    if (!key || !to) return resolve(false);

    const body = {
      from: process.env.MAIL_FROM || 'DEUS Band <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    };
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

async function enviarViaGmail(subject, html) {
  const t = getTransport();
  if (!t) return false;
  try {
    await t.sendMail({ from: `"DEUS Band" <${process.env.GMAIL_USER}>`, to: destinatario(), subject, html });
    console.log('[email] Enviado vía Gmail');
    return true;
  } catch (e) { console.error('[email] Gmail error', e.message); return false; }
}

// Intenta Resend primero, luego Gmail
async function enviarCorreo(subject, html, attachments) {
  if (await enviarViaResend(subject, html, attachments)) return;
  if (await enviarViaGmail(subject, html)) return;
  console.log('[email] No se pudo enviar (configura RESEND_API_KEY en Render)');
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
        <p>DEUS Band — ${money(pedido.product_price)}</p>
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
  await enviarCorreo(`🛒 Nuevo pedido DEUS Band — ${dir.commune || 'sin comuna'} (${money(pedido.total)})`, html);
}

// ── Correo: pago confirmado ──
async function enviarPagoConfirmado(payment) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      <div style="background:#0a7d2c;color:#fff;padding:20px 24px">
        <h2 style="margin:0">✅ PAGO CONFIRMADO</h2>
      </div>
      <div style="padding:24px;font-size:14px">
        <p><b>Comprador:</b> ${payment.payer?.email || '—'}</p>
        <p><b>Monto:</b> ${money(payment.transaction_amount)}</p>
        <p><b>ID de pago:</b> ${payment.id}</p>
        <p style="margin-top:16px;color:#0a7d2c"><b>Ya puedes coordinar el envío.</b></p>
      </div>
    </div>`;
  await enviarCorreo(`✅ Pago confirmado DEUS Band — ${money(payment.transaction_amount)}`, html);
}

module.exports = { enviarPedidoNuevo, enviarPagoConfirmado, enviarResena, diagnostico };
