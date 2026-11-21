// Quita el fondo negro de los cuadros del visor 360° (f_001..f_085).
//
// Los cuadros vienen de un render con fondo #080808 parejo. En la web van sobre
// una tarjeta gris de vidrio, así que el fondo tiene que ser transparente.
//
// Originales con fondo: img/rot360. Recortados: img/rot360-v3 (lo que usa la
// web). Nunca escribir los recortados encima de una carpeta que ya se publicó:
// los celulares guardan las imágenes 7 días (netlify.toml) y una página abierta
// antes del cambio sigue pidiendo la ruta vieja. Cada versión, carpeta nueva.
//
// Qué es fondo:
// 1. El negro que toca el borde del cuadro.
// 2. El negro ENCERRADO por la banda que se ve a través del aro (el espacio del
//    medio cuando la banda está de lado). Ojo: la banda tiene caras del MISMO
//    negro que el fondo (la cara del módulo, la correa en sombra), así que no
//    sirve "todo lo #080808". La diferencia: la cara de la banda está llena de
//    perforaciones o reflejos (huecos chicos dentro de la región negra) y el
//    fondo es una mancha lisa. Se quita la región encerrada solo si casi no
//    tiene perforaciones adentro y es ancha (radio >= RADIO_MIN): las rendijas
//    angostas se dejan negras, parecen sombra.
// 3. f_074..f_085 son un fundido de f_073 a f_001 que cierra la vuelta. Esos no
//    se recortan: se rehacen mezclando f_073 y f_001 ya recortados, con la misma
//    proporción que el original (se mide). Recortarlos directo dejaba manchas.
//
// Además, con el sensor encendido (f_061..f_073) sale un destello: una raya
// gris tenue de luz a la altura del sensor, encima del hueco. Sobre negro suma
// luz, pero opaca sobre el gris de la tarjeta queda como mancha oscura. Esos
// píxeles pasan a luz semitransparente (blanco con el alfa justo para que sobre
// negro se vea igual que antes).
//
// En el contorno, los píxeles de antialias pasan a alfa parcial (y se les saca
// la parte de fondo que traían), para que el borde no quede serruchado ni con
// halo negro.
//
// Para regenerar:
//   npm i sharp --no-save
//   node scripts/recortar-fondo-360.js img/rot360 img/rot360-v3
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FONDO = 8;          // gris del fondo del render (#080808)
const TOLERANCIA = 2;     // el fondo es parejo: más de 2 de diferencia ya es banda
const N_CUADROS = 85;
const ULTIMO_GIRO = 73;   // f_074..f_085: fundido de f_073 a f_001
const RADIO_MIN = 18;     // px: región encerrada más angosta que esto se deja negra
const PERFORACIONES_MAX = 1; // % del área: más que esto es la cara perforada de la banda
const DESTELLO_TENUE = 45;   // el destello no pasa de ~36 sobre el fondo
const DESTELLO_ALTO = 50;    // px arriba/abajo de la altura del sensor
const DESTELLO_HUECO = 40;   // px: tiene que haber fondo así de cerca arriba Y abajo
// Limpieza para fondo gris (21-nov-2026: sobre el gris humo se veían "sombras"
// al girar). Donde se ve el interior de la correa a través del aro, el render
// pinta partes sin luz del MISMO #080808 del fondo: el recorte las sacaba a
// medias y quedaban jirones negros con huecos grises. Sobre la tarjeta negra no
// se notaba; sobre gris parecen manchas.
const R_APERTURA = 5;     // px: el fondo de afuera no entra por pasadas más angostas que 2·R (si no, se comía caras de la correa tan negras como el fondo)
const R_CIERRE = 8;      // px: rendijas de fondo más angostas que 2·R entre partes de la banda pasan a banda (negro, sombra)
const ISLA_MIN = 400;     // px: pedazos sueltos de banda más chicos que esto son restos del recorte

const nombre = k => 'f_' + String(k).padStart(3, '0') + '.webp';

async function leer(archivo) {
  const { data, info } = await sharp(archivo).raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height, C: info.channels };
}

function vecinos4(p, W, H) {
  const x = p % W, y = (p / W) | 0;
  return [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1];
}

