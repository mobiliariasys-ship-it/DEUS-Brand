'use strict';
const test = require('node:test');
const assert = require('node:assert');
const R = require('../services/readiness');

// Genera historial de días "normales" para que exista línea base personal.
function historialNormal(dias = 28, extra = {}) {
  return Array.from({ length: dias }, () => ({
    suenoHoras: 7.5, pulsoReposo: 55, hrv: 60, carga: 300, ...extra
  }));
}

// ── Sub-puntajes ─────────────────────────────────────────────────────────
test('sueño: 8h da 100, 6h da 50, 4h o menos da 0', () => {
  const { puntajeSueno } = R._internos;
  assert.strictEqual(puntajeSueno(8), 100);
  assert.strictEqual(puntajeSueno(6), 50);
  assert.strictEqual(puntajeSueno(4), 0);
  assert.strictEqual(puntajeSueno(2), 0, 'no debe dar negativo');
  assert.strictEqual(puntajeSueno(10), 100, 'no debe pasar de 100');
  assert.strictEqual(puntajeSueno(undefined), null, 'sin dato devuelve null');
});

test('pulso en reposo: se mide contra la base personal, no contra tablas', () => {
  const { puntajePulso } = R._internos;
  assert.strictEqual(puntajePulso(55, 55), 100, 'en su base = perfecto');
  assert.strictEqual(puntajePulso(60, 55), 50, '+5 lpm = mitad');
  assert.strictEqual(puntajePulso(65, 55), 0, '+10 lpm = 0');
  assert.strictEqual(puntajePulso(50, 55), 100, 'por debajo de la base sigue siendo 100');
  // Mismo pulso absoluto, distinta persona, distinto resultado
  assert.ok(puntajePulso(60, 48) < puntajePulso(60, 62),
    '60 lpm castiga a quien suele tener 48 y no a quien suele tener 62');
});

test('HRV: se evalúa en porcentaje de caída', () => {
  const { puntajeHrv } = R._internos;
  assert.strictEqual(puntajeHrv(60, 60), 100);
  assert.strictEqual(puntajeHrv(54, 60), 50, '-10% = mitad');
  assert.strictEqual(puntajeHrv(48, 60), 0, '-20% = 0');
  assert.strictEqual(puntajeHrv(70, 60), 100, 'por encima no penaliza');
  assert.strictEqual(puntajeHrv(50, 0), null, 'base inválida no rompe');
});

test('carga: solo penaliza el exceso, no el descanso', () => {
  const { puntajeCarga } = R._internos;
  assert.strictEqual(puntajeCarga(0.5), 100, 'poca carga = está fresco, no penaliza');
  assert.strictEqual(puntajeCarga(1.0), 100);
  assert.strictEqual(puntajeCarga(1.3), 100, 'límite superior de la zona buena');
  assert.strictEqual(puntajeCarga(1.5), 50, 'salto de carga penaliza');
  assert.ok(puntajeCarga(1.8) === 0, 'salto grande = 0');
});

// ── Línea base ───────────────────────────────────────────────────────────
test('sin historial suficiente no se inventa línea base', () => {
  const base = R.calcularBaseline([{ pulsoReposo: 55 }, { pulsoReposo: 56 }]);
  assert.strictEqual(base.pulsoReposo, null, 'con 2 días no alcanza');
  const base2 = R.calcularBaseline([{ pulsoReposo: 55 }, { pulsoReposo: 57 }, { pulsoReposo: 56 }]);
  assert.strictEqual(base2.pulsoReposo, 56, 'con 3 días ya promedia');
});

