// Utilidad diaria: lo que queda después de TODO.
//
// Está acá y no dentro del endpoint porque es la cuenta con la que se deciden
// los presupuestos. Los dos errores fáciles son cobrar el envío por unidad
// (un pedido de 3 bandas se despacha UNA vez) y el costo de banda por pedido
// (un pedido de 3 bandas cuesta el TRIPLE). Los tests fijan las dos cosas.

const COSTO_BANDA = 17000;   // por UNIDAD
const COSTO_ENVIO = 4000;    // por PEDIDO
const TASA_PASARELA = 0.035; // sobre el monto cobrado

// Lo que se queda Mercado Libre de cada venta, sobre el PRECIO COMPLETO. Sale
// tal cual del resumen de ML de los últimos 30 días al 28-oct-2026 (Métricas →
// "Distribución de tus costos"): vendido $1.172.830 (17 × $68.990), cargos e
// inversiones $356.257, repartidos en publicidad 42,4%, cargo por venta 39,5%,
// envíos 16,3% y devoluciones 1,8%. Sobre lo vendido es el 30,4% (publicidad
// 12,88%, comisión 12%, envío 4,95%, devoluciones 0,55%): de $68.990 ML se
// queda $20.956 y deposita $48.034, lo mismo que ML dice que deposita en
// promedio ($816.573 / 17). El 12% de comisión calza además con todas las
// filas del Excel de ML (ver scripts/ml_reporte.py).
// Solo se aplica a las ventas de ML con su precio completo (bruto): las de
// antes del 28-sep-2026 traen lo que depositó ML.
const CARGOS_ML = {
  vendido: 1172830,
  cargos: 356257,
  partes: { publicidad: 0.424, comision: 0.395, envio: 0.163, devolucion: 0.018 }
};

// Meta REPORTA el gasto sin IVA pero COBRA con IVA. Verificado contra el
// recibo de agosto: las lineas por campana sumaban $88.898 y el cargo fue
// $105.789 — exactamente 88.898 x 1,19. Usar el numero de la API tal cual
// subestimaba la publicidad en un 19% todos los dias.
const IVA = 0.19;

// Día desde el que la utilidad cuenta los ads con IVA (commit "Utilidad
// diaria: el gasto en ads va con el 19% de IVA", 11-09-2026). La tarjeta
// "Utilidad histórica" del panel suma desde acá: antes de esa fecha el panel
// calculaba la publicidad sin IVA y no se mezclan las dos cuentas.
const IVA_DESDE = '2026-09-11';

// Cuántos días van desde IVA_DESDE hasta `hoy` (YYYY-MM-DD, día de Chile),
// contando los dos. Máximo 400: es lo que se le pide a Meta de una vez.
function diasDesdeIva(hoy) {
  const h = hoy || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
  const n = Math.round((Date.parse(h + 'T00:00:00Z') - Date.parse(IVA_DESDE + 'T00:00:00Z')) / 86400000) + 1;
  return Math.min(400, Math.max(1, n));
}

