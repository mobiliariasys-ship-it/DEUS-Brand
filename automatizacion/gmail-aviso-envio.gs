/***********************************************************************
 * DEUS BAND · Aviso automático de envío al cliente
 * ---------------------------------------------------------------------
 * Cuando llega a tu Gmail el correo de ChileExpress o Starken con el
 * número de seguimiento, este script:
 *   1) Lee ese correo oficial.
 *   2) Saca el CORREO del cliente y el N° de seguimiento.
 *   3) Llama al backend, que le envía al cliente el aviso
 *      "Tu DEUS Band ya fue enviada" con su número de orden.
 *   4) Marca el correo con la etiqueta "DEUS-Enviado" para no repetir.
 *
 * Como se envía al CORREO EXACTO que viene en el correo de la
 * transportadora, siempre le llega al cliente correcto.
 *
 * ─────────────────  CÓMO INSTALARLO (una sola vez)  ─────────────────
 * 1. Entra a  https://script.google.com  con tu cuenta de Gmail.
 * 2. "Nuevo proyecto" → borra todo y pega ESTE archivo completo.
 * 3. En CONFIG (abajo) pon tu CLAVE (la misma STOCK_KEY de Render).
 * 4. Guarda. Arriba elige la función "instalar" y presiona ▶ Ejecutar.
 *    (Te pedirá permisos de Gmail: acepta con tu cuenta.)
 *    Eso crea la etiqueta y programa que se revise cada 10 minutos.
 * 5. DEJA MODO_PRUEBA = true la primera vez. Ejecuta "revisarEnvios"
 *    a mano una vez: te llegará a TI un correo mostrando qué correo y
 *    qué N° detectó, sin avisar aún al cliente. Verifica que estén bien.
 * 6. Cuando esté correcto, pon MODO_PRUEBA = false y guarda. Listo:
 *    de ahí en adelante trabaja solo.
 ***********************************************************************/

// ═══════════════════════════  CONFIG  ═══════════════════════════
var CONFIG = {
  // Backend (déjalo así; también sirve https://deusbrand.cl/envio/despachado)
  BACKEND_URL: 'https://deus-band.onrender.com/envio/despachado',

  // MISMA clave que tienes en Render como STOCK_KEY
  CLAVE: 'PON_AQUI_TU_STOCK_KEY',

  // Tu propio correo y dominios de la transportadora: NO se toman como
  // "correo del cliente". Agrega aquí cualquier otro que debas excluir.
  EXCLUIR_CORREOS: [
    'mobiliaria.sys@gmail.com',
    'chilexpress.cl', 'starken.cl', 'bluexpress.cl',
    'noreply', 'no-reply', 'notificaciones', 'mailing', 'info@'
  ],

  // true = solo te avisa a TI lo que detectó (para probar sin enviar).
  // false = envía el aviso real al cliente.
  MODO_PRUEBA: true,

  // Cuántos días hacia atrás revisar (por si el script estuvo apagado).
  DIAS: 7,

  ETIQUETA: 'DEUS-Enviado'
};

// Patrones para encontrar el N° de seguimiento en el cuerpo del correo.
// El primero que calce, gana. Si tu transportadora usa otro formato,
// agrégalo aquí (ver el correo real y copiar cómo nombran el número).
var PATRONES_TRACKING = [
  /(?:orden\s+de\s+transporte|orden\s+de\s+flete|n[°º]?\s*de\s*(?:env[ií]o|orden|seguimiento)|seguimiento|tracking|OT)\s*[:#\-]?\s*([A-Z0-9]{8,16})/i,
  /\b(\d{10,14})\b/ // respaldo: un número largo suelto (ej. OT de Chilexpress)
];

// ═══════════════════════════  LÓGICA  ═══════════════════════════

function instalar() {
  // Crea la etiqueta si no existe
  if (!GmailApp.getUserLabelByName(CONFIG.ETIQUETA)) {
    GmailApp.createLabel(CONFIG.ETIQUETA);
  }
  // Evita duplicar el trigger
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'revisarEnvios') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('revisarEnvios').timeBased().everyMinutes(10).create();
  Logger.log('Instalado: etiqueta "%s" y revisión cada 10 min.', CONFIG.ETIQUETA);
}

function revisarEnvios() {
  var query = 'from:(chilexpress OR starken) newer_than:' + CONFIG.DIAS + 'd -label:' + CONFIG.ETIQUETA;
  var hilos = GmailApp.search(query, 0, 20);
  var label = GmailApp.getUserLabelByName(CONFIG.ETIQUETA) || GmailApp.createLabel(CONFIG.ETIQUETA);

  hilos.forEach(function (hilo) {
    var msgs = hilo.getMessages();
    var msg = msgs[msgs.length - 1]; // el más reciente del hilo
    var cuerpo = msg.getPlainBody() || '';
    var carrier = /starken/i.test(msg.getFrom() + cuerpo) ? 'Starken'
                : /chilexpress/i.test(msg.getFrom() + cuerpo) ? 'Chilexpress'
                : '';

    var email = extraerCorreoCliente(cuerpo);
    var tracking = extraerTracking(cuerpo);

    if (CONFIG.MODO_PRUEBA) {
      GmailApp.sendEmail(Session.getActiveUser().getEmail(),
        '🔎 PRUEBA DEUS — detección de envío',
        'Asunto transportadora: ' + msg.getSubject() +
        '\n\nCorreo del cliente detectado: ' + (email || '(no encontrado)') +
        '\nN° seguimiento detectado: ' + (tracking || '(no encontrado)') +
        '\nTransportadora: ' + (carrier || '(no detectada)') +
        '\n\nSi ambos están correctos, pon MODO_PRUEBA = false y guarda.');
      return; // en prueba NO marca ni envía, para poder repetir
    }

    if (!email || !tracking) {
      Logger.log('Sin datos suficientes (email=%s, tracking=%s). Se omite.', email, tracking);
      return; // no lo etiquetamos: se reintenta cuando llegue un correo más completo
    }

    var ok = enviarAlBackend(email, tracking, carrier);
    if (ok) {
      hilo.addLabel(label); // procesado: no se repite
      Logger.log('Avisado a %s (N° %s).', email, tracking);
    } else {
      Logger.log('Backend no confirmó para %s. Se reintentará luego.', email);
    }
  });
}

function extraerCorreoCliente(texto) {
  var encontrados = texto.match(/[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi) || [];
  for (var i = 0; i < encontrados.length; i++) {
    var e = encontrados[i].toLowerCase();
    var excluido = CONFIG.EXCLUIR_CORREOS.some(function (x) { return e.indexOf(x.toLowerCase()) !== -1; });
    if (!excluido) return encontrados[i];
  }
  return '';
}

function extraerTracking(texto) {
  for (var i = 0; i < PATRONES_TRACKING.length; i++) {
    var m = texto.match(PATRONES_TRACKING[i]);
    if (m && m[1]) return m[1].toUpperCase();
  }
  return '';
}

function enviarAlBackend(email, tracking, carrier) {
  try {
    var resp = UrlFetchApp.fetch(CONFIG.BACKEND_URL, {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ clave: CONFIG.CLAVE, email: email, tracking: tracking, carrier: carrier })
    });
    var code = resp.getResponseCode();
    Logger.log('Backend %s: %s', code, resp.getContentText());
    return code === 200;
  } catch (err) {
    Logger.log('Error llamando al backend: %s', err);
    return false;
  }
}
