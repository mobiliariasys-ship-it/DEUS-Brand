// Almacenamiento de atletas, equipos y sus datos diarios.
//
// Es la capa que va DESPUÉS del Bluetooth: la página lee la banda, manda acá
// los días que traía guardados, y esto los acumula para que readiness.js pueda
// calcular líneas base y tendencias. La banda guarda varios días en su propia
// memoria, así que no hace falta sincronizar todos los días — con conectarse
// cada 2 o 3 días el historial queda completo igual.
//
// Persistencia: usa persist.js, o sea Postgres si hay DATABASE_URL y archivo
// local si no (mismo criterio que metrics.js y el resto del proyecto).
//
// Modelo:
//   equipos[idEquipo] = { id, nombre, deporte, clave, creado }
//   atletas[idAtleta] = { id, nombre, idEquipo, deporte, token, creado }
//   dias[idAtleta]['YYYY-MM-DD'] = { suenoHoras, pulsoReposo, hrv, carga, origen }
//
// Los días se guardan por fecha, así que re-sincronizar la misma banda no
// duplica nada: sobrescribe el día con el dato más completo.

'use strict';
const crypto = require('crypto');
const persist = require('./persist');
const { evaluarAtleta, evaluarEquipo } = require('./readiness');

const ARCHIVO = 'atletas-data.json';
const DIAS_MAX_HISTORIAL = 120;  // cuánto se conserva por atleta
const DIAS_MAX_POR_SYNC  = 60;   // tope por request, para que nadie infle la base
const ANTIGUEDAD_MAX     = 400;  // días hacia atrás aceptados

let equipos = {};
let atletas = {};
let dias = {};
let guardadoPendiente = null;

// ── Validación ───────────────────────────────────────────────────────────
// Todo lo que llega del navegador es sospechoso: un endpoint público que
// escribe en la base sin validar es una invitación a que se la llenen de basura.
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function limpiarTexto(v, max = 60) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function numeroEnRango(v, min, max) {
  const n = Number(v);
  return (typeof v !== 'undefined' && v !== null && Number.isFinite(n) && n >= min && n <= max)
    ? n : undefined;
}

function fechaValida(f) {
  if (!RE_FECHA.test(f || '')) return null;
  const t = Date.parse(f + 'T12:00:00Z');
  if (Number.isNaN(t)) return null;
  const hoy = Date.now();
  if (t > hoy + 36 * 3600 * 1000) return null;                     // no acepta futuro
  if (t < hoy - ANTIGUEDAD_MAX * 86400000) return null;            // ni prehistoria
  return f;
}

// Deja un registro diario en forma canónica, descartando lo que no sirve.
function normalizarDia(d) {
  const fecha = fechaValida(d && d.fecha);
  if (!fecha) return null;
  const reg = { fecha };
  const sueno  = numeroEnRango(d.suenoHoras, 0, 24);
  const pulso  = numeroEnRango(d.pulsoReposo, 25, 220);
  const hrv    = numeroEnRango(d.hrv, 1, 300);
  const carga  = numeroEnRango(d.carga, 0, 2000);
  if (sueno !== undefined) reg.suenoHoras  = sueno;
  if (pulso !== undefined) reg.pulsoReposo = pulso;
  if (hrv   !== undefined) reg.hrv         = hrv;
  if (carga !== undefined) reg.carga       = carga;
  // Un día sin ninguna métrica no aporta nada
  if (Object.keys(reg).length === 1) return null;
  reg.origen = limpiarTexto(d.origen, 20) || 'banda';
  return reg;
}

// ── Persistencia ─────────────────────────────────────────────────────────
async function init() {
  const g = await persist.load(ARCHIVO, {});
  equipos = g.equipos || {};
  atletas = g.atletas || {};
  dias    = g.dias    || {};
  const nAtletas = Object.keys(atletas).length;
  if (nAtletas) console.log(`[atletas] ${Object.keys(equipos).length} equipo(s), ${nAtletas} atleta(s).`);
}

// Se agrupan las escrituras: una sincronización de plantel completo dispara 25
// guardados seguidos y no tiene sentido pegarle a la base 25 veces.
function guardar() {
  if (guardadoPendiente) return;
  guardadoPendiente = setTimeout(() => {
    guardadoPendiente = null;
    persist.save(ARCHIVO, { equipos, atletas, dias })
      .catch(e => console.error('[atletas] Error guardando:', e.message));
  }, 800);
  if (guardadoPendiente.unref) guardadoPendiente.unref();
}

const nuevoId    = () => crypto.randomBytes(6).toString('hex');
const nuevoToken = () => crypto.randomBytes(16).toString('hex');

// ── Equipos ──────────────────────────────────────────────────────────────
function crearEquipo({ nombre, deporte }) {
  const id = nuevoId();
  equipos[id] = {
    id,
    nombre: limpiarTexto(nombre, 60) || 'Equipo',
    deporte: limpiarTexto(deporte, 20) || 'general',
    clave: nuevoToken(),
    creado: new Date().toISOString()
  };
  guardar();
  return equipos[id];
}

function equipoPorClave(idEquipo, clave) {
  const e = equipos[idEquipo];
  if (!e || !clave) return null;
  // Comparación de tiempo constante: evita distinguir claves por cuánto tarda
  const a = Buffer.from(String(clave));
  const b = Buffer.from(e.clave);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return e;
}

