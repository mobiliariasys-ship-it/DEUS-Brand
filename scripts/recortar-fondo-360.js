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

// Cuadro del giro -> RGBA sin fondo (Buffer W*H*4)
function recortarCuadro({ data, W, H, C }) {
  const N = W * H;
  const dif = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * C;
    dif[p] = Math.max(Math.abs(data[i] - FONDO), Math.abs(data[i + 1] - FONDO), Math.abs(data[i + 2] - FONDO));
  }
  // Regiones de negro (4-conectadas): las del borde son fondo; las encerradas, si pasan el filtro
  const fondo = new Uint8Array(N); const visto = new Uint8Array(N); const cola = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (visto[s] || dif[s] > TOLERANCIA) continue;
    let ini = 0, fin = 0, borde = false; cola[fin++] = s; visto[s] = 1;
    while (ini < fin) {
      const p = cola[ini++]; const x = p % W, y = (p / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) borde = true;
      for (const q of vecinos4(p, W, H)) if (q >= 0 && !visto[q] && dif[q] <= TOLERANCIA) { visto[q] = 1; cola[fin++] = q; }
    }
    const px = cola.subarray(0, fin);
    // < 900 px no llega al radio mínimo: perforaciones y rendijas, se quedan
    if (borde || (fin >= 900 && esFondoEncerrado(px, W))) for (const p of px) fondo[p] = 1;
  }
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
