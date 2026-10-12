// Reseñas que el dueño carga desde el panel (admin.html → sección "Reseñas").
//
// Se guardan con persist.js (Postgres si responde, archivo local si no), igual
// que las ventas. La lista va en una clave y cada foto en la suya: así leer la
// lista para pintar la web no arrastra las imágenes.
//
// La web pide /resenas/lista y suma estas tarjetas a las que están fijas en el
// HTML; cada foto se sirve desde /resenas/foto/:id.
//
// Transparencia: si la foto está editada o quien escribe es cercano a la marca
// (familia, amigos, equipo), la tarjeta lo dice a la vista. Una reseña que
// esconde eso engaña al comprador, aunque el comentario sea sincero.
const crypto = require('crypto');

const CLAVE_LISTA = 'resenas-panel.json';
const claveFoto = (id) => `resena-foto-${id}.json`;
const MAX_FOTO = 1.5 * 1024 * 1024;   // bytes de la imagen ya decodificada
const MAX_EN_CACHE = 40;              // fotos en memoria para no ir a la base en cada visita
const ID_OK = /^[a-f0-9]{12}$/;
// Cómo se muestra el origen junto al nombre ("@usuario · Instagram").
const ORIGENES = { instagram: 'Instagram', whatsapp: 'WhatsApp', web: 'Formulario web', otro: '' };

// Error de datos del formulario: su mensaje se le muestra tal cual al dueño.
class ErrorResena extends Error {}

function limpiar(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
}

// La foto llega del panel como data URL (el navegador ya la achicó). Se revisan
// el tipo declarado, el tamaño y la firma real del archivo: un "image/jpeg" que
// no empieza como JPEG no se guarda.
function leerFoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || '').replace(/\s/g, ''));
  if (!m) throw new ErrorResena('La foto tiene que ser JPG, PNG o WebP.');
  const tipo = m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length) throw new ErrorResena('La foto llegó vacía.');
  if (buf.length > MAX_FOTO) throw new ErrorResena('La foto pesa más de 1,5 MB.');
  const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
  const firmaOk =
    tipo === 'image/jpeg' ? buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff :
    tipo === 'image/png' ? ascii(0, 8) === '\x89PNG\r\n\x1a\n' :
    ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (!firmaOk) throw new ErrorResena('El archivo no es una imagen válida.');
  return { tipo, buf };
}

function crearServicio({ load, save }) {
  let lista = [];
  const cache = new Map(); // id -> { tipo, buf }

  async function init() {
    const v = await load(CLAVE_LISTA, []);
    lista = Array.isArray(v) ? v : [];
  }

  const guardarLista = () => save(CLAVE_LISTA, lista);

  // Lo que ve cualquiera: sin datos internos.
  function publica(r) {
    return {
      id: r.id,
      autor: r.autor,
      texto: r.texto,
      estrellas: r.estrellas,
      ubicacion: r.ubicacion,
      origen: ORIGENES[r.origen] || '',
      foto: r.foto ? `/resenas/foto/${r.id}` : null,
      notaFoto: r.foto && r.fotoEditada ? `Foto editada${r.notaFoto ? ' ' + r.notaFoto : ''}` : '',
      cercano: !!r.cercano,
      creada: r.creada
    };
  }

  const publicas = () => lista.filter((r) => r.visible).map(publica);
  const todas = () => lista.map((r) => ({ ...publica(r), visible: !!r.visible }));

  async function crear(datos) {
    const d = datos || {};
    const autor = limpiar(d.autor, 60);
    const texto = limpiar(d.texto, 600);
    if (!autor) throw new ErrorResena('Falta el nombre o usuario de quien escribió la reseña.');
    if (!texto) throw new ErrorResena('Falta el comentario.');
    const estrellas = Math.round(Number(d.estrellas));
    if (!(estrellas >= 1 && estrellas <= 5)) throw new ErrorResena('Las estrellas van de 1 a 5.');
    const r = {
      id: crypto.randomBytes(6).toString('hex'),
      autor,
      texto,
      estrellas,
      ubicacion: limpiar(d.ubicacion, 40),
      origen: Object.prototype.hasOwnProperty.call(ORIGENES, d.origen) ? d.origen : 'instagram',
      foto: false,
      fotoEditada: false,
      notaFoto: '',
      cercano: d.cercano === true,
      visible: true,
      creada: new Date().toISOString()
    };
    if (d.foto) {
      const f = leerFoto(d.foto);
      // La foto se guarda antes que la lista: si falla, la reseña no queda a medias.
      await save(claveFoto(r.id), { tipo: f.tipo, datos: f.buf.toString('base64') });
      recordar(r.id, f);
      r.foto = true;
      r.fotoEditada = d.fotoEditada === true;
      r.notaFoto = r.fotoEditada ? limpiar(d.notaFoto, 60) : '';
    }
    lista.unshift(r); // la más nueva primero
    await guardarLista();
    return publica(r);
  }

  async function cambiarVisible(id, visible) {
    const r = lista.find((x) => x.id === id);
    if (!r) return null;
    r.visible = !!visible;
    await guardarLista();
    return publica(r);
  }

  async function borrar(id) {
    const i = lista.findIndex((x) => x.id === id);
    if (i < 0) return false;
    const [r] = lista.splice(i, 1);
    await guardarLista();
    if (r.foto) {
      cache.delete(id);
      await save(claveFoto(id), null); // persist.js no borra claves: se vacía
    }
    return true;
  }

  function recordar(id, f) {
    if (cache.size >= MAX_EN_CACHE) cache.delete(cache.keys().next().value);
    cache.set(id, f);
  }

  // Foto de una reseña. Las ocultas solo se entregan al panel (miniaturas).
  async function foto(id, { incluirOcultas = false } = {}) {
    if (!ID_OK.test(String(id || ''))) return null;
    const r = lista.find((x) => x.id === id);
    if (!r || !r.foto || (!r.visible && !incluirOcultas)) return null;
    if (cache.has(id)) return cache.get(id);
    const g = await load(claveFoto(id), null);
    if (!g || !g.datos) return null;
    const f = { tipo: g.tipo, buf: Buffer.from(g.datos, 'base64') };
    recordar(id, f);
    return f;
  }

  return { init, publicas, todas, crear, cambiarVisible, borrar, foto };
}

const persist = require('./persist');
module.exports = { ...crearServicio({ load: persist.load, save: persist.save }), crearServicio, leerFoto, ErrorResena };
