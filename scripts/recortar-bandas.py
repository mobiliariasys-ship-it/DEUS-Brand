#!/usr/bin/env python3
"""Separa las dos bandas de las 3 fotos principales (negra, gris, rosada).

Uso (desde la raíz del repo):
    python3 scripts/recortar-bandas.py /tmp/salida

Cada foto del carrusel trae el texto de la marca a la izquierda y, a la
derecha, las dos bandas colgando (la de silicona con el módulo y la de nylon),
cortadas por el borde de arriba. Para que la web las meza como péndulos se
escriben, por color:
  - <color>-placa.png: la franja de las bandas con SOLO el fondo (sin bandas),
    para tapar las bandas de la foto original.
  - <color>-silicona.png / <color>-nylon.png: cada banda con fondo transparente.
  - <color>.json: dónde va cada pieza, en % de la foto.

Cómo: el fondo de cada fila es un degradé suave; se ajusta una recta por canal
con dos franjas que siempre son fondo (entre el texto y las bandas, y a la
derecha de las bandas). La banda es lo que se aparta de ese fondo por COLOR (no
por brillo: el rosado tiene casi el mismo brillo que el fondo). Los huecos de
adentro de la banda (brillos, perforaciones) se rellenan; el borde queda con
alfa suave y se le saca el gris del fondo para que no tenga halo.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FOTOS = {'negra': 'img/img-afadcb86.webp', 'gris': 'img/img-80cd4240.webp', 'rosada': 'img/img-rosada.webp'}
# En fracción del ancho: franjas de fondo y la zona de las bandas.
FONDO_IZQ, FONDO_DER = (0.53, 0.575), (0.95, 0.99)
ZONA = (0.575, 0.95)
# El hueco entre las dos bandas se busca en esta franja (fracción del ancho).
HUECO = (0.72, 0.79)


def fondo(A):
    H, W, _ = A.shape
    xs = np.r_[np.arange(int(W * FONDO_IZQ[0]), int(W * FONDO_IZQ[1])), np.arange(int(W * FONDO_DER[0]), int(W * FONDO_DER[1]))]
    X = np.arange(W, dtype=np.float32)
    bg = np.empty_like(A)
    for c in range(3):
        for y in range(H):
            k = np.polyfit(xs, A[y, xs, c], 1)
            bg[y, :, c] = np.polyval(k, X)
    return bg


def rellenar(mask):
    """Rellena los huecos de adentro de la máscara (lo que no se alcanza desde afuera)."""
    m = Image.fromarray(np.pad(mask, 1).astype(np.uint8) * 255).copy()   # copy: la imagen de fromarray no se deja pintar
    ImageDraw.floodfill(m, (0, 0), 128)
    return (np.asarray(m) != 128)[1:-1, 1:-1]


def morf(mask, filtro):
    return np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(filtro)) > 127


def mascaras(color, A, bg):
    """Banda segura (duro) y alfa suave del borde.

    Negra y gris: la banda se aparta MUCHO del fondo (distancia de color > 90);
    las sombras que dejan sobre el fondo se apartan menos (< 60) y quedan
    afuera. Rosada: el rosado tiene casi el mismo brillo que el fondo y que su
    sombra, pero la sombra es gris neutra: lo que distingue la banda es que el
    rojo le gana al verde. Las piezas negras (módulo, hebilla) entran por
    distancia, como en las otras.
    """
    d = np.sqrt(((A - bg) ** 2).sum(axis=2))
    if color == 'rosada':
        p = (A[..., 0] - A[..., 1]) - (bg[..., 0] - bg[..., 1])
        duro = (p > 9) | (d > 90)
        soft = np.maximum(np.clip((p - 3) / 12, 0, 1), np.clip((d - 40) / 60, 0, 1))
    else:
        duro = d > 90
        soft = np.clip((d - 25) / 75, 0, 1)
    return d, duro, soft


def componente(mask, semilla):
    """La parte de la máscara conectada a la semilla (x, y)."""
    m = Image.fromarray(mask.astype(np.uint8) * 255).copy()
    ImageDraw.floodfill(m, semilla, 128)
    return np.asarray(m) == 128


def procesar(color, ruta, out):
    A = np.asarray(Image.open(ruta).convert('RGB')).astype(np.float32)
    H, W, _ = A.shape
    bg = fondo(A)
    d, duro0, soft = mascaras(color, A, bg)
    x0, x1 = int(W * ZONA[0]), int(W * ZONA[1])
    # Columna de corte: la de menos banda dentro de la franja del hueco.
    dens = duro0[int(H * .15):int(H * .85)].mean(axis=0)
    h0, h1 = int(W * HUECO[0]), int(W * HUECO[1])
    corte = h0 + int(np.argmin(dens[h0:h1]))
    duro0 = morf(morf(duro0, ImageFilter.MaxFilter(5)), ImageFilter.MinFilter(5))   # cierra rendijas
    lados = {'silicona': (x0, corte), 'nylon': (corte + 1, x1)}
    duro = np.zeros_like(duro0)
    piezas = {}
    for nombre, (a, b) in lados.items():
        m = np.zeros_like(duro0); m[:, a:b] = duro0[:, a:b]
        cx = a + int(np.argmax(dens[a:b])); cy = H // 2
        ys = np.where(m[:, cx])[0]
        cy = int(ys[np.argmin(np.abs(ys - cy))])
        m = rellenar(componente(m, (cx, cy)))
        piezas[nombre] = m
        duro |= m
    adentro = morf(duro, ImageFilter.MinFilter(3))
    borde = morf(duro, ImageFilter.MaxFilter(5))
    alfa = np.where(adentro, 1.0, soft * borde)
    alfa = np.asarray(Image.fromarray((alfa * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5))).astype(np.float32) / 255
    a3 = np.maximum(alfa, 1e-3)[..., None]
    F = np.clip((A - (1 - a3) * bg) / a3, 0, 255)
    info = {'ancho': W, 'alto': H, 'corte': corte / W, 'piezas': {}}
    for nombre, m in piezas.items():
        cols = np.where(m.any(axis=0))[0]
        a, b = max(0, cols[0] - 10), min(W, cols[-1] + 11)
        filas = np.where(m.any(axis=1))[0]
        y0, y1 = 0, min(H, filas.max() + 12)
        propia = morf(m, ImageFilter.MaxFilter(7))[y0:y1, a:b]
        al = alfa[y0:y1, a:b] * propia
        rgba = np.dstack([F[y0:y1, a:b], al * 255]).astype(np.uint8)
        rgba[..., :3][al < 0.02] = 0
        Image.fromarray(rgba, 'RGBA').save(f'{out}/{color}-{nombre}.png')
        info['piezas'][nombre] = {'x': a / W, 'y': y0 / H, 'w': (b - a) / W, 'h': (y1 - y0) / H}
    # Placa: la franja de las bandas solo con fondo, con 8px de fundido a los costados.
    pa, pb = x0 - 8, x1 + 8
    placa = A[:, pa:pb].copy()
    peso = np.ones(pb - pa, dtype=np.float32)
    peso[:8] = np.linspace(0, 1, 8); peso[-8:] = np.linspace(1, 0, 8)
    placa = placa * (1 - peso[None, :, None]) + bg[:, pa:pb] * peso[None, :, None]
    Image.fromarray(placa.clip(0, 255).astype(np.uint8)).save(f'{out}/{color}-placa.png')
    info['piezas']['placa'] = {'x': pa / W, 'y': 0, 'w': (pb - pa) / W, 'h': 1}
    json.dump(info, open(f'{out}/{color}.json', 'w'), indent=1)
    print(color, W, H, {k: {kk: round(vv, 4) for kk, vv in v.items()} for k, v in info['piezas'].items()})


if __name__ == '__main__':
    out = sys.argv[1]
    for color, ruta in FOTOS.items():
        procesar(color, ruta, out)
