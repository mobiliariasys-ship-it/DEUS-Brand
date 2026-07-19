#!/bin/bash
# SessionStart hook · DEUS Band
# Deja el entorno listo automáticamente en cada sesión de Claude Code en la nube:
#   1) instala las dependencias de Node (para poder correr el backend)
#   2) instala Graphify y construye el grafo de código (optimización de tokens)
#      + registra el git hook que refresca el grafo solo tras cada commit
# Es idempotente y no pide ningún dato. Repo del tool: github.com/Graphify-Labs/graphify
set -euo pipefail

# Solo en el entorno remoto (Claude Code en la nube). En local no hace nada.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

# graphify (y otras tools de uv/pip) viven en ~/.local/bin: dejarlo en el PATH
# de toda la sesión para que 'graphify' esté disponible siempre.
export PATH="$HOME/.local/bin:$PATH"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
fi

# 1) Dependencias de Node (backend). npm install aprovecha el cache del contenedor.
if [ -f package.json ]; then
  echo "[session-start] npm install..."
  npm install --no-audit --no-fund || echo "[session-start] aviso: npm install falló, continúo."
fi

# 2) Graphify: instala el tool + construye el grafo (AST local, sin LLM, sin tokens).
if [ -f scripts/graphify-setup.sh ]; then
  echo "[session-start] Configurando Graphify..."
  bash scripts/graphify-setup.sh || echo "[session-start] aviso: setup de graphify falló, continúo."
fi

echo "[session-start] Listo."
