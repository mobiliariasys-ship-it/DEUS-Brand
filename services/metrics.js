// Métricas en vivo para el panel de administración.
// Los visitantes "en vivo" son efímeros por naturaleza (no se guardan).
// Ventas y vistas SÍ se guardan en disco (metrics-data.json) para sobrevivir
// si el servicio se duerme y despierta por inactividad. Igual pueden perderse
// en un deploy nuevo (disco efímero de Render) — por eso cada venta y cada
// ticket también llegan al correo del dueño como respaldo permanente.
const persist = require('./persist');
const DATA_FILE = 'metrics-data.json';

const sesiones = new Map();      // sid -> { inicio, ultimo } (ms) — no se persiste, es en vivo
const sesionesOwner = new Set(); // sids del dueño: no cuentan como visitantes ni como vistas
let vistasTotal = 0;
const vistasPorDia = {};   // 'YYYY-MM-DD' (Chile) -> N
let duracionTotalMs = 0;   // suma de duración de sesiones ya terminadas (sin el dueño)
let duracionN = 0;         // cuántas sesiones terminadas acumula duracionTotalMs
const ventas = [];         // { monto, fecha, metodo, nombre, orden }

// Carga lo guardado (disco o base de datos) antes de que el servidor empiece
// a recibir tráfico. server.js hace `await metrics.init()` al arrancar.
async function init() {
  const guardado = await persist.load(DATA_FILE, {});
  vistasTotal = guardado.vistasTotal || 0;
  Object.assign(vistasPorDia, guardado.vistasPorDia || {});
  duracionTotalMs = guardado.duracionTotalMs || 0;
  duracionN = guardado.duracionN || 0;
  ventas.push(...(guardado.ventas || []));
}

function guardar() {
  persist.save(DATA_FILE, { vistasTotal, vistasPorDia, duracionTotalMs, duracionN, ventas })
    .catch(e => console.error('[metrics] Error guardando:', e.message));
}

function hoyChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

// Registra actividad de un visitante. `nueva` = primera carga de la sesión.
// `esOwner` marca la sesión como del dueño: se ve en vivo pero no se cuenta.
function ping(sid, nueva, esOwner) {
  if (!sid) return;
  const ahora = Date.now();
  const s = sesiones.get(String(sid));
  if (s) s.ultimo = ahora;
  else sesiones.set(String(sid), { inicio: ahora, ultimo: ahora });
  if (esOwner) sesionesOwner.add(String(sid));
  if (nueva && !esOwner) {
    vistasTotal++;
    const d = hoyChile();
    vistasPorDia[d] = (vistasPorDia[d] || 0) + 1;
    guardar();
  }
}

// Visitantes activos en los últimos 35 s (y limpia los viejos, acumulando
// la duración de cada sesión terminada para el tiempo promedio de visita).
function visitantesEnVivo() {
  const limite = Date.now() - 35000;
  let n = 0;
  for (const [sid, s] of sesiones) {
    if (s.ultimo > limite) {
      if (!sesionesOwner.has(sid)) n++;
    } else {
      if (!sesionesOwner.has(sid)) {
        duracionTotalMs += s.ultimo - s.inicio;
        duracionN++;
        guardar();
      }
      sesiones.delete(sid);
      sesionesOwner.delete(sid);
    }
  }
  return n;
}

// Tiempo promedio de visita en segundos (sesiones terminadas + las activas).
function tiempoPromedioSeg() {
  let total = duracionTotalMs, cuenta = duracionN;
  for (const [sid, s] of sesiones) {
    if (!sesionesOwner.has(sid)) {
      total += s.ultimo - s.inicio;
      cuenta++;
    }
  }
  return cuenta ? Math.round(total / cuenta / 1000) : 0;
}

function registrarVenta(v) {
  ventas.push({
    monto: Number(v.monto) || 0,
    fecha: new Date().toISOString(),
    metodo: v.metodo || '',
    nombre: v.nombre || '',
    orden: v.orden ? String(v.orden) : ''
  });
  guardar();
}

// ¿Ese n° de orden corresponde a un pago ya confirmado? Cubre los 3 métodos
// (MercadoPago, Webpay, Flow) porque todos pasan por registrarVenta().
// El correo que le llega al CLIENTE muestra solo los últimos 8 caracteres
// del n° de orden ("Pedido XXXXXXXX"), así que además del calce exacto se
// acepta que el n° ingresado sea el sufijo (mínimo 6 caracteres) del guardado.
function ordenConfirmada(orden) {
  const o = String(orden || '').trim().toLowerCase();
  if (!o) return false;
  return ventas.some(v => {
    const guardado = v.orden.toLowerCase();
    if (guardado === o) return true;
    if (o.length >= 6 && guardado.endsWith(o)) return true;
    return false;
  });
}

function resumenVentas() {
  const d = hoyChile();
  let hoyCount = 0, hoyMonto = 0, totMonto = 0;
  for (const v of ventas) {
    totMonto += v.monto;
    const dv = new Date(v.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    if (dv === d) { hoyCount++; hoyMonto += v.monto; }
  }
  return {
    hoy: { count: hoyCount, monto: hoyMonto },
    total: { count: ventas.length, monto: totMonto },
    ultimas: ventas.slice(-12).reverse()
  };
}

// Vistas diarias de los últimos 30 días (fecha Chile, día por día).
function ultimos30Dias() {
  const dias = [];
  const ahora = Date.now();
  for (let i = 29; i >= 0; i--) {
    const dateStr = new Date(ahora - i * 86400000)
      .toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    dias.push({ fecha: dateStr, vistas: vistasPorDia[dateStr] || 0 });
  }
  return dias;
}

// Ventas diarias (cantidad y monto) de los últimos 30 días.
function ventas30Dias() {
  const porDia = {};
  for (const v of ventas) {
    const d = new Date(v.fecha).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    if (!porDia[d]) porDia[d] = { count: 0, monto: 0 };
    porDia[d].count++;
    porDia[d].monto += v.monto;
  }
  const dias = [];
  const ahora = Date.now();
  for (let i = 29; i >= 0; i--) {
    const dateStr = new Date(ahora - i * 86400000)
      .toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
    const dia = porDia[dateStr] || { count: 0, monto: 0 };
    dias.push({ fecha: dateStr, ventas: dia.count, monto: dia.monto });
  }
  return dias;
}

function snapshot() {
  return {
    visitantesEnVivo: visitantesEnVivo(),
    vistasHoy: vistasPorDia[hoyChile()] || 0,
    vistasTotal,
    tiempoPromedioSeg: tiempoPromedioSeg(),
    ventas: resumenVentas(),
    ultimos30: ultimos30Dias(),
    ventas30: ventas30Dias()
  };
}

module.exports = { init, ping, registrarVenta, ordenConfirmada, snapshot, visitantesEnVivo };
