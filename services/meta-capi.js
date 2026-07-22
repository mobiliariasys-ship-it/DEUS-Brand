// Conversions API de Meta (CAPI): dispara el evento Purchase desde el SERVIDOR
// cuando el pago se confirma por webhook. Garantiza que Meta cuente TODAS las
// ventas, aunque el cliente NO vuelva a success.html (el píxel del navegador
// solo se dispara si el cliente aterriza en esa página; muchos pagos se
// aprueban sin que el cliente regrese → esas ventas nunca llegaban al píxel).
//
// Deduplicación: usa el mismo event_id que el píxel del navegador
// ('purchase-<id de pago>'). Si ambos eventos llegan (navegador + servidor),
// Meta descarta el duplicado y cuenta la compra UNA sola vez.
//
// Variables de entorno en Render:
//   META_CAPI_TOKEN = token de Conversions API. Events Manager → tu píxel →
//                     Configuración → Conversions API → "Generar token de
//                     acceso". Es SECRETO, no se comparte ni se sube al repo.
//   META_PIXEL_ID   = opcional; por defecto el píxel de DEUS.
//
// Sin META_CAPI_TOKEN el módulo no hace nada (log y sigue): es inerte hasta que
// se configure el token, así que desplegarlo no cambia el comportamiento actual.
const https = require('https');
const crypto = require('crypto');

const PIXEL_ID = (process.env.META_PIXEL_ID || '2086346891978245').trim();
const API_VERSION = 'v21.0';

// Meta exige los identificadores del usuario hasheados en SHA-256, en minúsculas
// y sin espacios, para poder emparejar la compra con la persona sin exponer el dato.
function sha256(v) {
  return crypto.createHash('sha256').update(String(v).trim().toLowerCase()).digest('hex');
}

// Envía un evento Purchase a Meta. Nunca lanza: registra el resultado y resuelve
// un booleano, para no interferir con el flujo del webhook si Meta falla.
function enviarPurchase({ orden, valor, email, phone, sourceUrl }) {
  return new Promise(resolve => {
    const token = (process.env.META_CAPI_TOKEN || '').trim();
    if (!token) { console.log('[capi] META_CAPI_TOKEN no configurado — se omite el envío a Meta'); return resolve(false); }
    if (!orden) { console.log('[capi] sin id de orden — se omite'); return resolve(false); }

    const userData = {};
    if (email) userData.em = [sha256(email)];
    if (phone) { const p = String(phone).replace(/[^0-9]/g, ''); if (p) userData.ph = [sha256(p)]; }

    const body = JSON.stringify({
      data: [{
        event_name: 'Purchase',
        event_time: Math.floor(Date.now() / 1000),
        event_id: 'purchase-' + orden,   // mismo id que el píxel del navegador → dedup
        action_source: 'website',
        event_source_url: sourceUrl || 'https://deusbrand.cl/',
        user_data: userData,
        custom_data: { value: Number(valor) || 0, currency: 'CLP', content_name: 'DEUS Band' }
      }]
    });

    const opts = {
      hostname: 'graph.facebook.com',
      path: `/${API_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 200) console.log('[capi] Purchase enviado a Meta — orden', orden, '· valor', valor);
        else console.error('[capi] Meta respondió', res.statusCode, raw.substring(0, 250));
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', e => { console.error('[capi] Error de red:', e.message); resolve(false); });
    req.setTimeout(8000, () => { req.destroy(); console.error('[capi] Timeout'); resolve(false); });
    req.write(body);
    req.end();
  });
}

module.exports = { enviarPurchase };