// Región negra encerrada: ¿es el fondo visto a través del aro?
function esFondoEncerrado(px, W) {
  let x0 = Infinity, x1 = 0, y0 = Infinity, y1 = 0;
  for (const p of px) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const w = x1 - x0 + 3, h = y1 - y0 + 3; // con 1 px de margen
  const m = new Uint8Array(w * h);
  for (const p of px) m[(((p / W) | 0) - y0 + 1) * w + (p % W - x0 + 1)] = 1;
  // Huecos internos = lo que no es región y no se alcanza desde el margen
  const fuera = new Uint8Array(w * h); const pila = [0]; fuera[0] = 1;
  while (pila.length) { const p = pila.pop(); for (const q of vecinos4(p, w, h)) if (q >= 0 && !fuera[q] && !m[q]) { fuera[q] = 1; pila.push(q); } }
  // Perforaciones/reflejos: huecos internos de 20 a 3000 px (los más chicos son
  // ruido de compresión; uno más grande es otra pieza, como el sensor)
  const visto = new Uint8Array(w * h); let areaPerf = 0;
  for (let s = 0; s < w * h; s++) {
    if (fuera[s] || m[s] || visto[s]) continue;
    let a = 0; const st = [s]; visto[s] = 1;
    while (st.length) { const p = st.pop(); a++; for (const q of vecinos4(p, w, h)) if (q >= 0 && !visto[q] && !fuera[q] && !m[q]) { visto[q] = 1; st.push(q); } }
    if (a >= 20 && a <= 3000) areaPerf += a;
  }
  if (100 * areaPerf / (px.length + areaPerf) >= PERFORACIONES_MAX) return false;
  // Radio del círculo más grande que cabe adentro (distancia chamfer 3-4)
  const d = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) d[p] = m[p] ? 1e9 : 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (m[p]) d[p] = Math.min(d[p], d[p - 1] + 3, d[p - w] + 3, d[p - w - 1] + 4, d[p - w + 1] + 4); }
  let radio = 0;
  for (let y = h - 2; y > 0; y--) for (let x = w - 2; x > 0; x--) { const p = y * w + x; if (!m[p]) continue;
    d[p] = Math.min(d[p], d[p + 1] + 3, d[p + w] + 3, d[p + w + 1] + 4, d[p + w - 1] + 4); if (d[p] > radio) radio = d[p]; }
  return radio / 3 >= RADIO_MIN;
}

// Destello del sensor: píxeles tenues a la altura del sensor encendido que
// tienen fondo justo arriba y justo abajo (una raya horizontal flotando en el
// hueco). Los bordes de la banda tienen fondo de un solo lado. Se quedan solo
// las manchas compactas: los bordes finos que cuelan sueltos se descartan.
function marcarDestello(data, W, H, C, fondo, dif) {
  const N = W * H, marca = new Uint8Array(N);
  let suma = 0, n = 0;
  for (let p = 0; p < N; p++) { const i = p * C; if (data[i + 2] >= 180 && data[i + 2] - data[i] >= 50) { suma += (p / W) | 0; n++; } }
  if (n < 30) return marca; // sensor apagado o no se ve
  const yc = Math.round(suma / n);
  const cand = new Uint8Array(N);
  for (let y = Math.max(0, yc - DESTELLO_ALTO); y <= Math.min(H - 1, yc + DESTELLO_ALTO); y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (fondo[p] || dif[p] > DESTELLO_TENUE) continue;
    let arriba = false, abajo = false;
    for (let d = 1; d <= DESTELLO_HUECO && !(arriba && abajo); d++) {
      if (!arriba && y - d >= 0 && fondo[p - d * W]) arriba = true;
      if (!abajo && y + d < H && fondo[p + d * W]) abajo = true;
    }
    if (arriba && abajo) cand[p] = 1;
  }
  const visto = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (!cand[s] || visto[s]) continue;
    const px = [s]; visto[s] = 1; let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (let j = 0; j < px.length; j++) {
      const p = px[j], x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, q = yy * W + xx;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && cand[q] && !visto[q]) { visto[q] = 1; px.push(q); }
      }
    }
    if (px.length >= 60 && x1 - x0 >= 7 && y1 - y0 >= 5) for (const p of px) marca[p] = 1;
  }
  return marca;
}

// Distancia chamfer 3-4 (en tercios de píxel) al píxel más cercano con m=1.
function distanciaA(m, W, H) {
  const N = W * H, d = new Float32Array(N);
  for (let p = 0; p < N; p++) d[p] = m[p] ? 0 : 1e9;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x; if (!d[p]) continue;
    let v = d[p];
    if (x > 0) v = Math.min(v, d[p - 1] + 3);
    if (y > 0) { v = Math.min(v, d[p - W] + 3); if (x > 0) v = Math.min(v, d[p - W - 1] + 4); if (x < W - 1) v = Math.min(v, d[p - W + 1] + 4); }
    d[p] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const p = y * W + x; if (!d[p]) continue;
    let v = d[p];
    if (x < W - 1) v = Math.min(v, d[p + 1] + 3);
    if (y < H - 1) { v = Math.min(v, d[p + W] + 3); if (x < W - 1) v = Math.min(v, d[p + W + 1] + 4); if (x > 0) v = Math.min(v, d[p + W - 1] + 4); }
    d[p] = v;
  }
  return d;
}

