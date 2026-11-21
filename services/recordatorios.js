'use strict';
// Recordatorio automático de la ruleta (pedido del dueño, 21-nov-2026): a quien
// no compró, 5 horas después de que se le generó el código (al otro día si se
// generó desde las 20:00), un correo que le recuerda que su código vence y le
// mejora el premio. Y un segundo, el último aviso, unas 6 horas antes de que
// venza (el dueño pidió que fueran dos). Cuándo sale y qué mejora: RECORDATORIO_MS y mejorar() en
// services/ruleta.js; el correo: enviarRecordatorioRuleta() en services/email.js.
//
// Cada 10 minutos el servidor revisa a quién ya le toca y se lo manda, de a uno
// y respetando el límite de Resend (2 por segundo). Dos por persona como máximo.
// Solo a quien no compró: se saca a quien tiene un ticket de compra o un pedido
// pagado con ese correo (aunque no haya usado el código), y se espera a quien
// empezó a pagar hace menos de una hora (puede estar pagando ahora mismo).
// Si Resend se queda sin cuota del día, para y sigue en la próxima vuelta.
// Tope de recordatorios por día (RECORDATORIOS_MAX_DIA, 40 si no está): salen
// por la misma cuenta de Resend que el correo del premio, y en el plan gratis
// (100 al día) no pueden comerse el cupo de los premios. Primero los que vencen antes.
// De 22:00 a 9:00 (hora de Chile) no manda nada. En el plan gratis de Render el
// servidor se duerme sin visitas: lo que se cumpla mientras duerme sale apenas
// despierte, dentro del horario.
const { validarCorreo, enHorarioCorreos } = require('./ruleta');

const VUELTA_MS = 10 * 60 * 1000;
const PRIMERA_MS = 60 * 1000;       // primera vuelta, un minuto después de arrancar
const PAUSA_MS = 600;               // Resend acepta 2 por segundo
const MAX_POR_VUELTA = 30;
const MAX_FALLOS = 3;               // fallos (sin ser cuota) antes de darlo por perdido
const PAGANDO_MS = 60 * 60 * 1000;  // empezó a pagar hace menos que esto → se espera
const PAGADOS = new Set(['approved', 'paid', 'enviado']); // igual que services/promo.js
const MAX_DIA = Number(process.env.RECORDATORIOS_MAX_DIA) > 0 ? Number(process.env.RECORDATORIOS_MAX_DIA) : 40;

// Quiénes ya compraron y quiénes están pagando, por correo normalizado (mismas
// fuentes que el correo 11:11: tickets de compra, pedidos e intentos de pago).
function compradores(f = {}, t = Date.now()) {
  const clave = e => { const v = validarCorreo(e); return v.ok ? v.clave : null; };
  const compraron = new Set(), pagando = new Set();
  for (const e of f.correosCompradores || []) { const k = clave(e); if (k) compraron.add(k); }
  for (const p of f.pedidos || []) {
    const k = clave(p && p.customer && p.customer.email);
    if (!k) continue;
    if (PAGADOS.has(p.status)) compraron.add(k);
    else if (Date.parse(p.created_at) > t - PAGANDO_MS) pagando.add(k);
  }
  for (const i of f.intentos || []) {
    const k = clave(i && i.email);
    if (k && Date.parse(i.fecha) > t - PAGANDO_MS) pagando.add(k);
  }
  return { compraron, pagando };
}

function esCuota(r) { return /quota/i.test(String(r && r.cuerpo || '')); }

// ruleta: ruleta.servicio() · enviar: email.enviarRecordatorioRuleta ·
// fuentes: () => Promise<{ correosCompradores, pedidos, intentos }>
function crearRecordatorios({ ruleta, enviar, fuentes, ahora = () => Date.now(), esperar = ms => new Promise(r => setTimeout(r, ms)), maxDia = MAX_DIA }) {
  let corriendo = null;
  const ultimo = { vuelta: null, enviados: 0, motivo: null, totalEnviados: 0 };

  async function vuelta() {
    const t = ahora();
    if (!enHorarioCorreos(t)) return { enviados: 0, motivo: 'fuera de horario' };
    const pendientes = (await ruleta.pendientesRecordatorio()).sort((a, b) => a.vence - b.vence);
    if (!pendientes.length) return { enviados: 0, motivo: null };
    let cupo = maxDia - await ruleta.recordatoriosHoy();
    if (cupo <= 0) return { enviados: 0, motivo: 'tope de ' + maxDia + ' recordatorios por día: sigue mañana' };
    const { compraron, pagando } = compradores(await fuentes(), t);
    let enviados = 0;
    for (const p of pendientes.slice(0, MAX_POR_VUELTA)) {
      if (cupo <= 0) return { enviados, motivo: 'tope de ' + maxDia + ' recordatorios por día: sigue mañana' };
      if (compraron.has(p.clave)) { await ruleta.marcarRecordatorio(p.codigo, 'compro', p.vez); continue; }
      if (pagando.has(p.clave)) continue;
      const datos = await ruleta.prepararRecordatorio(p.codigo, p.vez);
      if (!datos) continue;
      let r;
      try {
        r = await enviar(datos);
        if (!r.ok && r.status === 429 && !esCuota(r)) { await esperar(2000); r = await enviar(datos); }
      } catch (e) {
        r = { ok: false, status: 0, cuerpo: e.message };
      }
      if (r.ok) { await ruleta.marcarRecordatorio(p.codigo, 'enviado', p.vez); enviados++; cupo--; }
      else if (esCuota(r)) return { enviados, motivo: 'Resend llegó a su límite de correos del día: sigue en la próxima vuelta' };
      else await ruleta.falloRecordatorio(p.codigo, MAX_FALLOS, p.vez);
      await esperar(PAUSA_MS);
    }
    return { enviados, motivo: null };
  }

  // Una vuelta a la vez: si la anterior sigue mandando, se espera esa.
  function revisar() {
    if (!corriendo) {
      corriendo = vuelta()
        .then(r => {
          Object.assign(ultimo, r, { vuelta: new Date(ahora()).toISOString() });
          ultimo.totalEnviados += r.enviados;
          if (r.enviados) console.log('[recordatorio] enviados:', r.enviados);
          return r;
        })
        .catch(e => { console.error('[recordatorio]', e.message); return { enviados: 0, motivo: e.message }; })
        .finally(() => { corriendo = null; });
    }
    return corriendo;
  }

  return { revisar, estado: () => ({ ...ultimo }) };
}

// Lo arranca server.js después de cargar los datos.
function iniciar({ fuentes }) {
  const ruleta = require('./ruleta').servicio();
  const { enviarRecordatorioRuleta } = require('./email');
  const r = crearRecordatorios({ ruleta, enviar: enviarRecordatorioRuleta, fuentes });
  setTimeout(() => r.revisar(), PRIMERA_MS).unref();
  setInterval(() => r.revisar(), VUELTA_MS).unref();
  return r;
}

module.exports = { crearRecordatorios, compradores, iniciar, PAGANDO_MS, MAX_FALLOS, MAX_DIA };
