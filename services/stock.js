// Contador de stock que sobrevive a los redeploys de Render.
//
// Problema anterior: el contador vivía solo en stock.json y Render borra el
// disco en cada deploy, así que el stock volvía al valor inicial.
//
// Cómo funciona ahora:
//  1. STOCK_START = unidades con que partió la venta (env var en Render).
//  2. Al arrancar (y cada 6 horas) se consulta a MercadoPago cuántos pagos
//     aprobados hay desde STOCK_SINCE, y se recalcula: restante = inicio - vendidos.
//     Usa el mismo ACCESS_TOKEN que ya está configurado para cobrar.
//  3. Los pagos por Flow y Webpay descuentan en vivo vía decrementStock()
//     (esos no se pueden reconsultar tras un redeploy; si vendes por esas vías,
//     ajusta con setStock / la URL de ajuste).
//  4. setStock(n) permite fijar el número a mano (endpoint /stock/ajustar).
//
// Variables de entorno en Render:
//   STOCK_START = stock inicial real (ej: 4)
//   STOCK_SINCE = fecha ISO desde la que se cuentan ventas (ej: 2026-07-01)
//   STOCK_KEY   = clave secreta para el endpoint de ajuste manual (opcional)
const fs = require('fs');
const path = require('path');
const https = require('https');

const STOCK_FILE = path.join(__dirname, '..', 'stock.json');
const START = Math.max(0, parseInt(process.env.STOCK_START || '3', 10));

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(STOCK_FILE, 'utf8'));
    if (typeof data.remaining === 'number') return data.remaining;
  } catch (e) { /* archivo no existe aún */ }
  return START;
}

function write(n) {
  try { fs.writeFileSync(STOCK_FILE, JSON.stringify({ remaining: n })); }
  catch (e) { console.error('[stock] Error guardando:', e.message); }
}

let remaining = read();
// Descuentos en vivo (Flow/Webpay) hechos después de la última sincronización
// con MercadoPago, para no perderlos al recalcular.
let ajusteLocal = 0;
const processed = new Set(); // evita descontar dos veces el mismo pago

// Cuenta pagos aprobados en MercadoPago desde STOCK_SINCE (usa paging.total).
function contarVentasMP() {
  return new Promise(resolve => {
    const token = (process.env.ACCESS_TOKEN || '').trim();
    const since = (process.env.STOCK_SINCE || '').trim();
    if (!token || !since) return resolve(null);

    const begin = encodeURIComponent(new Date(since).toISOString());
    const end = encodeURIComponent(new Date().toISOString());
    const opts = {
      hostname: 'api.mercadopago.com',
      path: `/v1/payments/search?status=approved&range=date_created&begin_date=${begin}&end_date=${end}&limit=1`,
      headers: { Authorization: `Bearer ${token}` }
    };
    const req = https.get(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (res.statusCode === 200 && data.paging && typeof data.paging.total === 'number') {
            return resolve(data.paging.total);
          }
          console.error('[stock] MP search error', res.statusCode, raw.substring(0, 200));
          resolve(null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', e => { console.error('[stock] MP req error', e.message); resolve(null); });
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function sincronizar() {
  const vendidasMP = await contarVentasMP();
  if (vendidasMP === null) return; // sin token o sin fecha: se mantiene el conteo local
  const nuevo = Math.max(0, START - vendidasMP - ajusteLocal);
  if (nuevo !== remaining) {
    console.log(`[stock] sincronizado con MercadoPago: ${vendidasMP} vendidas + ${ajusteLocal} locales — quedan ${nuevo}`);
    remaining = nuevo;
    write(remaining);
  }
}

// Sincronizar al arrancar y luego cada 6 horas
sincronizar();
setInterval(sincronizar, 6 * 60 * 60 * 1000);

function getStock() {
  return remaining;
}

// orderId: id único del pago para no descontar duplicados (webhooks repetidos)
// esMP: true cuando el descuento viene del webhook de MercadoPago (esos ya los
// cuenta la sincronización, así que no se suman al ajuste local).
function decrementStock(orderId, esMP) {
  if (orderId) {
    if (processed.has(orderId)) {
      console.log('[stock] pago ya contado:', orderId);
      return remaining;
    }
    processed.add(orderId);
  }
  if (remaining > 0) {
    remaining -= 1;
    if (!esMP) ajusteLocal += 1;
    write(remaining);
  }
  console.log('[stock] unidad descontada — quedan:', remaining);
  return remaining;
}

// Fijar el stock a mano (endpoint /stock/ajustar protegido con STOCK_KEY)
function setStock(n) {
  remaining = Math.max(0, parseInt(n, 10) || 0);
  ajusteLocal = 0;
  write(remaining);
  console.log('[stock] ajustado manualmente a', remaining);
  return remaining;
}

module.exports = { getStock, decrementStock, setStock };
