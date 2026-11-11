'use strict';
// Correo "11:11" (pedido del dueño, 11-nov-2026): a quien dejó su correo en la
// web y no compró se le manda un 10% OFF que dura 24 horas desde que le llega.
//
// A quién: los correos de la ruleta "Gira y gana" y los de los pedidos de
// Mercado Pago que quedaron sin pagar. Los pedidos de Flow y Webpay sin pagar
// viven solo en memoria (se pierden con cada reinicio de Render), así que no
// entran. Se saca a todo el que compró (tickets de compra, códigos de la
// ruleta ya usados, pedidos pagados) y a quien ya recibió este correo.
//
// Cada persona recibe SU código (10% OFF, un solo uso, solo con su correo),
// hecho con ruleta.generar(): el cobro lo valida el mismo camino que ya usan
// las tres pasarelas, y el código no le quita el giro de la ruleta a nadie.
//
// Lo dispara el dueño desde el panel: primero ve cuántos son y después envía.
// El envío corre en segundo plano, de a uno y respetando el límite de Resend
// (2 por segundo). Si Resend dice que se acabó la cuota del día, se detiene:
// lo que faltó se puede mandar después, sin repetirle el correo a nadie.
const { validarCorreo } = require('./ruleta');

const CAMPANA = '11.11';
const PREMIO = 'p10';
const VIGENCIA_MS = 24 * 60 * 60 * 1000;
const ARCHIVO = 'promo-1111.json';
const PAUSA_MS = 600;            // Resend acepta 2 por segundo
const MAX_FALLOS_SEGUIDOS = 3;   // sin Resend no se siguen generando códigos
const PAGADOS = new Set(['approved', 'paid', 'enviado']);
// Los pedidos de Mercado Pago NO cambian a pagado cuando se pagan (quedan
// 'pending' hasta que se despachan): al comprador se lo reconoce por su ticket
// de compra, que existe para toda venta web desde agosto de 2026. Un pedido
// sin pagar más viejo que eso no entra, porque ahí no hay cómo saber si
// después compró.
const CHECKOUT_DESDE = Date.parse('2026-08-05T00:00:00Z');

// "María José  Pérez" y "maria jose perez" son el mismo nombre. Solo cuentan
// nombres de dos palabras o más: un "Juan" suelto no identifica a nadie.
function nombreClave(n) {
  const t = String(n || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-zñ ]/g, ' ').replace(/\s+/g, ' ').trim();
  return t.split(' ').length >= 2 ? t : '';
}

// Quiénes reciben el correo, del que dejó su correo más reciente al más viejo.
//  personasRuleta: ruleta.lista()  ·  pedidos: los de server.js
//  correosCompradores / nombresCompradores: de los tickets de compra (uno por
//    venta pagada). El nombre saca a quien pagó con OTRO correo que el del
//    pedido que dejó a medias.
//  yaEnviados: claves (correo normalizado) que ya recibieron este correo
function audiencia({ personasRuleta = [], pedidos = [], correosCompradores = [], nombresCompradores = [], yaEnviados = new Set() } = {}) {
  const clave = e => { const v = validarCorreo(e); return v.ok ? v : null; };
  const nombresQueCompraron = new Set(nombresCompradores.map(nombreClave).filter(Boolean));
  const compraron = new Set();
  for (const e of correosCompradores) { const v = clave(e); if (v) compraron.add(v.clave); }
  for (const p of personasRuleta) if (p.estado === 'usado') { const v = clave(p.email); if (v) compraron.add(v.clave); }
  for (const p of pedidos) if (PAGADOS.has(p && p.status)) { const v = clave(p.customer && p.customer.email); if (v) compraron.add(v.clave); }

  const por = new Map();
  const sumar = (email, fecha, origen) => {
    const v = clave(email);
    if (!v || compraron.has(v.clave) || yaEnviados.has(v.clave)) return;
    const f = fecha ? new Date(fecha).getTime() || 0 : 0;
    const prev = por.get(v.clave);
    if (!prev) por.set(v.clave, { email: v.envio, clave: v.clave, fecha: f, origenes: new Set([origen]) });
    else { prev.origenes.add(origen); if (f > prev.fecha) { prev.fecha = f; prev.email = v.envio; } }
  };
  for (const p of personasRuleta) if (!p.manual && p.email) sumar(p.email, p.fecha, 'ruleta');
  for (const p of pedidos) {
    if (!p || PAGADOS.has(p.status)) continue;
    const f = Date.parse(p.created_at);
    if (!(f >= CHECKOUT_DESDE)) continue;
    const n = nombreClave(p.customer && p.customer.name);
    if (n && nombresQueCompraron.has(n)) continue;
    sumar(p.customer && p.customer.email, p.created_at, 'checkout');
  }

  return [...por.values()]
    .sort((a, b) => b.fecha - a.fecha)
    .map(p => ({ email: p.email, clave: p.clave, fecha: p.fecha ? new Date(p.fecha).toISOString() : null, origenes: [...p.origenes] }));
}

