// Marketing API de Meta (Ads Manager): leer campañas/resultados y controlar
// estado, presupuesto y duplicado desde el panel admin.
//
// Variables de entorno:
//   META_ADS_ACCESS_TOKEN = token de un System User (Business Settings →
//                           Usuarios del sistema), con permisos ads_management
//                           y ads_read sobre la cuenta. Permanente (no expira
//                           en 60 días como un token de usuario normal).
//   META_AD_ACCOUNT_ID    = id de la cuenta publicitaria, formato act_XXXXXXXXXXX
//                           (se ve en la URL de Ads Manager).
//
// Uso exclusivo sobre la propia cuenta del negocio → "Standard Access", no
// requiere App Review de Meta. Todas las acciones de escritura las gatilla
// un click humano en el panel admin, no hay reglas automáticas.
//
// Sin META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID las funciones lanzan error
// explícito (el panel admin lo muestra), a diferencia de meta-capi.js que
// se queda inerte en silencio — acá sí hace falta feedback de error.
const API_VERSION = 'v21.0';
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

function creds() {
  const token = (process.env.META_ADS_ACCESS_TOKEN || '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!token || !adAccountId) {
    throw new Error('META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID no configurados');
  }
  return { token, adAccountId };
}

// Meta reporta el uso de rate limit de la cuenta en este header (JSON por
// ad account). Si algún valor se acerca al límite, avisamos por log antes de
// que Meta empiece a devolver 429.
function chequearUso(res) {
  const header = res.headers.get('x-business-use-case-usage');
  if (!header) return;
  try {
    const data = JSON.parse(header);
    for (const entries of Object.values(data)) {
      for (const entry of entries) {
        const pico = Math.max(entry.call_count || 0, entry.total_cputime || 0, entry.total_time || 0);
        if (pico >= 90) console.warn('[meta-ads] uso cerca del límite de la cuenta:', pico + '%');
      }
    }
  } catch { /* header con formato inesperado, ignorar */ }
}

async function llamar(path, { method = 'GET', params, body } = {}) {
  const { token } = creds();
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);

  const opts = { method };
  if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  chequearUso(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Meta respondió ${res.status}`);
  }
  return data;
}

// Meta pagina los edges de a 25 filas y deja el resto detrás de paging.next.
// Con time_increment=1 eso muerde apenas la ventana pasa de 25 filas y NO
// avisa: la respuesta llega con 200 y parece completa.
//
// Lo que rompía: la vista de 30 días se quedaba con 25 y perdía los 5 días más
// recientes (Meta devuelve ascendente), así que el panel mostraba esos días con
// gasto en publicidad CERO y una utilidad inflada. El desglose horario —hasta
// 168 filas en la ventana de 7 días— se quedaba en el primer día largo.
//
// Se pide una página grande Y se sigue el cursor: el limit ahorra vueltas, el
// cursor es lo que garantiza que no falte ninguna fila. El tope de páginas es
// para que un cursor que se repita no deje el request colgado para siempre.
const MAX_PAGINAS_INSIGHTS = 20;

async function llamarUrl(url) {
  const res = await fetch(url);
  chequearUso(res);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Meta respondió ${res.status}`);
  return data;
}

async function insightsCompletos(path, params) {
  let data = await llamar(path, { params: { ...params, limit: 500 } });
  const filas = [];
  for (let i = 0; i < MAX_PAGINAS_INSIGHTS; i++) {
    filas.push(...(data.data || []));
    const siguiente = data.paging && data.paging.next;
    // En la última vuelta no se pide otra página: se iba a descartar igual.
    if (!siguiente || i === MAX_PAGINAS_INSIGHTS - 1) break;
    data = await llamarUrl(siguiente);
  }
  return filas;
}

async function listCampaigns() {
  const { adAccountId } = creds();
  const data = await llamar(`/${adAccountId}/campaigns`, {
    params: { fields: 'id,name,status,objective,daily_budget,lifetime_budget', limit: 100 }
  });
  return data.data || [];
}

