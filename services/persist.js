// Persistencia de datos: usa Postgres si la base está configurada Y responde
// (así sobrevive a los deploys de Render); si no, usa un archivo JSON local.
//
// Por qué se le pregunta a db.init() y no a db.activa: db.activa solo dice que
// la variable DATABASE_URL existe. El 23/08 la base de Render quedó inalcanzable
// (getaddrinfo ENOTFOUND) con la variable todavía puesta, así que db.activa
// seguía en true y todo se guardaba contra una base muerta: db.set() devolvía
// false sin lanzar, save() se daba por cumplido y NINGUNA venta quedaba
// registrada, sin un solo error en el log. init() sí contacta la base, así que
// distingue "configurada" de "usable" y el respaldo local entra de verdad.
//
// El archivo local sobrevive al sueño por inactividad pero NO a un deploy
// nuevo (el disco de Render es efímero). O sea: es una red de emergencia para
// no perder ventas mientras la base está caída, no un reemplazo. Si aparece el
// aviso de "Postgres INALCANZABLE" en los logs, hay que arreglar DATABASE_URL.
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
  if (await db.init()) {
    try {
      const v = await db.get(key);
      return v === undefined ? fallback : v;
    } catch (e) {
      console.error(`[persist] Error leyendo "${key}" de la base de datos:`, e.message);
      return fallback;
    }
  }
  // Postgres no configurado o inalcanzable.
  return loadFile(key, fallback);
}

async function save(key, data) {
  if (await db.init()) {
    try {
      await db.set(key, data);
      return;
    } catch (e) {
      // La base respondía al arrancar pero este guardado falló. Se deja copia
      // local igual: perder la venta es peor que dejar un archivo huérfano.
      console.error(`[persist] Error guardando "${key}" en la base de datos:`, e.message, '— se deja copia local');
    }
  }
  saveFile(key, data);
}

module.exports = { load, save };
