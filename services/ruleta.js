'use strict';
// Ruleta "Gira y gana" (desde el 4-nov-2026, en lugar de la pestaña del
// sorteo mensual). A los 5,4 segundos en la web aparece la ruleta: la persona
// deja su correo, gira, y le llega al correo un código con su premio.
//
// El premio lo decide ESTE archivo, nunca el navegador: el navegador solo
// anima la ruleta hasta el gajo que le dice el servidor. Así nadie puede
// "elegir" el 10% tocando el código de la página.
//
// Contra el abuso (pedido del dueño: "que no puedan abusar ni vulnerar"):
//  - Un giro por PERSONA: el correo se normaliza (Gmail ignora los puntos y
//    todo lo que va después de un "+"), así que camila+1@gmail.com y
//    c.amila@gmail.com cuentan como el mismo correo. Los correos temporales
//    (mailinator, yopmail…) no pueden girar.
//  - Si alguien escribe un correo que ya giró, NO se le muestra el código:
//    se le reenvía al dueño del correo. Si no, cualquiera podría ver el
//    premio de otra persona escribiendo su correo.
//  - Códigos de 6 caracteres al azar (887 millones de combinaciones por
//    premio) y el servidor limita los intentos: adivinar uno no es viable.
//  - Un código sirve UNA vez, por 48 horas, y SOLO con el correo que lo
//    ganó (pedido del dueño: "un solo código por correo"). Así no sirve
//    juntar códigos girando con otros correos: cada correo tiene un código y
//    solo ese correo lo puede usar. Una compra lleva un solo código.
//  - Al empezar a pagar queda reservado 30 minutos para esa compra.
//
// Probabilidades (decisión del dueño, 4-nov-2026; el 6-nov bajó los tapones
// a 0,2% y el 10% OFF a 0,5%, y lo que se liberó pasó al $3.000). Suman
// exactamente 1. Costo promedio por venta con código ≈ $2.930.
const PREMIOS = [
  { id: 'd3000',   etiqueta: '$3.000 OFF',     tipo: 'descuento', monto: 3000, prob: 0.613, prefijo: 'DEUS3K' },
  { id: 'p5',      etiqueta: '5% OFF',         tipo: 'descuento', pct: 5,      prob: 0.20,  prefijo: 'DEUS5' },
  { id: 'correa',  etiqueta: 'Correa extra',   tipo: 'correa',                 prob: 0.15,  prefijo: 'CORREA' },
  { id: 'p7',      etiqueta: '7% OFF',         tipo: 'descuento', pct: 7,      prob: 0.03,  prefijo: 'DEUS7' },
  // Los tapones tienen que poder salir: un premio que se muestra en la ruleta
  // y nunca sale sería publicidad engañosa (SERNAC).
  { id: 'tapones', etiqueta: 'Tapones de oído gratis', tipo: 'tapones',        prob: 0.002, prefijo: 'TAPONES' },
  { id: 'p10',     etiqueta: '10% OFF',        tipo: 'descuento', pct: 10,     prob: 0.005, prefijo: 'DEUS10' },
];
const VIGENCIA_MS = 48 * 60 * 60 * 1000;   // el premio dura 48 horas
// Premio vencido SIN usar: a las 24 h de vencer, ese mismo correo puede girar
// de nuevo (pedido del dueño, 10-nov-2026). Un premio usado no da otro giro.
// index.html lleva el mismo número (REGIRO_MS). La página no lo anuncia: el
// dueño lo avisará por correo más adelante (giraDesde ya viaja en la respuesta).
const REGIRO_MS = 24 * 60 * 60 * 1000;
const RESERVA_MS = 30 * 60 * 1000;         // al empezar a pagar, el código se aparta 30 min
const REENVIO_MS = 10 * 60 * 1000;         // a un mismo correo, máximo un reenvío cada 10 min
const COLORES_CORREA = ['negra', 'gris'];  // correas de tela que hay en stock
const ARCHIVO = 'ruleta.json';
// Sin 0/O ni 1/I/L: el código se lee en el celular y se tipea a mano.
const LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 6;
const FORMATO_CODIGO = /^[A-Z0-9]{3,8}-[A-Z0-9]{4,8}$/;

