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

async function getInsights(campaignId, datePreset = 'last_7d') {
  const data = await llamar(`/${campaignId}/insights`, {
    params: { fields: 'spend,impressions,clicks,cpc,actions', date_preset: datePreset }
  });
  return data.data?.[0] || { spend: '0', impressions: '0', clicks: '0', cpc: '0', actions: [] };
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

module.exports = { listCampaigns, getInsights, setStatus, updateBudget, duplicateCampaign };
