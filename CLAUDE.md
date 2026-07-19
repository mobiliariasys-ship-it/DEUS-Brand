# DEUS Band — guía para el asistente

## Ahorro de tokens: usa el grafo ANTES de leer archivos

Para cualquier pregunta sobre el código (dónde está algo, qué llama a qué, qué
se rompe si toco X), consulta Graphify primero y lee **solo** los rangos
`archivo:línea` que devuelva — nunca archivos completos:

```bash
graphify query "pregunta" --budget 600      # ubicar código relevante
graphify explain "funcion()"                 # una función y sus vecinos
graphify affected "funcion()"                # impacto inverso (qué depende de esto)
graphify path "A()" "B()"                    # cómo se conectan dos piezas
```

- El grafo se construye al iniciar la sesión (SessionStart hook) y se refresca
  solo tras cada commit (git hook). Manual: `graphify update .`
- **Frontend**: el JS inline de `index.html`/`admin.html` está indexado vía
  `graphify-src/*-inline.js` (generado). Cada bloque lleva un marcador
  `// ═══ index.html:LNNN ═══` con la línea real del HTML — **edita siempre el
  HTML original en esa línea**, nunca el archivo generado.
- `.graphifyignore` excluye `img/` (assets pesados). No corras extracción
  semántica sobre `img/`.
- `index.html` mide ~2.900 líneas (~19k tokens solo su JS inline): leerlo
  entero es el anti-patrón que este setup evita.

## Estructura de repos (importante)

Producción despliega desde el repo **`deus-band` rama `main`**
(`/workspace/deus-band` → Netlify frontend + Render backend). El repo
**`DEUS-Brand`** (rama `claude/...`) es espejo de desarrollo. Todo cambio se
commitea en ambos.
