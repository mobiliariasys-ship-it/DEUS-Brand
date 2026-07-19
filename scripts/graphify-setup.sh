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

echo "▸ Construyendo el grafo de código (AST local, sin LLM)..."
graphify update . --no-cluster
echo "▸ Detectando comunidades (sin LLM, sin tokens)..."
graphify cluster-only . --no-label --no-viz

echo ""
echo "✓ Listo. El grafo está en graphify-out/graph.json"
echo ""
echo "  Consultá el código sin leer archivos enteros, por ejemplo:"
echo "    graphify query \"donde se registra una venta confirmada\" --budget 800"
echo "    graphify explain \"registrarVenta()\""
echo "    graphify affected \"ordenConfirmada()\""
echo ""
echo "  Tras cambios de código, refrescá el grafo con:  graphify update ."