// Correos temporales: sirven para inventar correos en serie y girar muchas
// veces. No es una lista completa; corta a los más usados.
const DESECHABLES = new Set([
  'mailinator.com', 'yopmail.com', 'yopmail.net', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'sharklasers.com', 'grr.la', '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'temp-mail.io',
  'tempmail.com', 'tempmail.net', 'tempmailo.com', 'tmpmail.org', 'tmpmail.net', 'trashmail.com', 'trashmail.de',
  'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mintemail.com', 'mohmal.com', 'emailondeck.com',
  'throwawaymail.com', 'fakeinbox.com', 'tempr.email', 'discard.email', 'mailnesia.com', 'mytemp.email',
  'burnermail.io', 'moakt.com', 'tempail.com', 'spamgourmet.com', 'mailcatch.com', 'inboxkitten.com',
  'emailfake.com', 'fakemail.net', 'luxusmail.org', 'minuteinbox.com', 'mail.tm', 'cs.email', 'spam4.me',
]);

const MENSAJES = {
  'no-existe': 'Ese código no existe. Revisa que esté bien escrito.',
  'vencido': 'Este código venció (duraba 48 horas).',
  'usado': 'Este código ya se usó en otra compra.',
  'reservado': 'Este código se está usando en otra compra en este momento. Si fuiste tú, espera 30 minutos e intenta de nuevo.',
  'formato': 'Revisa tu correo: así no te podemos mandar el premio.',
  'uno-solo': 'Solo se puede usar un código por compra.',
  'otro-correo': 'Este código es de otro correo. Para usarlo, compra con el mismo correo con el que giraste la ruleta',
  'desechable': 'Usa tu correo de siempre: a los correos temporales no les podemos mandar premios.',
};

const tiene = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const premioPorId = id => PREMIOS.find(p => p.id === id) || null;
const normalizarCodigo = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 40);

// El correo tal como se le escribe (envio) y la clave que identifica a la
// persona (clave): sin "+etiqueta" y, en Gmail, sin puntos.
function validarCorreo(email) {
  const envio = String(email || '').trim().toLowerCase();
  if (envio.length > 254 || !/^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(envio)) {
    return { ok: false, tipo: 'formato', mensaje: MENSAJES.formato };
  }
  let [local, dominio] = envio.split('@');
  if (DESECHABLES.has(dominio)) return { ok: false, tipo: 'desechable', mensaje: MENSAJES.desechable };
  local = local.split('+')[0];
  if (dominio === 'googlemail.com') dominio = 'gmail.com';
  if (dominio === 'gmail.com') local = local.replace(/\./g, '');
  if (!local) return { ok: false, tipo: 'formato', mensaje: MENSAJES.formato };
  return { ok: true, envio, clave: local + '@' + dominio };
}

// Elige un premio según las probabilidades. `r` es un número en [0, 1).
function sortear(r) {
  let acumulado = 0;
  for (const p of PREMIOS) {
    acumulado += p.prob;
    if (r < acumulado) return p;
  }
  return PREMIOS[0]; // por redondeo de coma flotante, nunca debería llegar acá
}

// Lo que se puede mostrar del premio (sin probabilidades ni prefijos).
function premioPublico(p) {
  const o = { id: p.id, etiqueta: p.etiqueta, tipo: p.tipo };
  if (p.monto) o.monto = p.monto;
  if (p.pct) o.pct = p.pct;
  return o;
}

function error(tipo, extra) {
  const e = new Error(MENSAJES[tipo] + (extra || ''));
  e.codigoError = tipo;
  // El correo equivocado se corrige en el campo del correo, no en el del código.
  e.campo = tipo === 'otro-correo' ? 'email' : 'codigo';
  return e;
}

