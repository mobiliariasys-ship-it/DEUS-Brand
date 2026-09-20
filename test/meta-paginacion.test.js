'use strict';
// Meta pagina los insights de a 25 filas y deja el resto detrás de paging.next,
// sin marcar la respuesta de ninguna forma: llega con 200 y parece completa.
//
// Eso rompía la vista de 30 días del panel — se quedaba con 25 y perdía los 5
// días MÁS RECIENTES, porque Meta devuelve ascendente. Esos días aparecían con
// gasto en publicidad cero y utilidad inflada. El desglose horario, que llega a
// 168 filas en la ventana de 7 días, se quedaba en el primer día largo.
const test = require('node:test');
const assert = require('node:assert');

process.env.META_ADS_ACCESS_TOKEN = 'token-de-prueba';
process.env.META_AD_ACCOUNT_ID = 'act_prueba';

const meta = require('../services/meta-ads');

// Respuesta falsa de Meta: `paginas` es una lista de listas de filas. Cada
// página menos la última trae paging.next, igual que la API real.
function fingirMeta(paginas) {
  const pedidas = [];
  global.fetch = async (url) => {
    const u = String(url);
    pedidas.push(u);
    const i = pedidas.length - 1;
    const esUltima = i >= paginas.length - 1;
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        data: paginas[i] || [],
        paging: esUltima ? {} : { next: 'https://graph.facebook.com/siguiente?cursor=' + (i + 1) }
      })
    };
  };
  return pedidas;
}

function dia(n, gasto) {
  const f = new Date(Date.UTC(2026, 7, 1 + n)).toISOString().slice(0, 10);
  return { date_start: f, date_stop: f, spend: String(gasto), impressions: '100', clicks: '2', inline_link_clicks: '1' };
}

test('30 días: se siguen las páginas y no se pierde ningún día', async () => {
  const pag1 = Array.from({ length: 25 }, (_, i) => dia(i, 1000));
  const pag2 = Array.from({ length: 5 },  (_, i) => dia(25 + i, 1000));
  fingirMeta([pag1, pag2]);

  const filas = await meta.getInsightsDiarios('123', 30);
  assert.strictEqual(filas.length, 30, 'se quedó en la primera página');

  const total = filas.reduce((a, d) => a + d.gasto, 0);
  assert.strictEqual(total, 30000, 'el total de gasto no cuadra');

  // Los que se perdían eran los ÚLTIMOS, que es lo que hacía ver utilidad
  // inflada justo en los días recientes.
  assert.ok(filas.some(d => d.fecha === '2026-08-30'), 'falta el día 30');
});

test('la primera página se pide con limit alto, para no encadenar 12 vueltas', async () => {
  const pedidas = fingirMeta([[dia(0, 500)]]);
  await meta.getInsightsDiarios('123', 30);
  const u = new URL(pedidas[0]);
  assert.strictEqual(u.searchParams.get('limit'), '500');
  assert.strictEqual(u.searchParams.get('time_increment'), '1');
  assert.strictEqual(pedidas.length, 1, 'sin paging.next no debe pedir otra página');
});

test('7 y 14 días siguen funcionando igual (una sola página)', async () => {
  for (const n of [7, 14]) {
    const pedidas = fingirMeta([Array.from({ length: n }, (_, i) => dia(i, 2000))]);
    const filas = await meta.getInsightsDiarios('123', n);
    assert.strictEqual(filas.length, n);
    assert.strictEqual(pedidas.length, 1);
  }
});

test('el desglose horario también pagina: 7 días son hasta 168 filas', async () => {
  const hora = (d, h) => ({
    date_start: '2026-08-0' + d, date_stop: '2026-08-0' + d,
    hourly_stats_aggregated_by_advertiser_time_zone: String(h).padStart(2, '0') + ':00:00 - ' + String(h).padStart(2, '0') + ':59:59',
    impressions: '200', clicks: '5', inline_link_clicks: '4', spend: '800'
  });
  const todas = [];
  for (let d = 1; d <= 7; d++) for (let h = 0; h < 24; h++) todas.push(hora(d, h));
  fingirMeta([todas.slice(0, 25), todas.slice(25, 50), todas.slice(50)]);

  const filas = await meta.getCtrHorario('123', 7);
  assert.strictEqual(filas.length, 168, 'el desglose horario se truncó');
});

test('un cursor que se repite no deja el request colgado', async () => {
  // Meta siempre devuelve paging.next: sin tope serían vueltas infinitas.
  let vueltas = 0;
  global.fetch = async () => {
    vueltas++;
    return {
      ok: true, headers: { get: () => null },
      json: async () => ({ data: [dia(0, 100)], paging: { next: 'https://graph.facebook.com/loop' } })
    };
  };
  const filas = await meta.getInsightsDiarios('123', 30);
  assert.ok(vueltas <= 20, 'se pasó del tope de páginas: ' + vueltas);
  assert.strictEqual(filas.length, 20);
});