// Campañas que pudieron GASTAR desde `desde` (YYYY-MM-DD), incluidas las
// ARCHIVADAS y las BORRADAS. Es la lista para sumar gasto, no para el panel de
// campañas (ahí siguen solo las vigentes, con listCampaigns).
//
// Lo que rompía: Meta no devuelve las campañas archivadas ni las borradas si
// no se le piden con effective_status, y en esta cuenta el gasto se suma
// campaña por campaña (el nodo de la cuenta está bloqueado). Al archivar una
// campaña, su gasto desaparecía de los días en que corrió: esos días quedaban
// con publicidad de menos y utilidad de más. Del 11-sep al 6-nov eran $1,6M
// + IVA de campañas archivadas ("solid", "solid mas info"…) que la utilidad
// histórica no restaba: marcaba $4,6M cuando eran ~$2,7M.
//
// Para no pedirle insights a cada campaña vieja, se descartan las archivadas o
// borradas ANTES de la ventana: archivar cambia updated_time y una campaña
// archivada ya no entrega, así que si su última modificación es anterior a
// `desde` no pudo gastar en la ventana. Un día de margen por el huso horario
// (updated_time viene en UTC). Verificado con la cuenta: las 11 archivadas
// que gastaron entre el 11-sep y el 6-nov tienen updated_time del 15-sep en
// adelante.
const ESTADOS_CON_GASTO = ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'ARCHIVED', 'DELETED'];
const FUERA_DE_CIRCULACION = new Set(['ARCHIVED', 'DELETED']);

function diaAntes(fecha) {
  return new Date(Date.parse(fecha + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}

async function listCampaignsConGasto(desde) {
  const { adAccountId } = creds();
  const pedir = estados => insightsCompletos(`/${adAccountId}/campaigns`, {
    fields: 'id,name,status,effective_status,updated_time',
    effective_status: JSON.stringify(estados)
  });
  let todas;
  try {
    todas = await pedir(ESTADOS_CON_GASTO);
  } catch (e) {
    // Si Meta no acepta DELETED en este edge, al menos las archivadas, que
    // son las que se usan para ordenar la cuenta.
    todas = await pedir(ESTADOS_CON_GASTO.filter(s => s !== 'DELETED'));
  }
  const corte = /^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) ? diaAntes(desde) : '';
  return todas.filter(c => {
    if (!FUERA_DE_CIRCULACION.has(c.effective_status || c.status)) return true;
    const tocada = String(c.updated_time || '').slice(0, 10);
    return !corte || !tocada || tocada >= corte;
  });
}

// Corre `fn` sobre `items` de a `n` a la vez y devuelve los resultados en el
// mismo orden. Con las archivadas la lista de campañas crece, y disparar
// todas las consultas juntas acerca la cuenta al límite de uso de Meta.
async function enTandas(items, n, fn) {
  const salida = new Array(items.length);
  let siguiente = 0;
  const trabajar = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      salida[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajar));
  return salida;
}

// Campañas para sumar gasto con la mejor lista posible: con las archivadas; si
// Meta no deja leerlas, las vigentes (y se avisa que puede faltar gasto).
async function campanasParaSumar(desde) {
  try {
    return { campanas: await listCampaignsConGasto(desde), sinArchivadas: false };
  } catch (e) {
    console.warn('[meta-ads] no se pudieron leer las campañas archivadas; el gasto puede quedar corto:', e.message || e);
    return { campanas: await listCampaigns(), sinArchivadas: true };
  }
}

// Campos extendidos para el panel: además de gasto/clics, trae impresiones,
// alcance, frecuencia, CTR/CPC de clics en el enlace (no de "todos los clics",
// que infla con likes/comentarios) y compras + costo por compra vía
// actions/cost_per_action_type. Mismos campos que usa Ads Manager para
// "Rendimiento y clics".
const INSIGHTS_FIELDS = [
  'spend', 'impressions', 'reach', 'frequency', 'clicks', 'cpc', 'ctr',
  'inline_link_clicks', 'inline_link_click_ctr', 'cost_per_inline_link_click',
  'actions', 'cost_per_action_type'
].join(',');

