// Endpoints del módulo de equipos: sincronización de bandas y panel del
// entrenador.
//
// Tres niveles de acceso, a propósito distintos:
//  · Dueño (STOCK_KEY)  — crea equipos y ve la lista completa.
//  · Entrenador (clave del equipo) — ve y administra SU plantel, nada más.
//  · Atleta (token propio) — solo puede subir SUS datos, no leer los de otros.
//
// El token del atleta es lo que permite que la página de sincronización sea
// pública sin que cualquiera pueda escribir datos falsos en la ficha ajena.

'use strict';
const express = require('express');
const router = express.Router();
const atletas = require('../services/atletas');

// ── Autorización ─────────────────────────────────────────────────────────
function claveAdmin() { return (process.env.STOCK_KEY || '').trim(); }

function soloDueno(req, res, next) {
  const clave = claveAdmin();
  if (!clave) return res.status(404).json({ error: 'No disponible' });
  const enviada = req.query.clave || (req.body && req.body.clave) || '';
  if (enviada !== clave) return res.status(403).json({ error: 'Clave incorrecta' });
  next();
}

// El entrenador se identifica con el id y la clave de su equipo.
function soloEntrenador(req, res, next) {
  const id = req.query.equipo || (req.body && req.body.equipo) || '';
  const clave = req.query.clave || (req.body && req.body.clave) || '';
  // La clave del dueño abre cualquier equipo, para poder dar soporte.
  const eq = atletas.equipoPorClave(id, clave)
          || (claveAdmin() && clave === claveAdmin() ? { id } : null);
  if (!eq) return res.status(403).json({ error: 'Equipo o clave incorrectos' });
  req.idEquipo = id;
  next();
}

// ── Alta de equipos (dueño) ──────────────────────────────────────────────
router.post('/equipo/crear', soloDueno, (req, res) => {
  const { nombre, deporte } = req.body || {};
  const eq = atletas.crearEquipo({ nombre, deporte });
  console.log(`[equipo] Creado "${eq.nombre}" (${eq.deporte}) id=${eq.id}`);
  // La clave se muestra una sola vez acá; es lo que se le entrega al club.
  res.json({ id: eq.id, nombre: eq.nombre, deporte: eq.deporte, clave: eq.clave });
});

router.get('/equipo/lista', soloDueno, (req, res) => {
  res.json({ equipos: atletas.listarEquipos() });
});

// ── Alta de atletas (entrenador) ─────────────────────────────────────────
router.post('/equipo/atleta', soloEntrenador, (req, res) => {
  const { nombre, deporte } = req.body || {};
  if (!nombre || !String(nombre).trim()) {
    return res.status(400).json({ error: 'Falta el nombre del jugador' });
  }
  const a = atletas.crearAtleta({ nombre, idEquipo: req.idEquipo, deporte });
  res.json({
    id: a.id, nombre: a.nombre, deporte: a.deporte,
    // Con este enlace el jugador sincroniza su banda; es personal e intransferible.
    enlaceSync: `/sync.html?t=${a.token}`
  });
});

router.delete('/equipo/atleta/:id', soloEntrenador, (req, res) => {
  res.json({ ok: atletas.borrarAtleta(req.params.id) });
});

// ── Sincronización desde la banda (atleta) ───────────────────────────────
// Lo llama la página que habla Bluetooth con la pulsera. Manda todos los días
// que la banda tenía guardados; acá se fusionan con lo que ya había.
router.post('/equipo/sync', (req, res) => {
  const { token, dias } = req.body || {};
  const atleta = atletas.atletaPorToken(token);
  if (!atleta) return res.status(403).json({ error: 'Token inválido' });
  if (!Array.isArray(dias)) return res.status(400).json({ error: 'Falta el arreglo de días' });

  const r = atletas.guardarDias(atleta.id, dias);
  console.log(`[equipo] Sync ${atleta.nombre}: ${r.guardados} día(s) guardado(s), ${r.descartados} descartado(s)`);

  // Se devuelve la evaluación del día para que el atleta vea algo útil al toque
  const evaluacion = atletas.evaluar(atleta.id);
  res.json({
    ok: true, nombre: atleta.nombre,
    guardados: r.guardados, descartados: r.descartados, totalHistorial: r.total,
    hoy: evaluacion && {
      puntaje: evaluacion.puntaje, zona: evaluacion.zona,
      mensaje: evaluacion.mensaje, sesion: evaluacion.sesion,
      confianza: evaluacion.confianza, descargo: evaluacion.descargo
    }
  });
});

// Ficha propia del atleta, con su token (para la vista del jugador)
router.get('/equipo/mi-ficha', (req, res) => {
  const atleta = atletas.atletaPorToken(req.query.t);
  if (!atleta) return res.status(403).json({ error: 'Token inválido' });
  const ev = atletas.evaluar(atleta.id, req.query.fecha);
  res.json({ nombre: atleta.nombre, deporte: atleta.deporte, evaluacion: ev });
});

// ── Panel del entrenador ─────────────────────────────────────────────────
router.get('/equipo/panel', soloEntrenador, (req, res) => {
  const panel = atletas.panelEquipo(req.idEquipo, req.query.fecha);
  if (!panel) return res.status(404).json({ error: 'Equipo no encontrado' });
  res.json({ ...panel, sincronizacion: atletas.estadoSincronizacion(req.idEquipo) });
});

// Carga manual: sirve para arrancar antes de que la banda sincronice sola, y
// para corregir a mano cuando un dato viene raro.
router.post('/equipo/dia-manual', soloEntrenador, (req, res) => {
  const { atleta, dia } = req.body || {};
  if (!atleta || !dia) return res.status(400).json({ error: 'Faltan atleta o dia' });
  const r = atletas.guardarDias(atleta, [{ ...dia, origen: 'manual' }]);
  if (r.error) return res.status(400).json({ error: r.error });
  if (!r.guardados) return res.status(400).json({ error: 'El día no tiene datos válidos' });
  res.json({ ok: true, ...r, evaluacion: atletas.evaluar(atleta, dia.fecha) });
});

module.exports = router;
