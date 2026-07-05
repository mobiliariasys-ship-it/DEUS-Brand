const axios = require('axios');

const BASE_URL = 'https://services.wschilexpress.com';
const API_KEY = process.env.CHILEXPRESS_API_KEY;

// Peso y dimensiones del paquete DEUS Band (estimado)
const PACKAGE = { weight: 0.3, height: 5, width: 10, length: 15 };

// Región de origen: Santiago (código Chilexpress)
const ORIGIN_REGION = '13';

async function getRegions() {
  const res = await axios.get(`${BASE_URL}/geographiccoverage/api/v1.0/regions`, {
    headers: { 'Ocp-Apim-Subscription-Key': API_KEY }
  });
  return res.data.regions;
}

async function getCoverageAreas(regionCode) {
  const res = await axios.get(`${BASE_URL}/geographiccoverage/api/v1.0/coverage-areas?regionCode=${regionCode}`, {
    headers: { 'Ocp-Apim-Subscription-Key': API_KEY }
  });
  return res.data.coverageAreas;
}

async function getRate({ regionCode, countyName }) {
  if (!API_KEY) throw new Error('CHILEXPRESS_API_KEY no configurada');

  const areas = await getCoverageAreas(regionCode);
  const area = areas.find(a => a.countyName?.toLowerCase() === countyName?.toLowerCase());
  if (!area) throw new Error('Sin cobertura en esta comuna');

  const res = await axios.post(
    `${BASE_URL}/transport/api/v1.0/routes/price`,
    {
      originCountyCode: 'STGO',
      destinationCountyCode: area.countyCode,
      package: PACKAGE,
      serviceTypeCode: '3' // Normal
    },
    { headers: { 'Ocp-Apim-Subscription-Key': API_KEY, 'Content-Type': 'application/json' } }
  );

  const service = res.data.data?.courierServiceOptions?.[0];
  if (!service) throw new Error('No hay tarifas disponibles');

  return {
    carrier: 'Chilexpress',
    price: Math.round(service.serviceValue),
    deliveryTime: `${service.daysDelivery} días hábiles`,
    serviceType: service.serviceDescription
  };
}

module.exports = { getRate, getRegions, getCoverageAreas };
