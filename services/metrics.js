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
let checkoutsTotal = 0;    // cuántas veces se abrió el checkout (paso medio del embudo, sin el dueño)
// Conducta del visitante: contadores agregados por evento (1 por sesión, sin el
// dueño). Clave 'hito:precio', 'accion:color', 'disp:movil', 'fuente:instagram'…
// No guarda nada personal, solo cuántas sesiones hicieron cada cosa.
const eventos = {};
// 'co:' son los pasos DENTRO del checkout (co:1abrio … co:4pago) que alimentan
// el embudo del dashboard. Sin este prefijo el validador los descartaba y la
// sección quedaba siempre "sin datos".
const EVENTO_OK = /^(hito|accion|disp|fuente|co):[a-z0-9_-]{1,24}$/;
// Conversión por acción: de las sesiones que COMPRARON, cuántas habían hecho
// cada acción/hito (llega desde success.html). Cruzado con `eventos` da el % de
// gente que compró después de hacer X (p. ej. girar el 360°).
const conversiones = {};
let conversionesN = 0;     // total de compras rastreadas desde el frontend
const conversionesOrdenes = []; // n° de orden ya contados (dedup webhook + success.html), capado
const ventas = [];         // { monto, fecha, metodo, nombre, orden }
// Tickets del sorteo. Se asigna 1 por compra confirmada (número correlativo),
// automáticamente. { numero, nombre, orden, email, instagram, verificado, automatico, fecha }
const tickets = [];

// Carga lo guardado (disco o base de datos) antes de que el servidor empiece
// a recibir tráfico. server.js hace `await metrics.init()` al arrancar.
async function init() {
  const guardado = await persist.load(DATA_FILE, {});
  vistasTotal = guardado.vistasTotal || 0;
  Object.assign(vistasPorDia, guardado.vistasPorDia || {});
  duracionTotalMs = guardado.duracionTotalMs || 0;
  duracionN = guardado.duracionN || 0;
  checkoutsTotal = guardado.checkoutsTotal || 0;
  Object.assign(eventos, guardado.eventos || {});
  Object.assign(conversiones, guardado.conversiones || {});
  conversionesN = guardado.conversionesN || 0;
  conversionesOrdenes.push(...(guardado.conversionesOrdenes || []));
  ventas.push(...(guardado.ventas || []));
  tickets.push(...(guardado.tickets || []));
}