function esCuota(r) { return /quota/i.test(String(r && r.cuerpo || '')); }

// load/save: persist.js · ruleta: ruleta.servicio() · enviar: email.enviarPromo1111
function crearCampana({ load, save, ruleta, enviar, ahora = () => Date.now(), esperar = ms => new Promise(r => setTimeout(r, ms)) }) {
  let estado = null;
  let trabajo = null;

  async function cargar() {
    if (!estado) {
      const g = await Promise.resolve(load(ARCHIVO, null));
      estado = (g && g.enviados) ? g : { enviados: {} };
    }
    return estado;
  }
  const guardar = () => Promise.resolve(save(ARCHIVO, estado)).catch(e => console.error('[promo] Error guardando:', e.message));

  function publico() {
    const yaRecibieron = estado ? Object.keys(estado.enviados).length : 0;
    if (!trabajo) return { estado: 'sin-envio', yaRecibieron };
    // totalEnvio: a cuántos iba el envío en curso (el `total` de la vista
    // previa es otra cosa: a cuántos les llegaría ahora).
    const { total: totalEnvio, enviados, fallidos, motivo, inicio, fin } = trabajo;
    return { estado: trabajo.estado, totalEnvio, enviados, fallidos, motivo, inicio, fin, yaRecibieron };
  }

  async function vistaPrevia(fuentes) {
    await cargar();
    const lista = audiencia({ ...fuentes, yaEnviados: new Set(Object.keys(estado.enviados)) });
    const porOrigen = { ruleta: 0, checkout: 0 };
    for (const p of lista) for (const o of p.origenes) porOrigen[o]++;
    return { ...publico(), total: lista.length, porOrigen };
  }

  async function correr(cola) {
    let seguidos = 0;
    for (const p of cola) {
      let r;
      try {
        const c = await ruleta.generar(PREMIO, { email: p.email, vigenciaMs: VIGENCIA_MS, campana: CAMPANA });
        r = await enviar({ email: p.email, codigo: c.codigo, vence: c.vence });
        if (!r.ok && r.status === 429 && !esCuota(r)) { await esperar(2000); r = await enviar({ email: p.email, codigo: c.codigo, vence: c.vence }); }
        if (r.ok) {
          estado.enviados[p.clave] = { fecha: new Date(ahora()).toISOString(), codigo: c.codigo };
          trabajo.enviados++;
          seguidos = 0;
          await guardar();
        }
      } catch (e) {
        r = { ok: false, status: 0, cuerpo: e.message };
      }
      if (!r.ok) {
        trabajo.fallidos++;
        seguidos++;
        if (esCuota(r)) { trabajo.estado = 'detenido'; trabajo.motivo = 'Resend llegó a su límite de correos. Lo que faltó se puede mandar más tarde.'; break; }
        if (seguidos >= MAX_FALLOS_SEGUIDOS) { trabajo.estado = 'detenido'; trabajo.motivo = 'Resend no está enviando (' + (r.status || 'sin respuesta') + '): ' + String(r.cuerpo || '').slice(0, 140); break; }
      }
      await esperar(PAUSA_MS);
    }
    if (trabajo.estado === 'enviando') trabajo.estado = 'listo';
    trabajo.fin = new Date(ahora()).toISOString();
    console.log('[promo] 11:11 terminado:', JSON.stringify(publico()));
  }

  // Arranca el envío en segundo plano. maximo: tope opcional de correos.
  async function iniciar(fuentes, { maximo } = {}) {
    await cargar();
    if (trabajo && trabajo.estado === 'enviando') return publico();
    const lista = audiencia({ ...fuentes, yaEnviados: new Set(Object.keys(estado.enviados)) });
    const tope = parseInt(maximo, 10);
    const cola = tope > 0 ? lista.slice(0, tope) : lista;
    trabajo = { estado: 'enviando', total: cola.length, enviados: 0, fallidos: 0, motivo: null, inicio: new Date(ahora()).toISOString(), fin: null };
    trabajo.listo = correr(cola).catch(e => { trabajo.estado = 'detenido'; trabajo.motivo = e.message; });
    return publico();
  }

  async function estadoActual() { await cargar(); return publico(); }
  // Solo para los tests: espera a que termine el envío en curso.
  function terminado() { return trabajo ? trabajo.listo : Promise.resolve(); }

  return { vistaPrevia, iniciar, estado: estadoActual, terminado };
}

let instancia = null;
function campana() {
  if (!instancia) {
    const persist = require('./persist');
    const ruleta = require('./ruleta').servicio();
    const { enviarPromo1111 } = require('./email');
    instancia = crearCampana({ load: persist.load, save: persist.save, ruleta, enviar: enviarPromo1111 });
  }
  return instancia;
}

module.exports = { audiencia, crearCampana, campana, CAMPANA, PREMIO, VIGENCIA_MS };
