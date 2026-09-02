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

async function listCampaigns() {
  const { adAccountId } = creds();
  const data = await llamar(`/${adAccountId}/campaigns`, {
    params: { fields: 'id,name,status,objective,daily_budget,lifetime_budget', limit: 100 }
  });
  return data.data || [];
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

async function getInsights(campaignId, datePreset = 'last_7d') {
  const data = await llamar(`/${campaignId}/insights`, {
    params: { fields: INSIGHTS_FIELDS, date_preset: datePreset }
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
// date_preset solo acepta valores de su enum, no un número arbitrario de días,
// así que la ventana viene de una lista blanca.
const VENTANAS_DIARIAS = { 7: 'last_7d', 14: 'last_14d', 30: 'last_30d' };

async function getInsightsDiarios(campaignId, dias = 14) {
  const preset = VENTANAS_DIARIAS[dias] || VENTANAS_DIARIAS[14];
  const data = await llamar(`/${campaignId}/insights`, {
    params: {
      fields: 'spend,impressions,clicks,ctr,inline_link_clicks,inline_link_click_ctr',
      time_increment: 1,
      date_preset: preset
    }
  });
  // Meta devuelve los días en orden ascendente, pero no lo promete: se ordena
  // acá para que el gráfico no dependa de eso.
  return (data.data || [])
    .map(r => ({
      fecha: r.date_start,
      ctr: Number(r.inline_link_click_ctr || 0),
      ctrTodos: Number(r.ctr || 0),
      clics: Number(r.inline_link_clicks || 0),
      impresiones: Number(r.impressions || 0),
      gasto: Number(r.spend || 0)
    }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
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

module.exports = { listCampaigns, getInsights, getInsightsDiarios, setStatus, updateBudget, duplicateCampaign };
