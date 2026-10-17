'use strict';
// Métricas de SOLO LECTURA: para analizar la conversión desde fuera del panel
// (por ejemplo, Claude en una sesión en la nube) sin la clave admin.
//
// Dos reglas:
//  1. Clave aparte (METRICAS_KEY). Solo abre lecturas: no sirve para cambiar
//     stock, anuncios, reseñas ni nada.
//  2. Solo números agregados. La respuesta se arma con una lista de campos
//     PERMITIDOS, no con una de prohibidos: si mañana el resumen de métricas
//     suma un campo con datos de clientes, no se cuela solo por estar ahí.
//     (Por eso no va `tickets`, que trae nombre, correo e Instagram.)

const crypto = require('crypto');

// Campos de metrics.snapshot() que viajan. Todos son conteos, montos o
// fechas sin nombre de nadie.
const CAMPOS = [
  'visitantesEnVivo', 'vistasHoy', 'vistasTotal', 'conversionHoy', 'tiempoPromedioSeg',
  'ventas', 'ultimos30', 'ventas30', 'ticketsTotal', 'conversion', 'embudo',
  'conducta', 'conductaPorDia', 'vistasPorDia', 'conversionAccion', 'conversionesN',
  'ticketPromedio', 'ventasPorMomento', 'ventasPorMetodo', 'conversionPorDia',
  'ventasRecientes', 'fallosChat'
];

// Comparación en tiempo constante: no deja adivinar la clave por cuánto tarda.
function claveValida(enviada, real) {
  const a = Buffer.from(String(enviada || ''));
  const b = Buffer.from(String(real || ''));
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// `pedidos`: la lista completa del servidor. De ahí solo salen conteos por
// color (por unidad, como en el panel) y por comuna.
function armar(snap, pedidos, stock) {
  const out = {};
  for (const k of CAMPOS) if (snap && snap[k] !== undefined) out[k] = snap[k];
  const porColor = {}, porComuna = {};
  for (const p of pedidos || []) {
    const c = (p.color || '—').toString().trim();
    const unidades = (Array.isArray(p.colores) && p.colores.length)
      ? p.colores
      : Array.from({ length: Math.max(1, parseInt(p.cantidad, 10) || 1) }, () => c);
    for (const u of unidades) porColor[u] = (porColor[u] || 0) + 1;
    const cm = (p.shipping && p.shipping.address && p.shipping.address.commune || '—').toString().trim();
    porComuna[cm] = (porComuna[cm] || 0) + 1;
  }
  out.pedidosPorColor = porColor;
  out.pedidosPorComuna = porComuna;
  out.pedidosTotal = (pedidos || []).length;
  out.stock = stock;
  out.generado = new Date().toISOString();
  return out;
}

module.exports = { CAMPOS, claveValida, armar };
