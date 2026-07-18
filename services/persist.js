// Persistencia de datos: usa Postgres si hay DATABASE_URL configurada
// (sobrevive a los deploys de Render); si no, usa un archivo JSON local
// (mismo patrón que ya usaba stock.js — sobrevive al sueño por inactividad,
// pero no a un deploy nuevo, porque el disco de Render es efímero).
const fs = require('fs');
const path = require('path');
const db = require('./db');

function rutaArchivo(file) {
  return path.join(__dirname, '..', file);
}

function loadFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(rutaArchivo(file), 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveFile(file, data) {
  try {
    fs.writeFileSync(rutaArchivo(file), JSON.stringify(data));
  } catch (e) {
    console.error(`[persist] Error guardando ${file}:`, e.message);
  }
}

// `key` se usa tal cual como nombre de archivo (modo local) o como clave en
// la base de datos (modo Postgres) — mantiene compatibilidad con los mismos
// nombres que ya se usaban (ej. 'metrics-data.json', 'pedidos.json').
async function load(key, fallback) {
  if (db.activa) {
    try {
      const v = await db.get(key);
      return v === undefined ? fallback : v;
    } catch (e) {
      console.error(`[persist] Error leyendo "${key}" de la base de datos:`, e.message);
      return fallback;
    }
  }
  return loadFile(key, fallback);
}

async function save(key, data) {
  if (db.activa) {
    try {
      await db.set(key, data);
      return;
    } catch (e) {
      console.error(`[persist] Error guardando "${key}" en la base de datos:`, e.message);
      return;
    }
  }
  saveFile(key, data);
}

module.exports = { load, save };
