'use strict';
// Campañas ARCHIVADAS en el gasto de Meta.
//
// En esta cuenta el gasto se suma campaña por campaña (Meta bloquea el nodo de
// la cuenta), y Meta no devuelve las campañas archivadas ni las borradas si no
// se le piden. Al archivar una campaña su gasto desaparecía de los días en que
// corrió y la utilidad de esos días quedaba inflada: del 11-sep al 6-nov, la
// utilidad histórica marcaba $4,6M cuando eran ~$2,7M ($1,6M + IVA de
// campañas archivadas que no se restaban).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.META_ADS_ACCESS_TOKEN = 'token-de-prueba';
process.env.META_AD_ACCOUNT_ID = 'act_prueba';

const meta = require('../services/meta-ads');

const diaChile = atras => new Date(Date.now() - atras * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const hoy = diaChile(0), ayer = diaChile(1);

function respuesta(data, status = 200) {
  return { ok: status < 400, status, headers: { get: () => null }, json: async () => (status < 400 ? { data } : { error: { message: data } }) };
}

const VIGENTE = { id: 'c1', name: 'solid - Copia', status: 'ACTIVE', effective_status: 'ACTIVE', updated_time: hoy + 'T10:00:00+0000' };
const ARCHIVADA_EN_LA_VENTANA = { id: 'c2', name: 'solid', status: 'ARCHIVED', effective_status: 'ARCHIVED', updated_time: ayer + 'T18:00:00+0000' };
const ARCHIVADA_HACE_MESES = { id: 'c3', name: 'vieja', status: 'ARCHIVED', effective_status: 'ARCHIVED', updated_time: '2026-01-05T12:00:00+0000' };

// Meta falso: sin effective_status devuelve solo las vigentes, como la API real.
// `rechazar(estados)` decide si esa lista de estados se responde con error.
function fingirMeta({ rechazar = () => false } = {}) {
  const pedidas = [];
  global.fetch = async url => {
    const u = new URL(String(url));
    pedidas.push(u);
    const p = u.pathname;
    if (p.endsWith('/act_prueba/insights')) return respuesta('API access blocked', 400);
    if (p.endsWith('/act_prueba/campaigns')) {
      const estados = u.searchParams.get('effective_status');
      if (!estados) return respuesta([VIGENTE]);
      const lista = JSON.parse(estados);
      if (rechazar(lista)) return respuesta('Param effective_status is invalid', 400);
      return respuesta([VIGENTE, ARCHIVADA_EN_LA_VENTANA, ARCHIVADA_HACE_MESES]
        .filter(c => lista.includes(c.effective_status)));
    }
    const hora = { hourly_stats_aggregated_by_advertiser_time_zone: '21:00:00 - 21:59:59' };
    if (p.endsWith('/c1/insights')) return respuesta([{ date_start: hoy, date_stop: hoy, spend: '5000', impressions: '100', ...hora }]);
    if (p.endsWith('/c2/insights')) return respuesta([{ date_start: ayer, date_stop: ayer, spend: '3000', impressions: '50', ...hora }]);
    if (p.endsWith('/c3/insights')) return respuesta([{ date_start: ayer, date_stop: ayer, spend: '99999', impressions: '1', ...hora }]);
    return respuesta('no existe', 404);
  };
  return pedidas;
}

test('la utilidad resta el gasto de una campaña archivada en los días que corrió', async () => {
  const pedidas = fingirMeta();
  const r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.via, 'campañas');
  assert.strictEqual(r.mapa[hoy], 5000, 'falta el gasto de la vigente');
  assert.strictEqual(r.mapa[ayer], 3000, 'el gasto de la archivada se perdió: la utilidad de ese día queda inflada');
  assert.strictEqual(r.sinArchivadas, false);
  // La que se archivó hace meses no pudo gastar en la ventana: no se consulta.
  assert.ok(!pedidas.some(u => u.pathname.endsWith('/c3/insights')), 'consultó una campaña archivada antes de la ventana');
});

test('las campañas se piden con effective_status, archivadas y borradas incluidas', async () => {
  const pedidas = fingirMeta();
  await meta.getGastoDiarioCuenta(7);
  const lista = pedidas.find(u => u.pathname.endsWith('/act_prueba/campaigns'));
  const estados = JSON.parse(lista.searchParams.get('effective_status'));
  for (const e of ['ACTIVE', 'PAUSED', 'ARCHIVED', 'DELETED']) assert.ok(estados.includes(e), 'falta ' + e);
  assert.match(lista.searchParams.get('fields'), /updated_time/);
});

test('si Meta no acepta DELETED, reintenta sin borradas y sigue sumando las archivadas', async () => {
  fingirMeta({ rechazar: estados => estados.includes('DELETED') });
  const r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.mapa[ayer], 3000);
  assert.strictEqual(r.sinArchivadas, false);
});

test('si Meta no deja leer las archivadas, suma las vigentes y lo avisa', async () => {
  fingirMeta({ rechazar: () => true });
  const r = await meta.getGastoDiarioCuenta(7);
  assert.strictEqual(r.mapa[hoy], 5000, 'sin archivadas igual tiene que traer las vigentes');
  assert.strictEqual(r.mapa[ayer], undefined);
  assert.strictEqual(r.sinArchivadas, true, 'tiene que avisar que el gasto puede quedar corto');
});

test('el gasto por hora, sin lista de campañas, también suma las archivadas de la ventana', async () => {
  fingirMeta();
  const r = await meta.getGastoHorario(diaChile(7), ayer);
  const total = r.filas.reduce((a, f) => a + f.gasto, 0);
  assert.strictEqual(total, 5000 + 3000, 'el promedio de 7 días por hora pierde a las archivadas');
});

test('listCampaignsConGasto: vigentes siempre; archivadas solo si se tocaron desde un día antes de la ventana', async () => {
  fingirMeta();
  const ids = (await meta.listCampaignsConGasto(ayer)).map(c => c.id);
  assert.deepStrictEqual(ids, ['c1', 'c2']);
  const todas = (await meta.listCampaignsConGasto('')).map(c => c.id);
  assert.deepStrictEqual(todas, ['c1', 'c2', 'c3'], 'sin fecha no se descarta ninguna');
});

test('el panel avisa cuando no se pudieron leer las archivadas', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  assert.match(html, /diagnostico\.sinArchivadas \?/);
  assert.match(html, /archivadas incluidas/);
});
