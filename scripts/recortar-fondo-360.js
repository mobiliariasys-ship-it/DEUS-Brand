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
//   node scripts/recortar-fondo-360.js img/rot360 img/rot360-v7 img/rot360-v7m
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
// Pelitos: puntas OSCURAS más finas que 2·R_PELO+1 px pegadas al contorno (restos
// del fondo con ruido de compresión). Se sacan solo si el grupo es chico (las
// líneas finas largas son bordes de la correa de lado) y oscuro (los bordes con
// luz se quedan).
const R_PELO = 2;
const PELO_MAX = 90;      // px por grupo
const PELO_OSCURO = 24;   // diferencia con el fondo: más que esto es borde con luz

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

// Apertura morfológica de radio r: erosiona y dilata (saca lo más fino que 2r+1).
function abrir(m, W, H, r) {
  const N = W * H, fuera = new Uint8Array(N);
  for (let p = 0; p < N; p++) fuera[p] = m[p] ? 0 : 1;
  const d1 = distanciaA(fuera, W, H), er = new Uint8Array(N);
  for (let p = 0; p < N; p++) er[p] = m[p] && d1[p] > 3 * r ? 1 : 0;
  const d2 = distanciaA(er, W, H), out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = m[p] && d2[p] <= 3 * r ? 1 : 0;
  return out;
}

// Pelitos oscuros del contorno → fondo (ver R_PELO).
function quitarPelos(fondo, dif, W, H) {
  const N = W * H, banda = new Uint8Array(N);
  for (let p = 0; p < N; p++) banda[p] = fondo[p] ? 0 : 1;
  const ab = abrir(banda, W, H, R_PELO), pelo = new Uint8Array(N);
  for (let p = 0; p < N; p++) pelo[p] = banda[p] && !ab[p] && dif[p] <= PELO_OSCURO ? 1 : 0;
  const visto = new Uint8Array(N), cola = new Int32Array(N);
  for (let s = 0; s < N; s++) {
    if (!pelo[s] || visto[s]) continue;
    let ini = 0, fin = 0; cola[fin++] = s; visto[s] = 1;
    while (ini < fin) {
      const p = cola[ini++], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx;
        if (pelo[q] && !visto[q]) { visto[q] = 1; cola[fin++] = q; }
      }
    }
    if (fin <= PELO_MAX) for (let j = 0; j < fin; j++) fondo[cola[j]] = 1;
  }
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
// opciones.encerrados: si se sacan las regiones negras encerradas por la banda
// (el fondo visto a través del aro). opciones.registro: si viene un arreglo, se
// anota cada región sacada ({ area, x0, y0, x1, y1 }) para revisar el recorte.
function recortarCuadro({ data, W, H, C }, opciones = {}) {
  const sacarEncerrados = opciones.encerrados !== false;
  const TOL = opciones.tolerancia != null ? opciones.tolerancia : TOLERANCIA;
  const RC = opciones.rCierre != null ? opciones.rCierre : R_CIERRE;
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
  for (let p = 0; p < N; p++) { cand[p] = dif[p] <= TOL ? 1 : 0; noCand[p] = 1 - cand[p]; }
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
    if (sacarEncerrados && f >= 900 && esFondoEncerrado(px, W)) {
      for (const p of px) fondo[p] = 1;
      if (opciones.registro) {
        let x0 = W, y0 = H, x1 = 0, y1 = 0;
        for (const p of px) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        opciones.registro.push({ area: f, x0, y0, x1, y1 });
      }
    }
  }
  // Rendijas entre partes de la banda → banda (quedan negras, como sombra) y
  // pedazos sueltos → fondo. Ver R_CIERRE e ISLA_MIN.
  // Primero el ruido suelto: si no, el cierre lo une al contorno y quedan puntas.
  quitarIslas(fondo, W, H, ISLA_MIN);
  const opaco = new Uint8Array(N);
  for (let p = 0; p < N; p++) opaco[p] = fondo[p] ? 0 : 1;
  if (RC > 0) {
    const cerrado = cerrar(opaco, W, H, RC);
    for (let p = 0; p < N; p++) if (fondo[p] && cerrado[p]) fondo[p] = 0;
  }
  quitarIslas(fondo, W, H, ISLA_MIN);
  quitarPelos(fondo, dif, W, H);
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

// Huecos falsos (23-nov-2026): la banda tiene caras del mismo #080808 que el
// fondo y a veces quedan pegadas al fondo del borde, así que el relleno las
// borraba enteras (correa con agujeros grises en f_011, f_017-019, f_046,
// f_056, f_062...). Sobre la tarjeta negra no se notaba; sobre la gris sí.
// Arreglo con los cuadros vecinos: el giro avanza ~4° por cuadro, así que un
// píxel que es banda maciza (máscara erosionada) en algún cuadro de atrás Y en
// alguno de adelante es banda también en este. El fondo real (alrededor y a
// través del aro) es fondo en los vecinos y se queda transparente.
const VENTANA = 3;  // cuadros a cada lado
const EROSION = 4;  // px: el borde se mueve entre cuadros; solo cuenta lo macizo

function erosionar(m, W, H, r) {
  const tmp = new Uint8Array(W * H), out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1; for (let d = -r; d <= r && v; d++) { const xx = x + d; if (xx < 0 || xx >= W || !m[y * W + xx]) v = 0; }
    tmp[y * W + x] = v;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 1; for (let d = -r; d <= r && v; d++) { const yy = y + d; if (yy < 0 || yy >= H || !tmp[yy * W + x]) v = 0; }
    out[y * W + x] = v;
  }
  return out;
}

