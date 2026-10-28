'use strict';
// Gasto por hora del panel "en vivo": en esta cuenta Meta bloquea los insights
// a nivel cuenta, así que el gasto se arma sumando campaña por campaña y hora
// por hora. Si esa suma se equivoca, el gráfico muestra horas que no gastaron
// lo que dice.
const test = require('node:test');
const assert = require('node:assert');

function respuesta(status, body) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => body };
}

test('con la cuenta bloqueada, el gasto por hora suma campaña por campaña', async () => {
  const entorno = { t: process.env.META_ADS_ACCESS_TOKEN, a: process.env.META_AD_ACCOUNT_ID };
  process.env.META_ADS_ACCESS_TOKEN = 'token-de-prueba';
  process.env.META_AD_ACCOUNT_ID = 'act_1';
  const orig = global.fetch;
  const hora = h => ({ hourly_stats_aggregated_by_advertiser_time_zone: h + ':00:00 - ' + h + ':59:59' });
  global.fetch = async url => {
    const u = String(url);
    if (u.includes('/act_1/insights')) return respuesta(400, { error: { message: 'API access blocked' } });
    if (u.includes('/c1/insights')) return respuesta(200, { data: [
      { date_start: '2026-10-04', ...hora('21'), spend: '1000', impressions: '1200', inline_link_clicks: '10' }
    ] });
    if (u.includes('/c2/insights')) return respuesta(200, { data: [
      { date_start: '2026-10-04', ...hora('21'), spend: '500', impressions: '800', inline_link_clicks: '4' },
      { date_start: '2026-10-04', ...hora('09'), spend: '200', impressions: '300', inline_link_clicks: '1' }
    ] });
    return respuesta(404, {});
  };
  try {
    const { getGastoHorario } = require('../services/meta-ads');
    const r = await getGastoHorario('2026-10-04', '2026-10-04', { campanas: [{ id: 'c1' }, { id: 'c2' }] });
    assert.strictEqual(r.via, 'campañas');
    const h21 = r.filas.find(f => f.hora === 21), h9 = r.filas.find(f => f.hora === 9);
    assert.deepStrictEqual([h21.gasto, h21.impresiones, h21.clics], [1500, 2000, 14], 'las 21:00 suman las dos campañas');
    assert.deepStrictEqual([h9.gasto, h9.impresiones, h9.clics], [200, 300, 1], 'las 09:00 son solo de la segunda');
    assert.strictEqual(r.filas.length, 2, 'una fila por hora con gasto, sin duplicados');
  } finally {
    global.fetch = orig;
    if (entorno.t === undefined) delete process.env.META_ADS_ACCESS_TOKEN; else process.env.META_ADS_ACCESS_TOKEN = entorno.t;
    if (entorno.a === undefined) delete process.env.META_AD_ACCOUNT_ID; else process.env.META_AD_ACCOUNT_ID = entorno.a;
  }
});

test('si ninguna campaña responde, avisa en vez de mostrar un día en cero', async () => {
  const entorno = { t: process.env.META_ADS_ACCESS_TOKEN, a: process.env.META_AD_ACCOUNT_ID };
  process.env.META_ADS_ACCESS_TOKEN = 'token-de-prueba';
  process.env.META_AD_ACCOUNT_ID = 'act_1';
  const orig = global.fetch;
  global.fetch = async () => respuesta(400, { error: { message: 'API access blocked' } });
  try {
    const { getGastoHorario } = require('../services/meta-ads');
    await assert.rejects(getGastoHorario('2026-10-04', '2026-10-04', { campanas: [{ id: 'c1' }] }), /ninguna campaña/);
  } finally {
    global.fetch = orig;
    if (entorno.t === undefined) delete process.env.META_ADS_ACCESS_TOKEN; else process.env.META_ADS_ACCESS_TOKEN = entorno.t;
    if (entorno.a === undefined) delete process.env.META_AD_ACCOUNT_ID; else process.env.META_AD_ACCOUNT_ID = entorno.a;
  }
});