const PURCHASE_ACTION_TYPES = ['omni_purchase', 'offsite_conversion.fb_pixel_purchase'];

// Lee un tipo de acción del array que manda Meta. Devuelve 0 si ese día no
// hubo ninguna: Meta simplemente no incluye la fila, no manda un cero.
function accionValor(actions, tipo) {
  const a = (actions || []).find(x => x.action_type === tipo);
  return a ? Number(a.value) || 0 : 0;
}

// Compras que Meta le atribuye a los anuncios en una fila de insights. Se
// toma el PRIMER tipo que venga (omni_purchase, si no el del píxel), nunca la
// suma de los dos: omni_purchase ya incluye las del píxel y contarlas otra vez
// duplicaría las compras y dejaría el costo por compra a la mitad.
function comprasDe(actions) {
  for (const tipo of PURCHASE_ACTION_TYPES) {
    const a = (actions || []).find(x => x.action_type === tipo);
    if (a) return Number(a.value) || 0;
  }
  return 0;
}

function extraerCompras(insights) {
  const actions = insights.actions || [];
  const costos = insights.cost_per_action_type || [];
  for (const tipo of PURCHASE_ACTION_TYPES) {
    const accion = actions.find(a => a.action_type === tipo);
    if (accion) {
      const costo = costos.find(c => c.action_type === tipo);
      return { resultados: Number(accion.value) || 0, costoPorResultado: costo ? Number(costo.value) : null };
    }
  }
  return { resultados: 0, costoPorResultado: null };
}

// Ventana de N días QUE INCLUYE HOY (fechas de Chile, el huso de la cuenta).
// NO se usan los date_preset last_7d / last_14d / last_30d: son los N días
// CERRADOS anteriores y dejan HOY afuera, así que el gasto del día recién
// aparecía en el panel cuando el día terminaba (la utilidad de hoy salía con
// publicidad en cero y las tarjetas no se movían en todo el día).
// Acepta cualquier cantidad entera de días entre 1 y 400 (la utilidad
// "desde el IVA" pide más de 30). Cada endpoint ya valida lo que recibe del
// navegador antes de llegar acá.
function rangoHastaHoy(dias, porDefecto) {
  const d = Number(dias);
  const n = Number.isInteger(d) && d >= 1 && d <= 400 ? d : porDefecto;
  return JSON.stringify({ since: diaChile(n - 1), until: diaChile(0) });
}

async function getInsights(campaignId, dias = 7) {
  const data = await llamar(`/${campaignId}/insights`, {
    params: { fields: INSIGHTS_FIELDS, time_range: rangoHastaHoy(dias, 7) }
  });
  const row = data.data?.[0] || {};
  const { resultados, costoPorResultado } = extraerCompras(row);
  return {
    spend: row.spend || '0',
    impressions: row.impressions || '0',
    reach: row.reach || '0',
    frequency: row.frequency || '0',
    clicks: row.clicks || '0',
    cpc: row.cpc || '0',
    ctr: row.ctr || '0',
    linkClicks: row.inline_link_clicks || '0',
    linkCtr: row.inline_link_click_ctr || '0',
    cpcLink: row.cost_per_inline_link_click || '0',
    resultados,
    costoPorResultado,
    actions: row.actions || []
  };
}