// cuadros: [{ rgba, orig }] del giro (sin el fundido). Devuelve cuántos px rellenó por cuadro.
function rellenarHuecos(cuadros, W, H) {
  const N = W * H;
  const macizo = cuadros.map(({ rgba }) => {
    const m = new Uint8Array(N); for (let p = 0; p < N; p++) m[p] = rgba[p * 4 + 3] >= 128 ? 1 : 0;
    return erosionar(m, W, H, EROSION);
  });
  const n = cuadros.length;
  return cuadros.map(({ rgba, orig }, k) => {
    const atras = [], adelante = [];
    for (let d = 1; d <= VENTANA; d++) { if (k - d >= 0) atras.push(macizo[k - d]); if (k + d < n) adelante.push(macizo[k + d]); }
    // En las puntas del giro hay vecinos de un solo lado: se piden dos de ese lado
    const ladoA = atras.length ? atras : adelante.slice(0, 1), ladoB = adelante.length ? adelante : atras.slice(0, 1);
    const ladoA2 = atras.length ? null : adelante.slice(1), ladoB2 = adelante.length ? null : atras.slice(1);
    const relleno = new Uint8Array(N); let cuenta = 0;
    for (let p = 0; p < N; p++) {
      if (rgba[p * 4 + 3] !== 0) continue;
      const okA = ladoA.some(m => m[p]) && (!ladoA2 || ladoA2.some(m => m[p]));
      const okB = ladoB.some(m => m[p]) && (!ladoB2 || ladoB2.some(m => m[p]));
      if (okA && okB) { relleno[p] = 1; cuenta++; }
    }
    if (!cuenta) return 0;
    const { data, C } = orig;
    for (let p = 0; p < N; p++) if (relleno[p]) {
      const o = p * 4, i = p * C; rgba[o] = data[i]; rgba[o + 1] = data[i + 1]; rgba[o + 2] = data[i + 2]; rgba[o + 3] = 255;
    }
    // Los bordes de antialias que quedaron adentro (pegados a un hueco ya relleno,
    // no al fondo) vuelven a ser opacos con su color original
    for (let p = 0; p < N; p++) {
      const a = rgba[p * 4 + 3]; if (a === 0 || a === 255) continue;
      const x = p % W, y = (p / W) | 0; let fondo = false, junto = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = yy * W + xx; if (rgba[q * 4 + 3] === 0) fondo = true; if (relleno[q]) junto = true;
      }
      if (junto && !fondo) { const o = p * 4, i = p * C; rgba[o] = data[i]; rgba[o + 1] = data[i + 1]; rgba[o + 2] = data[i + 2]; rgba[o + 3] = 255; }
    }
    return cuenta;
  });
}

// Mezcla de dos cuadros recortados para el fundido que cierra la vuelta.
// El alfa es el MAYOR de los dos, no el promedio: con el promedio la banda del
// fundido quedaba medio transparente (se veía la tarjeta gris a través, como un
// fantasma). El color es la mezcla premultiplicada, igual que el original.
function mezclar(A, B, w) {
  const out = Buffer.alloc(A.length);
  for (let o = 0; o < A.length; o += 4) {
    const aA = A[o + 3] / 255, aB = B[o + 3] / 255;
    const a = Math.max(aA, aB);
    out[o + 3] = Math.round(a * 255);
    if (a > 0) for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.round(((1 - w) * A[o + c] * aA + w * B[o + c] * aB) / ((1 - w) * aA + w * aB || 1)));
  }
  return out;
}

const guardar = (rgba, W, H, salida) => sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(salida);

async function procesar(entrada, salida, salidaMovil) {
  fs.mkdirSync(salida, { recursive: true });
  if (salidaMovil) fs.mkdirSync(salidaMovil, { recursive: true });
  let W = 0, H = 0;
  const cuadros = [];
  for (let k = 1; k <= ULTIMO_GIRO; k++) {
    const orig = await leer(path.join(entrada, nombre(k)));
    W = orig.W; H = orig.H;
    cuadros.push({ rgba: recortarCuadro(orig), orig });
  }
  rellenarHuecos(cuadros, W, H).forEach((c, k) => { if (c) console.log(nombre(k + 1) + ': ' + c + ' px de banda recuperados'); });
  const escribir = async (rgba, k) => {
    await guardar(rgba, W, H, path.join(salida, nombre(k)));
    // Celular: 600 px y más comprimido (en 4G los de 900 tardaban demasiado)
    if (salidaMovil) await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).resize(600, 600)
      .webp({ quality: 72, alphaQuality: 80, effort: 6 }).toFile(path.join(salidaMovil, nombre(k)));
  };
  for (let k = 1; k <= ULTIMO_GIRO; k++) await escribir(cuadros[k - 1].rgba, k);
  const primero = cuadros[0].rgba, ultimo = cuadros[ULTIMO_GIRO - 1].rgba;
  const o1 = await leer(path.join(entrada, nombre(1)));
  const oU = await leer(path.join(entrada, nombre(ULTIMO_GIRO)));
  for (let k = ULTIMO_GIRO + 1; k <= N_CUADROS; k++) {
    const w = medirFundido(await leer(path.join(entrada, nombre(k))), oU, o1);
    await escribir(mezclar(ultimo, primero, w), k);
    console.log(nombre(k) + ': fundido con ' + Math.round(w * 100) + '% de ' + nombre(1));
  }
}

if (require.main === module) {
  const [, , entrada, salida, salidaMovil] = process.argv;
  if (!entrada || !salida) { console.error('Uso: node scripts/recortar-fondo-360.js <carpeta-originales> <carpeta-salida> [carpeta-celular]'); process.exit(1); }
  procesar(entrada, salida, salidaMovil).then(() => console.log('Recortados ' + N_CUADROS + ' cuadros en ' + salida))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { recortarCuadro, rellenarHuecos, mezclar, medirFundido, procesar };