// Cierre morfológico de radio r: dilata y erosiona. Rellena las rendijas más
// angostas que 2r entre partes de m sin agrandar su contorno.
function cerrar(m, W, H, r) {
  const N = W * H, dil = new Uint8Array(N), d1 = distanciaA(m, W, H);
  for (let p = 0; p < N; p++) dil[p] = d1[p] <= 3 * r ? 1 : 0;
  const fuera = new Uint8Array(N);
  for (let p = 0; p < N; p++) fuera[p] = dil[p] ? 0 : 1;
  const d2 = distanciaA(fuera, W, H), out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = d2[p] > 3 * r ? 1 : 0;
  return out;
}

// Pedazos sueltos de banda (8-conectados) más chicos que min → fondo.
function quitarIslas(fondo, W, H, min) {
  const N = W * H, visto = new Uint8Array(N), cola = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (fondo[s] || visto[s]) continue;
    let ini = 0, fin = 0; cola[fin++] = s; visto[s] = 1;
    while (ini < fin) {
      const p = cola[ini++], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (!fondo[q] && !visto[q]) { visto[q] = 1; cola[fin++] = q; }
      }
    }
    if (fin < min) for (let j = 0; j < fin; j++) fondo[cola[j]] = 1;
  }
}

// Cuadro del giro -> RGBA sin fondo (Buffer W*H*4)
function recortarCuadro({ data, W, H, C }) {
  const N = W * H;
  const dif = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * C;
    dif[p] = Math.max(Math.abs(data[i] - FONDO), Math.abs(data[i + 1] - FONDO), Math.abs(data[i + 2] - FONDO));
  }
  // Fondo de afuera: el negro que toca el borde del cuadro. Antes se inundaba
  // directo y se colaba por grietas de 1-2 px del contorno hasta caras de la
  // correa del mismo negro (quedaban transparentes a medias). Ahora se inunda
  // sobre el negro "abierto" (sin las pasadas más angostas que 2·R_APERTURA) y
  // después se recupera el contorno exacto creciendo hasta R_APERTURA+2 px.
  const cand = new Uint8Array(N), noCand = new Uint8Array(N);
  for (let p = 0; p < N; p++) { cand[p] = dif[p] <= TOLERANCIA ? 1 : 0; noCand[p] = 1 - cand[p]; }
  const dA = distanciaA(noCand, W, H), eros = new Uint8Array(N);
  for (let p = 0; p < N; p++) eros[p] = cand[p] && dA[p] > 3 * R_APERTURA ? 1 : 0;
  const dB = distanciaA(eros, W, H), abierto = new Uint8Array(N);
  for (let p = 0; p < N; p++) abierto[p] = cand[p] && dB[p] <= 3 * R_APERTURA ? 1 : 0;
  const fondo = new Uint8Array(N); const visto = new Uint8Array(N); const cola = new Int32Array(N);
  let fin = 0;
  for (let p = 0; p < N; p++) {
    const x = p % W, y = (p / W) | 0;
    if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && abierto[p] && !fondo[p]) { fondo[p] = 1; cola[fin++] = p; }
  }
  for (let ini = 0; ini < fin;) {
    const p = cola[ini++];
    for (const q of vecinos4(p, W, H)) if (q >= 0 && abierto[q] && !fondo[q]) { fondo[q] = 1; cola[fin++] = q; }
  }
  // Recuperar el contorno: crecer dentro del negro, como mucho R_APERTURA+2 pasos
  let frente = [];
  for (let p = 0; p < N; p++) if (fondo[p]) frente.push(p);
  for (let paso = 0; paso < R_APERTURA + 2 && frente.length; paso++) {
    const sig = [];
    for (const p of frente) for (const q of vecinos4(p, W, H)) if (q >= 0 && cand[q] && !fondo[q]) { fondo[q] = 1; sig.push(q); }
    frente = sig;
  }
  // Regiones de negro encerradas por la banda (4-conectadas): fondo visto a
  // través del aro si pasan el filtro.
  for (let s = 0; s < N; s++) {
    if (visto[s] || fondo[s] || !cand[s]) continue;
    let ini = 0, f = 0; cola[f++] = s; visto[s] = 1;
    while (ini < f) {
      const p = cola[ini++];
      for (const q of vecinos4(p, W, H)) if (q >= 0 && !visto[q] && !fondo[q] && cand[q]) { visto[q] = 1; cola[f++] = q; }
    }
    const px = cola.subarray(0, f);
    // < 900 px no llega al radio mínimo: perforaciones y rendijas, se quedan
    if (f >= 900 && esFondoEncerrado(px, W)) for (const p of px) fondo[p] = 1;
  }
  // Rendijas entre partes de la banda → banda (quedan negras, como sombra) y
  // pedazos sueltos → fondo. Ver R_CIERRE e ISLA_MIN.
  const opaco = new Uint8Array(N);
  for (let p = 0; p < N; p++) opaco[p] = fondo[p] ? 0 : 1;
  const cerrado = cerrar(opaco, W, H, R_CIERRE);
  for (let p = 0; p < N; p++) if (fondo[p] && cerrado[p]) fondo[p] = 0;
  quitarIslas(fondo, W, H, ISLA_MIN);
  const destello = marcarDestello(data, W, H, C, fondo, dif);
  const out = Buffer.alloc(N * 4);
  for (let p = 0; p < N; p++) {
    const i = p * C, o = p * 4;
    if (destello[p]) { // luz: blanco con el alfa mínimo que sobre negro da el mismo color
      const al = Math.max(data[i] - FONDO, data[i + 1] - FONDO, data[i + 2] - FONDO, 0) / (255 - FONDO);
      for (let c = 0; c < 3; c++) out[o + c] = al > 0 ? Math.min(255, Math.round(FONDO + (data[i + c] - FONDO) / al)) : 0;
      out[o + 3] = Math.round(al * 255);
      continue;
    }
    let a = 255;
    if (fondo[p]) a = 0;
    else {
      // Contorno: píxel de banda pegado al fondo -> alfa según cuánto se aleja del negro
      const x = p % W, y = (p / W) | 0;
      let pegado = false;
      for (let dy = -1; dy <= 1 && !pegado; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && fondo[yy * W + xx]) { pegado = true; break; }
      }
      if (pegado) a = Math.round(255 * Math.min(1, Math.max(0.2, (dif[p] - TOLERANCIA) / 18)));
    }
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (a > 0 && a < 255) { // saca la mezcla con el fondo negro que traía el píxel del borde
      const al = a / 255;
      r = Math.min(255, Math.max(0, Math.round((r - (1 - al) * FONDO) / al)));
      g = Math.min(255, Math.max(0, Math.round((g - (1 - al) * FONDO) / al)));
      b = Math.min(255, Math.max(0, Math.round((b - (1 - al) * FONDO) / al)));
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return out;
}

