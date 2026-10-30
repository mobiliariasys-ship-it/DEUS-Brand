// Fondo vivo del panel (admin.html): la tinta en movimiento, "humo con gel"
// (pedido del dueño, 31-oct-2026).
//
// Corre en un Worker con OffscreenCanvas, en un hilo aparte: antes se
// dibujaba en el hilo principal y cada vez que el panel se refrescaba (cada
// 5 s rearma tablas, gráficos y tarjetas) la tinta se quedaba pegada un
// instante. Desde acá los cuadros van directo a la pantalla, aunque el panel
// esté ocupado.
//
// Un solo pase de WebGL sobre la foto 4K:
//  - la tinta fluye con un campo de remolinos suave (senos encadenados:
//    barato aun en 4K);
//  - gel: el relieve sale del brillo de la propia tinta, así las vetas
//    parecen un líquido espeso y la luz se corre por sus bordes al fluir;
//  - humo: hebras claras de ruido (fBm) que suben y se enroscan con los
//    mismos remolinos.
//
// Mensajes del panel: iniciar {canvas, ancho, alto, fotoHD, foto},
// medida {ancho, alto}, pausa y sigue (pestaña oculta o visible).
// Responde 'listo' cuando dibujó el primer cuadro y 'fallo' si no puede.
'use strict';

var VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }';

function fragmento(gel) {
  return (gel ? '#extension GL_OES_standard_derivatives : enable\n' : '') + [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform sampler2D img; uniform vec2 res, imgRes; uniform float t;',
    'varying vec2 v;',
    // Ruido suave (fBm) para las hebras de humo.
    'float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }',
    'float ruido(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float r = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { r += a*ruido(p); p = p*2.03 + vec2(1.7,9.2); a *= 0.5; } return r; }',
    'void main(){',
    // La foto cubre la pantalla sin deformarse (como background-size:cover).
    '  float ra = res.x/res.y, ri = imgRes.x/imgRes.y;',
    '  vec2 uv = vec2(v.x, 1.0-v.y);',
    '  if (ra > ri) uv.y = (uv.y-0.5)*ri/ra+0.5; else uv.x = (uv.x-0.5)*ra/ri+0.5;',
    // La tinta fluye: remolinos que se enroscan despacio.
    '  vec2 q = vec2(v.x*ra, v.y)*2.2;',
    '  vec2 w = q;',
    '  for (int i = 1; i < 6; i++) {',
    '    float f = float(i);',
    '    w.x += 0.55/f * sin(f*w.y + t*0.28 + 0.7*f);',
    '    w.y += 0.55/f * cos(f*w.x - t*0.23 + 1.3*f);',
    '  }',
    '  vec2 uvd = uv + (w-q)*0.016;',
    '  vec3 col = texture2D(img, uvd).rgb;',
    '  vec3 L = vec3(0.3,0.59,0.11);',
    '  float lum = dot(col, L);',
    // Gel: relieve de la tinta suavizado (5 muestras), así brilla como un
    // líquido parejo y no como purpurina.
    (gel ? [
    '  vec2 o = 2.0/res;',
    '  float lumS = (lum + dot(texture2D(img, uvd+vec2(o.x,0.0)).rgb, L) + dot(texture2D(img, uvd-vec2(o.x,0.0)).rgb, L)',
    '             + dot(texture2D(img, uvd+vec2(0.0,o.y)).rgb, L) + dot(texture2D(img, uvd-vec2(0.0,o.y)).rgb, L)) / 5.0;',
    '  vec3 n = normalize(vec3(-dFdx(lumS), -dFdy(lumS), 0.0)*(res.y/70.0) + vec3(0.0,0.0,1.0));',
    '  float brillo = pow(max(dot(n, normalize(vec3(-0.35,0.45,1.0))), 0.0), 24.0);',
    '  col += vec3(0.75,1.0,1.0) * brillo * 0.6 * smoothstep(0.03, 0.25, lum);'].join('\n') : ''),
    // Humo: hebras claras que suben y se enroscan con los mismos remolinos.
    '  vec2 sp = vec2(v.x*ra, v.y)*2.6 + (w-q)*0.9 + vec2(t*0.015, -t*0.06);',
    '  float humo = smoothstep(0.42, 0.85, fbm(sp + fbm(sp*1.7 - t*0.05)*1.2));',
    '  col = mix(col, vec3(0.55,0.86,0.87), humo*0.28) + vec3(0.05,0.3,0.32)*humo*0.22;',
    // Viñeta suave para dar profundidad.
    '  col *= 1.0 - 0.28*length(v-0.5);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');
}