function listarEquipos() {
  return Object.values(equipos).map(e => ({
    id: e.id, nombre: e.nombre, deporte: e.deporte, creado: e.creado,
    atletas: Object.values(atletas).filter(a => a.idEquipo === e.id).length
  }));
}

// ── Atletas ──────────────────────────────────────────────────────────────
function crearAtleta({ nombre, idEquipo, deporte }) {
  const eq = equipos[idEquipo];
  const id = nuevoId();
  atletas[id] = {
    id,
    nombre: limpiarTexto(nombre, 60) || 'Atleta',
    idEquipo: eq ? idEquipo : null,
    deporte: limpiarTexto(deporte, 20) || (eq ? eq.deporte : 'general'),
    token: nuevoToken(),
    creado: new Date().toISOString()
  };
  guardar();
  return atletas[id];
}

function atletaPorToken(token) {
  if (!token) return null;
  return Object.values(atletas).find(a => a.token === token) || null;
}

function borrarAtleta(id) {
  if (!atletas[id]) return false;
  delete atletas[id];
  delete dias[id];
  guardar();
  return true;
}

// ── Datos diarios ────────────────────────────────────────────────────────
/**
 * Guarda los días que trajo la banda. Idempotente: sincronizar dos veces el
 * mismo día no duplica, actualiza. Los campos nuevos se fusionan con los ya
 * guardados, así una sincronización parcial no borra lo que había.
 * @returns {{guardados:number, descartados:number}}
 */
function guardarDias(idAtleta, lista) {
  if (!atletas[idAtleta]) return { guardados: 0, descartados: 0, error: 'atleta desconocido' };
  const entrantes = Array.isArray(lista) ? lista.slice(0, DIAS_MAX_POR_SYNC) : [];
  if (!dias[idAtleta]) dias[idAtleta] = {};

  let guardados = 0, descartados = 0;
  for (const bruto of entrantes) {
    const reg = normalizarDia(bruto);
    if (!reg) { descartados++; continue; }
    const { fecha, ...datos } = reg;
    dias[idAtleta][fecha] = { ...(dias[idAtleta][fecha] || {}), ...datos, actualizado: new Date().toISOString() };
    guardados++;
  }

  // Poda: conservar solo las fechas más recientes
  const fechas = Object.keys(dias[idAtleta]).sort();
  if (fechas.length > DIAS_MAX_HISTORIAL) {
    fechas.slice(0, fechas.length - DIAS_MAX_HISTORIAL).forEach(f => delete dias[idAtleta][f]);
  }

  if (guardados) guardar();
  return { guardados, descartados, total: Object.keys(dias[idAtleta]).length };
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

// Arma la estructura que espera readiness.js: el día pedido como "hoy" y todo
// lo anterior, en orden, como historial.
function construirEntrada(idAtleta, fecha = hoyISO()) {
  const a = atletas[idAtleta];
  if (!a) return null;
  const porFecha = dias[idAtleta] || {};
  const anteriores = Object.keys(porFecha).filter(f => f < fecha).sort();
  const { actualizado, origen, ...hoy } = porFecha[fecha] || {};
  return {
    nombre: a.nombre,
    deporte: a.deporte,
    hoy,
    historial: anteriores.map(f => {
      const { actualizado: _a, origen: _o, ...d } = porFecha[f];
      return { fecha: f, ...d };
    })
  };
}

function evaluar(idAtleta, fecha) {
  const entrada = construirEntrada(idAtleta, fecha);
  if (!entrada) return null;
  return { id: idAtleta, ...evaluarAtleta(entrada) };
}

function panelEquipo(idEquipo, fecha) {
  const eq = equipos[idEquipo];
  if (!eq) return null;
  const delEquipo = Object.values(atletas).filter(a => a.idEquipo === idEquipo);
  const entradas = delEquipo.map(a => construirEntrada(a.id, fecha)).filter(Boolean);
  const panel = evaluarEquipo(entradas, { nombreEquipo: eq.nombre });
  // Reponer los ids, que evaluarEquipo no conoce
  panel.jugadores = panel.jugadores.map((j, i) => ({ ...j, id: delEquipo[i] && delEquipo[i].id }));
  if (fecha) panel.fecha = fecha;
  return panel;
}

// Última sincronización de cada atleta: le dice al entrenador quién no conectó
// la banda, que en la práctica es el problema operativo más común.
function estadoSincronizacion(idEquipo) {
  return Object.values(atletas)
    .filter(a => a.idEquipo === idEquipo)
    .map(a => {
      const fechas = Object.keys(dias[a.id] || {}).sort();
      const ultima = fechas[fechas.length - 1] || null;
      const diasSin = ultima
        ? Math.floor((Date.parse(hoyISO()) - Date.parse(ultima)) / 86400000)
        : null;
      return { id: a.id, nombre: a.nombre, ultimaFecha: ultima, diasSinSincronizar: diasSin };
    });
}

module.exports = {
  init,
  crearEquipo, equipoPorClave, listarEquipos,
  crearAtleta, atletaPorToken, borrarAtleta,
  guardarDias, evaluar, panelEquipo, estadoSincronizacion,
  construirEntrada,
  _internos: { normalizarDia, fechaValida, numeroEnRango },
  _estado: () => ({ equipos, atletas, dias }),
  _reset: () => { equipos = {}; atletas = {}; dias = {}; }
};
