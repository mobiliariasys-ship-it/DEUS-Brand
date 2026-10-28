// Precio de la banda y su ancla tachada, en un solo lugar.
//
// Antes esto vivía duplicado en server.js, routes/flow.js, routes/transbank.js
// y routes/chat.js: cuatro copias del mismo número, y entre ellas las dos
// pasarelas de pago. Bastaba olvidarse de una al subir el precio para cobrar
// distinto según por dónde entrara el cliente. Ahora los cuatro leen de acá.
//
// SUBIDA_MS es el instante exacto en que sube el precio, y coincide con el fin
// del ciclo de oferta que muestra el contador de la web: 27-ago-2026 06:00 UTC
// = 02:00 de Chile. Está acá para no tener que hacer un deploy a esa hora — el
// backend cambia solo, y el sitio lo lee del endpoint /stock.
const SUBIDA_MS = Date.UTC(2026, 7, 27, 6, 0, 0);

const ANTES   = { precio: 54990, ancla: 62990, off: 12 };
const DESPUES = { precio: 68990, ancla: 0, off: 0 };   // sin tachado (ver abajo)

// El sello de descuento se redondea HACIA ABAJO a propósito: 62.990→54.990 es
// 12,70% y se anuncia 12%; 78.990→68.990 es 12,66% y se anuncia 12%. Así lo
// que se entrega siempre es igual o mejor que lo anunciado. Al revés sería
// anunciar una rebaja que después no se aplica.
//
// Desde el 9-oct-2026 NO hay tachado: el dueño sacó el $78.990 (y con él el
// -12%). ancla 0 y off 0 = el sitio muestra solo el precio real. Para volver a
// mostrar un tachado, ojo: el SERNAC exige que el "precio anterior" haya sido
// un precio realmente cobrado (la banda se vendió a $54.990, $62.990 y
// $68.990; $78.990 solo se usó como ancla).
function precios(ahora = Date.now()) {
  return ahora < SUBIDA_MS ? ANTES : DESPUES;
}

// Firma compatible con las cuatro copias que reemplaza: se sigue llamando
// precioBanda() sin argumentos desde todos los sitios existentes.
const precioBanda = (ahora) => precios(ahora).precio;

// Tapones de oído: DOS precios y no son intercambiables. UPSELL es lo que
// cuestan agregados a la compra de una banda; TAPONES_PRICE es lo que cuestan
// comprados solos. Desde el 12-oct-2026 valen lo mismo ($18.990, decisión del
// dueño), pero siguen separados por si vuelven a tener precios distintos. Vivían declarados por separado en server.js,
// flow.js y transbank.js — el mismo error que este archivo existe para evitar.
const TAPONES_PRICE  = 18990;   // comprados solos, sin banda
const UPSELL_TAPONES = 18990;   // agregados a la compra de una banda

// Correas extra: desde el 27-oct-2026 son el upsell del checkout en vez de los
// tapones (decisión del dueño). Cada PAR es una correa de silicona negra + una
// de nylon con velcro; hay dos pares, que cambian solo en el color del nylon.
// $18.990 el par, y se puede llevar uno, el otro o los dos. El navegador manda
// las claves ('negras', 'grises'); lo que se cobra y lo que va al correo de
// despacho sale de acá, nunca de un texto que arme el navegador.
const CORREAS_PRICE = 18990;   // por par
const CORREAS = {
  negras: { nombre: 'Correas extra negras', detalle: 'Correa de silicona negra + correa de nylon negra' },
  grises: { nombre: 'Correas extra grises', detalle: 'Correa de silicona negra + correa de nylon gris' },
};

// Solo pares conocidos, sin repetir y siempre en el mismo orden. Acepta el
// arreglo del navegador o el texto 'negras,grises' que vuelve en la metadata
// de Mercado Pago.
function normalizarCorreas(correas) {
  const lista = Array.isArray(correas) ? correas.map(String)
    : (typeof correas === 'string' ? correas.split(',') : []);
  return Object.keys(CORREAS).filter(k => lista.includes(k));
}

// El monto que se cobra, en UN solo lugar.
//
// Antes esta fórmula estaba copiada NUEVE veces: el cobro, el registro del
// pedido y el aviso de pago fallido, en cada uno de server.js, flow.js y
// transbank.js, mas TAPONES_PRICE declarado tres veces y el 12990 del upsell
// escrito a mano en seis. Copias asi son las que terminan cobrando distinto
// segun la pasarela por la que entro el cliente. Las tres llaman a esta.
function calcularMonto({ cantidad, tapones, correas, soloTapones, shippingCost } = {}) {
  const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));
  const envio = Math.max(0, Number(shippingCost) || 0);
  // Las correas son extras de la banda: en una compra de solo tapones no van.
  const pares = soloTapones ? [] : normalizarCorreas(correas);
  const productos = soloTapones
    ? TAPONES_PRICE * qty
    : precioBanda() * qty + (tapones ? UPSELL_TAPONES : 0) + CORREAS_PRICE * pares.length;
  return {
    qty,
    correas: pares,                            // pares de correas extra que se cobran
    productos,                                 // subtotal de productos, sin envío
    envio,
    total: productos + envio,                  // lo que se cobra
  };
}

// Promoción de tapones: con PROMO_TAPONES en true, toda compra CON banda lleva
// de regalo los tapones DEUS (en la web se descubren raspando en el checkout).
// Nació como regalo del Cyber de octubre (5 al 7) y siguió sin la marca Cyber
// hasta el 11-oct-2026, cuando el dueño la apagó: queda solo el envío gratis.
// Se decide al crear el pedido. Una compra de solo tapones no suma otros.
// Para prenderla de nuevo, las DOS cosas a la vez: PROMO_TAPONES acá y la
// clase html.promo en el <head> de index.html.
const PROMO_TAPONES = false;

// Lo que dice el pedido ('DEUS Band x2 + Correas extra negras'), igual en las
// tres pasarelas. Va al correo, al panel y al asunto de Flow.
function nombreProducto({ qty, tapones, correas, soloTapones } = {}) {
  const x = qty > 1 ? ` x${qty}` : '';
  if (soloTapones) return 'Tapones de oído DEUS' + x;
  return 'DEUS Band' + x + (tapones ? ' + Tapones de oído' : '')
    + normalizarCorreas(correas).map(k => ' + ' + CORREAS[k].nombre).join('');
}

function llevaRegaloTapones({ soloTapones } = {}) {
  return PROMO_TAPONES && !soloTapones;
}

module.exports = {
  SUBIDA_MS, precios, precioBanda, ANTES, DESPUES,
  TAPONES_PRICE, UPSELL_TAPONES, calcularMonto,
  CORREAS_PRICE, CORREAS, normalizarCorreas, nombreProducto,
  PROMO_TAPONES, llevaRegaloTapones,
};