// Serie DIARIA de una campaña: mismo endpoint que getInsights pero con
// time_increment=1, que devuelve una fila por día en vez de un solo agregado.
// Es lo que necesita el gráfico del panel para mostrar la variación día a día.
//
// El CTR que se grafica es el de clics EN EL ENLACE (inline_link_click_ctr),
// no el ctr "de todos los clics": ese último infla con likes, comentarios y
// despliegues del texto, así que sube sin que nadie haya entrado al sitio.
//
// La ventana termina HOY (ver rangoHastaHoy): el último punto es el día en
// curso, todavía incompleto.
async function getInsightsDiarios(campaignId, dias = 14) {
  const filas = await insightsCompletos(`/${campaignId}/insights`, {
    fields: 'spend,impressions,clicks,ctr,inline_link_clicks,inline_link_click_ctr,actions',
    time_increment: 1,
    time_range: rangoHastaHoy(dias, 14)
  });
  // Meta devuelve los días en orden ascendente, pero no lo promete: se ordena
  // acá para que el gráfico no dependa de eso.
  return filas
    .map(r => ({
      fecha: r.date_start,
      ctr: Number(r.inline_link_click_ctr || 0),
      ctrTodos: Number(r.ctr || 0),
      clics: Number(r.inline_link_clicks || 0),
      // Gente que efectivamente ABRIÓ el sitio desde el anuncio. No es lo
      // mismo que el clic: entre el clic y la página se pierde ~10% (cierran
      // antes de que cargue). Es el número comparable con las visitas que
      // cuenta el propio sitio, y el que separa el tráfico pagado del resto.
      visitas: accionValor(r.actions, 'landing_page_view'),
      impresiones: Number(r.impressions || 0),
      gasto: Number(r.spend || 0),
      compras: comprasDe(r.actions)
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ── Serie HORARIA de un anuncio ────────────────────────────────────────────
// El gráfico diario dice si un anuncio sirve; este dice a qué HORA sirve, que
// es otra pregunta y se responde con otro corte.
//
// Meta agrega las horas en el huso de la CUENTA (America/Santiago), el mismo
// en el que el panel cuenta las ventas, así que las dos series se pueden mirar
// una al lado de la otra sin corregir nada.
function diaChile(atras = 0) {
  return new Date(Date.now() - atras * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
}

async function getCtrHorario(objectId, dias = 3) {
  const n = [1, 3, 7].includes(Number(dias)) ? Number(dias) : 3;
  const filas = await insightsCompletos(`/${objectId}/insights`, {
    fields: 'impressions,clicks,inline_link_clicks,spend',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    time_increment: 1,
    // Ventana explícita y NO date_preset: last_3d devuelve los 3 días CERRADOS
    // anteriores y deja HOY afuera, y hoy es justamente lo que se quiere mirar
    // cuando el CTR se está moviendo.
    time_range: JSON.stringify({ since: diaChile(n - 1), until: diaChile(0) })
  });
  return filas
    .map(r => {
      const impresiones = Number(r.impressions || 0);
      // CTR del ENLACE calculado acá en vez de pedir inline_link_click_ctr:
      // es la misma división, y así una hora con impresiones pero sin clics
      // da 0 en vez de un campo que Meta simplemente no manda.
      const clics = Number(r.inline_link_clicks || 0);
      return {
        fecha: r.date_start,
        hora: Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone || '0').slice(0, 2)) || 0,
        ctr: impresiones ? (clics / impresiones) * 100 : 0,
        clics,
        clicsTodos: Number(r.clicks || 0),
        impresiones,
        gasto: Number(r.spend || 0)
      };
    })
    // Una hora sin entrega no es un CTR de 0%: es una hora sin datos. Se cae
    // de la serie para que la línea se CORTE en vez de desplomarse y hacer
    // creer que el anuncio se cayó cuando en realidad estaba pausado.
    .filter(h => h.impresiones > 0)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora - b.hora);
}

// Anuncios de la cuenta. Hace falta para ubicar uno POR NOMBRE: los creativos
// de Meta son inmutables, así que cada vez que se cambia el video o el copy
// nace un anuncio NUEVO con otro id, y un id escrito a mano dejaría el gráfico
// mudo sin avisar.
async function listAds() {
  const { adAccountId } = creds();
  const data = await llamar(`/${adAccountId}/ads`, {
    params: { fields: 'id,name,effective_status', limit: 100 }
  });
  return data.data || [];
}

async function setStatus(objectId, status) {
  if (status !== 'ACTIVE' && status !== 'PAUSED') throw new Error('status inválido: ' + status);
  return llamar(`/${objectId}`, { method: 'POST', params: { status } });
}

async function updateBudget(objectId, { dailyBudget }) {
  if (!dailyBudget || Number(dailyBudget) <= 0) throw new Error('dailyBudget inválido');
  // Meta espera el presupuesto en la unidad mínima de la moneda; CLP no tiene
  // decimales, así que el valor va tal cual (sin *100 como en USD/centavos).
  return llamar(`/${objectId}`, { method: 'POST', params: { daily_budget: Math.round(Number(dailyBudget)) } });
}

// Duplica campaña + adsets + ads en un solo call de Meta. Queda en PAUSED por
// default — nunca se auto-activa un duplicado.
async function duplicateCampaign(campaignId, overrides = {}) {
  const data = await llamar(`/${campaignId}/copies`, {
    method: 'POST',
    params: { status_option: 'PAUSED', deep_copy: true }
  });
  const nuevaId = data.copied_campaign_id;
  if (!nuevaId) throw new Error('Meta no devolvió el id de la copia');

  if (overrides.name) await llamar(`/${nuevaId}`, { method: 'POST', params: { name: overrides.name } });
  if (overrides.dailyBudget) await updateBudget(nuevaId, { dailyBudget: overrides.dailyBudget });

  return { id: nuevaId };
}

// Gasto diario de la CUENTA COMPLETA (no de una campaña): para la utilidad
// diaria hay que restar todo lo gastado en publicidad ese día, incluidas las
// campañas pausadas después, que igual consumieron plata mientras corrían.
// Trae también las compras que Meta atribuye a los anuncios cada día
// (`compras`), para el costo por compra "según Meta" del panel.
async function getGastoDiarioCuenta(dias = 14) {

  // Camino 1: una sola llamada a nivel de CUENTA. Es lo barato — un request
  // trae todo. En esta cuenta Meta lo rechaza con "API access blocked": el
  // token tiene permiso sobre las campañas pero no sobre el nodo de la cuenta.
  let errorCuenta = '';
  try {
    const { adAccountId } = creds();
    const filas = await insightsCompletos(`/${adAccountId}/insights`, {
      fields: 'spend,actions', time_increment: 1, time_range: rangoHastaHoy(dias, 14)
    });
    if (filas.length) {
      const mapa = {}, compras = {};
      for (const r of filas) {
        mapa[r.date_start] = Number(r.spend || 0);
        compras[r.date_start] = comprasDe(r.actions);
      }
      return { mapa, compras, via: 'cuenta' };
    }
  } catch (e) {
    errorCuenta = e.message || String(e);
  }

  // Camino 2: sumar campaña por campaña. Son más requests (una por campaña),
  // pero es EXACTAMENTE el mismo endpoint que usa el gráfico de CTR, que sí
  // responde en esta cuenta. Se incluyen las PAUSADAS, las ARCHIVADAS y las
  // BORRADAS a propósito: una campaña apagada o archivada hoy igual gastó
  // plata mientras corría, y esa plata salió del mismo bolsillo que la de las
  // activas (ver listCampaignsConGasto).
  let campanas, sinArchivadas;
  try {
    ({ campanas, sinArchivadas } = await campanasParaSumar(JSON.parse(rangoHastaHoy(dias, 14)).since));
  } catch (e) {
    // Los dos caminos caídos = el token no sirve para NADA de Meta, no es un
    // permiso puntual del nodo de la cuenta. El mensaje tiene que decirlo, o
    // el panel muestra el mismo texto en dos situaciones que se arreglan
    // distinto: una cambiando de endpoint, la otra regenerando el token.
    throw new Error(
      'los dos caminos fallaron. Nivel cuenta: ' + (errorCuenta || 'sin datos') +
      ' · Nivel campañas: ' + (e.message || e) +
      '. El token de Meta no tiene acceso a nada — hay que regenerarlo en Render.'
    );
  }
  const porCampana = await enTandas(campanas, 5, c => getInsightsDiarios(c.id, dias).catch(() => []));
  const mapa = {}, compras = {};
  let filas = 0;
  for (const dias_ of porCampana) {
    filas += dias_.length;
    for (const d of dias_) {
      mapa[d.fecha] = (mapa[d.fecha] || 0) + (Number(d.gasto) || 0);
      compras[d.fecha] = (compras[d.fecha] || 0) + (Number(d.compras) || 0);
    }
  }
  // Campañas que responden pero sin una sola fila de insights: el permiso de
  // insights está cortado aunque el de leer campañas no. Distinto problema.
  if (campanas.length && !filas) {
    throw new Error(
      'se leyeron ' + campanas.length + ' campañas pero ninguna devolvió insights. ' +
      'Nivel cuenta: ' + (errorCuenta || 'sin datos') + '. Falta el permiso ads_read sobre los insights.'
    );
  }
  return { mapa, compras, via: 'campañas', campanas: campanas.length, sinArchivadas, errorCuenta };
}

// Gasto POR HORA de la cuenta, para la sección "en vivo" del panel. Mismo
// esquema que getGastoDiarioCuenta: primero UNA llamada a nivel cuenta y, si
// Meta la bloquea (pasa en esta cuenta), campaña por campaña sumando hora a
// hora. Trae también impresiones y clics en el enlace, que son el "por qué"
// de cada hora: gasto = impresiones × CPM, así que una hora gasta más porque
// Meta mostró más el anuncio, porque cada impresión salió más cara, o ambas.
// Las horas vienen en el huso de la CUENTA (America/Santiago).
async function getGastoHorario(desde, hasta, { campanas } = {}) {
  const params = {
    fields: 'spend,impressions,inline_link_clicks',
    breakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    time_increment: 1,
    time_range: JSON.stringify({ since: desde, until: hasta })
  };
  const sumar = (mapa, filas) => {
    for (const r of filas) {
      const hora = Number(String(r.hourly_stats_aggregated_by_advertiser_time_zone || '0').slice(0, 2)) || 0;
      const k = r.date_start + '|' + hora;
      const a = mapa[k] || (mapa[k] = { fecha: r.date_start, hora, gasto: 0, impresiones: 0, clics: 0 });
      a.gasto += Number(r.spend || 0);
      a.impresiones += Number(r.impressions || 0);
      a.clics += Number(r.inline_link_clicks || 0);
    }
  };
  let errorCuenta = '';
  try {
    const { adAccountId } = creds();
    const filas = await insightsCompletos(`/${adAccountId}/insights`, params);
    if (filas.length) { const mapa = {}; sumar(mapa, filas); return { filas: Object.values(mapa), via: 'cuenta' }; }
  } catch (e) {
    errorCuenta = e.message || String(e);
  }
  // Sin lista dada, también las archivadas en la ventana: gastaron mientras corrían.
  const lista = campanas || (await campanasParaSumar(desde)).campanas;
  const res = await enTandas(lista, 5, c => insightsCompletos(`/${c.id}/insights`, params).catch(() => null));
  const mapa = {};
  let ok = 0;
  for (const filas of res) if (filas) { ok++; sumar(mapa, filas); }
  if (lista.length && !ok) {
    throw new Error('ninguna campaña devolvió el gasto por hora. Nivel cuenta: ' + (errorCuenta || 'sin datos'));
  }
  return { filas: Object.values(mapa), via: 'campañas', errorCuenta };
}

module.exports = { listCampaigns, listCampaignsConGasto, listAds, getInsights, getInsightsDiarios, getCtrHorario, getGastoDiarioCuenta, getGastoHorario, setStatus, updateBudget, duplicateCampaign };
