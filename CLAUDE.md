# DEUS Band — guía para el asistente

## Ahorro de tokens: usa el grafo ANTES de leer archivos

Para cualquier pregunta sobre el código (dónde está algo, qué llama a qué, qué
se rompe si toco X), consulta Graphify primero y lee **solo** el rango exacto
`archivo:línea` que devuelva — nunca archivos completos.

**Flujo más barato (≈750 tokens en vez de ~48k):**

```bash
graphify explain "funcion()"     # ~100 tok: da la línea EXACTA + vecinos
graphify query "pregunta" --budget 500   # cuando no sabés el nombre de la función
graphify affected "funcion()"    # impacto inverso (qué depende de esto)
graphify path "A()" "B()"        # cómo se conectan dos piezas
```

Después de `explain`/`query`, hacé un `Read` acotado (offset+limit, ~40 líneas)
en la línea que indicó, y editá ahí.

- **Frontend — mapeo 1:1 (clave):** el JS inline de `index.html`/`admin.html`
  está indexado vía `graphify-src/*-inline.js` (generado, **line-preserving**).
  La línea que reporta el grafo para ese archivo **ES la misma línea del HTML
  original** (p. ej. `index-inline.js:L1667` = `index.html:L1667`). Así que
  **abrí y editá `index.html`/`admin.html` en esa línea directamente** — nunca
  el archivo generado, y sin cálculos de offset.
- El grafo se construye al iniciar la sesión (SessionStart hook) y se refresca
  solo tras cada commit (git hook). Manual: `graphify update .`
- `.graphifyignore` excluye `img/` (assets pesados). No corras extracción
  semántica sobre `img/`.
- `index.html` mide ~2.900 líneas (~48k tokens): leerlo entero es el
  anti-patrón que este setup evita.

## Estructura de repos (importante)

Producción despliega desde el repo **`deus-band` rama `main`**
(`/workspace/deus-band` → Netlify frontend + Render backend). El repo
**`DEUS-Brand`** (rama `claude/...`) es espejo de desarrollo. Todo cambio se
commitea en ambos.
