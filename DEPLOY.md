# Despliegue: Frontend en Netlify + Backend en Render

## Parte 1 — Backend en Render

1. Sube el proyecto a un repositorio de GitHub (incluye todo MENOS `.env` y `node_modules`, que ya están en `.gitignore`).
2. Entra a https://render.com → **New** → **Web Service** → conecta tu repo.
3. Render detecta `render.yaml` automáticamente. Si no, usa:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. En **Environment** agrega estas variables (las mismas de tu `.env`):
   - `NODE_ENV` = `production`
   - `PUBLIC_KEY` = tu public key de MercadoPago
   - `ACCESS_TOKEN` = tu access token de MercadoPago
   - `PUBLIC_URL` = (déjala vacía por ahora; la llenas en el paso 6)
   - `ALLOWED_ORIGIN` = la URL de tu sitio Netlify, ej: `https://deusband.netlify.app`
   - (opcional) credenciales de couriers
5. Deploy. Render te dará una URL, ej: `https://deus-band-backend.onrender.com`
6. Vuelve a las variables de Render y pon `PUBLIC_URL` = esa URL. Redeploy.

## Parte 2 — Conectar el Frontend (Netlify)

1. Abre `index.html` y reemplaza la URL de ejemplo por la de Render:
   ```js
   window.DEUS_API_BASE = location.hostname.includes('localhost')
     ? ''
     : 'https://deus-band-backend.onrender.com';   // ← tu URL real de Render
   ```
2. Sube el cambio a Netlify (git push o arrastrar el archivo).

## Listo

- **Local:** `npm start` → todo apunta al backend local automáticamente.
- **Producción:** Netlify sirve el HTML y las llamadas van al backend en Render.

## Nota sobre el plan gratis de Render

El backend "se duerme" tras 15 min de inactividad. La primera petición tras dormir tarda ~30s en despertar. Para una tienda con tráfico bajo es aceptable; si necesitas que esté siempre activo, sube al plan de pago.
