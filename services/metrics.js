// Métricas en vivo para el panel de administración.
// Todo en memoria: los visitantes en vivo son efímeros por naturaleza; las
// ventas del día se reinician si Render reinicia (por eso cada venta también
// llega al correo del dueño como respaldo permanente).

const sesiones = new Map();      // sid -> última vez visto (ms)
const sesionesOwner = new Set(); // sids del dueño: no cuentan como visitantes ni como vistas
let vistasTotal = 0;
const vistasPorDia = {};         // 'YYYY-MM-DD' (Chile) -> N

function hoyChile() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

const ventas = [];               // { monto, fecha, metodo, nombre, orden }

// Registra actividad de un visitante. `nueva` = primera carga de la sesión.
// `esOwner` marca la sesión como del dueño: se ve en vivo pero no se cuenta.
function ping(sid, nueva, esOwner) {
  if (!sid) return;
  sesiones.set(String(sid), Date.now());
  if (esOwner) sesionesOwner.add(String(sid));
  if (nueva && !esOwner) {
    vistasTotal++;
    const d = hoyChile();
    vistasPorDia[d] = (vistasPorDia[d] || 0) + 1;
  }
}

// Visitantes activos en los últimos 35 s (y limpia los viejos).
function visitantesEnVivo() {
  const limite = Date.now() - 35000;
  let n = 0;
  for (const [sid, t] of sesiones) {
    if (t > limite) {
      if (!sesionesOwner.has(sid)) n++;
    } else {
      sesiones.delete(sid);
      sesionesOwner.delete(sid);
    }
  }
  return n;
}

function registrarVenta(v) {
  ventas.push({
    monto: Number(v.monto) || 0,
    fecha: new Date().toISOString(),
    metodo: v.metodo || '',
    nombre: v.nombre || '',
    orden: v.orden ? String(v.orden) : ''
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

function snapshot() {
  return {
    visitantesEnVivo: visitantesEnVivo(),
    vistasHoy: vistasPorDia[hoyChile()] || 0,
    vistasTotal,
    ventas: resumenVentas(),
    ultimos30: ultimos30Dias()
  };
}

module.exports = { ping, registrarVenta, snapshot, visitantesEnVivo };
