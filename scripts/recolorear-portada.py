#!/usr/bin/env python3
"""Cambia el fondo de las 3 fotos principales y pasa sus textos a celeste hielo.

Uso (desde la raíz del repo):
    python3 scripts/recortar-bandas.py /tmp/bandas      # recortes de las bandas
    python3 scripts/recolorear-portada.py /tmp/bandas [variante]

Pedido del dueño (30-oct-2026): la negra con el fondo carbón de su referencia,
la gris un poco más clara (gris mate) y la rosada en rosado mate; los mismos
textos, en celeste hielo. Se rehace cada foto por capas, a partir de la
original:
  - fondo: un degradé nuevo, más oscuro a la izquierda y más claro hacia las
    bandas (como la referencia), con grano fino para que se vea mate;
  - textos, líneas y círculos de los íconos: lo que en la original es más
    oscuro que el fondo, en celeste hielo, con su mismo borde suave;
  - dibujos de los íconos (blancos en la original): siguen blancos;
  - bandas: los recortes de recortar-bandas.py, con una sombra suave.
Escribe img/portada/<color>-{800,1200}.webp y, para las bandas que se mecen,
img/hero-bandas2/<color>-{fondo,silicona,nylon}-{800,1200}.webp: el fondo sin
bandas y los recortes sin la sombra que traían pegada. Sobre el fondo claro
original esa sombra no se notaba; sobre el carbón era un halo gris al lado de
cada banda oscura. La sombra la pone ahora la web (drop-shadow del CSS).
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FOTOS = {'negra': 'img/img-afadcb86.webp', 'gris': 'img/img-80cd4240.webp', 'rosada': 'img/img-rosada.webp'}
# Fondo nuevo: (lado oscuro, lado claro), en sRGB.
VARIANTES = {
    'recomendada': {
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
HIELO = np.array([213, 235, 237], float)    # el celeste hielo de la referencia
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


def fondo_nuevo(H, W, oscuro, claro, semilla):
    """Más oscuro a la izquierda y abajo, más claro hacia las bandas."""
    yy, xx = np.mgrid[0:H, 0:W]
    x, y = xx / W, yy / H
    t = np.clip((x - 0.04) / 0.78, 0, 1)
    f = t * t * (3 - 2 * t)
    f = f * (1 - 0.22 * np.clip((y - 0.55) / 0.45, 0, 1)) + 0.10 * np.exp(-((x - 0.78) ** 2 / 0.08 + (y - 0.32) ** 2 / 0.12))
    f = np.clip(f, 0, 1)[..., None]
    out = np.array(oscuro, float) * (1 - f) + np.array(claro, float) * f
    return out + np.random.default_rng(semilla).normal(0, 1.1, (H, W, 1))


def sin_sombra(im):
    """Deja en un recorte oscuro solo el cuerpo de la banda.

    El recorte trae, al costado, la sombra que la banda hacía sobre el fondo
    claro (grises de 80 a 135). El cuerpo es lo bien oscuro; se cierra y se
    rellenan sus huecos (perforaciones, brillos del marco, el perno) para no
    perder nada de adentro. Las bandas claras (gris de nylon, rosadas) se
    dejan como están: ahí la sombra se distingue poco del fondo nuevo.
    """
    a = np.asarray(im.getchannel('A')).astype(float) / 255
    L = lum(np.asarray(im.convert('RGB')).astype(float))
    if np.median(L[a > 0.5]) > 75:
        return im
    cuerpo = Image.fromarray((((L < 78) & (a > 0.5)) * 255).astype(np.uint8))
    cuerpo = cuerpo.filter(ImageFilter.MaxFilter(7)).filter(ImageFilter.MinFilter(7))
    lienzo = Image.new('L', (cuerpo.width + 2, cuerpo.height + 2), 0)
    lienzo.paste(cuerpo, (1, 1))
    ImageDraw.floodfill(lienzo, (0, 0), 128)
    lleno = (np.asarray(lienzo)[1:-1, 1:-1] != 128)
    suave = np.asarray(Image.fromarray((lleno * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))).astype(float) / 255
    out = np.asarray(im).copy()
    out[..., 3] = (np.minimum(a, suave) * 255).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def procesar(color, ruta, recortes, variante, salida):
    A = np.asarray(Image.open(ruta).convert('RGB')).astype(float)
    H, W, _ = A.shape
    oscuro, claro = VARIANTES[variante][color]
    N = fondo_nuevo(H, W, oscuro, claro, {'negra': 1, 'gris': 2, 'rosada': 3}[color])
    x0 = int(round(ZONA[0] * W))
    # Textos: más oscuro que el fondo → celeste hielo; más claro → blanco.
    izq = A[:, :x0]
    bl = lum(fondo_original(A))[:, :x0]
    L = lum(izq)
    tinta = np.percentile(L, 0.5)
    a_tinta = np.clip((bl - L - 5) / np.maximum(bl - tinta - 5, 1), 0, 1)[..., None]
    a_claro = np.clip((L - bl - 5) / np.maximum(250 - bl - 5, 1), 0, 1)[..., None]
    out = N.copy()
    t = N[:, :x0] * (1 - a_tinta) + HIELO * a_tinta
    out[:, :x0] = t * (1 - a_claro) + BLANCO * a_claro
    fondo = out.copy()   # sin bandas: de acá sale el fondo que va detrás de las que se mecen
    # Bandas, con una sombra suave hacia abajo a la derecha.
    info = json.load(open(f'{recortes}/{color}.json'))
    capa = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    os.makedirs(f'{salida}/hero-bandas2', exist_ok=True)
    for pieza in ('silicona', 'nylon'):
        p = info['piezas'][pieza]
        im = sin_sombra(Image.open(f'{recortes}/{color}-{pieza}.png').convert('RGBA'))
        im.save(f'{salida}/hero-bandas2/{color}-{pieza}-1200.webp', 'WEBP', quality=86, method=6)
        im.resize((max(1, round(im.width * 800 / W)), max(1, round(im.height * 800 / W))), Image.LANCZOS).save(
            f'{salida}/hero-bandas2/{color}-{pieza}-800.webp', 'WEBP', quality=86, method=6)
        x, y = int(round(p['x'] * W)), int(round(p['y'] * H))
        # Los recortes arrancan por encima de la foto (y < 0): se pega desde adentro.
        capa.alpha_composite(im, (x, max(0, y)), (0, max(0, -y)))
    alfa = np.asarray(capa.getchannel('A')).astype(float) / 255
    sombra = np.asarray(Image.fromarray((alfa * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(W / 110))).astype(float) / 255
    sombra = np.roll(np.roll(sombra, int(W / 120), 1), int(W / 150), 0)[..., None]
    out = out * (1 - 0.32 * sombra)
    rgb = np.asarray(capa.convert('RGB')).astype(float)
    out = out * (1 - alfa[..., None]) + rgb * alfa[..., None]
    os.makedirs(f'{salida}/portada', exist_ok=True)
    foto = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    foto.save(f'{salida}/portada/{color}-1200.webp', 'WEBP', quality=86, method=6)
    foto.resize((800, round(H * 800 / W)), Image.LANCZOS).save(f'{salida}/portada/{color}-800.webp', 'WEBP', quality=84, method=6)
    x1 = x0 + int(round((ZONA[1] - ZONA[0]) * W))
    pl = Image.fromarray(np.clip(fondo[:, x0:x1], 0, 255).astype(np.uint8))
    pl.save(f'{salida}/hero-bandas2/{color}-fondo-1200.webp', 'WEBP', quality=84, method=6)
    pl.resize((round(pl.width * 800 / W), round(H * 800 / W)), Image.LANCZOS).save(f'{salida}/hero-bandas2/{color}-fondo-800.webp', 'WEBP', quality=82, method=6)
    print(color, variante, W, H, 'tinta original', round(tinta))


if __name__ == '__main__':
    recortes = sys.argv[1]
    variante = sys.argv[2] if len(sys.argv) > 2 else 'recomendada'
    salida = sys.argv[3] if len(sys.argv) > 3 else 'img'
    for color, ruta in FOTOS.items():
        procesar(color, ruta, recortes, variante, salida)
