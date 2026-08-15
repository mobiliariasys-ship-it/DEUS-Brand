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

// Comuna y región (ct/st): Meta las normaliza distinto que el resto de los
// campos — borra dígitos, ESPACIOS, paréntesis, puntos y guiones, pero CONSERVA
// las tildes y la ñ. Es la regla que implementan sus propios SDKs oficiales
// (city.replace(/[0-9\s().-]/g, '') en el de Node, idéntico en el de Python) y
// la misma que aplica el fbevents.js del píxel del navegador — por eso estos
// mismos campos rinden 100% de cobertura en AddPaymentInfo y solo 26,7% en
// Purchase.
//
// Importa mucho acá: la mitad de las comunas de la Región Metropolitana lleva
// espacio ("Puente Alto", "Las Condes", "Estación Central"), así que mandarlas
// con el espacio adentro produce un hash que no calza con nada. Y borrarles la
// tilde rompe las otras ("Ñuñoa", "Peñalolén", "Maipú"): entre los dos motivos
// se caía el 47% de las comunas del país y el 63% de las de la RM.
//
// Los nombres (fn/ln) NO pasan por acá: Meta solo les hace trim + minúsculas,
// conservando la tilde, así que "José" viaja como "josé" con sha256() a secas.
function sha256Ubicacion(v) {
  return sha256(String(v).replace(/[0-9\s().-]/g, ''));
}

// Envía un evento Purchase a Meta. Nunca lanza: registra el resultado y resuelve
// un booleano, para no interferir con el flujo del webhook si Meta falla.
function enviarPurchase({ orden, valor, email, phone, sourceUrl, clientIp, clientUa, fbp, fbc, nombre, rut, comuna, region }) {
  return new Promise(resolve => {
    const token = (process.env.META_CAPI_TOKEN || '').trim();
    if (!token) { console.log('[capi] META_CAPI_TOKEN no configurado — se omite el envío a Meta'); return resolve(false); }
    if (!orden) { console.log('[capi] sin id de orden — se omite'); return resolve(false); }

    const userData = {};
    if (email) userData.em = [sha256(email)];
    if (phone) { const p = String(phone).replace(/[^0-9]/g, ''); if (p) userData.ph = [sha256(p)]; }
    // Identificador estable por CLIENTE (el RUT, que ya se pide para la boleta),
    // a diferencia del event_id que es por COMPRA.
    if (rut) { const r = String(rut).replace(/[^0-9kK]/g, ''); if (r) userData.external_id = [sha256(r)]; }
    // Nombre, comuna y región: los mismos datos que ya hacen que AddPaymentInfo
    // llegue a 9.3/10 de Event Match Quality. El Purchase ya los recibe del
    // píxel del navegador, pero solo en el 26,7% de las compras (cuando el
    // cliente vuelve a success.html); mandándolos también por la CAPI, que
    // corre en el webhook, la cobertura no depende de que el cliente vuelva.
    if (nombre) {
      const partes = String(nombre).trim().split(/\s+/).filter(Boolean);
      if (partes[0]) userData.fn = [sha256(partes[0])];
      if (partes.length > 1) userData.ln = [sha256(partes.slice(1).join(' '))];
    }
    if (comuna) userData.ct = [sha256Ubicacion(comuna)];
    if (region) userData.st = [sha256Ubicacion(region)];
    userData.country = [sha256('cl')]; // la tienda solo vende en Chile
    // IP y navegador del cliente: van SIN hashear. Mejoran mucho el emparejamiento
    // (Event Match Quality) y la atribución. Se capturan cuando el cliente inicia
    // el pago desde su navegador (no en el webhook, donde la IP es la de la pasarela).
    if (clientIp) userData.client_ip_address = String(clientIp);
    if (clientUa) userData.client_user_agent = String(clientUa);
    // Cookies del píxel de Facebook: emparejan la compra con la sesión que vio el ad.
    if (fbp) userData.fbp = String(fbp);
    if (fbc) userData.fbc = String(fbc);

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
