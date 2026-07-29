'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../services/atletas');

const hoy = () => new Date().toISOString().slice(0, 10);
const hace = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test.beforeEach(() => A._reset());

// ── Validación de entrada ────────────────────────────────────────────────
test('rechaza fechas inválidas, futuras o prehistóricas', () => {
  const { fechaValida } = A._internos;
  assert.strictEqual(fechaValida(hoy()), hoy());
  assert.strictEqual(fechaValida(hace(30)), hace(30));
  assert.strictEqual(fechaValida('2026-7-1'), null, 'formato corto no vale');
  assert.strictEqual(fechaValida('ayer'), null);
  assert.strictEqual(fechaValida(''), null);
  assert.strictEqual(fechaValida(null), null);
  const futuro = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  assert.strictEqual(fechaValida(futuro), null, 'no se aceptan datos del futuro');
  assert.strictEqual(fechaValida('2019-01-01'), null, 'demasiado viejo');
});

test('descarta métricas fuera de rango fisiológico', () => {
  const { normalizarDia } = A._internos;
  const d = normalizarDia({
    fecha: hoy(), suenoHoras: 7.5, pulsoReposo: 500, hrv: -3, carga: 99999
  });
  assert.strictEqual(d.suenoHoras, 7.5, 'lo válido se conserva');
  assert.strictEqual(d.pulsoReposo, undefined, 'pulso imposible se descarta');
  assert.strictEqual(d.hrv, undefined, 'HRV negativo se descarta');
  assert.strictEqual(d.carga, undefined, 'carga absurda se descarta');
});

test('un día sin ninguna métrica se descarta entero', () => {
  assert.strictEqual(A._internos.normalizarDia({ fecha: hoy() }), null);
  assert.strictEqual(A._internos.normalizarDia({ fecha: hoy(), suenoHoras: 'ocho' }), null);
});

// ── Alta ─────────────────────────────────────────────────────────────────
test('el equipo nace con clave propia y el atleta con token propio', () => {
  const eq = A.crearEquipo({ nombre: 'Los Troncos', deporte: 'rugby' });
  assert.ok(eq.id && eq.clave);
  assert.strictEqual(eq.nombre, 'Los Troncos');

  const at = A.crearAtleta({ nombre: 'Rojas', idEquipo: eq.id });
  assert.ok(at.token);
  assert.notStrictEqual(at.token, eq.clave);
  assert.strictEqual(at.deporte, 'rugby', 'hereda el deporte del equipo');
});

test('la clave del equipo se valida sin filtrar por tiempo ni aceptar basura', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  assert.ok(A.equipoPorClave(eq.id, eq.clave));
  assert.strictEqual(A.equipoPorClave(eq.id, 'otra'), null);
  assert.strictEqual(A.equipoPorClave(eq.id, ''), null);
  assert.strictEqual(A.equipoPorClave(eq.id, eq.clave + 'x'), null, 'largo distinto no rompe');
  assert.strictEqual(A.equipoPorClave('inexistente', eq.clave), null);
});

test('el token identifica al atleta correcto', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const a1 = A.crearAtleta({ nombre: 'Uno', idEquipo: eq.id });
  const a2 = A.crearAtleta({ nombre: 'Dos', idEquipo: eq.id });
  assert.strictEqual(A.atletaPorToken(a1.token).nombre, 'Uno');
  assert.strictEqual(A.atletaPorToken(a2.token).nombre, 'Dos');
  assert.strictEqual(A.atletaPorToken('inventado'), null);
  assert.strictEqual(A.atletaPorToken(undefined), null);
});

// ── Sincronización ───────────────────────────────────────────────────────
test('sincronizar dos veces el mismo día actualiza, no duplica', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });

  A.guardarDias(at.id, [{ fecha: hoy(), suenoHoras: 7 }]);
  const r = A.guardarDias(at.id, [{ fecha: hoy(), suenoHoras: 7.5, pulsoReposo: 55 }]);

  assert.strictEqual(r.total, 1, 'sigue habiendo un solo día');
  const e = A.construirEntrada(at.id);
  assert.strictEqual(e.hoy.suenoHoras, 7.5, 'se quedó con el valor nuevo');
  assert.strictEqual(e.hoy.pulsoReposo, 55, 'y sumó el campo que faltaba');
});

