'use strict';
const { precioBanda, descuentoPremio } = require('./precio');
// Ruleta "Gira y gana" (desde el 4-nov-2026, en lugar de la pestaña del
// sorteo mensual). A los 3 segundos en la web aparece la ruleta: la persona
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
//  - Segundo lanzamiento (20-nov-2026, ver otroLanzamiento): quien giró y
//    no ha usado su premio lanza UNA vez más y le llegan los dos códigos para
//    que elija uno. Usar uno anula el otro, así que sigue siendo un premio.
//
// Probabilidades (decisión del dueño, 4-nov-2026; el 6-nov bajó los tapones
// a 0,2% y el 10% OFF a 0,5%, y lo que se liberó pasó al $3.000). El
// 19-nov-2026 el dueño pidió que a quien le salía el 5% le salga el 7%: el 5%
// queda en la ruleta pero sale solo el 0,1% de las veces (no en 0: un premio
// que se ve y nunca sale sería publicidad engañosa), y sus 19,9 puntos pasan
// al 7% (3% → 22,9%). Ese mismo día pidió además que el 7% salga más que el
// $3.000 y dos premios nuevos: un $7.000 OFF (2%) y un $10.000 OFF (1%) que
// va en DORADO en la ruleta de la página. Con un tope de $3.800 de descuento
// promedio por giro, lo que sobra va al 7%: 7% 22,9% → 59%; $3.000
// 61,3% → 22,2%. Suman exactamente 1. Descuento promedio por venta con
// código ≈ $3.794 en plata, sin contar la correa ni los tapones (antes
// ≈ $2.983). test/ruleta.test.js falla si pasa de $3.800.
// El 20-nov el dueño pidió sacar el 10% OFF de la ruleta: ya no se
// muestra ni sale (enRuleta: false, prob 0) y su 0,5% pasó al $10.000 OFF
// (1% → 1,5%). Con eso el descuento promedio por giro queda en ≈ $3.809, y
// el dueño aceptó pasar el tope a $3.810. Sigue definido porque lo usan el correo 11:11 (services/promo.js)
// y los códigos que genera el dueño desde el panel, y para que los códigos
// de 10% ya entregados se puedan seguir canjeando.
const PREMIOS = [
  { id: 'd3000',   etiqueta: '$3.000 OFF',     tipo: 'descuento', monto: 3000, prob: 0.222, prefijo: 'DEUS3K' },
  { id: 'p5',      etiqueta: '5% OFF',         tipo: 'descuento', pct: 5,      prob: 0.001, prefijo: 'DEUS5' },
  { id: 'correa',  etiqueta: 'Correa extra',   tipo: 'correa',                 prob: 0.15,  prefijo: 'CORREA' },
  { id: 'p7',      etiqueta: '7% OFF',         tipo: 'descuento', pct: 7,      prob: 0.59,  prefijo: 'DEUS7' },
  { id: 'd7000',   etiqueta: '$7.000 OFF',     tipo: 'descuento', monto: 7000, prob: 0.02,  prefijo: 'DEUS7K' },
  // El $10.000 va en dorado en la ruleta de la página (GAJOS, dorado: true).
  { id: 'd10000',  etiqueta: '$10.000 OFF',    tipo: 'descuento', monto: 10000, prob: 0.015, prefijo: 'DEUS10K' },
  // Los tapones tienen que poder salir: un premio que se muestra en la ruleta
  // y nunca sale sería publicidad engañosa (SERNAC).
  { id: 'tapones', etiqueta: 'Tapones de oído gratis', tipo: 'tapones',        prob: 0.002, prefijo: 'TAPONES' },
  // Fuera de la ruleta desde el 19-nov-2026 (ver arriba).
  { id: 'p10',     etiqueta: '10% OFF',        tipo: 'descuento', pct: 10,     prob: 0,     prefijo: 'DEUS10', enRuleta: false },
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
// Recordatorio (pedido del dueño, 21-nov-2026): a quien no compró, 5 horas
// después de que se le generó el código, un correo que le recuerda que su
// código vence y le mejora el premio: el descuento sube a 10% OFF (si el suyo
// valía menos) y la correa o los tapones suman un 10% OFF. Si el código se
// generó a las 20:00 o más tarde, sale al otro día. Nunca de noche: solo entre
// las 9:00 y las 22:00 de Chile (lo que caiga fuera sale a las 10:00). Ese mismo
// día pidió que sean DOS: el segundo es el último aviso, 6 horas antes de que
// venza (si eso cae de noche, a las 10:00 si todavía quedan 2 horas para
// comprar; si no, a las 21:00 de la noche anterior), y como mínimo 4 horas
// después del primero. Los manda services/recordatorios.js.
const RECORDATORIO_MS = 5 * 60 * 60 * 1000;
const RECORDATORIO_CORTE = 20;     // hora de Chile: códigos de esta hora en adelante → al otro día
const RECORDATORIO_MANANA = 10;    // hora de Chile a la que sale lo corrido a la mañana
const HORARIO_CORREOS = [9, 22];   // [desde, hasta) en hora de Chile
const ULTIMO_ANTES_MS = 6 * 60 * 60 * 1000;   // el 2º recordatorio, 6 h antes de que venza
const MARGEN_COMPRA_MS = 2 * 60 * 60 * 1000;  // nunca con menos de 2 h para comprar
const ENTRE_RECORDATORIOS_MS = 4 * 60 * 60 * 1000;
const NOCHE_ANTERIOR = 21;                    // hora de Chile del 2º si la mañana ya no alcanza
const MEJORA_PCT = 10;
const ZONA = 'America/Santiago';

// Fecha y hora de Chile (con su horario de verano) de un instante en ms.
const FMT_CHILE = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function partesChile(t) {
  const o = {};
  for (const x of FMT_CHILE.formatToParts(new Date(t))) o[x.type] = x.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: (+o.hour) % 24, mi: +o.minute };
}
// Instante de la hora `h` en punto del día (y, mo, d) en Chile.
function instanteChile(y, mo, d, h) {
  const meta = Date.UTC(y, mo - 1, d, h);
  let t = meta;
  for (let i = 0; i < 3; i++) { const p = partesChile(t); t += meta - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); }
  return t;
}
function enHorarioCorreos(t) {
  const h = partesChile(t).h;
  return h >= HORARIO_CORREOS[0] && h < HORARIO_CORREOS[1];
}
// Cuándo sale el recordatorio de un código generado en el instante `generado`.
function momentoRecordatorio(generado) {
  let t = generado + RECORDATORIO_MS;
  if (partesChile(generado).h >= RECORDATORIO_CORTE || !enHorarioCorreos(t)) {
    const p = partesChile(t);
    let m = instanteChile(p.y, p.mo, p.d, RECORDATORIO_MANANA);
    if (m < t) { const q = partesChile(t + 24 * 60 * 60 * 1000); m = instanteChile(q.y, q.mo, q.d, RECORDATORIO_MANANA); }
    t = m;
  }
  return t;
}
// Cuándo sale el 2º recordatorio (último aviso) de un código que vence en `vence`.
function momentoUltimoRecordatorio(vence) {
  const t = vence - ULTIMO_ANTES_MS;
  if (enHorarioCorreos(t)) return t;
  const p = partesChile(t);
  let m = instanteChile(p.y, p.mo, p.d, RECORDATORIO_MANANA);
  if (m < t) { const q = partesChile(t + 24 * 60 * 60 * 1000); m = instanteChile(q.y, q.mo, q.d, RECORDATORIO_MANANA); }
  if (m <= vence - MARGEN_COMPRA_MS) return m;
  const n = p.h >= HORARIO_CORREOS[1] ? p : partesChile(t - 24 * 60 * 60 * 1000);
  return instanteChile(n.y, n.mo, n.d, NOCHE_ANTERIOR);
}
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
  'par-usado': 'Ya usaste el otro código de tu ruleta: los dos premios eran para elegir uno.',
  'sin-giro': 'Primero gira la ruleta con tu correo.',
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
    if (p.enRuleta === false) continue;
    acumulado += p.prob;
    if (r < acumulado) return p;
  }
  return PREMIOS[0]; // por redondeo de coma flotante, nunca debería llegar acá
}

