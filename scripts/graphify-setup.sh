#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Graphify · setup para DEUS Band
#
# Deja graphify listo para usar en este proyecto y construye el grafo de
# conocimiento del código (AST local, SIN LLM y SIN gastar tokens).
#
# ¿Para qué sirve? En vez de que el asistente lea archivos enteros para
# entender el proyecto (miles de tokens), consulta un grafo con las relaciones
# entre funciones/archivos y recibe una respuesta compacta con ubicaciones
# exactas (archivo:línea). Eso ahorra tokens en cada pregunta sobre el código.
#
# Uso:
#   bash scripts/graphify-setup.sh
#
# Requisitos: Python 3.10+ y uv (o pip como respaldo). No pide ninguna API key.
# Repo del tool: https://github.com/Graphify-Labs/graphify  (MIT)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "▸ Instalando graphify (paquete PyPI: graphifyy)..."
if command -v uv >/dev/null 2>&1; then
  uv tool install --quiet graphifyy 2>/dev/null || uv tool upgrade graphifyy 2>/dev/null || true
  export PATH="$HOME/.local/bin:$PATH"
elif command -v pipx >/dev/null 2>&1; then
  pipx install graphifyy 2>/dev/null || pipx upgrade graphifyy 2>/dev/null || true
else
  python3 -m pip install --user --upgrade graphifyy
  export PATH="$HOME/.local/bin:$PATH"
fi

if ! command -v graphify >/dev/null 2>&1; then
  echo "✗ No se encontró 'graphify' en el PATH. Agrega \$HOME/.local/bin al PATH y reintenta." >&2
  exit 1
fi
echo "  graphify $(graphify --version 2>/dev/null || echo '?') instalado."

echo "▸ Registrando la skill /graphify para Claude Code..."
graphify install --platform claude >/dev/null 2>&1 || true

echo "▸ Extrayendo el JS inline del frontend (index.html/admin.html) para el grafo..."
python3 scripts/graphify-extract-frontend.py

echo "▸ Construyendo el grafo de código (AST local, sin LLM)..."
graphify update . --no-cluster
echo "▸ Detectando comunidades (sin LLM, sin tokens)..."
graphify cluster-only . --no-label --no-viz

echo "▸ Instalando git hook post-commit (refresca el grafo solo tras cada commit)..."
graphify hook install >/dev/null 2>&1 || echo "  (aviso: no se pudo instalar el git hook; refrescá manual con 'graphify update .')"

# El hook de graphify solo re-extrae archivos de código cambiados; el frontend
# vive inline en el HTML, así que además inyectamos (idempotente) un paso que
# regenera graphify-src/ y refresca el grafo cuando un commit toca el HTML.
HOOK="$PROJECT_DIR/.git/hooks/post-commit"
if [ -f "$HOOK" ] && ! grep -q "deus-frontend-extract" "$HOOK"; then
  TMP_SNIPPET="$(mktemp)"
  cat > "$TMP_SNIPPET" <<'SNIP'
# deus-frontend-extract-start
# Si el commit tocó el HTML, regenera la extracción del JS inline y refresca
# el grafo en segundo plano (el JS inline no es visible para el hook de graphify).
if git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -qE '^(index|admin)\.html$'; then
  python3 scripts/graphify-extract-frontend.py >/dev/null 2>&1 || true
  ( PATH="$HOME/.local/bin:$PATH" graphify update . --no-cluster >/dev/null 2>&1 || true ) &
fi
# deus-frontend-extract-end
SNIP
  # Insertar tras la línea del shebang
  sed -i "1r $TMP_SNIPPET" "$HOOK"
  rm -f "$TMP_SNIPPET"
  echo "  paso de extracción del frontend agregado al post-commit."
fi

echo ""
echo "✓ Listo. El grafo está en graphify-out/graph.json"
echo ""
echo "  Consultá el código sin leer archivos enteros, por ejemplo:"
echo "    graphify query \"donde se registra una venta confirmada\" --budget 800"
echo "    graphify explain \"registrarVenta()\""
echo "    graphify affected \"ordenConfirmada()\""
echo ""
echo "  Tras cambios de código, refrescá el grafo con:  graphify update ."
