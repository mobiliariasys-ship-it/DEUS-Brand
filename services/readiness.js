// Motor de recomendación de carga: decide cuánto puede exigirse un atleta hoy.
//
// Por qué existe: Strava y compañía solo saben lo que pasó DURANTE el
// entrenamiento. La DEUS Band mide las otras 23 horas — sueño, pulso en reposo
// y HRV — que es justo lo que determina si hoy conviene apretar o aflojar.
// Ese es el diferencial que se puede cobrar; el resumen de kilómetros no.
//
// Cómo funciona: cada métrica se convierte a un sub-puntaje de 0 a 100 contra
// la LÍNEA BASE DEL PROPIO ATLETA (no contra tablas de población — un pulso de
// 60 es alto para alguien que suele tener 48 y bajo para quien tiene 70). Los
// sub-puntajes se promedian ponderados y de ahí salen la zona y la indicación.
//
// Tolera datos faltantes: si no hay HRV (Da Halo no siempre lo exporta), su
// peso se reparte entre las demás métricas en vez de castigar el puntaje.
//
// AVISO: esto es orientación deportiva, no diagnóstico médico. Ver DESCARGO.

'use strict';

// ── Parámetros ajustables ────────────────────────────────────────────────
const SUENO_OBJETIVO_H = 8;    // horas por noche
const SUENO_PISO_H     = 4;    // por debajo, el sub-puntaje es 0
const DIAS_BASELINE    = 28;   // ventana para la línea base personal
const MIN_DIAS_BASE    = 3;    // menos que esto y la base no es confiable

// Pesos relativos (se renormalizan si falta alguna métrica)
const PESOS = { sueno: 30, pulsoReposo: 25, hrv: 25, carga: 20 };

// Umbrales de zona
const ZONA_VERDE    = 70;
const ZONA_AMARILLA = 45;

const DESCARGO = 'Orientación deportiva basada en tus datos. No reemplaza evaluación médica ' +
                 'ni criterio profesional. Ante dolor, fiebre o malestar, no entrenes y consultá.';

// ── Utilidades ───────────────────────────────────────────────────────────
const limitar = (n, min, max) => Math.max(min, Math.min(max, n));
const redondear = (n, d = 0) => { const f = 10 ** d; return Math.round(n * f) / f; };

