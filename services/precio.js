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
const DESPUES = { precio: 68990, ancla: 74999, off: 8 };

// El sello de descuento se redondea HACIA ABAJO a propósito: 62.990→54.990 es
// 12,70% y se anuncia 12%; 74.999→68.990 es 8,01% y se anuncia 8%. Así lo
// que se entrega siempre es igual o mejor que lo anunciado. Al revés sería
// anunciar una rebaja que después no se aplica.
//
// `ancla` y `off` hoy NO se muestran en el sitio (se anuncia un solo precio),
// pero se mantienen coherentes por si algún día se repone el tachado: el
// SERNAC exige que el "precio anterior" haya sido un precio realmente cobrado,
// y $74.999 nunca lo fue.
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
function calcularMonto({ cantidad, tapones, soloTapones, shippingCost } = {}) {
  const qty = Math.max(1, Math.min(10, parseInt(cantidad) || 1));
  const envio = Math.max(0, Number(shippingCost) || 0);
  const productos = soloTapones
    ? TAPONES_PRICE * qty
    : precioBanda() * qty + (tapones ? UPSELL_TAPONES : 0);
  return {
    qty,
    productos,                                 // subtotal de productos, sin envío
    envio,
    total: productos + envio,                  // lo que se cobra
  };
}

module.exports = {
  SUBIDA_MS, precios, precioBanda, ANTES, DESPUES,
  TAPONES_PRICE, UPSELL_TAPONES, calcularMonto,
};