function guardar() {
  persist.save(DATA_FILE, { vistasTotal, vistasPorDia, duracionTotalMs, duracionN, checkoutsTotal, eventos, conversiones, conversionesN, conversionesOrdenes, ventas, tickets })
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

// Reinicia el promedio de tiempo (borra lo acumulado). Útil para limpiar el
// tiempo del dueño que quedó contado antes de excluirse.
function resetTiempoPromedio() {
  duracionTotalMs = 0;
  duracionN = 0;
  guardar();
}

// Pone en cero los contadores de conducta Y de conversión-por-acción al mismo
// tiempo, para que numerador (compradores que hicieron X) y denominador (todos
// los que hicieron X) cuenten la MISMA ventana desde ahora. Sin esto, el
// denominador arrastra visitantes viejos que nunca tendrán una compra que los
// empareje y la sección "Qué lleva a comprar" da ~0% para siempre.
// NO toca ventas, tickets, stock ni el embudo de dinero.
function resetConducta() {
  for (const k of Object.keys(eventos)) delete eventos[k];
  for (const k of Object.keys(conversiones)) delete conversiones[k];
  conversionesN = 0;
  conversionesOrdenes.length = 0;
  checkoutsTotal = 0; // el embudo de conducta también arranca limpio
  guardar();
  console.log('[metrics] conducta y conversión-por-acción reseteadas');
}

// Registra que una sesión abrió el checkout (el paso del medio del embudo:
// visitas → abrieron checkout → pagaron). El dueño no cuenta.
function registrarCheckout(esOwner) {
  if (esOwner) return;
  checkoutsTotal++;
  guardar();
}

// Registra un evento de conducta (scroll, click, dispositivo, fuente). El
// frontend ya deduplica 1 vez por sesión, así que acá solo sumamos. Valida el
// formato para no ensuciar los datos y limita la cantidad de claves distintas.
function registrarEvento(ev, esOwner) {
  if (esOwner) return;
  const k = String(ev || '').trim().toLowerCase();
  if (!EVENTO_OK.test(k)) return;
  if (eventos[k] === undefined && Object.keys(eventos).length >= 120) return;
  eventos[k] = (eventos[k] || 0) + 1;
  guardar();
}

// Registra una compra y qué acciones/hitos había hecho esa sesión (success.html
// manda los flags de la sesión). Cruzado con `eventos` da el % que compró tras
// cada acción. El dueño no cuenta.
function registrarConversion(acciones, orden, esOwner) {
  if (esOwner) return;
  const ord = String(orden || '').trim();
  if (ord) {
    if (conversionesOrdenes.includes(ord)) return; // ya contada (webhook + success.html)
    conversionesOrdenes.push(ord);
    if (conversionesOrdenes.length > 1000) conversionesOrdenes.shift();
  }
  conversionesN++;
  if (Array.isArray(acciones)) {
    for (const raw of acciones) {
      const k = String(raw || '').trim().toLowerCase();
      if (!EVENTO_OK.test(k)) continue;
      if (conversiones[k] === undefined && Object.keys(conversiones).length >= 120) continue;
      conversiones[k] = (conversiones[k] || 0) + 1;
    }
  }
  guardar();
}

// Registra la venta confirmada Y le asigna automáticamente un ticket del
// sorteo (1 por compra). Devuelve el ticket asignado (con su número) para
// poder mostrárselo al cliente en el correo de confirmación.
function registrarVenta(v) {
  // El paso final del embudo del checkout se cuenta como un evento más
  // (co:5pago) en vez de leer el total histórico de ventas: ese total incluye
  // compras anteriores a que existieran los eventos co:, y daba porcentajes
  // imposibles (45 pagos sobre 5 que abrieron = 900%). Así los 5 pasos
  // arrancan desde cero en el mismo momento y el embudo cuadra.
  // Se cuenta solo la primera vez que se ve la orden (el webhook puede
  // reintentar): si ya tenía ticket, es un reintento y no suma.
  const yaContada = v.orden ? !!buscarTicketPorOrden(v.orden) : false;
  ventas.push({
    monto: Number(v.monto) || 0,
    fecha: new Date().toISOString(),
    metodo: v.metodo || '',
    nombre: v.nombre || '',
    orden: v.orden ? String(v.orden) : ''
  });
  const ticket = asignarTicket({ nombre: v.nombre, orden: v.orden, email: v.email });
  if (!yaContada) eventos['co:5pago'] = (eventos['co:5pago'] || 0) + 1;
  guardar();
  return ticket;
}

// Busca un ticket por n° de orden (calce exacto o por sufijo, como en
// ordenConfirmada, porque el correo al cliente muestra solo los últimos 8).
function buscarTicketPorOrden(orden) {
  const o = String(orden || '').trim().toLowerCase();
  if (!o) return null;
  return tickets.find(t => {
    const g = String(t.orden || '').toLowerCase();
    return g === o || (o.length >= 6 && g.endsWith(o)) || (g.length >= 6 && o.endsWith(g));
  }) || null;
}

// Asigna un ticket a una compra. Idempotente por n° de orden: si ya hay un
// ticket para esa orden (p. ej. reintento del webhook), devuelve el mismo, sin
// duplicar ni gastar un número nuevo.
function asignarTicket({ nombre, orden, email } = {}) {
  const ordenStr = String(orden || '').trim();
  if (!ordenStr) return null;
  const existente = buscarTicketPorOrden(ordenStr);
  if (existente) return existente;
  const numero = tickets.reduce((max, t) => Math.max(max, t.numero || 0), 0) + 1;
  const ticket = {
    numero,
    nombre: (nombre || '').toString().slice(0, 90),
    orden: ordenStr.slice(0, 60),
    email: (email || '').toString().slice(0, 120),
    instagram: '',
    verificado: true,
    automatico: true,
    fecha: new Date().toISOString()
  };
  tickets.push(ticket);
  return ticket;
}

// Canje manual: el comprador agrega su Instagram para que le avisemos si gana.
// Si ya tiene ticket (asignado al pagar), le adjunta el Instagram; si no existe
// pero la orden está confirmada, crea el ticket ahí mismo. Devuelve el ticket
// (o null si la orden no corresponde a un pago confirmado).
function reclamarInstagram({ orden, instagram, nombre } = {}) {
  if (!ordenConfirmada(orden)) return null;
  let ticket = buscarTicketPorOrden(orden);
  if (!ticket) ticket = asignarTicket({ nombre, orden });
  let ig = String(instagram || '').trim().slice(0, 60);
  if (ig && ig[0] !== '@') ig = '@' + ig;
  const yaTenia = !!ticket.instagram;
  if (ig) ticket.instagram = ig;
  if (nombre && !ticket.nombre) ticket.nombre = String(nombre).slice(0, 90);
  guardar();
  return { ticket, yaTenia };
}

function obtenerTickets() { return tickets; }
function ticketsTotal() { return tickets.length; }

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
  const comprasN = ventas.length;
  const conversion = vistasTotal ? +((comprasN / vistasTotal) * 100).toFixed(1) : 0;
  const vistasHoy = vistasPorDia[hoyChile()] || 0;
  const resVentas = resumenVentas();
  const ventasHoyN = resVentas.hoy.count;
  // Conversión del día: compras de hoy ÷ visitas de hoy (ambas hora de Chile).
  const conversionHoy = vistasHoy ? +((ventasHoyN / vistasHoy) * 100).toFixed(1) : 0;
  return {
    visitantesEnVivo: visitantesEnVivo(),
    vistasHoy,
    vistasTotal,
    conversionHoy,                                  // % ventas hoy ÷ visitas hoy
    tiempoPromedioSeg: tiempoPromedioSeg(),
    ventas: resVentas,
    ultimos30: ultimos30Dias(),
    ventas30: ventas30Dias(),
    tickets: tickets.slice().reverse(),
    ticketsTotal: tickets.length,
    conversion,                                     // % ventas ÷ visitas
    embudo: { visitas: vistasTotal, checkouts: checkoutsTotal, ventas: comprasN },
    conducta: { ...eventos },                        // contadores de conducta del visitante
    conversionAccion: { ...conversiones },           // compradores que hicieron cada acción
    conversionesN                                    // total de compras rastreadas
  };
}

module.exports = {
  init, ping, registrarVenta, ordenConfirmada, snapshot, visitantesEnVivo,
  asignarTicket, reclamarInstagram, obtenerTickets, ticketsTotal, buscarTicketPorOrden,
  resetTiempoPromedio, resetConducta, registrarCheckout, registrarEvento, registrarConversion
};
