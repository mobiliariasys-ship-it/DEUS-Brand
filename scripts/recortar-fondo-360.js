// Quita el fondo negro de los cuadros del visor 360° (f_001..f_085).
//
// Los cuadros vienen de un render con fondo #080808 parejo. En la web van sobre
// una tarjeta gris de vidrio, así que el fondo tiene que ser transparente.
//
// Originales con fondo: img/rot360. Recortados: img/rot360-v2 (lo que usa la
// web). Nunca escribir los recortados encima de img/rot360: las páginas cargadas
// antes del cambio piden esa ruta y dibujan sin limpiar el canvas, así que con
// cuadros transparentes la banda queda con estela.
//
// Ojo: la banda tiene sombras del MISMO negro que el fondo (la cara interior
// de la correa y el fondo de las perforaciones). Por eso no sirve "todo lo
// #080808 a transparente": la banda quedaría agujereada. Solo se quita el negro
// que toca el borde del cuadro (relleno desde los bordes). El negro encerrado
// por la banda es banda y se queda opaco. En el contorno, los píxeles de
// antialias pasan a alfa parcial (y se les saca la parte de fondo que traían),
// para que el borde no quede serruchado ni con halo negro.
//
// Para regenerar:
//   npm i sharp --no-save
//   node scripts/recortar-fondo-360.js img/rot360 img/rot360-v2
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const FONDO = 8;       // gris del fondo del render (#080808)
const TOLERANCIA = 2;  // el fondo es parejo: más de 2 de diferencia ya es banda
const N_CUADROS = 85;

async function recortar(entrada, salida) {
  const { data, info } = await sharp(entrada).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels, N = W * H;
  const dif = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * C;
    dif[p] = Math.max(Math.abs(data[i] - FONDO), Math.abs(data[i + 1] - FONDO), Math.abs(data[i + 2] - FONDO));
  }
  // Relleno desde los cuatro bordes: eso es el fondo.
  const fondo = new Uint8Array(N); const cola = new Int32Array(N); let ini = 0, fin = 0;
  const meter = p => { if (!fondo[p] && dif[p] <= TOLERANCIA) { fondo[p] = 1; cola[fin++] = p; } };
  for (let x = 0; x < W; x++) { meter(x); meter((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { meter(y * W); meter(y * W + W - 1); }
  while (ini < fin) {
    const p = cola[ini++]; const x = p % W, y = (p / W) | 0;
    if (x > 0) meter(p - 1); if (x < W - 1) meter(p + 1); if (y > 0) meter(p - W); if (y < H - 1) meter(p + W);
  }
  const out = Buffer.alloc(N * 4);
  for (let p = 0; p < N; p++) {
    const i = p * C, o = p * 4;
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
  await sharp(out, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(salida);
}

if (require.main === module) {
  (async () => {
    const [, , entrada, salida] = process.argv;
    if (!entrada || !salida) { console.error('Uso: node scripts/recortar-fondo-360.js <carpeta-originales> <carpeta-salida>'); process.exit(1); }
    fs.mkdirSync(salida, { recursive: true });
    for (let k = 1; k <= N_CUADROS; k++) {
      const n = 'f_' + String(k).padStart(3, '0') + '.webp';
      await recortar(path.join(entrada, n), path.join(salida, n));
    }
    console.log('Recortados ' + N_CUADROS + ' cuadros en ' + salida);
  })().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { recortar };