// Hasta 60 cuadros por segundo con ritmo parejo: en una pantalla de 60 Hz va
// cada cuadro; en una de 120 o 144 Hz se saltea los que sobran siempre igual.
// (El tope anterior de 30 por segundo, con un umbral justo de 33 ms, a veces
// se salteaba un cuadro de más y el movimiento se quedaba pegado.)
var MIN_ENTRE_CUADROS = 1000 / 60 - 3;

var lienzo, gl, uRes, uT, t0 = 0, ultimo = 0, parado = false, listo = false, roto = false, pausaDesde = 0;
var pedirCuadro = self.requestAnimationFrame
  ? function (f) { self.requestAnimationFrame(f); }
  : function (f) { setTimeout(function () { f(performance.now()); }, 16); };

function fallo() { parado = roto = true; self.postMessage('fallo'); }

function medir(ancho, alto) {
  if (!lienzo || !ancho || !alto) return;
  if (lienzo.width !== ancho || lienzo.height !== alto) {
    lienzo.width = ancho; lienzo.height = alto;
    if (gl) gl.viewport(0, 0, ancho, alto);
  }
}

function cuadro(ahora) {
  if (parado) return;
  pedirCuadro(cuadro);
  if (ahora - ultimo < MIN_ENTRE_CUADROS) return;
  ultimo = ahora;
  gl.uniform2f(uRes, lienzo.width, lienzo.height);
  gl.uniform1f(uT, (ahora - t0) / 1000);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (!listo) { listo = true; self.postMessage('listo'); }
}

function iniciar(m) {
  lienzo = m.canvas;
  try { gl = lienzo.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' }); } catch (e) {}
  if (!gl) return fallo();
  lienzo.addEventListener('webglcontextlost', function (e) { e.preventDefault(); fallo(); });
  var gel = !!gl.getExtension('OES_standard_derivatives');
  function shader(tipo, src) {
    var sh = gl.createShader(tipo); gl.shaderSource(sh, src); gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  }
  var vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, fragmento(gel));
  if (!vs || !fs) return fallo();
  var prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return fallo();
  gl.useProgram(prog);
  // Un triángulo que cubre toda la pantalla.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var aP = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(aP); gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
  uRes = gl.getUniformLocation(prog, 'res'); uT = gl.getUniformLocation(prog, 't');
  var uImg = gl.getUniformLocation(prog, 'imgRes');
  medir(m.ancho, m.alto);
  // La foto 4K solo si la pidió el panel (pantalla grande o de alta
  // densidad) y la placa de video la admite.
  var url = (m.fotoHD && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4300) ? m.fotoHD : m.foto;
  fetch(url).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
    .then(function (b) { return createImageBitmap(b); })
    .then(function (foto) {
      if (parado) return;
      var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, foto);
      gl.uniform2f(uImg, foto.width, foto.height);
      pedirCuadro(function (a) { t0 = a; cuadro(a); });
    })
    .catch(fallo);
}

self.onmessage = function (e) {
  var m = e.data || {};
  if (m.tipo === 'iniciar') iniciar(m);
  else if (m.tipo === 'medida') medir(m.ancho, m.alto);
  else if (m.tipo === 'pausa' && !parado) { parado = true; pausaDesde = performance.now(); }
  // Al volver, la tinta sigue desde donde quedó (sin saltar lo que estuvo en
  // pausa).
  else if (m.tipo === 'sigue' && parado && !roto && listo) {
    t0 += performance.now() - pausaDesde; parado = false; pedirCuadro(cuadro);
  }
};
