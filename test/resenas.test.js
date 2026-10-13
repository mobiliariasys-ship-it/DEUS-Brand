'use strict';
// Reseñas cargadas desde el panel (services/resenas.js): validación de los datos,
// firma real de las fotos, ocultar y borrar. Se usa un almacenamiento en memoria
// para no escribir archivos ni tocar la base.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { crearServicio, ErrorResena } = require('../services/resenas');

function memoria(inicial = {}) {
  const datos = { ...inicial };
  const guardados = [];
  return {
    datos,
    guardados,
    load: async (k, fallback) => (k in datos ? JSON.parse(JSON.stringify(datos[k])) : fallback),
    save: async (k, v) => { datos[k] = JSON.parse(JSON.stringify(v)); guardados.push(k); }
  };
}

// Imágenes mínimas: lo que importa es que empiecen con la firma correcta.
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]).toString('base64');
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(8)]).toString('base64');
const WEBP = 'data:image/webp;base64,' + Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]).toString('base64');

async function servicio(inicial) {
  const m = memoria(inicial);
  const s = crearServicio(m);
  await s.init();
  return { s, m };
}

test('una reseña sin foto queda publicada con los textos limpios y el origen legible', async () => {
  const { s, m } = await servicio();
  const r = await s.crear({ autor: '  @rocio.romann ', texto: 'Me gusta   mucho', estrellas: 5, origen: 'instagram', ubicacion: ' Ñuñoa ' });
  assert.deepStrictEqual(
    { autor: r.autor, texto: r.texto, estrellas: r.estrellas, origen: r.origen, ubicacion: r.ubicacion, foto: r.foto, notaFoto: r.notaFoto, cercano: r.cercano },
    { autor: '@rocio.romann', texto: 'Me gusta mucho', estrellas: 5, origen: 'Instagram', ubicacion: 'Ñuñoa', foto: null, notaFoto: '', cercano: false });
  assert.match(r.id, /^[a-f0-9]{12}$/);
  assert.strictEqual(s.publicas().length, 1);
  assert.ok(m.guardados.includes('resenas-panel.json'));
});

test('las más nuevas quedan primero', async () => {
  const { s } = await servicio();
  await s.crear({ autor: 'A', texto: 'primera', estrellas: 5 });
  await s.crear({ autor: 'B', texto: 'segunda', estrellas: 4 });
  assert.deepStrictEqual(s.publicas().map((r) => r.autor), ['B', 'A']);
});

test('sin autor, sin comentario o con estrellas fuera de rango no se guarda', async () => {
  const { s, m } = await servicio();
  await assert.rejects(s.crear({ autor: '', texto: 'hola', estrellas: 5 }), ErrorResena);
  await assert.rejects(s.crear({ autor: 'A', texto: '   ', estrellas: 5 }), ErrorResena);
  await assert.rejects(s.crear({ autor: 'A', texto: 'hola', estrellas: 0 }), ErrorResena);
  await assert.rejects(s.crear({ autor: 'A', texto: 'hola', estrellas: 6 }), ErrorResena);
  await assert.rejects(s.crear({ autor: 'A', texto: 'hola' }), ErrorResena);
  assert.strictEqual(s.publicas().length, 0);
  assert.strictEqual(m.guardados.length, 0);
});

test('un origen desconocido se toma como Instagram y los textos largos se recortan', async () => {
  const { s } = await servicio();
  const r = await s.crear({ autor: 'x'.repeat(200), texto: 'y'.repeat(2000), estrellas: 3, origen: 'tiktok' });
  assert.strictEqual(r.origen, 'Instagram');
  assert.strictEqual(r.autor.length, 60);
  assert.strictEqual(r.texto.length, 600);
});

test('acepta fotos JPG, PNG y WebP y las sirve con su tipo', async () => {
  const { s } = await servicio();
  for (const [foto, tipo] of [[JPEG, 'image/jpeg'], [PNG, 'image/png'], [WEBP, 'image/webp']]) {
    const r = await s.crear({ autor: 'A', texto: 'con foto', estrellas: 5, foto });
    assert.strictEqual(r.foto, `/resenas/foto/${r.id}`);
    const f = await s.foto(r.id);
    assert.strictEqual(f.tipo, tipo);
    assert.ok(Buffer.isBuffer(f.buf) && f.buf.length > 0);
  }
});

test('la foto se lee desde el almacenamiento después de un reinicio', async () => {
  const m = memoria();
  const a = crearServicio(m); await a.init();
  const r = await a.crear({ autor: 'A', texto: 'con foto', estrellas: 5, foto: JPEG });
  const b = crearServicio(m); await b.init(); // proceso nuevo: sin caché en memoria
  const f = await b.foto(r.id);
  assert.strictEqual(f.tipo, 'image/jpeg');
  assert.strictEqual(f.buf[0], 0xff);
});

