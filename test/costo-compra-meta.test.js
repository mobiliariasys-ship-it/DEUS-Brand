'use strict';
// "Costo por compra · Meta" en Utilidad diaria: gasto sin IVA ÷ compras que
// Meta les atribuye a los anuncios, como lo muestra Ads Manager. Reemplaza a
// "Días con venta" (pedido del dueño).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.META_ADS_ACCESS_TOKEN = 'token-de-prueba';
process.env.META_AD_ACCOUNT_ID = 'act_prueba';

const meta = require('../services/meta-ads');
const u = require('../services/utilidad');

const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
function respuesta(data) {
  return { ok: true, headers: { get: () => null }, json: async () => ({ data, paging: {} }) };
}

test('las compras de Meta no se cuentan dos veces (omni_purchase ya incluye las del píxel)', async () => {
  global.fetch = async () => respuesta([{
    date_start: hoy, date_stop: hoy, spend: '30000',
    actions: [
      { action_type: 'omni_purchase', value: '3' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
      { action_type: 'landing_page_view', value: '120' }
    ]
  }]);
  const r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.via, 'cuenta');
  assert.strictEqual(r.mapa[hoy], 30000);
  assert.strictEqual(r.compras[hoy], 3, 'tienen que ser 3 compras, no 6');
});

test('sin omni_purchase se usan las del píxel, y un día sin compras queda en 0', async () => {
  global.fetch = async () => respuesta([
    { date_start: hoy, date_stop: hoy, spend: '10000', actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' }] }
  ]);
  let r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.compras[hoy], 2);
  global.fetch = async () => respuesta([{ date_start: hoy, date_stop: hoy, spend: '10000' }]);
  r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.compras[hoy], 0);
});

test('por campañas (cuando Meta bloquea la cuenta) se suman las compras de cada una', async () => {
  global.fetch = async (url) => {
    const s = String(url);
    if (s.includes('/act_prueba/insights')) return { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: { message: 'API access blocked' } }) };
    if (s.includes('/act_prueba/campaigns')) return respuesta([{ id: 'c1', name: 'A', status: 'ACTIVE' }, { id: 'c2', name: 'B', status: 'PAUSED' }]);
    const compras = s.includes('/c1/') ? '2' : '1';
    return respuesta([{ date_start: hoy, date_stop: hoy, spend: '5000', actions: [{ action_type: 'omni_purchase', value: compras }] }]);
  };
  const r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.via, 'campañas');
  assert.strictEqual(r.mapa[hoy], 10000);
  assert.strictEqual(r.compras[hoy], 3);
});

test('la utilidad lleva las compras de Meta como dato y no cambia por ellas', () => {
  const sin = u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 68990 }, 20000);
  const con = u.calcularDia({ pedidos: 1, unidades: 1, ingresos: 68990 }, 20000, 4);
  assert.strictEqual(con.comprasMeta, 4);
  assert.strictEqual(con.utilidad, sin.utilidad, 'las compras que dice Meta no tocan la utilidad');
  const t = u.totalizar([con, u.calcularDia({ pedidos: 0, unidades: 0, ingresos: 0 }, 10000, 1)]);
  assert.strictEqual(t.comprasMeta, 5);
  assert.strictEqual(Math.round(t.adsNeto / t.comprasMeta), 6000, 'costo por compra según Meta = gasto sin IVA ÷ compras');
});

test('el panel muestra "Costo por compra · Meta" en vez de "Días con venta"', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.ok(!html.includes("kpi('Días con venta'"), 'quedó la tarjeta de días con venta');
  assert.match(html, /kpi\('Costo por compra · Meta', t\.comprasMeta \? money0\(t\.adsNeto \/ t\.comprasMeta\)/);
});
