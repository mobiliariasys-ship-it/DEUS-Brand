const { enviarCorreo } = require('./email');

// Recuperación de compras abandonadas: si alguien llena sus datos e inicia el
// pago pero a los 10 minutos no hay confirmación, le enviamos un correo con
// un botón para terminar la compra y otro para resolver dudas por WhatsApp.
// Si el pago se confirma antes, el envío se cancela.

const DELAY_MS = 10 * 60 * 1000; // 10 minutos
const WHATSAPP = 'https://wa.me/56979777870?text=' +
  encodeURIComponent('Hola! Estaba comprando mi DEUS Band y me quedó una duda 😊');

const pendientes = new Map(); // orderId -> { timer, email }

function programarRecuperacion(orderId, pedido) {
  const email = pedido?.customer?.email;
  if (!orderId || !email || pendientes.has(orderId)) return;

  // Si la misma persona reintenta con un pedido nuevo, reprogramamos:
  // un solo correo por cliente, no uno por intento.
  const emailNorm = String(email).toLowerCase();
  for (const [id, p] of pendientes) {
    if (p.email === emailNorm) {
      clearTimeout(p.timer);
      pendientes.delete(id);
    }
  }

  const timer = setTimeout(() => {
    pendientes.delete(orderId);
    enviarCorreoRecuperacion(pedido).catch(e => console.error('[recovery] email:', e.message));
  }, DELAY_MS);

  pendientes.set(orderId, { timer, email: emailNorm });
  console.log(`[recovery] programado ${orderId} → ${email} (10 min)`);
}

function marcarPagado(orderId) {
  const p = pendientes.get(orderId);
  if (p) {
    clearTimeout(p.timer);
    pendientes.delete(orderId);
    console.log(`[recovery] cancelado ${orderId} — pago confirmado`);
  }
}

function marcarPagadoPorEmail(email) {
  if (!email) return;
  const e = String(email).toLowerCase();
  for (const [id, p] of pendientes) {
    if (p.email === e) {
      clearTimeout(p.timer);
      pendientes.delete(id);
      console.log(`[recovery] cancelado ${id} — pago confirmado (${e})`);
    }
  }
}

async function enviarCorreoRecuperacion(pedido) {
  const nombre = (pedido.customer?.name || '').trim().split(' ')[0] || 'Hola';
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #eee">
      <div style="background:#080808;color:#fff;padding:22px 24px">
        <h2 style="margin:0;letter-spacing:3px">DEUS BAND</h2>
        <p style="margin:6px 0 0;color:#bbb;font-size:13px">Tu bienestar en datos</p>
      </div>
      <div style="padding:28px 24px;font-size:15px;line-height:1.7;color:#222">
        <p style="margin:0 0 14px"><b>${nombre}</b>, vimos que empezaste tu compra de la DEUS Band pero el pago no alcanzó a completarse.</p>
        <p style="margin:0 0 20px">Tranquilo: <b>no se hizo ningún cobro</b> y tu selección sigue disponible. Puedes retomarla en un minuto:</p>
        <div style="text-align:center;margin:26px 0">
          <a href="https://deusbrand.cl/" style="display:inline-block;background:#080808;color:#fff;text-decoration:none;padding:15px 34px;border-radius:6px;font-weight:700;letter-spacing:2px;font-size:13px">TERMINAR MI COMPRA</a>
        </div>
        <p style="margin:24px 0 14px;text-align:center;color:#555;font-size:14px">¿Te quedó alguna duda? Te ayudamos a despejarla al tiro 👇</p>
        <div style="text-align:center;margin:0 0 10px">
          <a href="${WHATSAPP}" style="display:inline-block;background:#25d366;color:#fff;text-decoration:none;padding:13px 28px;border-radius:24px;font-weight:700;font-size:14px">💬 Escríbenos por WhatsApp</a>
        </div>
        <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999;text-align:center">
          Pago 100% seguro con Webpay y Mercado Pago · Envío a todo Chile · Garantía de 60 días
        </p>
      </div>
    </div>`;
  const ref = String(pedido.preference_id || Date.now()).slice(-6);
  await enviarCorreo(`${nombre}, tu DEUS Band te está esperando 🖤 #${ref}`, html, null, pedido.customer.email);
  console.log(`[recovery] correo de recuperación enviado a ${pedido.customer.email}`);
}

module.exports = { programarRecuperacion, marcarPagado, marcarPagadoPorEmail };
