'use strict';
// Pagos que alguien EMPEZÓ por Flow o Webpay: dejó su nombre y correo y apretó
// Pagar. Hasta el 11-nov-2026 esos pedidos vivían solo en memoria y se perdían
// con cada reinicio de Render (los de Mercado Pago sí quedaban, en `pedidos`).
// Se guardan para poder escribirles después a quienes no compraron (correo
// 11:11, ver promo.js). Solo lo mínimo: fecha, correo, nombre, pasarela y n°
// de orden. Esto NUNCA puede trabar un pago: anotar() no espera ni lanza.
const ARCHIVO = 'intentos-pago.json';
const MAX = 3000; // los más nuevos

// Correos que vienen en el texto de los avisos pero no son de clientes: la
// tienda, las pasarelas, el que manda los correos y los "no-reply".
const DOMINIOS_SISTEMA = /@(deusbrand\.cl|flow\.cl|mercadopago\.(com|cl)|mercadolibre\.(com|cl)|transbank\.cl|resend\.(dev|com)|gmail-smtp-in\.l\.google\.com)$/;
function esDeSistema(e) { return DOMINIOS_SISTEMA.test(e) || /^(no-?reply|noreply|notificaciones|mailer-daemon|postmaster)@/.test(e); }

function crearRegistro({ load, save, ahora = () => Date.now() }) {
  let lista = null;
  let cargando = null;
  let cola = Promise.resolve();

  function cargar() {
    if (lista) return Promise.resolve(lista);
    if (!cargando) {
      cargando = Promise.resolve(load(ARCHIVO, null)).then(g => {
        lista = Array.isArray(g) ? g : [];
        return lista;
      }).catch(() => { lista = []; return lista; });
    }
    return cargando;
  }

  function anotar({ email, nombre, pasarela, orden } = {}) {
    try {
      const e = String(email || '').trim().toLowerCase().slice(0, 254);
      if (!e || !e.includes('@')) return;
      const reg = {
        fecha: new Date(ahora()).toISOString(),
        email: e,
        nombre: String(nombre || '').trim().slice(0, 90),
        pasarela: String(pasarela || '').slice(0, 20),
        orden: String(orden || '').slice(0, 60),
      };
      cola = cola.then(cargar).then(l => {
        l.push(reg);
        if (l.length > MAX) l.splice(0, l.length - MAX);
        return save(ARCHIVO, l);
      }).catch(err => console.error('[intentos] Error guardando:', err.message));
    } catch (err) {
      console.error('[intentos]', err.message);
    }
  }

  // Correos pegados por el dueño en el panel (p. ej. de los avisos "Nuevo
  // pedido" de su Gmail): pedidos viejos de Webpay/Flow que no quedaron
  // guardados. Sin fecha (no se sabe cuándo fueron) y sin repetir.
  // excluir: correos del dueño (los avisos traen su propio correo).
  async function importar(texto, excluir = []) {
    await cola;
    const l = await cargar();
    const ya = new Set(l.map(x => x.email));
    const fuera = new Set(excluir.map(e => String(e || '').trim().toLowerCase()).filter(Boolean));
    // Línea por línea: "Nombre Apellido <correo>" guarda también el nombre
    // (así se saca a quien compró con otro correo); un correo suelto, sin él.
    const nombres = new Map();
    for (const linea of String(texto || '').split(/\r?\n/)) {
      const m = linea.match(/^\s*([^<>@\n]*?)\s*<\s*([^<>\s]+@[^<>\s]+)\s*>/);
      if (m && m[1]) nombres.set(m[2].toLowerCase(), m[1].slice(0, 90));
    }
    const nuevos = [...new Set(String(texto || '').toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}/g) || [])]
      .filter(e => !ya.has(e) && !fuera.has(e) && !esDeSistema(e));
    for (const e of nuevos) l.push({ fecha: null, email: e, nombre: nombres.get(e) || '', pasarela: 'panel', orden: '' });
    if (l.length > MAX) l.splice(0, l.length - MAX);
    if (nuevos.length) await save(ARCHIVO, l);
    return nuevos.length;
  }

  async function todos() {
    await cola;
    return (await cargar()).slice();
  }

  return { anotar, todos, importar };
}

let instancia = null;
function registro() {
  if (!instancia) {
    const persist = require('./persist');
    instancia = crearRegistro({ load: persist.load, save: persist.save });
  }
  return instancia;
}

// Atajo para las rutas de pago: nunca lanza.
function anotar(datos) {
  try { registro().anotar(datos); } catch (e) { console.error('[intentos]', e.message); }
}

module.exports = { crearRegistro, registro, anotar, ARCHIVO };
