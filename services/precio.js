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
const DESPUES = { precio: 68990, ancla: 78990, off: 12 };

// El sello de descuento se redondea HACIA ABAJO a propósito: 62.990→54.990 es
// 12,70% y se anuncia 12%; 78.990→68.990 es 12,66% y se anuncia 12%. Así lo
// que se entrega siempre es igual o mejor que lo anunciado. Al revés sería
// anunciar una rebaja que después no se aplica.
//
// Desde el 4-oct-2026 el sitio vuelve a mostrar el tachado ($78.990 → $68.990,
// -12%) por decisión del dueño. Ojo: el SERNAC exige que el "precio anterior"
// haya sido un precio realmente cobrado, y la banda se vendió a $54.990,
// $62.990 y $68.990; $78.990 solo se usó antes como ancla.
function precios(ahora = Date.now()) {
  return ahora < SUBIDA_MS ? ANTES : DESPUES;
}

// Firma compatible con las cuatro copias que reemplaza: se sigue llamando
// precioBanda() sin argumentos desde todos los sitios existentes.
const precioBanda = (ahora) => precios(ahora).precio;

// Tapones de oído: DOS precios distintos y no son intercambiables. UPSELL es lo
// que cuestan agregados a la compra de una banda; TAPONES_PRICE es lo que
// cuestan comprados solos. Vivían declarados por separado en server.js,
// flow.js y transbank.js — el mismo error que este archivo existe para evitar.
const TAPONES_PRICE  = 14990;   // comprados solos, sin banda
const UPSELL_TAPONES = 12990;   // agregados a la compra de una banda

// El monto que se cobra, en UN solo lugar.
//
// Antes esta fórmula estaba copiada NUEVE veces: el cobro, el registro del
// pedido y el aviso de pago fallido, en cada uno de server.js, flow.js y
// transbank.js, mas TAPONES_PRICE declarado tres veces y el 12990 del upsell
// escrito a mano en seis. Copias asi son las que terminan cobrando distinto
// segun la pasarela por la que entro el cliente. Las tres llaman a esta.
//
// `ahora` solo existe para los tests: en producción manda el reloj del servidor.
function calcularMonto({ cantidad, tapones, soloTapones, shippingCost, ahora = Date.now() } = {}) {
  const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));
  const envio = Math.max(0, Number(shippingCost) || 0);
  const bandas = soloTapones ? 0 : subtotalBandas(qty, ahora);
  const productos = soloTapones
    ? TAPONES_PRICE * qty
    : bandas + (tapones ? UPSELL_TAPONES : 0);
  return {
    qty,
    productos,                                 // subtotal de productos, sin envío
    envio,
    total: productos + envio,                  // lo que se cobra
    bandas,                                    // subtotal de las bandas (con la promo del par)
    unitario: precioBanda(ahora),              // precio de lista de UNA banda
    par: soloTapones ? 0 : precioPar(ahora),   // precio del par si la promo corre, si no 0
  };
}

// Cyber de octubre: toda compra CON banda lleva de regalo los tapones DEUS
// (en la web se descubren raspando en el checkout). Se decide al crear el
// pedido, con el reloj del servidor: quien compra el miércoles 7 a las 23:58 y
// paga a las 00:05 igual recibe su regalo. Una compra de solo tapones no suma
// otros tapones. CYBER_FIN_MS es el mismo corte que la clase html.cyber del
// sitio: jueves 8-oct 00:00 de Chile (03:00 UTC, horario de verano).
const CYBER_FIN_MS = Date.UTC(2026, 9, 8, 3, 0, 0);

function regaloCyber({ soloTapones } = {}, ahora = Date.now()) {
  return !soloTapones && ahora < CYBER_FIN_MS;
}

// Promo Cyber "2 x $119.990": cada PAR de bandas cuesta $119.990 y la que
// queda impar va a precio de lista (3 = $119.990 + $68.990). Corta junto con
// el regalo de tapones, a la misma hora (CYBER_FIN_MS).
//
// Se anuncia "2 x $119.990" y NUNCA "2x1": en Chile "2x1" se lee como
// "llevas 2 y pagas 1", y acá el par cuesta más que una sola banda. Anunciarlo
// así sería publicidad engañosa (y el dueño lo pidió corregir por confuso).
const PRECIO_PAR = 119990;

function precioPar(ahora = Date.now()) {
  return ahora < CYBER_FIN_MS ? PRECIO_PAR : 0;
}

// El subtotal de N bandas. Math.min: si algún día sube el precio de lista y el
// par queda más caro que dos sueltas, se cobra lo más barato — una promo nunca
// puede encarecer la compra.
function subtotalBandas(qty, ahora = Date.now()) {
  const una = precioBanda(ahora);
  const par = Math.min(precioPar(ahora) || Infinity, 2 * una);
  return Math.floor(qty / 2) * par + (qty % 2) * una;
}

module.exports = {
  SUBIDA_MS, precios, precioBanda, ANTES, DESPUES,
  TAPONES_PRICE, UPSELL_TAPONES, calcularMonto,
  CYBER_FIN_MS, regaloCyber,
  PRECIO_PAR, precioPar, subtotalBandas,
};
