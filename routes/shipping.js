const express = require('express');
const router = express.Router();
const https = require('https');

// Cache simple sin dependencias externas
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// Modo desarrollo: simula tarifas cuando no hay credenciales
function mockRates(commune, region) {
  console.log(`[DEV MODE] Simulando tarifas para: ${commune}, ${region}`);
  return [
    { carrier: 'Chilexpress', price: 3990, deliveryTime: '2-3 días hábiles', serviceType: 'Express' },
    { carrier: 'Starken',     price: 3490, deliveryTime: '3-4 días hábiles', serviceType: 'Normal' },
    { carrier: 'Bluexpress',  price: 2990, deliveryTime: '4-5 días hábiles', serviceType: 'Estándar' }
  ];
}

// Helper: petición HTTPS sin axios
function httpsPost(hostname, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { reject(new Error(`JSON inválido: ${raw.substring(0,100)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

function httpsGet(hostname, path, headers) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'GET', headers };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch(e) { reject(new Error(`JSON inválido: ${raw.substring(0,100)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Chilexpress ──────────────────────────────────────────────
async function rateChilexpress(regionCode, commune) {
  const key = process.env.CHILEXPRESS_API_KEY;
  if (!key) throw new Error('CHILEXPRESS_API_KEY no configurada');

  console.log(`[Chilexpress] Consultando cobertura — región: ${regionCode}, comuna: ${commune}`);

  const coverageRes = await httpsGet(
    'services.wschilexpress.com',
    `/geographiccoverage/api/v1.0/coverage-areas?regionCode=${regionCode}`,
    { 'Ocp-Apim-Subscription-Key': key }
  );
  console.log(`[Chilexpress] Coverage status: ${coverageRes.status}`);

  const areas = coverageRes.body.coverageAreas || [];
  const area = areas.find(a => a.countyName?.toLowerCase() === commune.toLowerCase());
  if (!area) throw new Error(`Chilexpress sin cobertura en "${commune}"`);

  const priceRes = await httpsPost(
    'services.wschilexpress.com',
    '/transport/api/v1.0/routes/price',
    { originCountyCode: 'STGO', destinationCountyCode: area.countyCode, package: { weight: 0.3, height: 5, width: 10, length: 15 }, serviceTypeCode: '3' },
    { 'Ocp-Apim-Subscription-Key': key }
  );
  console.log(`[Chilexpress] Price status: ${priceRes.status}`);

  const service = priceRes.body.data?.courierServiceOptions?.[0];
  if (!service) throw new Error('Chilexpress no retornó tarifas');

  return { carrier: 'Chilexpress', price: Math.round(service.serviceValue), deliveryTime: `${service.daysDelivery} días hábiles`, serviceType: service.serviceDescription };
}

// ── Starken ──────────────────────────────────────────────────
async function rateStarken(city, region) {
  const key = process.env.STARKEN_API_KEY;
  const user = process.env.STARKEN_USER;
  if (!key || !user) throw new Error('STARKEN_API_KEY / STARKEN_USER no configurados');

  console.log(`[Starken] Consultando tarifa — ciudad: ${city}, región: ${region}`);

  const res = await httpsPost(
    'api.starken.cl',
    '/v1/tarifas',
    { origen: 'Santiago', destino: city, region, peso: 0.3, volumen: 0.00075, tipo_servicio: 'normal' },
    { 'Authorization': `Bearer ${key}`, 'x-user': user }
  );
  console.log(`[Starken] Status: ${res.status}`, JSON.stringify(res.body).substring(0, 200));

  const tarifa = res.body?.tarifas?.[0];
  if (!tarifa) throw new Error('Starken no retornó tarifas');

  return { carrier: 'Starken', price: Math.round(tarifa.precio), deliveryTime: tarifa.plazo_entrega || '3-5 días hábiles', serviceType: tarifa.tipo || 'Normal' };
}

// ── Bluexpress ───────────────────────────────────────────────
async function rateBluexpress(commune, region) {
  const key = process.env.BLUEXPRESS_API_KEY;
  if (!key) throw new Error('BLUEXPRESS_API_KEY no configurada');

  console.log(`[Bluexpress] Consultando tarifa — comuna: ${commune}, región: ${region}`);

  const res = await httpsPost(
    'api.bluexpress.cl',
    '/v1/cotizar',
    { origen: { comuna: 'Santiago', region: 'Metropolitana' }, destino: { comuna: commune, region }, paquete: { peso: 0.3, alto: 5, ancho: 10, largo: 15 } },
    { 'Authorization': `Bearer ${key}` }
  );
  console.log(`[Bluexpress] Status: ${res.status}`, JSON.stringify(res.body).substring(0, 200));

  const cotizacion = res.body?.cotizacion;
  if (!cotizacion) throw new Error('Bluexpress no retornó cotización');

  return { carrier: 'Bluexpress', price: Math.round(cotizacion.precio), deliveryTime: cotizacion.plazo || '4-6 días hábiles', serviceType: cotizacion.servicio || 'Estándar' };
}

// ── Tarifas Starken por región (según distancia desde Santiago) ──
const TARIFAS = {
  'metropolitana':      { price: 3890, dias: '1-2 días hábiles' },
  'valparaiso':         { price: 3890, dias: '1-2 días hábiles' },
  'ohiggins':           { price: 3890, dias: '1-2 días hábiles' },
  'maule':              { price: 4090, dias: '2-3 días hábiles' },
  'nuble':              { price: 4290, dias: '2-3 días hábiles' },
  'biobio':             { price: 4390, dias: '2-3 días hábiles' },
  'la araucania':       { price: 4690, dias: '2-3 días hábiles' },
  'araucania':          { price: 4690, dias: '2-3 días hábiles' },
  'los rios':           { price: 4890, dias: '2-3 días hábiles' },
  'los lagos':          { price: 4990, dias: '2-3 días hábiles' },
  'coquimbo':           { price: 4490, dias: '2-3 días hábiles' },
  'atacama':            { price: 4790, dias: '2-3 días hábiles' },
  'antofagasta':        { price: 5100, dias: '2-3 días hábiles' },
  'tarapaca':           { price: 5300, dias: '2-3 días hábiles' },
  'arica y parinacota': { price: 5400, dias: '2-3 días hábiles' },
  'aysen':              { price: 5400, dias: '3-5 días hábiles' },
  'magallanes':         { price: 5400, dias: '3-5 días hábiles' }
};

function normRegion(r) {
  return (r || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, '').trim();
}

// ── Ruta principal: solo Starken, tarifa fija por región ─────
router.post('/calcular-envio', (req, res) => {
  const { region, commune, city } = req.body;
  const destCommune = commune || city;

  if (!destCommune) {
    return res.status(400).json({ error: 'Debes ingresar la comuna de destino.' });
  }

  const key = normRegion(region);
  const t = TARIFAS[key] || TARIFAS['metropolitana'];

  console.log(`[envio] region="${region}" (${key}) -> Starken $${t.price} · ${t.dias}`);

  res.json({
    carriers: [
      { carrier: 'Starken', price: t.price, deliveryTime: t.dias, serviceType: 'Normal' }
    ]
  });
});

module.exports = router;
