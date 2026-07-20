#!/usr/bin/env python3
"""Extrae el JS inline de las páginas HTML a graphify-src/ para que Graphify
lo indexe SIEMPRE FRESCO — con los números de línea PRESERVADOS.

Por qué existe: el frontend de DEUS Band vive como <script> inline dentro de
index.html (~20 bloques, ~78KB de JS) y admin.html. tree-sitter no extrae ese
JS desde el HTML, así que sin esto el grafo queda ciego al frontend — justo lo
que más se desarrolla.

Optimización clave (ahorro de tokens): la extracción es "line-preserving". El
archivo generado tiene EXACTAMENTE la misma numeración de líneas que el HTML
original: cada bloque de JS se coloca en su offset real y los huecos se rellenan
con líneas en blanco. Así el grafo apunta a `index-inline.js:L1254` y esa línea
ES la línea 1254 de index.html — sin marcadores ni cálculos: se salta directo
a editar el HTML en esa línea. La línea 1 lleva un recordatorio de a qué HTML
corresponde el archivo.

Se ejecuta desde scripts/graphify-setup.sh (y por lo tanto en cada sesión y en
cada commit vía el git hook). graphify-src/ está en .gitignore (artefacto) y
.graphifyignore lo re-incluye con !graphify-src/ para que el grafo lo vea.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "graphify-src"
PAGINAS = ["index.html", "admin.html"]

OUT_DIR.mkdir(exist_ok=True)

# Bloques <script> SIN atributo src (solo JS inline nuestro; los de terceros
# con src= — GTM, píxel — no aportan al grafo del proyecto).
SCRIPT_RE = re.compile(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", re.S | re.I)

total_bloques = 0
for pagina in PAGINAS:
    src = ROOT / pagina
    if not src.exists():
        continue
    html = src.read_text(encoding="utf-8")
    total_lineas = html.count("\n") + 1
    # Lienzo de líneas en blanco del mismo largo que el HTML: rellenamos solo
    # las líneas que corresponden a JS inline, dejando el resto vacío.
    lineas = [""] * (total_lineas + 1)
    bloques_pagina = 0
    for m in SCRIPT_RE.finditer(html):
        cuerpo = m.group(1)
        if not cuerpo.strip():
            continue
        # Saltar JSON-LD u otros bloques que no son JS ejecutable
        tag = html[m.start():html.index(">", m.start()) + 1].lower()
        if "application/ld+json" in tag:
            continue
        # Línea (1-based) donde arranca el CONTENIDO del <script> en el HTML.
        inicio_cuerpo = m.start(1)
        linea0 = html.count("\n", 0, inicio_cuerpo)  # 0-based del cuerpo
        for i, texto in enumerate(cuerpo.split("\n")):
            idx = linea0 + i
            if 0 <= idx < len(lineas):
                lineas[idx] = texto
        bloques_pagina += 1
        total_bloques += 1
    # Recordatorio en la línea 1 (desplaza a nadie: la línea 1 del HTML es
    # <!doctype>, nunca JS). Mantiene el mapeo 1:1 para el resto.
    lineas[0] = f"// Extraído de {pagina} — numeración de líneas IDÉNTICA al HTML original. Editá {pagina}, no este archivo."
    destino = OUT_DIR / f"{Path(pagina).stem}-inline.js"
    destino.write_text("\n".join(lineas), encoding="utf-8")
    print(f"  {destino.relative_to(ROOT)}: {bloques_pagina} bloques desde {pagina} (líneas 1:1 con el HTML)")

print(f"  total: {total_bloques} bloques de JS inline extraídos")
sys.exit(0)
