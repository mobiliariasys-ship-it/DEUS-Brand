#!/usr/bin/env python3
"""Recorta las correas extra del checkout con fondo transparente.

Uso (desde la raíz del repo):
    python3 scripts/recortar-correas.py img/correas-negras.webp img/correas-grises.webp /tmp/salida

Los renders img/correas-negras.webp y img/correas-grises.webp tienen las dos
correas colgando (silicona a la izquierda, nylon a la derecha) sobre un gris
con degradé, y el logo DEUS BAND arriba. Escribe silicona.png, nylon-negra.png
y nylon-gris.png en la carpeta de salida; para la web se pasan a WebP de 720px
de alto (img/correa-*.webp, las usa el cuadro de correas del checkout).

Cómo: el fondo de cada fila se modela con una cuadrática en x ajustada a tres
franjas que siempre son fondo, y el alfa sale de cuánto se aparta cada píxel de
ese fondo (más oscuro o más claro: así entra el remache plateado y las
perforaciones quedan como en la foto). El nylon gris casi no se distingue del
fondo, así que usa el alfa del render negro, que tiene la misma forma (los dos
renders calzan columna por columna). Los píxeles de borde se limpian del gris
del fondo para que no quede halo sobre otros colores.
"""
import sys, numpy as np
from PIL import Image
neg_p, gri_p, out = sys.argv[1], sys.argv[2], sys.argv[3]
N = np.asarray(Image.open(neg_p).convert('RGB')).astype(np.float32)
G = np.asarray(Image.open(gri_p).convert('RGB')).astype(np.float32)
H, W, _ = N.shape
lum = lambda A: A[..., 0] * .299 + A[..., 1] * .587 + A[..., 2] * .114
MUESTRAS = [(150, 200), (380, 425), (600, 660)]   # columnas que son fondo en todas las filas

def fondo(A):
    """Fondo por fila: cuadrática en x ajustada a las columnas de fondo."""
    xs = np.array([(a + b) / 2 for a, b in MUESTRAS], dtype=np.float32)
    bg = np.zeros_like(A)
    X = np.arange(W, dtype=np.float32)
    for c in range(3):
        for y in range(H):
            ys = np.array([np.median(A[y, a:b, c]) for a, b in MUESTRAS])
            k = np.polyfit(xs, ys, 2)
            bg[y, :, c] = np.polyval(k, X)
    return bg

bgN, bgG = fondo(N), fondo(G)
d = np.abs(lum(N) - lum(bgN))
alfa = np.clip((d - 6) / 26, 0, 1)
alfa[:110, :] = 0                       # el logo DEUS BAND de arriba no va
# suavizado mínimo del borde (3x3) para que no quede serruchado
from PIL import ImageFilter
alfa = np.asarray(Image.fromarray((alfa * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6))).astype(np.float32) / 255

def recorte(A, bg, x0, x1, nombre):
    a = alfa.copy(); a[:, :x0] = 0; a[:, x1:] = 0
    ys, xs = np.where(a > 0.05)
    y0, y1, xa, xb = ys.min() - 6, ys.max() + 7, xs.min() - 6, xs.max() + 7
    a = a[y0:y1, xa:xb]; C = A[y0:y1, xa:xb]; B = bg[y0:y1, xa:xb]
    # Saca el gris del fondo que traen los píxeles de borde (sin halo).
    aa = np.maximum(a, 1e-3)[..., None]
    F = np.clip((C - (1 - aa) * B) / aa, 0, 255)
    F[a < 0.02] = 0
    rgba = np.dstack([F, a * 255]).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    im.save(f'{out}/{nombre}.png')
    print(nombre, 'caja', (xa, y0, xb, y1), 'tamaño', im.size)
    return im

recorte(N, bgN, 200, 390, 'silicona')
recorte(N, bgN, 410, 610, 'nylon-negra')
recorte(G, bgG, 410, 610, 'nylon-gris')