test('la carga aguda se compara contra el equivalente semanal de 4 semanas', () => {
  const hist = Array.from({ length: 28 }, () => ({ carga: 100 }));
  const c = R.calcularCarga(hist, 100);
  assert.strictEqual(c.ratio, 1, 'carga estable da ratio 1');

  // Semana con el doble de carga que las anteriores
  const hist2 = [
    ...Array.from({ length: 21 }, () => ({ carga: 100 })),
    ...Array.from({ length: 6 },  () => ({ carga: 200 }))
  ];
  const c2 = R.calcularCarga(hist2, 200);
  assert.ok(c2.ratio > 1.4, `salto de carga detectado (ratio ${c2.ratio})`);
});

// ── Evaluación individual ────────────────────────────────────────────────
test('atleta descansado y con poca carga: verde y a exigirse', () => {
  const r = R.evaluarAtleta({
    nombre: 'Ana', deporte: 'resistencia',
    historial: historialNormal(28, { carga: 400 }),
    hoy: { suenoHoras: 8.2, pulsoReposo: 52, hrv: 66, carga: 100 }
  });
  assert.strictEqual(r.zona, 'verde');
  assert.ok(r.puntaje >= 90, `puntaje alto (${r.puntaje})`);
  assert.match(r.sesion, /intervalos|umbral|larga/i, 'propone sesión exigente');
  assert.strictEqual(r.confianza, 'alta');
});

test('atleta fundido: rojo, descanso y alerta de pulso', () => {
  const r = R.evaluarAtleta({
    nombre: 'Beto', deporte: 'rugby',
    historial: historialNormal(),
    hoy: { suenoHoras: 4.5, pulsoReposo: 66, hrv: 44, carga: 600 }
  });
  assert.strictEqual(r.zona, 'roja');
  assert.match(r.sesion, /descanso/i);
  assert.match(r.sesion, /contacto/i, 'la indicación es específica de rugby');
  assert.ok(r.alertas.some(a => a.nivel === 'alta' && /pulso/i.test(a.texto)),
    'avisa del pulso elevado');
});

test('falta el HRV: se reparte su peso en vez de castigar', () => {
  const base = historialNormal().map(d => ({ ...d, hrv: undefined }));
  const conHrv = R.evaluarAtleta({
    nombre: 'C', historial: historialNormal(),
    hoy: { suenoHoras: 8, pulsoReposo: 55, hrv: 60, carga: 300 }
  });
  const sinHrv = R.evaluarAtleta({
    nombre: 'C', historial: base,
    hoy: { suenoHoras: 8, pulsoReposo: 55, carga: 300 }
  });
  assert.strictEqual(sinHrv.factores.hrv, null);
  assert.strictEqual(sinHrv.puntaje, conHrv.puntaje,
    'sin HRV el puntaje no debe bajar respecto de tenerlo perfecto');
  assert.strictEqual(sinHrv.confianza, 'alta', '3 métricas siguen dando confianza alta');
});

test('sin ningún dato no opina', () => {
  const r = R.evaluarAtleta({ nombre: 'D', hoy: {}, historial: [] });
  assert.strictEqual(r.puntaje, null);
  assert.strictEqual(r.zona, 'sin-datos');
  assert.strictEqual(r.sesion, null);
  assert.match(r.mensaje, /sin datos/i);
});

test('el mensaje explica el porqué en lenguaje llano', () => {
  const r = R.evaluarAtleta({
    nombre: 'E', historial: historialNormal(),
    hoy: { suenoHoras: 6.5, pulsoReposo: 61, hrv: 55, carga: 300 }
  });
  assert.match(r.mensaje, /dormiste 6h30/i, 'dice cuánto durmió, no un puntaje abstracto');
  assert.match(r.mensaje, /pulso en reposo está 6 lpm sobre/);
  assert.match(r.mensaje, /^[A-ZÁÉÍÓÚÑ]/, 'arranca en mayúscula');
});

test('deuda de sueño acumulada dispara alerta', () => {
  const hist = historialNormal(28).map((d, i) => (i >= 22 ? { ...d, suenoHoras: 5 } : d));
  const r = R.evaluarAtleta({
    nombre: 'F', historial: hist,
    hoy: { suenoHoras: 5, pulsoReposo: 55, hrv: 60, carga: 300 }
  });
  assert.ok(r.alertas.some(a => /deuda de sueño/i.test(a.texto)), 'detecta la deuda');
});