test('un archivo que no es imagen, aunque diga image/jpeg, no se guarda', async () => {
  const { s } = await servicio();
  const falsa = 'data:image/jpeg;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64');
  await assert.rejects(s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: falsa }), /no es una imagen válida/);
  await assert.rejects(s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: 'data:image/gif;base64,R0lGOD' }), /JPG, PNG o WebP/);
  await assert.rejects(s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: 'https://otro-sitio.cl/foto.jpg' }), /JPG, PNG o WebP/);
  assert.strictEqual(s.publicas().length, 0);
});

// JPEG de prueba del peso pedido (la firma basta para pasar la validación).
const jpegDe = (bytes) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(bytes - 3)]).toString('base64');

test('una foto de alta calidad (2,5 MB) se acepta y una de más de 3 MB se rechaza', async () => {
  const { s } = await servicio();
  const r = await s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: jpegDe(2.5 * 1024 * 1024) });
  assert.strictEqual(r.foto, '/resenas/foto/' + r.id, 'el panel sube fotos de hasta 2000 px, que pesan eso');
  assert.strictEqual((await s.foto(r.id)).buf.length, 2.5 * 1024 * 1024);
  await assert.rejects(s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: jpegDe(3 * 1024 * 1024 + 1) }), /3 MB/);
});

test('la cache de fotos se limita por peso: saca las más viejas y las vuelve a leer de la base', async () => {
  const m = memoria();
  let lecturas = 0;
  const load = (k, fallback) => { if (k.startsWith('resena-foto-')) lecturas++; return m.load(k, fallback); };
  const s = crearServicio({ load, save: m.save, maxCache: 1000 });
  await s.init();
  const [a, b, c] = [await s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: jpegDe(400) }),
    await s.crear({ autor: 'B', texto: 'x', estrellas: 5, foto: jpegDe(400) }),
    await s.crear({ autor: 'C', texto: 'x', estrellas: 5, foto: jpegDe(400) })];
  // A + B + C = 1200 bytes > 1000: A salió de la memoria, B y C siguen.
  await s.foto(b.id); await s.foto(c.id);
  assert.strictEqual(lecturas, 0, 'B y C se sirven desde memoria');
  assert.strictEqual((await s.foto(a.id)).buf.length, 400, 'A se recupera de la base');
  assert.strictEqual(lecturas, 1);
  // Al volver A, sale B (la más vieja que queda); C sigue en memoria.
  await s.foto(c.id);
  assert.strictEqual(lecturas, 1);
  await s.foto(b.id);
  assert.strictEqual(lecturas, 2);
  // Una foto más pesada que todo el límite igual se sirve: solo queda ella.
  const d = await s.crear({ autor: 'D', texto: 'x', estrellas: 5, foto: jpegDe(1500) });
  assert.strictEqual((await s.foto(d.id)).buf.length, 1500);
  assert.strictEqual(lecturas, 2, 'la recién subida se sirve desde memoria');
});

test('foto editada y persona cercana a la marca quedan avisadas en la reseña pública', async () => {
  const { s } = await servicio();
  const r = await s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: JPEG, fotoEditada: true, notaFoto: 'para mostrar la correa gris', cercano: true });
  assert.strictEqual(r.notaFoto, 'Foto editada para mostrar la correa gris');
  assert.strictEqual(r.cercano, true);
  const sinDetalle = await s.crear({ autor: 'B', texto: 'x', estrellas: 5, foto: JPEG, fotoEditada: true });
  assert.strictEqual(sinDetalle.notaFoto, 'Foto editada');
  // sin foto no hay nada que avisar de la foto
  const sinFoto = await s.crear({ autor: 'C', texto: 'x', estrellas: 5, fotoEditada: true, notaFoto: 'algo' });
  assert.strictEqual(sinFoto.notaFoto, '');
});

test('una reseña oculta sale de la web y su foto solo la ve el panel', async () => {
  const { s } = await servicio();
  const r = await s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: JPEG });
  await s.cambiarVisible(r.id, false);
  assert.strictEqual(s.publicas().length, 0);
  assert.strictEqual(s.todas()[0].visible, false);
  assert.strictEqual(await s.foto(r.id), null);
  assert.ok(await s.foto(r.id, { incluirOcultas: true }));
  await s.cambiarVisible(r.id, true);
  assert.strictEqual(s.publicas().length, 1);
  assert.strictEqual(await s.cambiarVisible('000000000000', true), null);
});

