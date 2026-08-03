// Registro de las conversaciones del chatbot, para que el dueño vea TODO lo que
// le preguntan al bot: se guardan en disco (o Postgres, vía persist) y se leen
// desde el panel de administración.
//
// Además avisa por correo cuando una conversación merece atención humana, para
// no tener que estar mirando el panel.
//
// Variables de entorno en Render:
//   CHAT_AVISO_CORREO = 'todas' avisa de cada conversación nueva;
//                       'ninguna' no avisa;
//                       por defecto ('rescate') avisa solo cuando el cliente
//                       pide hablar con una persona o el bot no supo responder.
const persist = require('./persist');
const { enviarCorreo } = require('./email');

const ARCHIVO = 'chats.json';
const MAX_CONVERSACIONES = 500;   // se conservan las más recientes
const ESPERA_AVISO_MS = 3 * 60 * 1000; // agrupa la conversación antes de avisar

let conversaciones = [];
let cargado = false;
const avisosPendientes = new Map(); // id -> timeout

async function cargar() {
  if (cargado) return;
  conversaciones = await persist.load(ARCHIVO, []);
  if (!Array.isArray(conversaciones)) conversaciones = [];
  cargado = true;
}

function guardar() {
  persist.save(ARCHIVO, conversaciones).catch(e => console.error('[chat-log] Error guardando:', e.message));
}

/** Guarda un turno (pregunta del cliente + respuesta del bot). */
async function registrar({ id, pregunta, respuesta, ip, ua, ruta }) {
  await cargar();
  let conv = conversaciones.find(c => c.id === id);
  if (!conv) {
    conv = {
      id,
      inicio: new Date().toISOString(),
      ip: (ip || '').slice(0, 45),
      ua: (ua || '').slice(0, 200),
      ruta: (ruta || '').slice(0, 200),
      escalado: false,
      turnos: []
    };
    conversaciones.unshift(conv);
    if (conversaciones.length > MAX_CONVERSACIONES) conversaciones.length = MAX_CONVERSACIONES;
  }
  conv.ultimo = new Date().toISOString();
  conv.turnos.push({
    t: new Date().toISOString(),
    q: String(pregunta || '').slice(0, 1000),
    a: String(respuesta || '').slice(0, 2000)
  });
  guardar();
  return conv;
}

/** Marca que el cliente pidió hablar con una persona (apretó el botón). */
async function marcarEscalado(id) {
  await cargar();
  const conv = conversaciones.find(c => c.id === id);
  if (!conv) return null;
  conv.escalado = true;
  conv.ultimo = new Date().toISOString();
  guardar();
  programarAviso(conv, true);
  return conv;
}

function transcripcionHtml(conv) {
  const filas = conv.turnos.map(t => `
    <div style="margin-bottom:14px;">
      <div style="color:#111;font-weight:600;font-size:14px;">🙋 ${escapar(t.q)}</div>
      <div style="color:#555;font-size:14px;margin-top:4px;">🤖 ${escapar(t.a)}</div>
    </div>`).join('');
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;">
      <h2 style="font-size:18px;margin-bottom:4px;">${conv.escalado ? '🔔 Un cliente pidió hablar contigo' : '💬 Conversación en el chat'}</h2>
      <p style="color:#777;font-size:12px;margin-top:0;">
        ${conv.turnos.length} mensaje(s) · empezó ${new Date(conv.inicio).toLocaleString('es-CL')}
        ${conv.ruta ? `<br>Página: ${escapar(conv.ruta)}` : ''}
      </p>
      <hr style="border:none;border-top:1px solid #ddd;">
      ${filas}
      <hr style="border:none;border-top:1px solid #ddd;">
      <p style="color:#777;font-size:12px;">Ves todas las conversaciones en el panel de administración, sección “Chat”.</p>
    </div>`;
}

function escapar(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Agrupa: espera unos minutos de silencio antes de mandar el correo, para que
// llegue la conversación completa y no un correo por cada mensaje.
function programarAviso(conv, urgente) {
  const modo = (process.env.CHAT_AVISO_CORREO || 'rescate').trim().toLowerCase();
  if (modo === 'ninguna') return;
  if (modo !== 'todas' && !urgente && !conv.escalado) return;

  const previo = avisosPendientes.get(conv.id);
  if (previo) clearTimeout(previo);

  const espera = urgente ? 5000 : ESPERA_AVISO_MS;
  const timer = setTimeout(() => {
    avisosPendientes.delete(conv.id);
    const asunto = conv.escalado
      ? '🔔 Un cliente quiere hablar contigo — DEUS'
      : `💬 Conversación en el chat (${conv.turnos.length} mensajes) — DEUS`;
    enviarCorreo(asunto, transcripcionHtml(conv)).catch(e => console.error('[chat-log] Aviso:', e.message));
  }, espera);
  timer.unref();
  avisosPendientes.set(conv.id, timer);
}

/** Últimas conversaciones, para el panel. */
async function listar(limite = 100) {
  await cargar();
  return conversaciones.slice(0, limite);
}

module.exports = { registrar, marcarEscalado, programarAviso, listar };
