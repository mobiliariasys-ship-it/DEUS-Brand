const axios = require('axios');

const BASE_URL = 'https://api.bluexpress.cl/v1';
const API_KEY = process.env.BLUEXPRESS_API_KEY;

const PACKAGE = { peso: 0.3, alto: 5, ancho: 10, largo: 15 };

async function getRate({ commune, region }) {
  if (!API_KEY) throw new Error('BLUEXPRESS_API_KEY no configurada');

  const res = await axios.post(
    `${BASE_URL}/cotizar`,
    {
      origen: { comuna: 'Santiago', region: 'Metropolitana' },
      destino: { comuna: commune, region: region },
      paquete: PACKAGE
    },
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const cotizacion = res.data?.cotizacion;
  if (!cotizacion) throw new Error('Sin cobertura Bluexpress');

  return {
    carrier: 'Bluexpress',
    price: Math.round(cotizacion.precio),
    deliveryTime: cotizacion.plazo || '4-6 días hábiles',
    serviceType: cotizacion.servicio || 'Envío estándar'
  };
}

module.exports = { getRate };
