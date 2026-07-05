const axios = require('axios');

const BASE_URL = 'https://api.starken.cl/v1';
const API_KEY = process.env.STARKEN_API_KEY;
const API_USER = process.env.STARKEN_USER;

const PACKAGE = { weight: 0.3, volume: 0.00075 }; // 5x10x15cm

async function getRate({ city, region }) {
  if (!API_KEY || !API_USER) throw new Error('STARKEN_API_KEY / STARKEN_USER no configurados');

  const res = await axios.post(
    `${BASE_URL}/tarifas`,
    {
      origen: 'Santiago',
      destino: city,
      region: region,
      peso: PACKAGE.weight,
      volumen: PACKAGE.volume,
      tipo_servicio: 'normal'
    },
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'x-user': API_USER,
        'Content-Type': 'application/json'
      }
    }
  );

  const tarifa = res.data?.tarifas?.[0];
  if (!tarifa) throw new Error('Sin cobertura Starken');

  return {
    carrier: 'Starken',
    price: Math.round(tarifa.precio),
    deliveryTime: tarifa.plazo_entrega || '3-5 días hábiles',
    serviceType: tarifa.tipo || 'Encomienda normal'
  };
}

module.exports = { getRate };
