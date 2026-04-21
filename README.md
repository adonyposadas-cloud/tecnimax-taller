# TECNIMAX Taller

Sistema de Gestión de Taller para la flota de taxis de TECNIMAX.
PWA (Progressive Web App) con backend en Supabase.

**Versión:** 2.0 — Fase 2 (autenticación)
**Stack:** HTML + JS vanilla · Supabase (PostgreSQL + Auth + Storage + Realtime)
**Hosting:** GitHub Pages

---

## Estructura del proyecto

```
tecnimax-taller/
├── index.html              Pantalla de login
├── manifest.json           Configuración PWA
├── service-worker.js       Cache con versionado
├── css/styles.css          Paleta azul TECNIMAX + dark mode
├── js/
│   ├── config.js           ← CREDENCIALES (editar antes de subir)
│   ├── supabase-client.js  Cliente de Supabase
│   ├── utils.js            Helpers comunes
│   ├── auth.js             Login / logout / sesiones
│   └── router.js           Redirección por rol
├── pages/
│   ├── admin.html          Stub administrador
│   ├── jefe.html           Stub jefe de pista
│   └── tecnico.html        Stub técnico
└── icons/                  Iconos PWA (192, 512, maskable, apple-touch, favicon)
```

---

## Configuración inicial

### 1. Editar `js/config.js`

Abre `js/config.js` y reemplaza estos dos valores:

```js
SUPABASE_URL: 'https://TU_PROYECTO.supabase.co',
SUPABASE_ANON_KEY: 'PEGA_AQUI_TU_ANON_KEY',
```

Los valores reales los obtienes en Supabase:
**Settings → API → Project URL** y **anon public key**.

> ⚠️ Nunca pegues aquí la **service_role key**. Esa es secreta.

---

## Deployment a GitHub Pages

### Paso 1 — Crear repositorio

1. Entra a https://github.com/new
2. Nombre: `tecnimax-taller`
3. Visibilidad: **Public** (GitHub Pages free requiere público)
4. NO marques "Add README" (ya tenemos uno)
5. Crea el repositorio

### Paso 2 — Subir los archivos

**Opción A (interfaz web, más fácil):**
1. En la página del repo recién creado, click en "uploading an existing file"
2. Arrastra TODA la carpeta `tecnimax-taller` (todos los archivos juntos)
3. Commit: "Primera versión: login + auth"

**Opción B (terminal con Git):**
```bash
cd tecnimax-taller
git init
git add .
git commit -m "Primera versión: login + auth"
git branch -M main
git remote add origin https://github.com/maximinoposadas01-star/tecnimax-taller.git
git push -u origin main
```

### Paso 3 — Activar GitHub Pages

1. En el repo: **Settings → Pages**
2. **Source:** Deploy from a branch
3. **Branch:** `main` · carpeta `/ (root)`
4. **Save**
5. Espera 1-2 minutos y GitHub te dará una URL como:
   `https://maximinoposadas01-star.github.io/tecnimax-taller/`

### Paso 4 — Probar

1. Abre la URL en tu celular (Chrome Android o Safari iOS).
2. Deberías ver la pantalla de login con fondo azul oscuro.
3. Ingresa con tu código (`A` + 5 dígitos) y PIN de 6 dígitos.
4. Si eres admin, te redirige a la pantalla de bienvenida de admin.
5. En Chrome: menú → "Agregar a pantalla principal" para instalar como app.

---

## Flujo de autenticación

1. Usuario ingresa **código** (ej: `A03404`) y **PIN** (6 dígitos).
2. La app convierte a email sintético: `a03404@tecnimax.local` (minúscula, por normalización de Supabase Auth).
3. Supabase Auth valida contra `auth.users`.
4. Si OK, consulta tabla `usuarios` para obtener `rol`, `nombre`, `activo`.
5. Registra entrada en tabla `sesiones`.
6. Guarda perfil en `localStorage` y redirige a la pantalla del rol.

---

## Solución de problemas

**"Código o PIN incorrecto" pero sé que son correctos:**
- Verifica en Supabase > Authentication > Users que el email sea exactamente `M12345@tecnimax.local`.
- Verifica en la tabla `usuarios` que el `id` coincida con el UUID de `auth.users`.
- Verifica que `activo = TRUE` en la tabla `usuarios`.

**"Usuario sin perfil asignado":**
- El auth.users existe pero no hay fila correspondiente en la tabla `usuarios`.
- Ejecuta el SQL `03_vincular_admin.sql` con el UUID correcto.

**La app no se actualiza después de cambios:**
- Incrementa `SW_VERSION` en `config.js` y `CACHE_VERSION` en `service-worker.js`.
- Haz commit y push. GitHub Pages tarda 1-2 min en propagar.
- En el navegador: DevTools > Application > Service Workers > Unregister.

**No carga en el celular pero sí en la PC:**
- Verifica que el celular tenga conexión.
- Prueba modo incógnito para descartar cache.
- Revisa la consola del navegador en Chrome remoto (chrome://inspect).

---

## Próximas fases

- **Fase 3:** Módulo de órdenes (crear, listar, ficha completa) + tablero en vivo
- **Fase 4:** Alertas KM + carga manual GPS + reportes básicos
- **Fase 5:** Fotos (Supabase Storage) + integración WhatsApp
- **Fase 6:** Testing con datos reales + respaldo automático