function promedio(valores) {
  const v = valores.filter(x => typeof x === 'number' && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

// ── Líneas base personales ───────────────────────────────────────────────
// Se calculan sobre el historial del propio atleta. Si hay menos de MIN_DIAS_BASE
// días, se devuelve null y las métricas que dependan de ello se omiten: es
// preferible no opinar a opinar sobre una base inventada.
function calcularBaseline(historial) {
  const dias = (historial || []).slice(-DIAS_BASELINE);
  const conPulso = dias.map(d => d.pulsoReposo).filter(v => typeof v === 'number');
  const conHrv   = dias.map(d => d.hrv).filter(v => typeof v === 'number');
  return {
    pulsoReposo: conPulso.length >= MIN_DIAS_BASE ? promedio(conPulso) : null,
    hrv:         conHrv.length   >= MIN_DIAS_BASE ? promedio(conHrv)   : null,
    dias: dias.length
  };
}

// ── Carga de entrenamiento ───────────────────────────────────────────────
// Relación entre la carga de los últimos 7 días y el promedio semanal de las
// últimas 4 semanas. Es el indicador clásico de "saltos de carga": subir muy
// rápido respecto de lo que el cuerpo viene tolerando es el patrón que precede
// a las lesiones por sobrecarga.
//
// Se usa como heurística, no como verdad absoluta: la literatura deportiva
// discute su valor predictivo. Sirve para detectar saltos bruscos, que es
// exactamente lo que un preparador físico quiere ver a tiempo.
function calcularCarga(historial, cargaHoy) {
  const dias = (historial || []).slice(-DIAS_BASELINE);
  const cargas = dias.map(d => (typeof d.carga === 'number' ? d.carga : 0));
  if (typeof cargaHoy === 'number') cargas.push(cargaHoy);
  if (cargas.length < 7) return { agudo: null, cronico: null, ratio: null, dias: cargas.length };

  const agudo = cargas.slice(-7).reduce((a, b) => a + b, 0);
  const ventana = cargas.slice(-28);
  const cronico = (ventana.reduce((a, b) => a + b, 0) / ventana.length) * 7; // equivalente semanal

  return {
    agudo: redondear(agudo),
    cronico: redondear(cronico),
    ratio: cronico > 0 ? redondear(agudo / cronico, 2) : null,
    dias: cargas.length
  };
}

// ── Sub-puntajes ─────────────────────────────────────────────────────────
function puntajeSueno(horas) {
  if (typeof horas !== 'number') return null;
  return redondear(limitar((horas - SUENO_PISO_H) / (SUENO_OBJETIVO_H - SUENO_PISO_H) * 100, 0, 100));
}

// +5 lpm sobre la base personal ya es señal de fatiga o infección incubando;
// +10 es bandera roja.
function puntajePulso(hoy, base) {
  if (typeof hoy !== 'number' || typeof base !== 'number') return null;
  return redondear(limitar(100 - (hoy - base) * 10, 0, 100));
}

// El HRV cae cuando el sistema nervioso está estresado. Se mide en porcentaje
// respecto de la base: -10% es fatiga clara, -20% es alarma.
function puntajeHrv(hoy, base) {
  if (typeof hoy !== 'number' || typeof base !== 'number' || base <= 0) return null;
  return redondear(limitar(100 + ((hoy - base) / base) * 500, 0, 100));
}

// Carga baja NO baja la disposición — significa que está fresco y puede exigirse.
// Solo penaliza el exceso.
function puntajeCarga(ratio) {
  if (typeof ratio !== 'number') return null;
  if (ratio <= 1.3) return 100;
  return redondear(limitar(100 - (ratio - 1.3) * 250, 0, 100));
}

// ── Indicación del día ───────────────────────────────────────────────────
// Prescripciones concretas por deporte. Un número no le dice a nadie qué hacer;
// una instrucción sí. Esa es la diferencia entre un panel y un entrenador.
const SESIONES = {
  general: {
    alta:  'Día para exigirte: series, intervalos o tu sesión más pesada de la semana.',
    media: 'Entrená normal, sin buscar récords. Volumen habitual a intensidad moderada.',
    baja:  'Sesión suave: 30-40 min aeróbico liviano, movilidad y elongación.',
    nula:  'Descanso. Caminata liviana como mucho.'
  },
  futbol: {
    alta:  'Día para carga alta: partido reducido, cambios de dirección y velocidad.',
    media: 'Trabajo técnico-táctico a ritmo normal. Evitá los sprints máximos repetidos.',
    baja:  'Solo técnica, pases y posesión en espacio amplio. Nada de duelos ni sprints.',
    nula:  'Descanso o recuperación en piscina. Sin trabajo de campo.'
  },
  rugby: {
    alta:  'Día para contacto y potencia: scrum, tackle, trabajo de fuerza pesado.',
    media: 'Skills y line-out a intensidad media. Contacto controlado, sin impactos máximos.',
    baja:  'Sin contacto. Manejo de pelota, carrera suave y movilidad.',
    nula:  'Descanso total. Cero contacto — es cuando más se lesiona.'
  },
  hockey: {
    alta:  'Día para intensidad: cambios de ritmo, definición y trabajo de potencia.',
    media: 'Técnica y táctica a ritmo normal. Cuidá la carga de sprints repetidos.',
    baja:  'Técnica de stick y pases, trote suave. Sin sprints ni frenadas bruscas.',
    nula:  'Descanso. Movilidad de cadera y espalda si quiere hacer algo.'
  },
  resistencia: {
    alta:  'Día de calidad: intervalos, umbral o tirada larga a ritmo objetivo.',
    media: 'Rodaje cómodo en zona 2, duración habitual.',
    baja:  'Regenerativo corto y muy suave, o descanso activo.',
    nula:  'Descanso completo.'
  }
};

function elegirSesion(zona, deporte, ratio) {
  const set = SESIONES[deporte] || SESIONES.general;
  if (zona === 'roja') return set.nula;
  if (zona === 'amarilla') return set.baja;
  // En verde, si además viene con poca carga acumulada, es momento de subirla.
  if (typeof ratio === 'number' && ratio < 0.8) return set.alta;
  return typeof ratio === 'number' && ratio > 1.3 ? set.media : set.alta;
}

// ── Evaluación individual ────────────────────────────────────────────────
/**
 * @param {object} atleta
 * @param {string} atleta.nombre
 * @param {string} [atleta.deporte]   general | futbol | rugby | hockey | resistencia
 * @param {object} atleta.hoy         { suenoHoras, pulsoReposo, hrv, carga }
 * @param {Array}  [atleta.historial] días previos con la misma forma
 */
function evaluarAtleta(atleta) {
  const { nombre, deporte = 'general', hoy = {}, historial = [] } = atleta || {};
  const base = calcularBaseline(historial);
  const carga = calcularCarga(historial, hoy.carga);

  const sub = {
    sueno:       puntajeSueno(hoy.suenoHoras),
    pulsoReposo: puntajePulso(hoy.pulsoReposo, base.pulsoReposo),
    hrv:         puntajeHrv(hoy.hrv, base.hrv),
    carga:       puntajeCarga(carga.ratio)
  };

  // Promedio ponderado solo sobre lo que efectivamente hay
  let suma = 0, pesoTotal = 0;
  for (const k of Object.keys(PESOS)) {
    if (sub[k] !== null) { suma += sub[k] * PESOS[k]; pesoTotal += PESOS[k]; }
  }

  if (!pesoTotal) {
    return {
      nombre, deporte, puntaje: null, zona: 'sin-datos',
      mensaje: 'Sin datos suficientes para recomendar. Cargá al menos el sueño de anoche.',
      sesion: null, factores: sub, carga, alertas: [], confianza: 'nula', descargo: DESCARGO
    };
  }

  const puntaje = redondear(suma / pesoTotal);
  const zona = puntaje >= ZONA_VERDE ? 'verde' : (puntaje >= ZONA_AMARILLA ? 'amarilla' : 'roja');

  // Confianza: cuántas métricas alimentaron el puntaje y cuánta historia hay
  const metricas = Object.values(sub).filter(v => v !== null).length;
  const confianza = (metricas >= 3 && base.dias >= 7) ? 'alta'
                  : (metricas >= 2 ? 'media' : 'baja');

  return {
    nombre, deporte, puntaje, zona,
    mensaje: redactarMensaje(puntaje, zona, sub, hoy, base, carga),
    sesion: elegirSesion(zona, deporte, carga.ratio),
    factores: sub,
    baseline: base,
    carga,
    alertas: detectarAlertas(sub, hoy, base, carga, historial),
    confianza,
    descargo: DESCARGO
  };
}

// Explica el porqué en lenguaje llano: el atleta obedece la indicación cuando
// entiende de dónde sale.
function redactarMensaje(puntaje, zona, sub, hoy, base, carga) {
  const partes = [];

  if (typeof hoy.suenoHoras === 'number') {
    const h = Math.floor(hoy.suenoHoras);
    const m = Math.round((hoy.suenoHoras - h) * 60);
    partes.push(`dormiste ${h}h${m ? String(m).padStart(2, '0') : '00'}`);
  }
  if (typeof hoy.pulsoReposo === 'number' && typeof base.pulsoReposo === 'number') {
    const d = redondear(hoy.pulsoReposo - base.pulsoReposo);
    if (d >= 3)      partes.push(`tu pulso en reposo está ${d} lpm sobre lo normal tuyo`);
    else if (d <= -3) partes.push(`tu pulso en reposo está ${Math.abs(d)} lpm por debajo de lo normal`);
    else              partes.push('tu pulso en reposo está en tu rango habitual');
  }
  if (typeof carga.ratio === 'number') {
    if (carga.ratio > 1.5)      partes.push(`venís entrenando ${Math.round((carga.ratio - 1) * 100)}% más que tu promedio`);
    else if (carga.ratio < 0.8) partes.push('venís con menos carga que tu promedio');
  }

  const contexto = partes.length ? partes.join(', ') + '. ' : '';
  const cierre = zona === 'verde'  ? 'Estás para exigirte.'
               : zona === 'amarilla' ? 'Hoy conviene bajar un cambio.'
               : 'Hoy toca priorizar la recuperación.';

  return contexto.charAt(0).toUpperCase() + contexto.slice(1) + cierre;
}

// ── Alertas ──────────────────────────────────────────────────────────────
function detectarAlertas(sub, hoy, base, carga, historial) {
  const alertas = [];

  if (typeof hoy.pulsoReposo === 'number' && typeof base.pulsoReposo === 'number'
      && hoy.pulsoReposo - base.pulsoReposo >= 8) {
    alertas.push({
      nivel: 'alta',
      texto: `Pulso en reposo ${redondear(hoy.pulsoReposo - base.pulsoReposo)} lpm sobre su base. ` +
             'Puede ser fatiga acumulada o una infección empezando. Preguntale cómo se siente antes de que entrene.'
    });
  }

  if (typeof carga.ratio === 'number' && carga.ratio > 1.5) {
    alertas.push({
      nivel: 'alta',
      texto: `Salto de carga: ${carga.ratio}× su promedio de las últimas 4 semanas. ` +
             'Es el patrón que suele preceder lesiones por sobrecarga.'
    });
  }

  // Deuda de sueño de la última semana
  const ult7 = (historial || []).slice(-6).map(d => d.suenoHoras).filter(v => typeof v === 'number');
  if (typeof hoy.suenoHoras === 'number') ult7.push(hoy.suenoHoras);
  if (ult7.length >= 5) {
    const deuda = ult7.reduce((a, h) => a + Math.max(0, SUENO_OBJETIVO_H - h), 0);
    if (deuda >= 8) {
      alertas.push({
        nivel: 'media',
        texto: `Acumula ${redondear(deuda)} h de deuda de sueño en la última semana. ` +
               'Ninguna recuperación funciona sin dormir.'
      });
    }
  }

  if (typeof carga.ratio === 'number' && carga.ratio < 0.8 && sub.sueno !== null && sub.sueno > 70) {
    alertas.push({
      nivel: 'info',
      texto: 'Está descansado y con poca carga acumulada: buen momento para subir la exigencia.'
    });
  }

  return alertas;
}

// ── Evaluación de plantel ────────────────────────────────────────────────
// Lo que el preparador físico necesita ver en 5 segundos: quién no está para
// entrenar hoy, y si el problema es de uno o del grupo entero.
function evaluarEquipo(atletas, opciones = {}) {
  const { nombreEquipo = 'Plantel' } = opciones;
  const evaluados = (atletas || []).map(evaluarAtleta);
  const conPuntaje = evaluados.filter(e => typeof e.puntaje === 'number');

  const conteo = { verde: 0, amarilla: 0, roja: 0, 'sin-datos': 0 };
  evaluados.forEach(e => { conteo[e.zona] = (conteo[e.zona] || 0) + 1; });

  const promedioEquipo = conPuntaje.length ? redondear(promedio(conPuntaje.map(e => e.puntaje))) : null;
  const pctRojo = evaluados.length ? conteo.roja / evaluados.length : 0;

  const alertasEquipo = [];

  // Si un tercio del plantel está en rojo, el problema no es individual: es la
  // planificación. Avisarlo al entrenador vale más que 30 fichas sueltas.
  if (pctRojo >= 0.3 && evaluados.length >= 5) {
    alertasEquipo.push({
      nivel: 'alta',
      texto: `${Math.round(pctRojo * 100)}% del plantel en rojo. No es un problema individual: ` +
             'revisá la carga de la semana y considerá una sesión de descarga para todos.'
    });
  }

  if (conteo['sin-datos'] >= Math.max(2, evaluados.length * 0.25)) {
    alertasEquipo.push({
      nivel: 'media',
      texto: `${conteo['sin-datos']} jugadores sin datos hoy. Sin sincronizar la banda no hay lectura posible.`
    });
  }

  // Prioridad de revisión: primero los peores, y dentro de ellos los que tienen
  // alertas de nivel alto.
  const aRevisar = evaluados
    .filter(e => e.zona === 'roja' || e.alertas.some(a => a.nivel === 'alta'))
    .sort((a, b) => (a.puntaje ?? 999) - (b.puntaje ?? 999));

  return {
    equipo: nombreEquipo,
    fecha: new Date().toISOString().slice(0, 10),
    promedio: promedioEquipo,
    total: evaluados.length,
    conteo,
    alertas: alertasEquipo,
    aRevisar: aRevisar.map(e => ({
      nombre: e.nombre, puntaje: e.puntaje, zona: e.zona,
      motivo: e.alertas.find(a => a.nivel === 'alta')?.texto || e.mensaje
    })),
    jugadores: evaluados,
    descargo: DESCARGO
  };
}

module.exports = {
  evaluarAtleta,
  evaluarEquipo,
  calcularBaseline,
  calcularCarga,
  DESCARGO,
  _internos: { puntajeSueno, puntajePulso, puntajeHrv, puntajeCarga, elegirSesion }
};
