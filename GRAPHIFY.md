# Graphify · optimización de tokens para DEUS Band

[Graphify](https://github.com/Graphify-Labs/graphify) (MIT) convierte el código
del proyecto en un **grafo de conocimiento** consultable. En vez de que el
asistente lea archivos enteros para entender cómo se conecta todo (lo que gasta
muchos tokens), consulta el grafo y recibe una respuesta compacta con las
funciones/archivos relevantes y su ubicación exacta (`archivo:línea`).

- El código se analiza **localmente con tree-sitter (AST)** — sin LLM, sin API
  key y **sin gastar tokens** al construir el grafo.
- La optimización de tokens ocurre en las **consultas**: cada respuesta viene
  acotada por un presupuesto de tokens (`--budget`, 2000 por defecto).

## Puesta en marcha (una sola vez por entorno)

```bash
bash scripts/graphify-setup.sh
```

Esto instala graphify, registra la skill `/graphify` para Claude Code y
construye el grafo en `graphify-out/graph.json`.

> **Nota:** el grafo (`graphify-out/`) es un artefacto derivado y está en
> `.gitignore` — no se commitea porque cambia con cada modificación del código
> y se regenera en segundos. En un entorno nuevo (p. ej. una sesión nueva de
> Claude Code en la nube), volvé a correr el script de arriba: la instalación
> vive solo en ese contenedor.

## Uso diario

```bash
# Preguntar por el código sin abrir archivos enteros
graphify query "cómo se verifica el ticket del sorteo" --budget 800

# Explicar una función y sus vecinos en el grafo
graphify explain "registrarVenta()"

# Ver qué se rompería si tocás algo (impacto inverso)
graphify affected "ordenConfirmada()"

# Camino más corto entre dos piezas del código
graphify path "canjearTicket()" "ordenConfirmada()"

# Refrescar el grafo tras cambios de código (sin LLM, sin tokens)
graphify update .
```

Dentro de Claude Code también podés escribir `/graphify` para invocar la skill.

## Cómo ayuda a ahorrar tokens

| Sin graphify | Con graphify |
|---|---|
| Leer `server.js`, `routes/*.js`, `services/*.js` completos para ubicar una función (~miles de tokens). | Una consulta al grafo devuelve los nodos relevantes con `archivo:línea` en unos cientos de tokens. |
| El asistente re-lee archivos en cada pregunta. | El grafo persiste en `graphify-out/` y se consulta las veces que haga falta. |

El estado actual del proyecto: **~319 nodos** (backend + frontend) y ~27
comunidades detectadas automáticamente.

## Cobertura del frontend (optimización clave)

El JS del sitio vive como `<script>` inline dentro de `index.html` (~20
bloques, ~78KB) y `admin.html`, invisible para el análisis AST de HTML. Por eso
`scripts/graphify-extract-frontend.py` (invocado por el setup y por el git hook
post-commit) lo extrae **siempre fresco** a `graphify-src/*-inline.js`.

La extracción es **line-preserving**: el archivo generado tiene la misma
numeración de líneas que el HTML, así la línea que reporta el grafo
(`index-inline.js:L1667`) **es idéntica a la del `index.html` real**
(`index.html:L1667`). Se salta directo a editar el HTML en esa línea, sin
marcadores ni cálculos — el paso de "lectura dirigida" pasa de ~1000 a ~650
tokens y el ahorro en preguntas de frontend sube a **~98%**.

`.graphifyignore` excluye del grafo `img/` (assets pesados). La antigua copia
obsoleta del frontend (`scratch_scripts.js`) fue eliminada del repo: la
extracción fresca de `graphify-src/` la reemplaza por completo.
