// Devoluciones pagadas a clientes: plata que SALIÓ de la cuenta para devolverle
// una compra a alguien. La utilidad por mes del panel las resta.
//
// Salen de dos lados:
//  1. La cartola de la cuenta corriente (Banco Falabella) que el dueño sube
//     cada mes. De ahí se identifican las transferencias que son devoluciones
//     y se anotan en services/datos/devoluciones-*.json: SOLO fecha y monto.
//     Sin nombres ni datos de la cuenta — este repositorio es público. El
//     detalle con nombres vive en la página privada de la cartola del dueño
//     (se cruza por fecha y monto).
//  2. Las que el dueño agrega a mano en el panel, para el mes en curso o para
//     un mes cuya cartola todavía no sube. Van al almacén (Postgres/archivo).
//
// La cartola manda. Cuando llega la cartola de un mes, una devolución cargada
// a mano que calza con una de la cartola (mismo monto, hasta 10 días de
// diferencia) deja de contarse: si no, se restaría dos veces. No se borra
// sola: el panel la muestra como "ya está en la cartola" para que la quite.
//
// Para que una devolución NUEVA no se confunda con una vieja del mismo monto
// (los montos se repiten: casi todas son $68.990), el calce solo vale si la
// cartola del mes de la cargada a mano ya está revisada, o si el banco la
// registró el mismo día o después de la fecha que anotó el dueño. Una de
// noviembre cargada a mano nunca calza con una de la cartola de octubre.
const fs = require('fs');
const path = require('path');

const ARCHIVO = 'devoluciones.json';
const DIR_CARTOLAS = path.join(__dirname, 'datos');
const DIAS_CALCE = 10;
const MONTO_MIN = 1000;
const MONTO_MAX = 2000000;

function fechaValida(f) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(f))) return false;
  const d = new Date(f + 'T12:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === f;   // descarta 2026-02-31
}
const diasEntre = (a, b) => Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / 86400000;

// Lee services/datos/devoluciones-*.json → { meses, devoluciones }.
// `meses` son los meses cuya cartola ya se revisó (aunque no tengan ninguna
// devolución): sirve para que el panel distinga "no hubo" de "falta la cartola".
function leerCartolas(dir = DIR_CARTOLAS) {
  const meses = new Set(), devoluciones = [];
  let archivos = [];
  try { archivos = fs.readdirSync(dir).filter(f => /^devoluciones-.*\.json$/.test(f)).sort(); } catch (e) { return { meses: [], devoluciones }; }
  for (const f of archivos) {
    let d;
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
    catch (e) { console.error('[devoluciones] No se pudo leer', f + ':', e.message); continue; }
    for (const m of d.mesesRevisados || []) if (/^\d{4}-\d{2}$/.test(m)) meses.add(m);
    for (const x of d.devoluciones || []) {
      const monto = Math.round(Number(x.monto));
      if (!fechaValida(x.fecha) || !(monto > 0)) continue;
      devoluciones.push({
        id: 'cartola-' + x.fecha + '-' + monto + '-' + devoluciones.length,
        fecha: x.fecha, monto, nota: String(x.nota || '').slice(0, 120), origen: 'cartola'
      });
    }
  }
  return { meses: [...meses].sort(), devoluciones };
}

function crearServicio({ load, save, cartola, ahora = () => Date.now() } = {}) {
  const deCartola = cartola || leerCartolas();
  let manuales = null;
  let cargando = null;

  async function cargar() {
    if (manuales) return manuales;
    if (!cargando) {
      cargando = Promise.resolve(load(ARCHIVO, null)).then(g => {
        manuales = (g && Array.isArray(g.manuales)) ? g.manuales : [];
        return manuales;
      });
    }
    return cargando;
  }
  const guardar = () => save(ARCHIVO, { manuales });
  const hoyChile = () => new Date(ahora()).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const error = msg => Object.assign(new Error(msg), { deUsuario: true });

  // Todas, de la más nueva a la más vieja. Las de la cartola se emparejan una
  // a una con las cargadas a mano que calzan (enCartola); ver arriba la regla.
  async function lista() {
    await cargar();
    const usadas = new Set();
    const revisado = new Set(deCartola.meses);
    const aMano = manuales.map(m => {
      const i = deCartola.devoluciones.findIndex((c, k) => !usadas.has(k) && c.monto === m.monto &&
        diasEntre(c.fecha, m.fecha) <= DIAS_CALCE && (revisado.has(m.fecha.slice(0, 7)) || c.fecha >= m.fecha));
      if (i >= 0) usadas.add(i);
      return { id: m.id, fecha: m.fecha, monto: m.monto, nota: m.nota || '', origen: 'manual', enCartola: i >= 0 };
    });
    return deCartola.devoluciones.concat(aMano).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }

  // { 'AAAA-MM': { n, monto } } con lo que de verdad se resta: las de la
  // cartola más las cargadas a mano que NO están ya en la cartola.
  async function porMes() {
    const mapa = {};
    for (const d of await lista()) {
      if (d.enCartola) continue;
      const mes = d.fecha.slice(0, 7);
      if (!mapa[mes]) mapa[mes] = { n: 0, monto: 0 };
      mapa[mes].n += 1;
      mapa[mes].monto += d.monto;
    }
    return mapa;
  }

  async function agregar({ fecha, monto, nota } = {}) {
    await cargar();
    const f = String(fecha || '').trim();
    const m = Math.round(Number(monto));
    if (!fechaValida(f)) throw error('La fecha no es válida.');
    if (f > hoyChile()) throw error('La fecha no puede ser futura.');
    if (!(m >= MONTO_MIN && m <= MONTO_MAX)) throw error('El monto tiene que estar entre $1.000 y $2.000.000.');
    const reg = {
      id: 'm-' + ahora().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
      fecha: f, monto: m, nota: String(nota || '').trim().slice(0, 80),
      creado: new Date(ahora()).toISOString()
    };
    manuales.push(reg);
    await guardar();
    return reg;
  }

  // Solo se quitan las cargadas a mano: las de la cartola salen del archivo.
  async function quitar(id) {
    await cargar();
    const i = manuales.findIndex(m => m.id === String(id || ''));
    if (i < 0) return null;
    const [q] = manuales.splice(i, 1);
    await guardar();
    return q;
  }

  return { lista, porMes, agregar, quitar, mesesRevisados: () => deCartola.meses.slice() };
}

// Una sola instancia para server.js. persist.js se carga recién acá para que
// los tests usen crearServicio() con un almacenamiento en memoria.
let instancia = null;
function servicio() {
  if (!instancia) {
    const persist = require('./persist');
    instancia = crearServicio({ load: persist.load, save: persist.save });
  }
  return instancia;
}

module.exports = { ARCHIVO, DIAS_CALCE, MONTO_MIN, MONTO_MAX, fechaValida, leerCartolas, crearServicio, servicio };