// "camila.rojas@gmail.com" → "ca•••@gmail.com": le dice a la persona qué
// correo usar sin mostrárselo entero a quien no es su dueño.
function enmascarar(email) {
  const [local, dominio] = String(email || '').split('@');
  if (!local || !dominio) return '';
  return local.slice(0, 2) + '•••@' + dominio;
}

function crearServicio({ load, save, ahora = () => Date.now(), azar } = {}) {
  const crypto = require('crypto');
  const aleatorio = azar || (() => crypto.randomInt(0, 1000000) / 1000000);
  // Las letras del código salen SIEMPRE de crypto (no se pueden predecir).
  const letra = () => LETRAS[crypto.randomInt(0, LETRAS.length)];
  let estado = null;
  let cargando = null;

  async function cargar() {
    if (estado) return estado;
    if (!cargando) {
      cargando = Promise.resolve(load(ARCHIVO, null)).then(g => {
        estado = (g && g.codigos) ? g : { codigos: {}, porCorreo: {} };
        if (!estado.porCorreo) estado.porCorreo = {};
        return estado;
      });
    }
    return cargando;
  }
  function guardar() {
    return Promise.resolve(save(ARCHIVO, estado)).catch(e => console.error('[ruleta] Error guardando:', e.message));
  }
  function buscar(codigo) {
    const c = normalizarCodigo(codigo);
    if (!FORMATO_CODIGO.test(c) || !tiene(estado.codigos, c)) return null;
    return estado.codigos[c];
  }

  function nuevoCodigo(prefijo) {
    for (let i = 0; i < 50; i++) {
      let s = '';
      for (let k = 0; k < LARGO_CODIGO; k++) s += letra();
      const c = prefijo + '-' + s;
      if (!tiene(estado.codigos, c)) return c;
    }
    throw new Error('No se pudo generar un código único');
  }

  // Lo que ve el navegador. Sin el correo: cualquiera que tipee un código
  // ajeno en el checkout no tiene por qué ver de quién es.
  function datos(reg) {
    const p = premioPorId(reg.premio);
    return {
      codigo: reg.codigo,
      premio: premioPublico(p),
      color: reg.color || null,
      vence: new Date(reg.vence).toISOString(),
    };
  }

  // Un giro por persona. Devuelve:
  //  publico    → lo que se responde al navegador (sin código si ya había girado)
  //  paraCorreo → lo que va en el correo del premio (con código y correo)
  //  reenviar   → si corresponde mandar (o reenviar) el correo ahora
  async function girar(email) {
    await cargar();
    const v = validarCorreo(email);
    if (!v.ok) throw error(v.tipo);
    const t = ahora();
    if (tiene(estado.porCorreo, v.clave) && tiene(estado.codigos, estado.porCorreo[v.clave])) {
      const reg = estado.codigos[estado.porCorreo[v.clave]];
      // ¿Ya puede girar de nuevo? Solo si el premio venció sin usarse y pasaron
      // 24 h desde que venció. Si no, se responde lo de siempre (y se le dice
      // desde cuándo puede). Cuando sí puede, sigue de largo: sale un premio y
      // un código nuevos, y el viejo queda en el registro como vencido.
      const giraDesde = reg.vence + REGIRO_MS;
      if (reg.usado || t < giraDesde) {
        const reenviar = !reg.usado && t <= reg.vence && (!reg.ultimoEnvio || t - reg.ultimoEnvio > REENVIO_MS);
        if (reenviar) { reg.ultimoEnvio = t; await guardar(); }
        const pub = datos(reg);
        delete pub.codigo;
        delete pub.color;
        pub.usado = !!reg.usado;
        if (!reg.usado && t > reg.vence) pub.giraDesde = new Date(giraDesde).toISOString();
        return { yaGiro: true, reenviar, publico: { yaGiro: true, ...pub }, paraCorreo: { ...datos(reg), email: reg.emailEnvio || reg.email } };
      }
    }
    const premio = sortear(aleatorio());
    const codigo = nuevoCodigo(premio.prefijo);
    const reg = { codigo, premio: premio.id, email: v.clave, emailEnvio: v.envio, creado: t, vence: t + VIGENCIA_MS, color: null, usado: null, reserva: null, ultimoEnvio: t };
    estado.codigos[codigo] = reg;
    estado.porCorreo[v.clave] = codigo;
    await guardar();
    return { yaGiro: false, reenviar: true, publico: { yaGiro: false, ...datos(reg) }, paraCorreo: { ...datos(reg), email: v.envio } };
  }

  // ¿Sirve este código para pagar ahora? { ok, error, mensaje, ...datos }
  async function validar(codigo) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg) return { ok: false, error: 'no-existe', mensaje: MENSAJES['no-existe'] };
    if (reg.usado) return { ok: false, error: 'usado', mensaje: MENSAJES.usado };
    if (ahora() > reg.vence) return { ok: false, error: 'vencido', mensaje: MENSAJES.vencido };
    return { ok: true, ...datos(reg) };
  }

  // La correa del premio: el color que elige en la ruleta o en el correo.
  async function elegirColor(codigo, color) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg || reg.premio !== 'correa' || reg.usado || !COLORES_CORREA.includes(color)) return false;
    reg.color = color;
    await guardar();
    return true;
  }

  // Lo que el cobro necesita saber del premio. Sin código → null. Con un código
  // que no sirve → error con un mensaje para mostrarle al cliente.
  // El color de la correa: el que manda el checkout (lo pudo cambiar ahí); si
  // no viene, el que eligió en la ruleta; si nunca eligió, negra.
  // Al pasar por acá el código queda reservado 30 min para `cliente` (el
  // correo de la compra): otra compra con el mismo código no puede entrar
  // mientras esta se paga. El mismo cliente sí puede reintentar el pago.
  async function premioParaCobro(codigo, color, opciones = {}) {
    if (codigo == null || codigo === '') return null;
    // UN código por compra: una lista, o dos códigos en el mismo texto, no pasan.
    if (typeof codigo !== 'string') throw error('uno-solo');
    if (codigo.split(/[\s,;]+/).filter(x => x.includes('-')).length > 1) throw error('uno-solo');
    if (!normalizarCodigo(codigo)) return null;
    const v = await validar(codigo);
    if (!v.ok) throw error(v.error);
    const reg = buscar(codigo);
    // Solo el correo que ganó el código lo puede usar (con la misma
    // normalización del giro: mayúsculas, puntos y +etiqueta de Gmail no importan).
    // Los que genera el dueño SIN correo sirven con cualquiera (ver generar()).
    const c = validarCorreo(opciones.cliente);
    if (reg.email && (!c.ok || c.clave !== reg.email)) throw error('otro-correo', ' (' + enmascarar(reg.emailEnvio || reg.email) + ').');
    const cliente = c.ok ? c.clave : String(opciones.cliente || '').trim().toLowerCase();
    const t = ahora();
    if (reg.reserva && reg.reserva.hasta > t && reg.reserva.cliente !== cliente) throw error('reservado');
    reg.reserva = { cliente, hasta: t + RESERVA_MS };
    await guardar();
    const p = premioPorId(v.premio.id);
    const r = { codigo: v.codigo, id: p.id, tipo: p.tipo };
    if (p.monto) r.monto = p.monto;
    if (p.pct) r.pct = p.pct;
    if (p.tipo === 'correa') r.color = COLORES_CORREA.includes(color) ? color : (v.color || 'negra');
    return r;
  }

  // Al aprobarse el pago. Idempotente: un reaviso de la pasarela no lo pisa.
  async function marcarUsado(codigo, orden) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg || reg.usado) return false;
    reg.usado = { orden: String(orden || ''), fecha: new Date(ahora()).toISOString() };
    reg.reserva = null;
    await guardar();
    return true;
  }

  // Códigos que genera el DUEÑO desde el panel, para probar el cobro o para
  // regalar: el premio lo elige él, no la ruleta. Duran lo mismo (48 horas) y
  // sirven UNA vez. Con correo, solo ese correo los puede usar (igual que los
  // de la ruleta); sin correo, sirven con cualquier correo. No son giros: no
  // cuentan en las estadísticas de la ruleta ni le quitan el giro a ese correo.
  async function generar(premioId, opciones = {}) {
    await cargar();
    const p = premioPorId(premioId);
    if (!p) throw new Error('Premio desconocido: ' + premioId);
    let email = null, emailEnvio = null;
    if (opciones.email) {
      const v = validarCorreo(opciones.email);
      if (!v.ok) throw error(v.tipo);
      email = v.clave; emailEnvio = v.envio;
    }
    const t = ahora();
    const codigo = nuevoCodigo(p.prefijo);
    // vigenciaMs: los del correo 11:11 duran 24 h desde que se mandan, no 48.
    // campana: de qué envío salió el código (los del panel no llevan).
    const vigencia = Number(opciones.vigenciaMs) > 0 ? Number(opciones.vigenciaMs) : VIGENCIA_MS;
    estado.codigos[codigo] = { codigo, premio: p.id, email, emailEnvio, creado: t, vence: t + vigencia, color: null, usado: null, reserva: null, manual: true };
    if (opciones.campana) estado.codigos[codigo].campana = String(opciones.campana).slice(0, 30);
    await guardar();
    return { ...datos(estado.codigos[codigo]), email: emailEnvio };
  }

  // Uno de cada premio, en el orden de la ruleta.
  async function generarUnoDeCada(opciones = {}) {
    const salida = [];
    for (const p of PREMIOS) salida.push(await generar(p.id, opciones));
    return salida;
  }

  // Resumen para el panel: cuántos giraron y cuántos usaron cada premio.
  // Los códigos que generó el dueño no son giros: van aparte.
  async function resumen() {
    await cargar();
    const por = {};
    for (const p of PREMIOS) por[p.id] = { etiqueta: p.etiqueta, giros: 0, usados: 0 };
    let manuales = 0;
    for (const reg of Object.values(estado.codigos)) {
      if (reg.manual) { manuales++; continue; }
      if (!por[reg.premio]) continue;
      por[reg.premio].giros++;
      if (reg.usado) por[reg.premio].usados++;
    }
    const giros = Object.values(por).reduce((s, x) => s + x.giros, 0);
    const usados = Object.values(por).reduce((s, x) => s + x.usados, 0);
    return { giros, usados, porPremio: por, manuales };
  }

  // Para el panel (con clave): cada persona que dejó su correo, del más
  // nuevo al más viejo, con su premio y si ya compró, sigue vigente o venció.
  async function lista() {
    await cargar();
    const t = ahora();
    return Object.values(estado.codigos)
      .map(reg => {
        const p = premioPorId(reg.premio);
        return {
          fecha: new Date(reg.creado).toISOString(),
          email: reg.emailEnvio || reg.email || '',
          manual: !!reg.manual,
          premio: p ? p.etiqueta : reg.premio,
          premioId: reg.premio,
          codigo: reg.codigo,
          color: reg.color || null,
          estado: reg.usado ? 'usado' : (t > reg.vence ? 'vencido' : 'vigente'),
          orden: reg.usado ? reg.usado.orden : null,
          vence: new Date(reg.vence).toISOString(),
        };
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

  return { girar, validar, elegirColor, premioParaCobro, marcarUsado, resumen, lista, generar, generarUnoDeCada };
}

// Una sola instancia para server.js, Flow y Transbank (comparten los códigos).
// persist.js se carga recién acá para que los tests usen crearServicio() con
// un almacenamiento en memoria, sin tocar la base de datos.
let instancia = null;
function servicio() {
  if (!instancia) {
    const persist = require('./persist');
    instancia = crearServicio({ load: persist.load, save: persist.save });
  }
  return instancia;
}

module.exports = {
  PREMIOS, VIGENCIA_MS, REGIRO_MS, RESERVA_MS, COLORES_CORREA, MENSAJES, DESECHABLES, LARGO_CODIGO,
  sortear, premioPorId, normalizarCodigo, validarCorreo, enmascarar, crearServicio, servicio,
};
