// Conexión a Postgres (opcional). Sin DATABASE_URL configurada, este módulo
// queda inactivo y persist.js usa archivos locales en su lugar.
//
// Se usa una sola tabla genérica (kv_store) donde cada "dataset" (ventas,
// pedidos, tickets) se guarda como un bloque JSON bajo su propia clave. Es la
// forma más simple de dar persistencia real sin diseñar un esquema relacional
// para lo que hoy son solo unos arreglos.
const { Pool } = require('pg');

const connectionString = (process.env.DATABASE_URL || '').trim();
const activa = !!connectionString;

let pool = null;
let listo = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false } // necesario para la mayoría de los Postgres gestionados (Neon, Render, etc.)
    });
    pool.on('error', err => console.error('[db] Error inesperado en el pool:', err.message));
  }
  return pool;
}

// Crea la tabla si hace falta (idempotente). Se ejecuta una sola vez.
function init() {
  if (!activa) return Promise.resolve(false);
  if (!listo) {
    listo = getPool().query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `).then(() => {
      console.log('[db] Conectado a Postgres — persistencia sobrevive a los deploys.');
      return true;
    }).catch(err => {
      console.error('[db] No se pudo inicializar la tabla:', err.message);
      return false;
    });
  }
  return listo;
}

async function get(key) {
  const ok = await init();
  if (!ok) return undefined;
  const r = await getPool().query('SELECT value FROM kv_store WHERE key = $1', [key]);
  return r.rows[0] ? r.rows[0].value : undefined;
}

async function set(key, value) {
  const ok = await init();
  if (!ok) return false;
  await getPool().query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  return true;
}

module.exports = { activa, init, get, set };
