'use strict';
// Pagos que alguien EMPEZÓ por Flow o Webpay: dejó su nombre y correo y apretó
// Pagar. Hasta el 11-nov-2026 esos pedidos vivían solo en memoria y se perdían
// con cada reinicio de Render (los de Mercado Pago sí quedaban, en `pedidos`).
// Se guardan para poder escribirles después a quienes no compraron (correo
// 11:11, ver promo.js). Solo lo mínimo: fecha, correo, nombre, pasarela y n°
// de orden. Esto NUNCA puede trabar un pago: anotar() no espera ni lanza.
const ARCHIVO = 'intentos-pago.json';
const MAX = 3000; // los más nuevos

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

  async function todos() {
    await cola;
    return (await cargar()).slice();
  }

  return { anotar, todos };
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
