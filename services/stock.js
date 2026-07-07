// Contador de stock con persistencia en archivo.
// Baja 1 unidad cada vez que un pago es CONFIRMADO (mismo momento en que
// llega el correo de "pago confirmado"). Los 3 medios de pago —MercadoPago,
// Flow y Webpay— llaman a decrementStock() al aprobar.
//
// STOCK_START define el stock inicial (por defecto 3). En Render el archivo
// vive durante el tiempo que el servidor esté activo; tras un redeploy vuelve
// a STOCK_START.
const fs = require('fs');
const path = require('path');

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
const processed = new Set(); // evita descontar dos veces el mismo pago

function getStock() {
  return remaining;
}

// orderId: id único del pago para no descontar duplicados (webhooks repetidos)
function decrementStock(orderId) {
  if (orderId) {
    if (processed.has(orderId)) {
      console.log('[stock] pago ya contado:', orderId);
      return remaining;
    }
    processed.add(orderId);
  }
  if (remaining > 0) {
    remaining -= 1;
    write(remaining);
  }
  console.log('[stock] unidad descontada — quedan:', remaining);
  return remaining;
}

module.exports = { getStock, decrementStock };