// El segundo lanzamiento: el mismo sorteo pero SIN el premio que ya tiene.
// Si no, más de un tercio de las veces le saldría lo mismo (el 7% sale el
// 59%) y no habría nada que elegir. Los demás premios mantienen su peso.
function sortearOtro(r, excluir) {
  const opciones = PREMIOS.filter(p => p.enRuleta !== false && p.prob > 0 && p.id !== excluir);
  const total = opciones.reduce((s, p) => s + p.prob, 0);
  let acumulado = 0;
  for (const p of opciones) {
    acumulado += p.prob / total;
    if (r < acumulado) return p;
  }
  return opciones[opciones.length - 1];
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
    // Con recordatorio: el premio mejorado (mejora = 'p10') o el mismo más un %.
    const p = premioPorId(reg.mejora || reg.premio);
    const premio = premioPublico(p);
    if (reg.mejora) premio.mejoradoDe = reg.premio;
    if (reg.extraPct) premio.pctExtra = reg.extraPct;
    return {
      codigo: reg.codigo,
      premio,
      color: reg.color || null,
      vence: new Date(reg.vence).toISOString(),
    };
  }
  // Los dos códigos de un segundo lanzamiento se apuntan entre sí (reg.par):
  // es uno u otro, así que si usó el otro, este ya no sirve.
  function parDe(reg) {
    return reg && reg.par && tiene(estado.codigos, reg.par) ? estado.codigos[reg.par] : null;
  }
  function usadoPar(reg) {
    const p = parDe(reg);
    return reg.usado || (p && p.usado) || null;
  }
  // Lo que va en el correo: uno o, si lanzó dos veces, los dos códigos.
  function paraElCorreo(reg) {
    const p = parDe(reg);
    const o = { ...datos(reg), email: reg.emailEnvio || reg.email };
    if (p) o.otro = datos(p);
    return o;
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
      const usado = usadoPar(reg);
      if (usado || t < giraDesde) {
        const reenviar = !usado && t <= reg.vence && (!reg.ultimoEnvio || t - reg.ultimoEnvio > REENVIO_MS);
        if (reenviar) { reg.ultimoEnvio = t; await guardar(); }
        const pub = datos(reg);
        delete pub.codigo;
        delete pub.color;
        pub.usado = !!usado;
        if (!usado && t > reg.vence) pub.giraDesde = new Date(giraDesde).toISOString();
        return { yaGiro: true, reenviar, publico: { yaGiro: true, ...pub }, paraCorreo: paraElCorreo(reg) };
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

  // "Otra oportunidad de lanzamiento" (pedido del dueño, 20-nov-2026): quien
  // ya giró y todavía no usa su premio lanza UNA vez más. Sale un premio
  // distinto al primero (sortearOtro) y le llegan los DOS códigos al correo
  // para que elija: usar uno anula el otro (validar → 'par-usado'). Los dos
  // vencen juntos, 48 h desde este segundo lanzamiento.
  // Se pide con el correo Y el código del primer giro: lo tiene solo quien
  // giró (en su navegador o en su correo), no cualquiera que escriba un
  // correo ajeno. Si ya lanzó dos veces, devuelve lo mismo (no sale otro).
  async function otroLanzamiento(email, codigoAnterior) {
    await cargar();
    const v = validarCorreo(email);
    if (!v.ok) throw error(v.tipo);
    const c1 = normalizarCodigo(codigoAnterior);
    const reg1 = tiene(estado.porCorreo, v.clave) && estado.porCorreo[v.clave] === c1 ? buscar(c1) : null;
    if (!reg1) throw error('sin-giro');
    if (usadoPar(reg1)) throw error('usado');
    const t = ahora();
    if (t > reg1.vence) throw error('vencido');
    const ya = parDe(reg1);
    if (ya) return { yaLanzo: true, reenviar: false, publico: { yaLanzo: true, ...datos(ya), anterior: datos(reg1) }, paraCorreo: paraElCorreo(reg1) };
    const premio = sortearOtro(aleatorio(), reg1.premio);
    const codigo = nuevoCodigo(premio.prefijo);
    const reg2 = { codigo, premio: premio.id, email: reg1.email, emailEnvio: reg1.emailEnvio, creado: t, vence: t + VIGENCIA_MS, color: null, usado: null, reserva: null, ultimoEnvio: t, par: reg1.codigo, segundo: true };
    estado.codigos[codigo] = reg2;
    reg1.par = codigo;
    reg1.vence = reg2.vence;
    reg1.ultimoEnvio = t;
    await guardar();
    return { yaLanzo: false, reenviar: true, publico: { yaLanzo: false, ...datos(reg2), anterior: datos(reg1) }, paraCorreo: paraElCorreo(reg1) };
  }

  // ¿Sirve este código para pagar ahora? { ok, error, mensaje, ...datos }
  async function validar(codigo) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg) return { ok: false, error: 'no-existe', mensaje: MENSAJES['no-existe'] };
    if (reg.usado) return { ok: false, error: 'usado', mensaje: MENSAJES.usado };
    const par = parDe(reg);
    if (par && par.usado) return { ok: false, error: 'par-usado', mensaje: MENSAJES['par-usado'] };
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
    if (reg.extraPct) r.pctExtra = reg.extraPct; // recordatorio: correa o tapones + %
    return r;
  }

  // Al aprobarse el pago. Idempotente: un reaviso de la pasarela no lo pisa.
  // `extra`: lo que de verdad se descontó en esa compra (descuento, en pesos,
  // el mismo de calcularMonto) y cuántas bandas llevaba (unidades). Lo usa el
  // gasto diario de la ruleta del panel (gastoPorDia); los códigos usados
  // antes del 23-nov-2026 no lo traen y ahí se calcula con la regla del premio.
  async function marcarUsado(codigo, orden, extra = {}) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg || reg.usado) return false;
    reg.usado = { orden: String(orden || ''), fecha: new Date(ahora()).toISOString() };
    const d = Number(extra && extra.descuento), u = Number(extra && extra.unidades);
    if (extra && extra.descuento != null && Number.isFinite(d) && d >= 0) reg.usado.descuento = Math.round(d);
    if (u > 0) reg.usado.unidades = Math.round(u);
    reg.reserva = null;
    await guardar();
    return true;
  }

  // Gasto de la ruleta por día de Chile (pedido del dueño, 23-nov-2026): lo que
  // se llevó en premio cada persona que COMPRÓ con su código, en el día de la
  // compra. El descuento ya viene restado de lo que pagó (el "vendido" de la
  // utilidad diaria), así que el panel lo muestra como dato y no lo resta de
  // nuevo. La correa y los tapones de premio se cuentan aparte: no tienen un
  // costo cargado, y una cifra inventada ensuciaría la utilidad.
  // `opciones.buscarVenta(orden)` (metrics.buscarVenta): si viene, solo cuentan
  // las compras que siguen en el registro de ventas (las mismas que suman en
  // el panel), y de ahí sale cuántas bandas llevaba una compra anterior a que
  // se guardara el descuento.
  async function gastoPorDia(opciones = {}) {
    await cargar();
    const buscarVenta = typeof opciones.buscarVenta === 'function' ? opciones.buscarVenta : null;
    const dias = {};
    for (const reg of Object.values(estado.codigos)) {
      const u = reg.usado;
      if (!u || !u.fecha) continue;
      const venta = buscarVenta ? buscarVenta(u.orden) : null;
      if (buscarVenta && !venta) continue;
      // Con recordatorio: el premio mejorado (mejora = 'p10') o el mismo más un %.
      const p = premioPorId(reg.mejora || reg.premio);
      if (!p) continue;
      const fecha = new Date(u.fecha).toLocaleDateString('en-CA', { timeZone: ZONA });
      const dia = dias[fecha] || (dias[fecha] = { ruleta: 0, usados: 0, correas: 0, tapones: 0, estimado: false, detalle: {} });
      let pesos;
      if (typeof u.descuento === 'number') pesos = u.descuento;
      else {
        const qty = Number(u.unidades) || (venta && Number(venta.unidades)) || 1;
        const premio = { tipo: p.tipo, monto: p.monto, pct: p.pct, pctExtra: reg.extraPct };
        pesos = Math.min(descuentoPremio(premio, qty), precioBanda() * qty);
        dia.estimado = true;
      }
      dia.ruleta += pesos;
      dia.usados += 1;
      if (p.tipo === 'correa') dia.correas += 1;
      if (p.tipo === 'tapones') dia.tapones += 1;
      const etiqueta = p.etiqueta + (reg.mejora ? ' (recordatorio)' : '') + (reg.extraPct ? ' + ' + reg.extraPct + '% OFF' : '');
      const det = dia.detalle[etiqueta] || (dia.detalle[etiqueta] = { n: 0, pesos: 0 });
      det.n += 1;
      det.pesos += pesos;
    }
    return dias;
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
    let manuales = 0, segundos = 0;
    for (const reg of Object.values(estado.codigos)) {
      if (reg.manual) { manuales++; continue; }
      if (reg.segundo) segundos++;
      if (!por[reg.premio]) continue;
      por[reg.premio].giros++;
      if (reg.usado) por[reg.premio].usados++;
    }
    const giros = Object.values(por).reduce((s, x) => s + x.giros, 0);
    const usados = Object.values(por).reduce((s, x) => s + x.usados, 0);
    return { giros, usados, porPremio: por, manuales, segundos };
  }

  // Para el panel (con clave): cada persona que dejó su correo, del más
  // nuevo al más viejo, con su premio y si ya compró, sigue vigente o venció.
  // Con segundo lanzamiento son dos filas (segundo: true en la segunda); la
  // que no eligió queda 'anulado' cuando usa la otra.
  async function lista() {
    await cargar();
    const t = ahora();
    return Object.values(estado.codigos)
      .map(reg => {
        const p = premioPorId(reg.premio);
        const pm = reg.mejora ? premioPorId(reg.mejora) : null;
        const par = parDe(reg);
        const etiqueta = (p ? p.etiqueta : reg.premio) + (pm ? ' → ' + pm.etiqueta : '') + (reg.extraPct ? ' + ' + reg.extraPct + '% OFF' : '');
        return {
          fecha: new Date(reg.creado).toISOString(),
          email: reg.emailEnvio || reg.email || '',
          manual: !!reg.manual,
          segundo: !!reg.segundo,
          par: par ? par.codigo : null,
          premio: etiqueta,
          premioId: reg.premio,
          mejorado: !!(reg.mejora || reg.extraPct),
          recordatorio: reg.recordatorio ? reg.recordatorio.fecha : null,
          recordatorioResultado: reg.recordatorio ? reg.recordatorio.resultado : null,
          recordatorio2: reg.recordatorio2 && reg.recordatorio2.resultado === 'enviado' ? reg.recordatorio2.fecha : null,
          codigo: reg.codigo,
          color: reg.color || null,
          estado: reg.usado ? 'usado' : (par && par.usado) ? 'anulado' : (t > reg.vence ? 'vencido' : 'vigente'),
          orden: reg.usado ? reg.usado.orden : null,
          vence: new Date(reg.vence).toISOString(),
        };
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

  // ── Recordatorio (ver RECORDATORIO_MS) ──
  // El premio mejorado: descuento que vale menos de 10% → 10% OFF; correa o
  // tapones → el mismo premio + 10% OFF. Un descuento que ya vale 10% o más
  // ($7.000, $10.000) se queda como está. No hace nada si ya se mejoró.
  function mejorar(reg) {
    const p = premioPorId(reg.premio);
    if (!p || reg.mejora || reg.extraPct) return;
    if (p.tipo === 'descuento') {
      const precio = precioBanda();
      const vale = p.monto ? p.monto : Math.ceil(precio * p.pct / 100);
      if (vale < Math.ceil(precio * MEJORA_PCT / 100)) reg.mejora = 'p10';
    } else {
      reg.extraPct = MEJORA_PCT;
    }
  }
  // Quienes ya deberían recibirlo: una fila por persona (su giro actual), sin
  // usar, sin vencer, sin recordatorio todavía y con la hora cumplida. Con
  // segundo lanzamiento cuenta desde el segundo (el correo con los dos códigos).
  // vez: 1 (el primero, con la mejora) o 2 (el último aviso). El 2º solo si el
  // 1º se mandó, con su hora cumplida y al menos 4 h después del 1º.
  async function pendientesRecordatorio() {
    await cargar();
    const t = ahora(), out = [];
    for (const codigo of Object.values(estado.porCorreo)) {
      const reg = tiene(estado.codigos, codigo) ? estado.codigos[codigo] : null;
      if (!reg || reg.manual || usadoPar(reg) || t > reg.vence) continue;
      const fila = { codigo: reg.codigo, email: reg.emailEnvio || reg.email, clave: reg.email, vence: reg.vence };
      if (!reg.recordatorio) {
        const par = parDe(reg);
        if (t >= momentoRecordatorio(Math.max(reg.creado, par ? par.creado : 0))) out.push({ ...fila, vez: 1 });
      } else if (reg.recordatorio.resultado === 'enviado' && !reg.recordatorio2
        && t >= momentoUltimoRecordatorio(reg.vence)
        && t >= Date.parse(reg.recordatorio.fecha) + ENTRE_RECORDATORIOS_MS) {
        out.push({ ...fila, vez: 2 });
      }
    }
    return out;
  }
  // Mejora el premio (y el del otro código si lanzó dos veces) y devuelve lo
  // que va en el correo. No marca el envío: eso lo hace marcarRecordatorio.
  async function prepararRecordatorio(codigo, vez = 1) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg) return null;
    const regs = [reg, parDe(reg)].filter(Boolean);
    const antes = regs.map(r => premioPublico(premioPorId(r.premio)));
    regs.forEach(mejorar); // en el 2º ya está mejorado: no cambia nada
    await guardar();
    return {
      email: reg.emailEnvio || reg.email,
      vez: vez === 2 ? 2 : 1,
      vence: new Date(reg.vence).toISOString(),
      horasQuedan: Math.max(1, Math.floor((reg.vence - ahora()) / (60 * 60 * 1000))),
      codigos: regs.map((r, i) => ({ ...datos(r), antes: antes[i] })),
    };
  }
  // Cuántos recordatorios (1º y 2º) salieron hoy, día de Chile: para el tope diario.
  async function recordatoriosHoy() {
    await cargar();
    const h = partesChile(ahora()), mismoDia = f => { const p = partesChile(Date.parse(f)); return p.y === h.y && p.mo === h.mo && p.d === h.d; };
    let n = 0;
    for (const reg of Object.values(estado.codigos)) {
      for (const r of [reg.recordatorio, reg.recordatorio2]) if (r && r.resultado === 'enviado' && mismoDia(r.fecha)) n++;
    }
    return n;
  }
  // resultado: 'enviado' | 'compro' (ya compró: no se le escribe más) | 'fallo'.
  async function marcarRecordatorio(codigo, resultado, vez = 1) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg) return false;
    const m = { fecha: new Date(ahora()).toISOString(), resultado: String(resultado || 'enviado') };
    if (vez === 2) reg.recordatorio2 = m;
    else reg.recordatorio = m;
    if (m.resultado === 'compro' && vez !== 2) reg.recordatorio2 = m; // tampoco el último aviso
    await guardar();
    return true;
  }
  // Un envío que falló (sin ser falta de cuota). A los `max` fallos se da por perdido.
  async function falloRecordatorio(codigo, max = 3, vez = 1) {
    await cargar();
    const reg = buscar(codigo);
    if (!reg) return false;
    const k = vez === 2 ? 'recordatorio2Fallos' : 'recordatorioFallos';
    reg[k] = (reg[k] || 0) + 1;
    if (reg[k] >= max) reg[vez === 2 ? 'recordatorio2' : 'recordatorio'] = { fecha: new Date(ahora()).toISOString(), resultado: 'fallo' };
    await guardar();
    return true;
  }

  return { girar, otroLanzamiento, validar, elegirColor, premioParaCobro, marcarUsado, gastoPorDia, resumen, lista, generar, generarUnoDeCada,
    pendientesRecordatorio, prepararRecordatorio, marcarRecordatorio, falloRecordatorio, recordatoriosHoy };
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
  sortear, sortearOtro, premioPorId, normalizarCodigo, validarCorreo, enmascarar, crearServicio, servicio,
  RECORDATORIO_MS, MEJORA_PCT, partesChile, enHorarioCorreos, momentoRecordatorio, momentoUltimoRecordatorio,
};
