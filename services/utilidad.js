// Utilidad diaria: lo que queda después de TODO.
//
// Está acá y no dentro del endpoint porque es la cuenta con la que se deciden
// los presupuestos. Los dos errores fáciles son cobrar el envío por unidad
// (un pedido de 3 bandas se despacha UNA vez) y el costo de banda por pedido
// (un pedido de 3 bandas cuesta el TRIPLE). Los tests fijan las dos cosas.

const COSTO_BANDA = 17000;   // por UNIDAD
const COSTO_ENVIO = 4000;    // por PEDIDO
const TASA_PASARELA = 0.035; // sobre el monto cobrado

// Meta REPORTA el gasto sin IVA pero COBRA con IVA. Verificado contra el
// recibo de agosto: las lineas por campana sumaban $88.898 y el cargo fue
// $105.789 — exactamente 88.898 x 1,19. Usar el numero de la API tal cual
// subestimaba la publicidad en un 19% todos los dias.
const IVA = 0.19;

function calcularDia(d, ads) {
  const pedidos = Number(d.pedidos) || 0;
  const unidades = Number(d.unidades) || 0;
  const ingresos = Number(d.ingresos) || 0;
  // `ads` viene de la API, sin IVA. Lo que sale del bolsillo lleva el 19%.
  const adsNeto = Math.round(Number(ads) || 0);
  const ivaAds = Math.round(adsNeto * IVA);
  const gastoAds = adsNeto + ivaAds;
  const costoBandas = unidades * COSTO_BANDA;
  const costoEnvios = pedidos * COSTO_ENVIO;
  const pasarela = Math.round(ingresos * TASA_PASARELA);
  return {
    fecha: d.fecha,
    pedidos, unidades, ingresos,
    costoBandas, costoEnvios, pasarela,
    adsNeto, ivaAds,
    ads: gastoAds,
    utilidad: ingresos - costoBandas - costoEnvios - pasarela - gastoAds,
    estimado: !!d.estimado
  };
}

function totalizar(filas) {
  return filas.reduce((a, f) => ({
    pedidos: a.pedidos + f.pedidos, unidades: a.unidades + f.unidades,
    ingresos: a.ingresos + f.ingresos, costoBandas: a.costoBandas + f.costoBandas,
    costoEnvios: a.costoEnvios + f.costoEnvios, pasarela: a.pasarela + f.pasarela,
    adsNeto: a.adsNeto + f.adsNeto, ivaAds: a.ivaAds + f.ivaAds,
    ads: a.ads + f.ads, utilidad: a.utilidad + f.utilidad
  }), { pedidos: 0, unidades: 0, ingresos: 0, costoBandas: 0, costoEnvios: 0, pasarela: 0, adsNeto: 0, ivaAds: 0, ads: 0, utilidad: 0 });
}

module.exports = { COSTO_BANDA, COSTO_ENVIO, TASA_PASARELA, IVA, calcularDia, totalizar };