test('salto de carga dispara alerta aunque duerma bien', () => {
  const hist = [
    ...Array.from({ length: 21 }, () => ({ suenoHoras: 8, pulsoReposo: 55, hrv: 60, carga: 100 })),
    ...Array.from({ length: 6 },  () => ({ suenoHoras: 8, pulsoReposo: 55, hrv: 60, carga: 300 }))
  ];
  const r = R.evaluarAtleta({
    nombre: 'G', historial: hist,
    hoy: { suenoHoras: 8, pulsoReposo: 55, hrv: 60, carga: 300 }
  });
  assert.ok(r.alertas.some(a => /salto de carga/i.test(a.texto)));
});

// ── Equipo ───────────────────────────────────────────────────────────────
test('plantel mayormente fundido: alerta colectiva', () => {
  const fundido = n => ({
    nombre: n, deporte: 'futbol', historial: historialNormal(),
    hoy: { suenoHoras: 4.5, pulsoReposo: 66, hrv: 45, carga: 700 }
  });
  const bien = n => ({
    nombre: n, deporte: 'futbol', historial: historialNormal(),
    hoy: { suenoHoras: 8, pulsoReposo: 54, hrv: 62, carga: 300 }
  });
  const eq = R.evaluarEquipo(
    [fundido('A'), fundido('B'), fundido('C'), fundido('D'), bien('E'), bien('F'), bien('G')],
    { nombreEquipo: 'Primera' }
  );

  assert.strictEqual(eq.total, 7);
  assert.strictEqual(eq.conteo.roja, 4);
  assert.ok(eq.alertas.some(a => /del plantel en rojo/i.test(a.texto)),
    'avisa que el problema es de planificación, no individual');
  assert.strictEqual(eq.aRevisar[0].zona, 'roja');
  assert.ok(eq.aRevisar.length >= 4);
  assert.strictEqual(eq.equipo, 'Primera');
});

test('plantel sano: sin alerta colectiva', () => {
  const bien = n => ({
    nombre: n, historial: historialNormal(),
    hoy: { suenoHoras: 8, pulsoReposo: 54, hrv: 62, carga: 300 }
  });
  const eq = R.evaluarEquipo(['A', 'B', 'C', 'D', 'E', 'F'].map(bien));
  assert.strictEqual(eq.conteo.roja, 0);
  assert.strictEqual(eq.alertas.length, 0);
  assert.strictEqual(eq.aRevisar.length, 0);
  assert.ok(eq.promedio >= 90);
});

test('jugadores sin sincronizar generan aviso', () => {
  const sinDatos = n => ({ nombre: n, hoy: {}, historial: [] });
  const bien = n => ({
    nombre: n, historial: historialNormal(),
    hoy: { suenoHoras: 8, pulsoReposo: 54, hrv: 62, carga: 300 }
  });
  const eq = R.evaluarEquipo([sinDatos('A'), sinDatos('B'), bien('C'), bien('D')]);
  assert.strictEqual(eq.conteo['sin-datos'], 2);
  assert.ok(eq.alertas.some(a => /sin datos hoy/i.test(a.texto)));
});

test('el equipo vacío no rompe', () => {
  const eq = R.evaluarEquipo([]);
  assert.strictEqual(eq.total, 0);
  assert.strictEqual(eq.promedio, null);
  assert.deepStrictEqual(eq.aRevisar, []);
});

test('todas las salidas llevan el descargo', () => {
  const r = R.evaluarAtleta({ nombre: 'X', hoy: { suenoHoras: 7 }, historial: [] });
  assert.match(r.descargo, /no reemplaza evaluación médica/i);
  assert.match(R.evaluarEquipo([]).descargo, /no reemplaza evaluación médica/i);
});
