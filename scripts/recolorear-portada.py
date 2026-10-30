#!/usr/bin/env python3
"""Cambia el fondo de las 3 fotos principales y pasa sus textos a celeste hielo.

Uso (desde la raíz del repo):
    python3 scripts/recortar-bandas.py /tmp/bandas      # dónde va cada banda (<color>.json)
    python3 scripts/recolorear-portada.py /tmp/bandas [variante]

Pedido del dueño (30-oct-2026): partiendo del celeste grisáceo de las fotos
originales, pero mate. La negra en ese celeste gris apagado con los textos en
celeste hielo; la gris en uno más claro (que contraste con la banda gris) y la
rosada en rosado pastel, las dos con los textos en gris mate para que se lean.
Antes probó carbón / gris mate / rosado mate (variante 'carbon').
Se rehace cada foto por capas, a partir de la original:
  - fondo: un degradé nuevo, más oscuro a la izquierda y más claro hacia las
    bandas (como la referencia), con grano fino para que se vea mate;
  - textos, líneas y círculos de los íconos: lo que en la original es más
    oscuro que el fondo, en el color de texto de cada foto, con su mismo
    borde suave;
  - dibujos de los íconos (blancos en la original): siguen blancos;
  - bandas: recortadas de nuevo de la original (recorte_limpio), con la
    misma sombra que les pone la web.
Escribe img/portada/<color>-{800,1200}.webp y, para las bandas que se mecen,
img/hero-bandas2/<color>-{fondo,silicona,nylon}-{800,1200}.webp: el fondo sin
bandas y los recortes limpios. Cada banda se vuelve a sacar de la foto original
(recorte_limpio): sin la sombra que hacía sobre el fondo claro (sobre los
fondos nuevos era un halo o una franja sucia), con el borde liso y sin el color
del fondo viejo en el contorno. La sombra la pone la web (drop-shadow del CSS)
y, en la foto, una igual.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FOTOS = {'negra': 'img/img-afadcb86.webp', 'gris': 'img/img-80cd4240.webp', 'rosada': 'img/img-rosada.webp'}
HIELO = (213, 235, 237)      # el celeste hielo de la referencia
GRIS_MATE = (74, 79, 84)     # texto sobre los fondos claros
# Por color: fondo nuevo (lado oscuro, lado claro) y color del texto, en sRGB.
# Sin texto, va en celeste hielo.
VARIANTES = {
    # La que se usa (30-oct-2026). Negra: el celeste grisáceo original, apagado
    # y lo bastante oscuro para el celeste hielo (contraste ~4:1 en la columna
    # de textos). Gris: más claro, para que la banda gris resalte. Rosada:
    # rosado pastel. Sobre esos dos, el texto en gris mate (~4:1).
    'celeste': {
        'negra': ((100, 115, 121), (130, 145, 150)),
        'gris': ((166, 178, 183), (190, 200, 204), GRIS_MATE),
        'rosada': ((226, 193, 198), (240, 214, 217), GRIS_MATE),
    },
    'carbon': {
        'negra': ((46, 48, 53), (76, 80, 85)),      # carbón de la referencia (#2e3035 → #4c5055)
        'gris': ((92, 96, 101), (122, 126, 131)),   # gris mate, más claro que el carbón
        'rosada': ((124, 96, 102), (156, 124, 130)),  # rosado mate (palo de rosa)
    },
    'pastel': {
        'negra': ((46, 48, 53), (76, 80, 85)),
        'gris': ((163, 167, 171), (186, 190, 193)),  # gris mate claro
        'rosada': ((226, 193, 198), (240, 214, 217)),  # rosado pastel
    },
}
BLANCO = np.array([246, 250, 251], float)
# Zona de las bandas (la misma de recortar-bandas.py, en fracción del ancho).
ZONA = (0.5683, 0.957)
# Franjas que en la original son siempre fondo (sin texto ni bandas).
LIBRE = ((0.53, 0.56), (0.962, 0.995))


def lum(a):
    return a @ [0.299, 0.587, 0.114]


def fondo_original(A):
    """Degradé de la foto original: ajuste cuadrático en las franjas libres."""
    H, W, _ = A.shape
    cols = np.concatenate([np.arange(int(a * W), int(b * W)) for a, b in LIBRE])[::2]
    ys, xs = np.meshgrid(np.arange(0, H, 4), cols, indexing='ij')
    X, Y = xs.ravel() / W, ys.ravel() / H
    M = np.stack([np.ones_like(X), X, Y, X * X, X * Y, Y * Y], 1)
    yy, xx = np.mgrid[0:H, 0:W]
    Xf, Yf = xx / W, yy / H
    Mf = np.stack([np.ones_like(Xf), Xf, Yf, Xf * Xf, Xf * Yf, Yf * Yf], -1)
    out = np.zeros((H, W, 3))
    for c in range(3):
        coef, *_ = np.linalg.lstsq(M, A[ys.ravel(), xs.ravel(), c], rcond=None)
        out[..., c] = Mf @ coef
    return out


# Calidad del WebP: con menos, la compresión arma parches sobre el degradé.
CALIDAD = 93


def fondo_textos(A, x0):
    """Degradé original en la columna de textos (x < x0), sin letras ni íconos.

    Se ajusta un polinomio de grado 3 con los píxeles de esa misma columna y se
    descartan, en varias pasadas, los que se apartan (letras, líneas, íconos).
    Extrapolarlo desde las franjas libres erraba hasta 34 niveles a la
    izquierda, y ese error salía como manchas en el fondo nuevo.
    """
    H = A.shape[0]
    ys, xs = np.mgrid[0:H:3, 0:x0:3]
    X, Y = xs.ravel() / x0, ys.ravel() / H
    M = np.stack([X ** i * Y ** j for i in range(4) for j in range(4 - i)], 1)
    V = A[ys.ravel(), xs.ravel()]
    lv = lum(V)
    usar = np.ones(len(lv), bool)
    for _ in range(5):
        coef, *_ = np.linalg.lstsq(M[usar], lv[usar], rcond=None)
        r = lv - M @ coef
        usar = np.abs(r) < max(6.0, 2.5 * np.median(np.abs(r[usar])))
    yy, xx = np.mgrid[0:H, 0:x0]
    Xf, Yf = xx / x0, yy / H
    Mf = np.stack([Xf ** i * Yf ** j for i in range(4) for j in range(4 - i)], -1)
    out = np.zeros((H, x0, 3))
    for c in range(3):
        coef, *_ = np.linalg.lstsq(M[usar], V[usar, c], rcond=None)
        out[..., c] = Mf @ coef
    return out


def fondo_nuevo(H, W, oscuro, claro, semilla):
    """Degradé suave: más oscuro a la izquierda, más claro hacia las bandas.

    Solo de izquierda a derecha (con apenas menos luz abajo) y un grano casi
    invisible que evita los escalones: con más grano o un brillo redondo, el
    WebP lo convertía en manchas.
    """
    yy, xx = np.mgrid[0:H, 0:W]
    x, y = xx / W, yy / H
    t = np.clip((x - 0.02) / 0.9, 0, 1)
    f = t * t * (3 - 2 * t) * (1 - 0.12 * np.clip((y - 0.5) / 0.5, 0, 1))
    f = f[..., None]
    out = np.array(oscuro, float) * (1 - f) + np.array(claro, float) * f
    return out + np.random.default_rng(semilla).normal(0, 0.35, (H, W, 1))


def _img(m):
    return Image.fromarray(np.clip(m * 255, 0, 255).astype(np.uint8))


def _arr(im):
    return np.asarray(im).astype(float) / 255


def _rellenar(mask):
    """Rellena los huecos de una máscara binaria (lo que no toca el borde)."""
    lienzo = Image.new('L', (mask.shape[1] + 2, mask.shape[0] + 2), 0)
    lienzo.paste(Image.fromarray((mask * 255).astype(np.uint8)), (1, 1))
    ImageDraw.floodfill(lienzo, (0, 0), 128)
    return np.asarray(lienzo)[1:-1, 1:-1] != 128


def _mediana(v, k):
    p = k // 2
    e = np.pad(v, p, mode='edge')
    return np.median(np.lib.stride_tricks.sliding_window_view(e, k), axis=1)


def _media(v, k):
    p = k // 2
    e = np.pad(v, p, mode='edge')
    return np.convolve(e, np.ones(k) / k, mode='valid')


def bordes_rectos(alfa):
    """Endereza el contorno de una correa: un tramo continuo por fila.

    Se mide el borde izquierdo y derecho de cada fila con precisión de
    subpíxel (donde el alfa cruza 0,5), se le sacan las muescas con una
    mediana (que respeta los escalones reales, como el marco o la punta) y se
    suaviza un poco; después se vuelve a dibujar cada fila con borde
    antialiasado. Queda liso como un vector.
    """
    h, w = alfa.shape
    xl = np.full(h, np.nan); xr = np.full(h, np.nan)
    for y in range(h):
        f = alfa[y]
        ids = np.where(f >= 0.5)[0]
        if len(ids) < 2:
            continue
        a, b = ids[0], ids[-1]
        xl[y] = a - (f[a] - 0.5) / max(f[a] - (f[a - 1] if a > 0 else 0), 1e-3) if a > 0 else a - 0.5
        xr[y] = b + (f[b] - 0.5) / max(f[b] - (f[b + 1] if b < w - 1 else 0), 1e-3) if b < w - 1 else b + 0.5
    hay = ~np.isnan(xl)
    if hay.sum() < 30:
        return alfa
    filas = np.where(hay)[0]
    y0, y1 = filas[0], filas[-1] + 1
    seg = slice(y0, y1)
    l = np.interp(np.arange(y0, y1), filas, xl[filas]); r = np.interp(np.arange(y0, y1), filas, xr[filas])
    l = _media(_mediana(l, 21), 7); r = _media(_mediana(r, 21), 7)
    xs = np.arange(w)[None, :]
    nuevo = np.zeros_like(alfa)
    nuevo[seg] = np.clip(xs - l[:, None] + 0.5, 0, 1) * np.clip(r[:, None] - xs + 0.5, 0, 1)
    # Primera y última fila: medio píxel de cobertura vertical, sin escalón.
    nuevo[y0] *= np.clip(alfa[y0].max(), 0, 1)
    nuevo[y1 - 1] *= np.clip(alfa[y1 - 1].max(), 0, 1)
    return nuevo


def recorte_limpio(C, B, escala=4):
    """Banda sin sombra, con borde suave y sin el color del fondo viejo.

    C: la zona de la foto original (H×W×3); B: el degradé de fondo en esa zona.
    La sombra y el fondo tienen el mismo tinte (el fondo, oscurecido); la banda
    es neutra (negra, gris) o rosada. Eso la separa de su sombra aunque tengan
    el mismo brillo. Lo bien oscuro es banda siempre.
    """
    L, Lb = lum(C), lum(B)
    sm = lambda a, r: _arr(_img(a).filter(ImageFilter.BoxBlur(r)))
    tinte = (C[..., 0] - 0.5 * (C[..., 1] + C[..., 2])) / np.maximum(L, 1)
    tinte_f = (B[..., 0] - 0.5 * (B[..., 1] + B[..., 2])) / np.maximum(Lb, 1)
    t = sm(np.clip((tinte - tinte_f) / np.maximum(-tinte_f, 0.02) * 0.5, 0, 1), 1) * 2
    s = np.maximum(np.clip(t, 0, 1), np.clip((80 - L) / 30, 0, 1))
    # Núcleo: sin motas sueltas, con los huecos de adentro rellenos.
    nuc = _img(s > 0.5).filter(ImageFilter.MinFilter(5)).filter(ImageFilter.MaxFilter(5))
    nuc = nuc.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    nuc = _rellenar(np.asarray(nuc) > 127)
    dentro = _arr(_img(nuc).filter(ImageFilter.MinFilter(5))) > 0.5
    cerca = _arr(_img(nuc).filter(ImageFilter.MaxFilter(5))) > 0.5
    campo = np.where(dentro, 1.0, np.where(cerca, _arr(_img(s).filter(ImageFilter.GaussianBlur(0.7))), 0.0))
    # Borde liso: el campo se agranda 4x, se corta en 0,5 y se vuelve a achicar.
    h, w = campo.shape
    g = _img(campo).resize((w * escala, h * escala), Image.BICUBIC)
    g = g.point(lambda v: 255 if v >= 128 else 0)
    alfa = _arr(g.filter(ImageFilter.GaussianBlur(escala * 0.35)).resize((w, h), Image.BOX))
    # Las correas son rectas: el contorno se endereza (sin muescas ni dientes).
    alfa = bordes_rectos(alfa)
    # Color del borde: el de adentro de la banda, corrido hacia afuera.
    F = C.copy()
    peso = (alfa > 0.97) & dentro
    for _ in range(6):
        num = np.stack([sm(F[..., k] / 255 * peso, 2) for k in range(3)], -1) * 255
        den = sm(peso.astype(float), 2)[..., None]
        nuevo = (~peso) & (den[..., 0] > 0.02)
        F[nuevo] = (num / np.maximum(den, 1e-6))[nuevo]
        peso = peso | nuevo
    return np.dstack([F, alfa * 255]).clip(0, 255).astype(np.uint8)


def procesar(color, ruta, recortes, variante, salida):
    A = np.asarray(Image.open(ruta).convert('RGB')).astype(float)
    H, W, _ = A.shape
    oscuro, claro, *texto = VARIANTES[variante][color]
    tinta_nueva = np.array(texto[0] if texto else HIELO, float)
    N = fondo_nuevo(H, W, oscuro, claro, {'negra': 1, 'gris': 2, 'rosada': 3}[color])
    x0 = int(round(ZONA[0] * W))
    # Textos: más oscuro que el fondo → celeste hielo; más claro → blanco.
    izq = A[:, :x0]
    bl = lum(fondo_textos(A, x0))
    L = lum(izq)
    tinta = np.percentile(L, 0.5)
    # Umbral de 8 niveles: por debajo es ruido de compresión de la original.
    a_tinta = np.clip((bl - L - 8) / np.maximum(bl - tinta - 8, 1), 0, 1)[..., None]
    a_claro = np.clip((L - bl - 8) / np.maximum(250 - bl - 8, 1), 0, 1)[..., None]
    out = N.copy()
    t = N[:, :x0] * (1 - a_tinta) + tinta_nueva * a_tinta
    out[:, :x0] = t * (1 - a_claro) + BLANCO * a_claro
    fondo = out.copy()   # sin bandas: de acá sale el fondo que va detrás de las que se mecen
    # Bandas, con una sombra suave hacia abajo a la derecha.
    info = json.load(open(f'{recortes}/{color}.json'))
    capa = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    os.makedirs(f'{salida}/hero-bandas2', exist_ok=True)
    Bf = fondo_original(A)
    for pieza in ('silicona', 'nylon'):
        p = info['piezas'][pieza]
        # Mismo encuadre que el recorte de recortar-bandas.py (BANDAS_HERO no
        # cambia), alargado arriba en espejo igual que allá.
        bx0 = int(round(p['x'] * W)); bx1 = bx0 + int(round(p['w'] * W))
        by1 = int(round((p['y'] + p['h']) * H)); extra = int(round(-p['y'] * H))
        rgba = recorte_limpio(A[:by1, bx0:bx1], Bf[:by1, bx0:bx1])
        im = Image.fromarray(np.concatenate([rgba[:extra][::-1], rgba], axis=0), 'RGBA')
        im.save(f'{salida}/hero-bandas2/{color}-{pieza}-1200.webp', 'WEBP', quality=86, method=6)
        im.resize((max(1, round(im.width * 800 / W)), max(1, round(im.height * 800 / W))), Image.LANCZOS).save(
            f'{salida}/hero-bandas2/{color}-{pieza}-800.webp', 'WEBP', quality=86, method=6)
        x, y = int(round(p['x'] * W)), int(round(p['y'] * H))
        # Los recortes arrancan por encima de la foto (y < 0): se pega desde adentro.
        capa.alpha_composite(im, (x, max(0, y)), (0, max(0, -y)))
    alfa = np.asarray(capa.getchannel('A')).astype(float) / 255
    # La misma sombra que les pone la web (drop-shadow(6px 5px 7px
    # rgba(30,40,50,.16)) con la foto a 358 px de ancho en el celular): así no
    # salta cuando aparecen las bandas que se mecen.
    k = W / 358
    sombra = np.asarray(Image.fromarray((alfa * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3.5 * k))).astype(float) / 255
    sombra = np.roll(np.roll(sombra, int(round(6 * k)), 1), int(round(5 * k)), 0)[..., None] * 0.16
    out = out * (1 - sombra) + np.array([30, 40, 50], float) * sombra
    rgb = np.asarray(capa.convert('RGB')).astype(float)
    out = out * (1 - alfa[..., None]) + rgb * alfa[..., None]
    os.makedirs(f'{salida}/portada', exist_ok=True)
    foto = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    foto.save(f'{salida}/portada/{color}-1200.webp', 'WEBP', quality=CALIDAD, method=6)
    foto.resize((800, round(H * 800 / W)), Image.LANCZOS).save(f'{salida}/portada/{color}-800.webp', 'WEBP', quality=CALIDAD, method=6)
    x1 = x0 + int(round((ZONA[1] - ZONA[0]) * W))
    pl = Image.fromarray(np.clip(fondo[:, x0:x1], 0, 255).astype(np.uint8))
    pl.save(f'{salida}/hero-bandas2/{color}-fondo-1200.webp', 'WEBP', quality=CALIDAD, method=6)
    pl.resize((round(pl.width * 800 / W), round(H * 800 / W)), Image.LANCZOS).save(f'{salida}/hero-bandas2/{color}-fondo-800.webp', 'WEBP', quality=CALIDAD, method=6)
    print(color, variante, W, H, 'tinta original', round(tinta))


if __name__ == '__main__':
    recortes = sys.argv[1]
    variante = sys.argv[2] if len(sys.argv) > 2 else 'celeste'
    salida = sys.argv[3] if len(sys.argv) > 3 else 'img'
    for color, ruta in FOTOS.items():
        procesar(color, ruta, recortes, variante, salida)