test('una sincronización parcial no borra lo ya guardado', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  A.guardarDias(at.id, [{ fecha: hoy(), suenoHoras: 7, pulsoReposo: 55, hrv: 60 }]);
  A.guardarDias(at.id, [{ fecha: hoy(), carga: 400 }]);
  const e = A.construirEntrada(at.id);
  assert.strictEqual(e.hoy.pulsoReposo, 55, 'el pulso sobrevive');
  assert.strictEqual(e.hoy.carga, 400, 'y se agregó la carga');
});

test('la banda puede entregar varios días de una vez', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  const lote = [0, 1, 2, 3, 4, 5, 6].map(i => ({
    fecha: hace(i), suenoHoras: 7 + (i % 3) * 0.5, pulsoReposo: 54 + (i % 4)
  }));
  const r = A.guardarDias(at.id, lote);
  assert.strictEqual(r.guardados, 7);
  const e = A.construirEntrada(at.id);
  assert.strictEqual(e.historial.length, 6, 'seis previos');
  assert.ok(e.hoy.suenoHoras, 'y el de hoy aparte');
  assert.deepStrictEqual(
    e.historial.map(d => d.fecha),
    [...e.historial].map(d => d.fecha).sort(),
    'el historial va en orden cronológico'
  );
});

test('los días basura se cuentan como descartados sin tirar el resto', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  const r = A.guardarDias(at.id, [
    { fecha: hoy(), suenoHoras: 7 },
    { fecha: 'cualquier cosa', suenoHoras: 8 },
    { fecha: hace(1) },
    { fecha: hace(2), pulsoReposo: 56 }
  ]);
  assert.strictEqual(r.guardados, 2);
  assert.strictEqual(r.descartados, 2);
});

test('no se pueden escribir datos de un atleta inexistente', () => {
  const r = A.guardarDias('no-existe', [{ fecha: hoy(), suenoHoras: 8 }]);
  assert.strictEqual(r.guardados, 0);
  assert.match(r.error, /desconocido/);
});

test('el historial se poda para que no crezca sin límite', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  // 200 días válidos, en tandas porque hay tope por request
  for (let bloque = 0; bloque < 4; bloque++) {
    A.guardarDias(at.id, Array.from({ length: 50 }, (_, i) => ({
      fecha: hace(bloque * 50 + i), suenoHoras: 7
    })));
  }
  const total = Object.keys(A._estado().dias[at.id]).length;
  assert.ok(total <= 120, `se conservan como mucho 120 días (hay ${total})`);
});

// ── Evaluación y panel ───────────────────────────────────────────────────
test('la evaluación individual usa el historial acumulado', () => {
  const eq = A.crearEquipo({ nombre: 'X', deporte: 'hockey' });
  const at = A.crearAtleta({ nombre: 'Vega', idEquipo: eq.id });
  for (let i = 1; i <= 20; i++) {
    A.guardarDias(at.id, [{ fecha: hace(i), suenoHoras: 7.5, pulsoReposo: 55, hrv: 60, carga: 300 }]);
  }
  A.guardarDias(at.id, [{ fecha: hoy(), suenoHoras: 4.5, pulsoReposo: 66, hrv: 45, carga: 300 }]);

  const ev = A.evaluar(at.id);
  assert.strictEqual(ev.nombre, 'Vega');
  assert.strictEqual(ev.deporte, 'hockey');
  assert.strictEqual(ev.zona, 'roja');
  assert.ok(ev.alertas.some(a => /pulso/i.test(a.texto)), 'compara contra su propia base');
});

