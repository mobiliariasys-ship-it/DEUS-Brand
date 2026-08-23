// Conexión a Postgres (opcional). Sin DATABASE_URL configurada, este módulo
// queda inactivo y persist.js usa archivos locales en su lugar.
//
// Se usa una sola tabla genérica (kv_store) donde cada "dataset" (ventas,
// pedidos, tickets) se guarda como un bloque JSON bajo su propia clave. Es la
// forma más simple de dar persistencia real sin diseñar un esquema relacional
// para lo que hoy son solo unos arreglos.
const { Pool } = require('pg');

// 'require'/'prefer'/'verify-ca' hoy se comportan igual que 'verify-full' en
// 'pg', pero la librería avisa que eso cambiará en una versión futura (dejaría
// de verificar el certificado). Se fija 'verify-full' explícito en la URL
// para no depender de ese comportamiento transitorio: queda seguro para
// siempre y de paso se va el warning en los logs.
const connectionString = (process.env.DATABASE_URL || '').trim()
  .replace(/sslmode=(require|prefer|verify-ca)\b/i, 'sslmode=verify-full');

// OJO: esto solo dice que la variable EXISTE, no que la base responda. Quien
// decide si se puede usar Postgres de verdad es init(), que sí la contacta.
// persist.js tiene que preguntarle a init(), no a esto.
const activa = !!connectionString;

let pool = null;
let listo = null;      // promesa del intento de conexión en curso o ya exitoso
let fallidoEn = 0;     // cuándo falló el último intento (0 = no hay fallo)

// Cuánto se espera antes de reintentar después de un fallo. Sin esta espera,
// con la base caída cada guardado pagaría un timeout de red; y si el fallo se
// recordara para siempre, una caída pasajera obligaría a redesplegar para
// volver a Postgres. Con esto se reintenta solo, cada tanto.
const REINTENTO_MS = 60000;

function getPool() {
  if (!pool) {
    const opts = { connectionString };
    // Si la URL no trae "sslmode" (proveedores sin ese parámetro en la URL),
    // se usa un modo permisivo de respaldo para no bloquear la conexión.
    if (!/sslmode=/i.test(connectionString)) {
      opts.ssl = { rejectUnauthorized: false };
    }
    pool = new Pool(opts);
    pool.on('error', err => console.error('[db] Error inesperado en el pool:', err.message));
  }
  return pool;
}

// Crea la tabla si hace falta (idempotente) y de paso comprueba que la base
// realmente responde.
function conectar() {
  return getPool().query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `).then(() => {
    fallidoEn = 0;
    console.log('[db] Conectado a Postgres — persistencia sobrevive a los deploys.');
    return true;
  }).catch(err => {
    fallidoEn = Date.now();
    listo = null;   // se vuelve a intentar pasado REINTENTO_MS
    console.error('[db] Postgres INALCANZABLE:', err.message);
    console.error('[db] persist.js pasa a archivos locales — los datos NO sobreviven al próximo deploy. Revisá DATABASE_URL.');
    return false;
  });
}

// Devuelve true solo si la base está contactada y usable.
function init() {
  if (!activa) return Promise.resolve(false);
  if (!listo) {
    if (fallidoEn && Date.now() - fallidoEn < REINTENTO_MS) return Promise.resolve(false);
    try {
      listo = conectar();
    } catch (err) {
      fallidoEn = Date.now();
      listo = null;
      console.error('[db] No se pudo abrir el pool:', err.message);
      return Promise.resolve(false);
    }
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
