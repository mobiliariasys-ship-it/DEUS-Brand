'use strict';
// Aviso de venta por Web Push: la notificación llega al PC (o al celular)
// aunque el panel esté CERRADO, mientras el navegador esté corriendo. En
// Windows, Chrome y Edge siguen en segundo plano al cerrar la ventana (viene
// así por defecto), así que basta con tener el PC prendido.
//
// Cómo funciona: el panel pide permiso, registra /sw-avisos.js y le manda al
// servidor su "suscripción" (una dirección del servicio de push del navegador).
// Cuando entra una venta, el servidor le manda el aviso a cada suscripción.
//
// Las llaves VAPID (las que firman los avisos) se generan solas la primera vez
// y se guardan con persist (Postgres), así no hay que configurar nada en
// Render. Si alguna vez se perdieran, basta con volver a abrir el panel: se
// vuelve a suscribir solo.
const webpush = require('web-push');
const persist = require('./persist');

const KEY = 'avisos-push.json';
const MAX_SUBS = 10;            // PC, notebook, celular… con margen
const TTL_SEG = 6 * 3600;       // con el navegador cerrado, el aviso espera hasta 6 h
const SUJETO = 'https://deusbrand.cl';

let estado = null;   // { vapid: { publicKey, privateKey }, subs: [...] }
let cargando = null;

async function cargar() {
  if (estado) return estado;
  if (!cargando) {
    cargando = (async () => {
      const d = await persist.load(KEY, null);
      let e = (d && d.vapid && d.vapid.publicKey && d.vapid.privateKey) ? d : null;
      if (!e) {
        e = { vapid: webpush.generateVAPIDKeys(), subs: [] };
        await persist.save(KEY, e);
      }
      if (!Array.isArray(e.subs)) e.subs = [];
      estado = e;
      return e;
    })().finally(() => { cargando = null; });
  }
  return cargando;
}

async function clavePublica() {
  return (await cargar()).vapid.publicKey;
}

// Solo se aceptan suscripciones con la forma que arma el navegador. El
// endpoint tiene que ser https: es la dirección a la que el servidor le va a
// hacer POST, y no puede apuntar a cualquier lado.
function validar(sub) {
  return !!(sub && typeof sub.endpoint === 'string' && /^https:\/\/[^\s]+$/.test(sub.endpoint) &&
    sub.endpoint.length < 1000 && sub.keys && typeof sub.keys.p256dh === 'string' &&
    typeof sub.keys.auth === 'string' && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100);
}

async function suscribir(sub) {
  if (!validar(sub)) throw new Error('Suscripción inválida');
  const e = await cargar();
  e.subs = e.subs.filter(s => s.endpoint !== sub.endpoint);
  e.subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, desde: new Date().toISOString() });
  if (e.subs.length > MAX_SUBS) e.subs = e.subs.slice(-MAX_SUBS);
  await persist.save(KEY, e);
  return e.subs.length;
}

async function desuscribir(endpoint) {
  const e = await cargar();
  const antes = e.subs.length;
  e.subs = e.subs.filter(s => s.endpoint !== endpoint);
  if (e.subs.length !== antes) await persist.save(KEY, e);
  return e.subs.length;
}

// Manda el aviso a todas las suscripciones. Las que el servicio de push da
// por muertas (404/410: el navegador se desinstaló o se revocó el permiso) se
// borran; cualquier otro error solo se anota y se reintenta en la próxima venta.
async function enviar(aviso) {
  const e = await cargar();
  if (!e.subs.length) return { enviados: 0, suscripciones: 0 };
  const opciones = {
    vapidDetails: { subject: SUJETO, publicKey: e.vapid.publicKey, privateKey: e.vapid.privateKey },
    TTL: TTL_SEG,
    urgency: 'high'
  };
  const cuerpo = JSON.stringify(aviso);
  const muertas = [];
  let enviados = 0;
  await Promise.all(e.subs.map(async s => {
    try {
      await webpush.sendNotification(s, cuerpo, opciones);
      enviados++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) muertas.push(s.endpoint);
      else console.error('[avisos-push] no se pudo enviar:', (err && err.statusCode) || '', err && err.message);
    }
  }));
  if (muertas.length) {
    e.subs = e.subs.filter(s => !muertas.includes(s.endpoint));
    await persist.save(KEY, e);
  }
  return { enviados, suscripciones: e.subs.length };
}

function plata(n) {
  return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL');
}

// Mismo texto que arma el panel cuando lo ve por su cuenta, y la misma
// etiqueta (tag): si el panel está abierto y también avisa, el segundo aviso
// reemplaza al primero en vez de duplicarlo.
function textoVenta(v, resumen) {
  const total = resumen && resumen.total ? resumen.total.count : 0;
  const hoy = (resumen && resumen.hoy) || { count: 0, monto: 0 };
  const que = v.soloTapones ? 'Tapones'
    : ((v.unidades > 1 ? v.unidades + ' bandas' : '1 banda') + (v.tapones ? ' + tapones' : '') + (v.correas ? ' + correas' : ''));
  const nombre = String(v.nombre || '').trim().split(/\s+/)[0];
  return {
    tipo: 'venta',
    total,
    title: '💰 Nueva venta · ' + plata(v.monto),
    body: [que, v.metodo, nombre].filter(Boolean).join(' · ') + '\n' +
      'Hoy llevas ' + hoy.count + (hoy.count === 1 ? ' venta' : ' ventas') + ' · ' + plata(hoy.monto),
    tag: 'deus-venta-' + total
  };
}

// Para tests: vuelve a leer del almacén.
function _reiniciar() { estado = null; cargando = null; }

module.exports = { clavePublica, suscribir, desuscribir, enviar, textoVenta, validar, _reiniciar };