test('el panel agrupa solo a los atletas de ese equipo', () => {
  const a = A.crearEquipo({ nombre: 'Equipo A', deporte: 'futbol' });
  const b = A.crearEquipo({ nombre: 'Equipo B', deporte: 'rugby' });
  const j1 = A.crearAtleta({ nombre: 'A1', idEquipo: a.id });
  A.crearAtleta({ nombre: 'B1', idEquipo: b.id });
  A.guardarDias(j1.id, [{ fecha: hoy(), suenoHoras: 8, pulsoReposo: 55 }]);

  const panel = A.panelEquipo(a.id);
  assert.strictEqual(panel.equipo, 'Equipo A');
  assert.strictEqual(panel.total, 1, 'no mezcla jugadores de otro equipo');
  assert.ok(panel.jugadores[0].id, 'cada jugador trae su id para el panel');
  assert.strictEqual(A.panelEquipo('no-existe'), null);
});

test('el panel avisa quién no sincroniza hace días', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const alDia = A.crearAtleta({ nombre: 'AlDia', idEquipo: eq.id });
  const colgado = A.crearAtleta({ nombre: 'Colgado', idEquipo: eq.id });
  A.crearAtleta({ nombre: 'Nunca', idEquipo: eq.id });

  A.guardarDias(alDia.id, [{ fecha: hoy(), suenoHoras: 8 }]);
  A.guardarDias(colgado.id, [{ fecha: hace(5), suenoHoras: 8 }]);

  const s = A.estadoSincronizacion(eq.id);
  const porNombre = Object.fromEntries(s.map(x => [x.nombre, x]));
  assert.strictEqual(porNombre.AlDia.diasSinSincronizar, 0);
  assert.strictEqual(porNombre.Colgado.diasSinSincronizar, 5);
  assert.strictEqual(porNombre.Nunca.ultimaFecha, null);
});

test('borrar un atleta se lleva también sus datos', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  A.guardarDias(at.id, [{ fecha: hoy(), suenoHoras: 8 }]);
  assert.ok(A._estado().dias[at.id]);
  assert.strictEqual(A.borrarAtleta(at.id), true);
  assert.strictEqual(A._estado().dias[at.id], undefined, 'no quedan datos huérfanos');
  assert.strictEqual(A.atletaPorToken(at.token), null);
  assert.strictEqual(A.borrarAtleta(at.id), false, 'borrar dos veces no rompe');
});

// ── Contadores que entrega la banda ──────────────────────────────────────
test('guarda pasos, distancia y calorías que emite la banda', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  // Valores reales capturados de la banda: 201 pasos, 136 m, 25 kcal
  const r = A.guardarDias(at.id, [{ fecha: hoy(), pasos: 201, distancia: 136, calorias: 25, origen: 'banda' }]);
  assert.strictEqual(r.guardados, 1, 'un día solo con contadores ya vale');
  const e = A.construirEntrada(at.id);
  assert.strictEqual(e.hoy.pasos, 201);
  assert.strictEqual(e.hoy.distancia, 136);
  assert.strictEqual(e.hoy.calorias, 25);
});

test('descarta contadores imposibles', () => {
  const { normalizarDia } = A._internos;
  const d = normalizarDia({ fecha: hoy(), pasos: 5000, distancia: -20, calorias: 999999 });
  assert.strictEqual(d.pasos, 5000);
  assert.strictEqual(d.distancia, undefined, 'distancia negativa fuera');
  assert.strictEqual(d.calorias, undefined, 'calorías absurdas fuera');
});

test('los contadores conviven con los datos cargados a mano', () => {
  const eq = A.crearEquipo({ nombre: 'X' });
  const at = A.crearAtleta({ nombre: 'A', idEquipo: eq.id });
  A.guardarDias(at.id, [{ fecha: hoy(), pasos: 8000, calorias: 380, origen: 'banda' }]);
  A.guardarDias(at.id, [{ fecha: hoy(), suenoHoras: 7.2, pulsoReposo: 54, origen: 'manual' }]);
  const e = A.construirEntrada(at.id);
  assert.strictEqual(e.hoy.pasos, 8000, 'lo de la banda sobrevive');
  assert.strictEqual(e.hoy.suenoHoras, 7.2, 'y lo manual se suma');
  const ev = A.evaluar(at.id);
  assert.strictEqual(ev.hoy.pasos, 8000, 'la evaluación expone los contadores para el panel');
});
