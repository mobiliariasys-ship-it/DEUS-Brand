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
import json, os, sys, warnings
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


def _recta(y, v, vueltas=5, tol=1.2):
    """Recta robusta: mínimos cuadrados, sacando lo que se aparta (muescas)."""
    usar = np.ones(len(v), bool)
    for _ in range(vueltas):
        a, b = np.polyfit(y[usar], v[usar], 1)
        res = np.abs(v - (a * y + b))
        usar = res < max(tol, 2.5 * np.median(res[usar]))
    return a * y + b, res[usar].max() if usar.any() else 0


def _por_tramos(v, salto=3.0, lado=-1, cambios=None):
    """Tramos rectos entre escalones de verdad (marco, presillas).

    Un escalón es donde la mediana cambia más de `salto` px en 12 filas; ahí
    el borde sigue a lo medido tal cual (así la esquina redondeada del marco
    queda redonda: la mediana la volvía escalera). Cada tramo de 30 filas o
    más entre escalones va como una recta; si no es recto (la punta redonda),
    sigue a la mediana.

    Entre dos tramos rectos, el escalón se dibuja: la correa recta, la parte
    ancha (marco, presilla) recta, y entre las dos la esquina de afuera como
    un cuarto de círculo. Medido, el brillo del borde del marco dejaba ahí un
    escaloncito. `lado`: -1 borde izquierdo (más ancho = x menor), +1 derecho.
    `cambios`: cuánto cambia el centro de la correa fila a fila; el salto más
    grande cerca de un escalón de arriba (donde empieza la parte ancha) es la
    barra del marco o de la presilla, y ahí va el escalón (la esquina va en la
    misma fila que su barra, como en la foto).
    """
    n = len(v); ys = np.arange(n, dtype=float)
    m = _mediana(v, 41)
    d = np.zeros(n); d[6:-6] = np.abs(m[12:] - m[:-12])
    esc = np.convolve((d > salto).astype(float), np.ones(7), mode='same') > 0
    out = np.where(esc, _media(v, 3), _media(m, 3))
    _por_tramos.esquinas = []   # (desde, hasta, fila de referencia, radio)
    tramos = []   # (desde, hasta, recta como (a, b)) de los tramos rectos
    i = 0
    while i < n:
        if esc[i]:
            i += 1; continue
        j = i
        while j < n and not esc[j]:
            j += 1
        if j - i >= 30:
            ajuste, desvio = _recta(ys[i:j], v[i:j])
            if desvio < 2.0:
                out[i:j] = ajuste
                a, b = np.polyfit(ys[i:j], ajuste, 1)
                tramos.append((i, j, a, b))
        i = j
    for (i1, j1, a1, b1), (i2, j2, a2, b2) in zip(tramos, tramos[1:]):
        if i2 - j1 > 40:
            continue          # no son vecinos: entre medio hay otra cosa
        zona = np.arange(j1, i2)
        if not len(zona):
            continue
        eA, eB = a1 * zona + b1, a2 * zona + b2
        if np.abs(eA - eB).mean() < salto:
            continue
        # El escalón va en la fila donde empieza la barra del marco (el salto
        # de `cambios`); si no se encuentra, donde el borde medido ya recorrió
        # el 65% del salto. La esquina de afuera es un cuarto de círculo de
        # hasta 8 px, como el de la foto: en la fila del escalón la parte ancha
        # empieza con su cara de arriba y baja redondeada.
        salto_px = float(np.abs(eB - eA).mean())
        R = min(salto_px, 8.0)
        abajo_ancho = (eB.mean() - eA.mean()) * lado > 0
        def fila_barra(desde, hasta):
            if cambios is None:
                return None
            d, h_ = max(0, desde), min(n, hasta)
            if h_ <= d:
                return None
            k = d + int(np.argmax(cambios[d:h_]))
            return k - 1 if cambios[k] > 25 else None
        if abajo_ancho:
            sep = np.where(np.abs(v[zona] - eA) > 0.65 * salto_px)[0]
            yt = int(zona[sep[0]]) if len(sep) else int(zona[len(zona) // 2])
            barra = fila_barra(j1 - 14, i2 + 4)
            if barra is not None:
                yt = barra
            # La barra puede caer fuera de la zona: todo lo de arriba de `yt`
            # va con la correa y todo lo de abajo con el marco (si no, quedan
            # filas anchas sueltas encima de la esquina: una rayita que sale).
            ys_ = np.arange(min(j1, yt), min(n, max(i2, yt)))
            out[ys_] = np.where(ys_ < yt, a1 * ys_ + b1, a2 * ys_ + b2)
            for y in range(yt, min(n, yt + int(np.ceil(R)))):
                t = y - yt
                eb = a2 * y + b2
                out[y] = eb - lado * (R - np.sqrt(max(R * R - (R - t) ** 2, 0)))
            _por_tramos.esquinas.append((yt, yt + int(np.ceil(R)) + 1, yt + int(np.ceil(R)) + 3, R))
        else:
            # Abajo del marco no se busca la barra: el grabado DEUSBAND también
            # hace saltar `cambios` y cortaba la D. La esquina va donde el
            # borde medido termina de llegar a la correa, del tamaño del salto.
            R = salto_px
            sep = np.where(np.abs(v[zona] - eB) > 1.0)[0]
            yb = int(zona[sep[-1]]) if len(sep) else int(zona[len(zona) // 2])
            out[zona] = np.where(zona > yb, eB, eA)
            for y in range(max(0, yb - int(np.ceil(R)) + 1), yb + 1):
                t = yb - y
                ea = a1 * y + b1
                out[y] = ea - lado * (R - np.sqrt(max(R * R - (R - t) ** 2, 0)))
    return out


def _sin_lengueta(l, r):
    """Nylon: una recta por lado hasta donde empieza la punta.

    La foto trae una lengüeta que sobresale a media correa; se ve como un
    defecto, así que queda fuera de la recta (y del recorte). La punta (donde
    la correa se angosta) sigue a los datos y se une a la recta sin salto.
    """
    n = len(l); ys = np.arange(n, dtype=float)
    ancho = r - l
    lleno = np.where(ancho >= 0.95 * np.median(ancho))[0]
    k = lleno[-1] + 1 if len(lleno) else n
    ml, mr = _mediana(l, 41), _mediana(r, 41)
    L, R = _media(ml, 5), _media(mr, 5)
    if k >= 60:
        rl, _ = _recta(ys[:k], l[:k]); rr, _ = _recta(ys[:k], r[:k])
        L[:k], R[:k] = rl, rr
        # Unión suave con la punta: 12 filas de transición.
        for t in range(12):
            y = k + t
            if y >= n:
                break
            p = (t + 1) / 13
            L[y] = (1 - p) * (rl[-1] + (rl[-1] - rl[-2]) * (t + 1)) + p * L[y]
            R[y] = (1 - p) * (rr[-1] + (rr[-1] - rr[-2]) * (t + 1)) + p * R[y]
    return L, R


def _punta(alfa, xl, xr, y0, l, r):
    """La punta de abajo de la correa, como una pieza dibujada.

    El recorte la dejaba facetada (lados rectos, cortes en diagonal y abajo
    plana) y con muescas donde la sombra de la foto se confundía con la banda.
    Acá va con lados rectos y las dos esquinas de abajo redondas (un cuarto de
    elipse, igual a cada lado), ajustadas a lo medido. Empieza abajo de la
    última parte ancha (la presilla, en la silicona), y el final de la
    presilla también se dibuja: su cara de abajo recta y la esquina de afuera
    redonda como la de arriba (la foto la dejaba cortada en diagonal).
    Devuelve, en filas de la imagen, (desde, xL, xR, yb, rx, ry, presilla)
    con presilla = (kL, kR, yk, Rk) o None, o None si no hay punta.
    """
    n = len(l); ancho = r - l
    v0 = max(0, n - 130)
    ancha = np.where(ancho[v0:] > np.median(ancho) + 12)[0]
    ya = v0 + (ancha[-1] + 1 if len(ancha) else 0)
    if n - ya < 30:
        return None
    # El final: cuánto llega la banda, columna a columna, en el centro.
    A = alfa[y0 + ya:y0 + n + 2]
    c0, c1 = int(l[ya] + 0.3 * ancho[ya]), int(l[ya] + 0.7 * ancho[ya])
    cob = A[:, c0:c1 + 1].mean(1)
    llena = np.where(cob > 0.98)[0]
    if not len(llena):
        return None
    yb = y0 + ya + llena[-1] + 1 + cob[llena[-1] + 1:].sum()
    # Los lados: lo medido justo debajo de la presilla; sin presilla (nylon),
    # las rectas de los lados, para que la punta siga a la correa sin escalón.
    lados = np.arange(y0 + ya + 3, y0 + ya + 13)
    if len(ancha):
        xL, xR = np.nanmedian(xl[lados]), np.nanmedian(xr[lados])
    else:
        xL, xR = float(np.median(l[lados - y0])), float(np.median(r[lados - y0]))
    # Las esquinas: la elipse que mejor sigue lo medido (con tope al error de
    # cada fila, para que una muesca o la sombra no la tuerzan).
    ys = np.arange(y0 + ya + 3, int(yb - 1))
    ok = ~np.isnan(xl[ys]) & ~np.isnan(xr[ys])
    ys = ys[ok]
    if len(ys) < 10:
        return None
    s = ys + 0.5
    rxs = np.arange(4.0, (xR - xL) / 2, 0.5)[:, None, None]
    rys = np.arange(4.0, yb - (y0 + ya + 3), 0.5)[None, :, None]
    u = np.clip((s[None, None, :] - (yb - rys)) / rys, 0, 1)
    ent = rxs * (1 - np.sqrt(1 - u * u))
    err = (np.minimum(np.abs(xl[ys] - (xL + ent)), 4) + np.minimum(np.abs(xr[ys] - (xR - ent)), 4)).sum(-1)
    i, j = np.unravel_index(np.argmin(err), err.shape)
    desde, presilla = y0 + ya, None
    if len(ancha) and ya - 30 >= 0:
        # La cara de abajo de la presilla: donde lo medido ya bajó a la mitad
        # entre el ancho de la presilla y el de la punta.
        kL, kR = float(np.median(l[ya - 30:ya - 14])), float(np.median(r[ya - 30:ya - 14]))
        mitad = 0.5 * ((kR - kL) + (xR - xL))
        zs = np.arange(y0 + ya - 16, y0 + ya + 6)
        med = np.where(np.isnan(xl[zs]), 0, xr[zs] - xl[zs])
        bajo = np.where(med < mitad)[0]
        Rk = min(8.0, xL - kL, kR - xR)
        if len(bajo) and bajo[0] > 0 and Rk >= 2:
            k = bajo[0]
            yk = zs[k] + 0.5 - (mitad - med[k]) / max(med[k - 1] - med[k], 1e-3)
            arr = int(np.floor(yk - Rk)) - 1
            kL, kR = float(l[arr - y0 - 1]), float(r[arr - y0 - 1])
            presilla, desde = (kL, kR, float(yk), float(Rk)), arr
    return desde, xL, xR, yb, float(rxs[i, 0, 0]), float(rys[0, j, 0]), presilla


def _dibujar_punta(nuevo, punta, sub=8):
    """Dibuja la punta con antialias en las dos direcciones (subfilas)."""
    desde, xL, xR, yb, rx, ry, presilla = punta
    h, w = nuevo.shape
    xs = np.arange(w)[None, :]
    hasta = min(h, int(np.ceil(yb)) + 1)
    for y in range(desde, hasta):
        s = y + (np.arange(sub) + 0.5) / sub
        u = np.clip((s - (yb - ry)) / ry, 0, 1)
        ent = rx * (1 - np.sqrt(1 - u * u))
        izq, der = xL + ent, xR - ent
        if presilla is not None:
            kL, kR, yk, Rk = presilla
            t = np.clip(s - (yk - Rk), 0, Rk)
            e = Rk - np.sqrt(np.maximum(Rk * Rk - t * t, 0))
            en = s < yk
            izq = np.where(en, np.minimum(izq, kL + e), izq)
            der = np.where(en, np.maximum(der, kR - e), der)
        cob = np.clip(xs - izq[:, None] + 0.5, 0, 1) * np.clip(der[:, None] - xs + 0.5, 0, 1)
        cob[s > yb] = 0
        nuevo[y] = cob.mean(0)
    nuevo[hasta:] = 0
    return nuevo


def bordes_rectos(alfa, nylon=False, cambios=None):
    """Endereza el contorno de una correa: un tramo continuo por fila.

    Se mide el borde izquierdo y derecho de cada fila con precisión de
    subpíxel (donde el alfa cruza 0,5) y se reemplaza por líneas rectas: la
    silicona por tramos (entre el marco y las presillas, que sobresalen), el
    nylon como una sola recta por lado (sin la lengüeta). Después se vuelve a
    dibujar cada fila con borde antialiasado. Queda liso como un vector.
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
    bordes_rectos.esquinas = []; bordes_rectos.punta = None
    if hay.sum() < 30:
        return alfa
    filas = np.where(hay)[0]
    y0, y1 = filas[0], filas[-1] + 1
    seg = slice(y0, y1)
    l = np.interp(np.arange(y0, y1), filas, xl[filas]); r = np.interp(np.arange(y0, y1), filas, xr[filas])
    esquinas = []
    if nylon:
        l, r = _sin_lengueta(l, r)
    else:
        cam = cambios[y0:y1] if cambios is not None else None
        l = _por_tramos(l, lado=-1, cambios=cam)
        esquinas += [(-1, a + y0, b + y0, c + y0, R) for a, b, c, R in _por_tramos.esquinas]
        r = _por_tramos(r, lado=1, cambios=cam)
        esquinas += [(1, a + y0, b + y0, c + y0, R) for a, b, c, R in _por_tramos.esquinas]
    bordes_rectos.esquinas = esquinas
    xs = np.arange(w)[None, :]
    nuevo = np.zeros_like(alfa)
    nuevo[seg] = np.clip(xs - l[:, None] + 0.5, 0, 1) * np.clip(r[:, None] - xs + 0.5, 0, 1)
    # Primera y última fila: medio píxel de cobertura vertical, sin escalón.
    nuevo[y0] *= np.clip(alfa[y0].max(), 0, 1)
    nuevo[y1 - 1] *= np.clip(alfa[y1 - 1].max(), 0, 1)
    punta = _punta(alfa, xl, xr, y0, l, r)
    bordes_rectos.punta = punta
    if punta is not None:
        nuevo = _dibujar_punta(nuevo, punta)
    return nuevo


def canto_parejo(F, alfa, borde=7):
    """Silicona: el canto de la correa del color del cuerpo.

    La foto trae un brillo en el canto de la correa; sobre el fondo claro
    original casi no se veía, sobre los fondos nuevos parece un halo. En las
    filas de correa (ni el marco ni las presillas, que son más anchos, ni la
    punta, más angosta) los `borde` px de cada lado toman el color del cuerpo,
    medido un poco más adentro (antes de las perforaciones) y parejo a lo
    largo de la correa.
    """
    h, w = alfa.shape
    a = alfa >= 0.5
    ancho = a.sum(1)
    hay = ancho > 0
    if hay.sum() < 30:
        return F
    med = np.median(ancho[hay])
    correa = hay & (np.abs(ancho - med) <= 3)
    # Cerca del marco y las presillas, las barras cruzan la correa unas filas
    # antes de que se ensanchen: esas filas (de otro color que la correa) no.
    cerca = np.convolve((hay & ~correa).astype(float), np.ones(25), mode='same') > 0
    izq = np.full((h, 3), np.nan); der = np.full((h, 3), np.nan)
    li = np.zeros(h, int); ri = np.zeros(h, int)
    for y in np.where(correa)[0]:
        xs = np.where(a[y])[0]
        li[y], ri[y] = xs[0], xs[-1]
        izq[y] = np.median(F[y, li[y] + borde:li[y] + borde + 5], 0)
        der[y] = np.median(F[y, ri[y] - borde - 4:ri[y] - borde + 1], 0)
    lejos = correa & ~cerca
    if lejos.sum() > 15:
        cuerpo = np.median(np.concatenate([izq[lejos], der[lejos]]), 0)
        distinto = np.abs(np.nanmean([izq, der], 0) - cuerpo).mean(1) > 30
        correa &= ~(cerca & distinto)
        izq[~correa] = np.nan; der[~correa] = np.nan
    for c in range(3):
        for col in (izq, der):
            v = col[:, c]; ok = ~np.isnan(v)
            if ok.sum() > 15:
                col[ok, c] = _mediana(v[ok], 15)
    F = F.copy()
    for y in np.where(correa)[0]:
        F[y, max(0, li[y] - 2):li[y] + borde] = izq[y]
        F[y, ri[y] - borde + 1:min(w, ri[y] + 3)] = der[y]
    return F


def esquinas_parejas(F, alfa, esquinas):
    """Las esquinas del marco y las presillas, del color de su costado.

    En la esquina, la foto trae el brillo de la cara de arriba del marco (una
    mancha clara sobre los fondos nuevos). Cada fila de la esquina copia, en
    las columnas del costado, el color de una fila donde el marco ya es recto.
    Solo las esquinas de arriba (donde empieza la parte ancha): abajo está el
    grabado DEUSBAND, que la copia tapaba.
    """
    h, w = alfa.shape
    a = alfa >= 0.5
    F = F.copy()
    for lado, y0, y1, yref, R in esquinas:
        if not (0 <= yref < h) or not a[yref].any():
            continue
        cols_ref = np.where(a[yref])[0]
        ancho = int(np.ceil(R)) + 4
        for y in range(max(0, y0), min(h, y1)):
            if not a[y].any():
                continue
            if lado < 0:
                x0 = cols_ref[0]; xs = np.arange(max(0, x0 - 1), min(w, x0 + ancho))
            else:
                x1 = cols_ref[-1]; xs = np.arange(max(0, x1 - ancho + 1), min(w, x1 + 2))
            F[y, xs] = F[yref, xs]
    return F


def punta_pareja(F, alfa, desde, borde=7):
    """Silicona: el canto de la punta del color del cuerpo, como la correa.

    La foto trae en la punta un ribete claro y la sombra pegada al costado
    (manchas grises o blancas sobre los fondos nuevos). Los `borde` px de
    afuera, desde `desde` (debajo de la presilla) hacia abajo, toman el color
    de la banda de más adentro, corrido hacia afuera de a poco.
    """
    h, w = alfa.shape
    sm = lambda a, r: _arr(_img(a).filter(ImageFilter.BoxBlur(r)))
    abajo = np.zeros((h, w), bool); abajo[desde:] = True
    hondo = (_arr(_img(alfa > 0.5).filter(ImageFilter.MinFilter(2 * borde + 1))) > 0.5) & abajo
    canto = (alfa > 0) & ~hondo & abajo
    F = F.copy(); peso = hondo.copy()
    for _ in range(3 * borde):
        num = np.stack([sm(F[..., k] / 255 * peso, 2) for k in range(3)], -1) * 255
        den = sm(peso.astype(float), 2)[..., None]
        nuevo = canto & ~peso & (den[..., 0] > 0.02)
        if not nuevo.any():
            break
        F[nuevo] = (num / np.maximum(den, 1e-6))[nuevo]
        peso = peso | nuevo
    return F


def recorte_limpio(C, B, escala=4, nylon=False):
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
    datos = alfa >= 0.5
    # Cuánto cambia el centro de la correa fila a fila (para ubicar las
    # barras del marco y las presillas).
    filas_con = np.where(datos.any(1))[0]
    li = np.array([np.where(datos[y])[0][0] for y in filas_con]); ri = np.array([np.where(datos[y])[0][-1] for y in filas_con])
    cl, cr = np.median(li), np.median(ri)
    centro = lum(C)[:, int(cl + 0.35 * (cr - cl)):int(cl + 0.65 * (cr - cl)) + 1].mean(1)
    cambios = np.zeros(len(centro)); cambios[2:] = np.abs(centro[2:] - centro[:-2])
    alfa = bordes_rectos(alfa, nylon, cambios)
    # Color del borde. La foto trae ahí un brillo o un ribete (en el nylon,
    # con una costura punteada) cortado y disparejo, que sobre un fondo oscuro
    # se veía carcomido. Se suaviza a lo largo de la correa (vertical): de 2 a
    # 6 px del borde queda como una línea recta y pareja; los 2 px de afuera
    # (con el fondo viejo mezclado) toman ese color. El interior no se toca.
    adentro = alfa > 0.5
    in2 = _arr(_img(adentro).filter(ImageFilter.MinFilter(5))) > 0.5
    in6 = _arr(_img(adentro).filter(ImageFilter.MinFilter(13))) > 0.5
    borde = in2 & ~in6
    V = np.where(in2[..., None], C, np.nan).astype(np.float32)
    k = 15
    Vp = np.pad(V, ((k // 2, k // 2), (0, 0), (0, 0)), mode='edge')
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', RuntimeWarning)   # columnas sin banda: todo NaN
        Vs = np.nanmedian(np.lib.stride_tricks.sliding_window_view(Vp, k, axis=0), axis=-1)
    F = C.copy()
    ok = borde & ~np.isnan(Vs[..., 0])
    F[ok] = Vs[ok]
    # Solo conserva su color lo que ya era banda en los datos: lo que agregó el
    # contorno nuevo (esquinas redondeadas, muescas tapadas) era fondo o un
    # brillo en la foto, y toma el color de la banda de al lado.
    peso = in2 & datos
    for _ in range(10):
        num = np.stack([sm(F[..., k2] / 255 * peso, 2) for k2 in range(3)], -1) * 255
        den = sm(peso.astype(float), 2)[..., None]
        nuevo = (~peso) & (den[..., 0] > 0.02)
        F[nuevo] = (num / np.maximum(den, 1e-6))[nuevo]
        peso = peso | nuevo
    if not nylon:
        F = canto_parejo(F, alfa)
        F = esquinas_parejas(F, alfa, bordes_rectos.esquinas)
        if bordes_rectos.punta is not None:
            desde, presilla = bordes_rectos.punta[0], bordes_rectos.punta[-1]
            if presilla is not None:
                # La esquina de abajo de la presilla sigue el color de su
                # costado (como las de arriba); la punta empieza debajo.
                kL, kR, yk, Rk = presilla
                y1 = int(np.ceil(yk)) + 1
                F = esquinas_parejas(F, alfa, [(-1, desde, y1, desde - 3, Rk), (1, desde, y1, desde - 3, Rk)])
                desde = y1
            F = punta_pareja(F, alfa, desde)
    # Brillos en el contorno (el reflejo del borde del marco): sobre el fondo
    # claro original pasaban; sobre los nuevos se ven como manchas blancas. En
    # los 7 px del borde, nada más de 35 niveles más claro que la banda de al
    # lado. Los brillos de adentro (la línea del marco, a ~12 px; el perno) no
    # se tocan.
    in4 = _arr(_img(adentro).filter(ImageFilter.MinFilter(15))) > 0.5
    canto = (alfa > 0) & ~in4
    ref = np.stack([sm(F[..., k2] / 255 * in4, 9) for k2 in range(3)], -1) * 255
    den = sm(in4.astype(float), 9)[..., None]
    ref = np.where(den > 0.05, ref / np.maximum(den, 1e-6), F)
    exceso = lum(F) - lum(ref) - 35
    k = np.where(exceso > 0, 35 / np.maximum(lum(F) - lum(ref), 1), 1.0)[..., None]
    F = np.where(canto[..., None], ref + (F - ref) * k, F)
    if not nylon:
        # Silicona clara (la rosada): en el canto, lo que es más gris que la
        # banda de al lado es la sombra de la foto pegada al costado (una raya
        # gris a lo largo de la presilla). Toma el tinte de la banda, y nada
        # del canto queda más de un 10% más oscuro que la banda de al lado (la
        # cara del costado sigue apenas más oscura, sin raya).
        tinte = lambda X: (X[..., 0] - 0.5 * (X[..., 1] + X[..., 2])) / np.maximum(lum(X), 1)
        clara = canto & (lum(ref) > 110) & (lum(F) > 90)
        gris = clara & (tinte(F) < tinte(ref) - 0.04)
        F = np.where(gris[..., None], ref * (lum(F) / np.maximum(lum(ref), 1))[..., None], F)
        piso = 0.9 * lum(ref)
        F = np.where((clara & (lum(F) < piso))[..., None], F * (piso / np.maximum(lum(F), 1))[..., None], F)
        # Los brillos de la rosada reflejaban el fondo celeste viejo (una
        # mancha lila en la punta): lo bien más azul que la banda toma el color
        # de la banda de alrededor. Lo neutro (el perno, el marco) no se toca.
        cuerpo = (alfa > 0.5) & (lum(F) > 110)
        if cuerpo.sum() > 0.5 * (alfa > 0.5).sum():
            bg_ = np.median((F[..., 2] - F[..., 1])[cuerpo])
            lila = (alfa > 0) & (lum(F) > 110) & (F[..., 2] - F[..., 1] > bg_ + 8)
            peso = (alfa > 0.5) & ~lila
            for _ in range(15):
                num = np.stack([sm(F[..., k2] / 255 * peso, 2) for k2 in range(3)], -1) * 255
                den = sm(peso.astype(float), 2)[..., None]
                nuevo = lila & ~peso & (den[..., 0] > 0.02)
                if not nuevo.any():
                    break
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
        rgba = recorte_limpio(A[:by1, bx0:bx1], Bf[:by1, bx0:bx1], nylon=pieza == 'nylon')
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