test('borrar quita la reseña y vacía su foto guardada', async () => {
  const { s, m } = await servicio();
  const r = await s.crear({ autor: 'A', texto: 'x', estrellas: 5, foto: JPEG });
  assert.strictEqual(await s.borrar(r.id), true);
  assert.strictEqual(s.todas().length, 0);
  assert.strictEqual(m.datos[`resena-foto-${r.id}.json`], null);
  assert.strictEqual(await s.foto(r.id, { incluirOcultas: true }), null);
  assert.strictEqual(await s.borrar(r.id), false);
});

test('un id con otro formato nunca llega al almacenamiento', async () => {
  const { s } = await servicio();
  assert.strictEqual(await s.foto('../pedidos'), null);
  assert.strictEqual(await s.foto(''), null);
});

test('al arrancar se recuperan las reseñas guardadas', async () => {
  const { s } = await servicio({ 'resenas-panel.json': [{ id: 'abcdef123456', autor: 'A', texto: 'x', estrellas: 5, origen: 'whatsapp', ubicacion: '', foto: false, fotoEditada: false, notaFoto: '', cercano: false, visible: true, creada: '2026-10-12T10:00:00.000Z' }] });
  const [r] = s.publicas();
  assert.strictEqual(r.origen, 'WhatsApp');
  assert.strictEqual(r.autor, 'A');
});

test('la web pinta las reseñas del panel con textContent y el panel también', () => {
  // Lo que escribe un cliente no puede convertirse en HTML en ninguna de las dos páginas.
  const web = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ini = web.indexOf('function tarjetaResenaPanel(');
  const fin = web.indexOf('function sumarResenasPanel(');
  assert.ok(ini > 0 && fin > ini, 'existe tarjetaResenaPanel en index.html');
  const cuerpo = web.slice(ini, fin);
  assert.ok(/t\.textContent='"'\+r\.texto\+'"'/.test(cuerpo), 'el comentario entra con textContent');
  assert.ok(!/innerHTML\s*=\s*[^;]*r\./.test(cuerpo), 'ningún dato de la reseña pasa por innerHTML');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const ini2 = admin.indexOf('function rpLista(');
  assert.ok(ini2 > 0, 'existe rpLista en admin.html');
  const a = admin.slice(ini2, admin.indexOf('function rpAccion(', ini2));
  assert.ok(a.length > 0 && !/innerHTML/.test(a), 'el panel arma la lista sin innerHTML');
});

test('el orden guardado se valida: ids con otro formato y repetidos se descartan', async () => {
  const { s, m } = await servicio();
  const o = await s.guardarOrden({ fotos: ['f-marcelo.rojas_', 'abcdef123456', 'f-marcelo.rojas_', '<script>', '../x'], textos: ['f-kathcortes_'] });
  assert.deepStrictEqual(o, { fotos: ['f-marcelo.rojas_', 'abcdef123456'], textos: ['f-kathcortes_'] });
  assert.deepStrictEqual(s.verOrden(), o);
  assert.ok(m.guardados.includes('resenas-orden.json'));
  await assert.rejects(s.guardarOrden({ fotos: 'no-es-lista', textos: [] }), ErrorResena);
  assert.deepStrictEqual(s.verOrden(), o, 'un orden mal armado no pisa el anterior');
});

test('el orden sobrevive a un reinicio', async () => {
  const m = memoria();
  const a = crearServicio(m); await a.init();
  await a.guardarOrden({ fotos: ['f-pdrozzzz', 'f-diorr.jayy'], textos: [] });
  const b = crearServicio(m); await b.init();
  assert.deepStrictEqual(b.verOrden(), { fotos: ['f-pdrozzzz', 'f-diorr.jayy'], textos: [] });
});

test('cada tarjeta fija de la web tiene un data-rid único que el orden acepta', () => {
  const web = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const ini = web.indexOf('id="reviewsCarr"');
  const zona = web.slice(ini, web.indexOf('class="rv-arrow l"', ini));
  const tarjetas = zona.match(/<div class="review-card[^"]*"[^>]*>/g) || [];
  const ids = tarjetas.map((t) => (/data-rid="([^"]+)"/.exec(t) || [])[1]);
  assert.ok(tarjetas.length >= 20, 'se encontraron las tarjetas del carrusel');
  assert.ok(ids.every((id) => /^f-[a-z0-9._]{1,60}$/.test(id || '')), 'todas tienen data-rid válido');
  assert.strictEqual(new Set(ids).size, ids.length, 'sin repetidos');
});