// Proporción de f_001 en un cuadro del fundido original: y ≈ (1-w)·a + w·b
function medirFundido(y, a, b) {
  let num = 0, den = 0;
  for (let p = 0, n = y.W * y.H; p < n; p++) for (let c = 0; c < 3; c++) {
    const ya = y.data[p * y.C + c], aa = a.data[p * a.C + c], bb = b.data[p * b.C + c];
    num += (ya - aa) * (bb - aa); den += (bb - aa) * (bb - aa);
  }
  return Math.min(1, Math.max(0, num / den));
}

// Mezcla de dos cuadros recortados (alfa premultiplicado: sobre cualquier fondo
// se ve igual que el fundido original sobre negro)
function mezclar(A, B, w) {
  const out = Buffer.alloc(A.length);
  for (let o = 0; o < A.length; o += 4) {
    const aA = A[o + 3] / 255, aB = B[o + 3] / 255;
    const a = (1 - w) * aA + w * aB;
    out[o + 3] = Math.round(a * 255);
    if (a > 0) for (let c = 0; c < 3; c++) out[o + c] = Math.round(((1 - w) * A[o + c] * aA + w * B[o + c] * aB) / a);
  }
  return out;
}

const guardar = (rgba, W, H, salida) => sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(salida);

async function procesar(entrada, salida) {
  fs.mkdirSync(salida, { recursive: true });
  let primero = null, ultimo = null, W = 0, H = 0;
  for (let k = 1; k <= ULTIMO_GIRO; k++) {
    const img = await leer(path.join(entrada, nombre(k)));
    W = img.W; H = img.H;
    const rgba = recortarCuadro(img);
    if (k === 1) primero = rgba;
    if (k === ULTIMO_GIRO) ultimo = rgba;
    await guardar(rgba, W, H, path.join(salida, nombre(k)));
  }
  const o1 = await leer(path.join(entrada, nombre(1)));
  const oU = await leer(path.join(entrada, nombre(ULTIMO_GIRO)));
  for (let k = ULTIMO_GIRO + 1; k <= N_CUADROS; k++) {
    const w = medirFundido(await leer(path.join(entrada, nombre(k))), oU, o1);
    await guardar(mezclar(ultimo, primero, w), W, H, path.join(salida, nombre(k)));
    console.log(nombre(k) + ': fundido con ' + Math.round(w * 100) + '% de ' + nombre(1));
  }
}

if (require.main === module) {
  const [, , entrada, salida] = process.argv;
  if (!entrada || !salida) { console.error('Uso: node scripts/recortar-fondo-360.js <carpeta-originales> <carpeta-salida>'); process.exit(1); }
  procesar(entrada, salida).then(() => console.log('Recortados ' + N_CUADROS + ' cuadros en ' + salida))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { recortarCuadro, mezclar, medirFundido, procesar };
