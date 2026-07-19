#!/usr/bin/env python3
"""Extrae el JS inline de las páginas HTML a graphify-src/ para que Graphify
lo indexe SIEMPRE FRESCO.

Por qué existe: el frontend de DEUS Band vive como <script> inline dentro de
index.html (~20 bloques, ~78KB de JS) y admin.html. tree-sitter no extrae ese
JS desde el HTML, así que sin esto el grafo queda ciego al frontend — justo lo
que más se desarrolla. Cada bloque va precedido de un marcador con el archivo
y la LÍNEA REAL del HTML de origen, para saltar directo al lugar correcto.

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
    partes = []
    for m in SCRIPT_RE.finditer(html):
        cuerpo = m.group(1)
        if not cuerpo.strip():
            continue
        # Saltar JSON-LD u otros bloques que no son JS ejecutable
        tag = html[m.start():html.index(">", m.start()) + 1].lower()
        if "application/ld+json" in tag:
            continue
        linea = html.count("\n", 0, m.start()) + 1
        partes.append(f"// ═══ {pagina}:L{linea} ═══\n{cuerpo.strip()}\n")
        total_bloques += 1
    destino = OUT_DIR / f"{Path(pagina).stem}-inline.js"
    destino.write_text("\n".join(partes), encoding="utf-8")
    print(f"  {destino.relative_to(ROOT)}: {len(partes)} bloques desde {pagina}")

print(f"  total: {total_bloques} bloques de JS inline extraídos")
sys.exit(0)
