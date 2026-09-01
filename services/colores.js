'use strict';
// Colores de un pedido.
//
// Desde que se puede comprar más de una banda, cada unidad lleva SU color, así
// que el pedido viaja con un arreglo (uno por unidad) en vez de un solo string.
//
// El resumen legible ('2 negra + 1 gris') lo arma siempre el backend a partir
// de ese arreglo: es lo que queda en la metadata del pago, y de ahí sale el
// correo de despacho. Si el texto lo mandara el navegador, un pedido podría
// decir un color y haberse pagado otro.

const COLORES = ['negra', 'gris', 'rosada'];
// Plural para el desglose: la banda es femenina, así que '2 negras + 1 gris'.
// Sin esto salía '2 negra + 1 gris' en el correo de despacho.
const PLURAL = { negra: 'negras', gris: 'grises', rosada: 'rosadas' };
const MAX_UNIDADES = 10;   // mismo tope que aceptan las rutas de pago

// Devuelve exactamente `cantidad` colores válidos. Lo que no calce — colores
// inventados, arreglo más corto que la cantidad, huecos — cae al color base,
// así ninguna unidad queda sin color y el largo siempre cuadra con lo cobrado.
function normalizar(colores, cantidad, base) {
  const qty = Math.max(1, Math.min(MAX_UNIDADES, parseInt(cantidad, 10) || 1));
  const porDefecto = COLORES.includes(base) ? base : COLORES[0];
  const lista = Array.isArray(colores) ? colores : [];
  return Array.from({ length: qty }, (_, i) => COLORES.includes(lista[i]) ? lista[i] : porDefecto);
}

// { negra: 2, gris: 1 }, en el orden del catálogo y no en el que vino.
function contar(colores) {
  const cuenta = {};
  for (const c of colores) cuenta[c] = (cuenta[c] || 0) + 1;
  const orden = {};
  for (const c of COLORES) if (cuenta[c]) orden[c] = cuenta[c];
  return orden;
}

// 'negra' si son todas del mismo color (aunque sean 3), '2 negra + 1 gris' si
// van mezcladas. Una compra de un solo color se ve igual que siempre, así que
// los correos y la tabla de pedidos no cambian para la mayoría de las ventas.
function resumen(colores) {
  const cuenta = contar(colores);
  const claves = Object.keys(cuenta);
  if (!claves.length) return '';
  if (claves.length === 1) return claves[0];
  return claves.map(c => cuenta[c] + ' ' + (cuenta[c] > 1 ? (PLURAL[c] || c) : c)).join(' + ');
}

module.exports = { COLORES, PLURAL, MAX_UNIDADES, normalizar, contar, resumen };