// comprasMeta: compras que Meta le atribuye a los anuncios ese día. Va solo
// como dato para el costo por compra "según Meta"; no entra en la utilidad,
// que se calcula con las ventas reales del panel.
function calcularDia(d, ads, comprasMeta) {
  const pedidos = Number(d.pedidos) || 0;
  const unidades = Number(d.unidades) || 0;
  const ingresos = Number(d.ingresos) || 0;
  // `ads` viene de la API, sin IVA. Lo que sale del bolsillo lleva el 19%.
  const adsNeto = Math.round(Number(ads) || 0);
  const ivaAds = Math.round(adsNeto * IVA);
  const gastoAds = adsNeto + ivaAds;
  // Ventas de Mercado Libre: no pasan por el despacho ni la pasarela de la web,
  // así que a esas no se les resta envío ni pasarela. Las del reporte de ML (y
  // las cargadas a mano antes del 28-oct) traen lo que deposita ML; las
  // cargadas con el precio completo (`brutoML`) llevan los cargos de ML de
  // abajo. Todas llevan su costo de banda, que está incluido en `unidades`.
  const pedidosExternos = Number(d.pedidosExternos) || 0;
  const unidadesExternas = Number(d.unidadesExternas) || 0;
  const ingresosExternos = Number(d.ingresosExternos) || 0;
  const costoBandas = unidades * COSTO_BANDA;
  const costoEnvios = Math.max(0, pedidos - pedidosExternos) * COSTO_ENVIO;
  const pasarela = Math.round(Math.max(0, ingresos - ingresosExternos) * TASA_PASARELA);
  // Las de Mercado Libre cargadas con el precio completo llevan los cargos de
  // ML. Van en su propia cuenta y no en "ads" ni "envíos": esas columnas son de
  // la web, y la publicidad de ML sumada a la de Meta falsearía el costo por
  // venta de los anuncios.
  const brutoML = Number(d.brutoML) || 0;
  // Primero el total, con la proporción exacta del resumen (así lo vendido en
  // esos 30 días da los mismos $356.257 de ML, sin los pesos de más que deja
  // redondear cada parte), y después el desglose; devoluciones se lleva el
  // resto para que las cuatro partes sumen justo el total.
  const cargosML = Math.round(brutoML * CARGOS_ML.cargos / CARGOS_ML.vendido);
  const mlPublicidad = Math.round(cargosML * CARGOS_ML.partes.publicidad);
  const mlComision = Math.round(cargosML * CARGOS_ML.partes.comision);
  const mlEnvio = Math.round(cargosML * CARGOS_ML.partes.envio);
  const mlDevolucion = cargosML - mlPublicidad - mlComision - mlEnvio;
  return {
    fecha: d.fecha,
    pedidos, unidades, ingresos,
    // Cuántos de esos pedidos llevaron el upsell de tapones. Va como dato, no
    // entra en la utilidad: falta el costo por set y meter una cifra inventada
    // ensuciaría el único número con el que se deciden los presupuestos.
    conTapones: Number(d.conTapones) || 0,
    // Lo mismo con las correas extra (el upsell desde el 27-oct-2026).
    conCorreas: Number(d.conCorreas) || 0,
    // Devoluciones de Mercado Libre en su día de compra. Su costo (lo que
    // cobró ML por los envíos) ya viene restado en ingresos, en negativo.
    devoluciones: Number(d.devoluciones) || 0,
    pedidosExternos, unidadesExternas, ingresosExternos,
    costoBandas, costoEnvios, pasarela,
    cargosML, mlPublicidad, mlComision, mlEnvio, mlDevolucion,
    adsNeto, ivaAds,
    ads: gastoAds,
    comprasMeta: Number(comprasMeta) || 0,
    utilidad: ingresos - costoBandas - costoEnvios - pasarela - cargosML - gastoAds,
    estimado: !!d.estimado,
    // Montos de Mercado Libre estimados: el reporte de ML los trajo vacíos.
    mlEstimado: !!d.mlEstimado,
    // Ventas cargadas a mano ese día: el panel ofrece quitarlas. Es un dato del
    // día, no plata: no se suma en el total.
    manuales: Number(d.manuales) || 0
  };
}

function totalizar(filas) {
  return filas.reduce((a, f) => ({
    pedidos: a.pedidos + f.pedidos, unidades: a.unidades + f.unidades,
    conTapones: a.conTapones + (f.conTapones || 0),
    conCorreas: a.conCorreas + (f.conCorreas || 0),
    devoluciones: a.devoluciones + (f.devoluciones || 0),
    pedidosExternos: a.pedidosExternos + (f.pedidosExternos || 0),
    unidadesExternas: a.unidadesExternas + (f.unidadesExternas || 0),
    ingresosExternos: a.ingresosExternos + (f.ingresosExternos || 0),
    ingresos: a.ingresos + f.ingresos, costoBandas: a.costoBandas + f.costoBandas,
    costoEnvios: a.costoEnvios + f.costoEnvios, pasarela: a.pasarela + f.pasarela,
    cargosML: a.cargosML + (f.cargosML || 0), mlPublicidad: a.mlPublicidad + (f.mlPublicidad || 0),
    mlComision: a.mlComision + (f.mlComision || 0), mlEnvio: a.mlEnvio + (f.mlEnvio || 0),
    mlDevolucion: a.mlDevolucion + (f.mlDevolucion || 0),
    adsNeto: a.adsNeto + f.adsNeto, ivaAds: a.ivaAds + f.ivaAds,
    ads: a.ads + f.ads, comprasMeta: a.comprasMeta + (f.comprasMeta || 0), utilidad: a.utilidad + f.utilidad
  }), { pedidos: 0, unidades: 0, conTapones: 0, conCorreas: 0, devoluciones: 0, pedidosExternos: 0, unidadesExternas: 0, ingresosExternos: 0, ingresos: 0, costoBandas: 0, costoEnvios: 0, pasarela: 0, cargosML: 0, mlPublicidad: 0, mlComision: 0, mlEnvio: 0, mlDevolucion: 0, adsNeto: 0, ivaAds: 0, ads: 0, comprasMeta: 0, utilidad: 0 });
}

module.exports = { COSTO_BANDA, COSTO_ENVIO, TASA_PASARELA, CARGOS_ML, IVA, IVA_DESDE, diasDesdeIva, calcularDia, totalizar };
