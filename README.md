# Dashboard QA — React

Migración del dashboard HTML/JS original (`D:\dashboard`, que queda intacto como base) a un stack moderno. Mismas pestañas, mismas reglas de negocio y **la misma base de datos Supabase**, así que se puede usar con los datos actuales sin migrarlos.

| Capa | Antes | Ahora |
|---|---|---|
| Interfaz | HTML + JS imperativo (`app.js`, 1.350 líneas) | **React 18 + TypeScript + Vite**, estado con Zustand, rutas con React Router |
| Lógica de negocio | Mezclada con el DOM | Paquete **`@qa/core`** (TypeScript puro, con pruebas), compartido por la web y la API |
| Backend | Funciones SQL en Supabase (`pg_cron`, `pg_net`) | Supabase (BD + login + RLS) **más una API Node (Fastify)** para avisos a Teams y envío programado |
| Config | `config.js` | Variables de entorno (`.env.local`) |
| Librerías externas | `<script>` desde CDN | Paquetes npm (`supabase-js`, `msal-browser`, `docx`, `xlsx`), cargadas solo al usarse |

## Estructura

```
apps/web        Interfaz React (Vite). Conserva el CSS y los temas del original (legacy.css)
apps/api        API Node + Fastify: confirma entregas a Teams y envía los avisos programados
packages/core   Tipos, fechas, cálculos, mezcla Planner, avisos, importador, exportaciones
supabase/       Scripts SQL (los del original, numerados en el orden de ejecución)
docs/           MIGRACION.md: dónde quedó cada parte del código antiguo
```

## Empezar

Requisitos: Node 20 o superior.

```bash
npm install
```

**Modo local** (sin Supabase, con datos de ejemplo guardados en el navegador):

```bash
npm run dev
```
Abre http://localhost:5173/.

**Con Supabase** (multiusuario, login, roles): copia `.env.example` como `.env.local` y completa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (Project Settings → API). Si es un proyecto nuevo, ejecuta antes los scripts de `supabase/migrations` en orden (ver `supabase/README.md`). Si reutilizas el proyecto del dashboard original, ya están ejecutados.

```bash
npm test            # pruebas de @qa/core y @qa/api
npm run typecheck   # TypeScript en los tres paquetes
npm run build       # genera apps/web/dist
```

## Planner (solo lectura)

Igual que antes: el dashboard lee Microsoft Planner y **nunca escribe** en él. Registra la aplicación en Entra ID (SPA, permisos delegados `Tasks.Read`, `Group.Read.All`, `User.ReadBasic.All`; redirect URI = dirección publicada y `http://localhost:5173/`) y pon `VITE_MSAL_CLIENT_ID` y `VITE_MSAL_TENANT_ID` en `.env.local`. Luego, en **Clientes**: activa Planner, «Conectar cuenta», «Buscar mis planes», elige el plan y «Sincronizar ahora».

## Avisos a Teams

Hay tres formas de enviar, todas con la misma lógica de resumen (`@qa/core`):

1. **Con la API** (`VITE_API_URL`): los botones «Enviar ahora» pasan por la API, que usa la URL guardada en `notify_secrets` y **confirma si Teams recibió el mensaje** (desde el navegador no se podía por CORS).
2. **Sin la API**: se usa la función SQL `qa_post` de Supabase (como antes; no confirma la entrega).
3. **Modo local**: se publica directo desde el navegador.

**Envío programado** (9, 12, 15 y 18 h o los horarios de la pestaña Avisos): elige una opción.

- **API Node (recomendado):** despliega `apps/api` con `AVISOS_SCHEDULER=1` (ver abajo).
- **Supabase `pg_cron`:** ejecuta `supabase/migrations/07-avisos-pgcron.sql`, como antes.

Si activas ambas no se duplica nada: comparten la tabla `avisos_log` y cada horario sale una sola vez por día.

### Ejecutar la API

Variables (en el servidor, nunca en el navegador; ver `.env.example`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`, `AVISOS_SCHEDULER`, `AVISOS_TZ`.

```bash
npm run dev:api      # desarrollo
npm run start -w @qa/api
```

Rutas: `GET /api/health`, `POST /api/teams/post` (editor o administrador), `POST /api/avisos/run` (solo administrador; equivale a `select public.qa_avisos(true)`).
La clave `service_role` salta las políticas RLS: guárdala solo como variable de entorno del servidor.

## Publicar

- **Web:** `npm run build` y sube `apps/web/dist` a GitHub Pages u otro hosting estático. Define `VITE_BASE=/nombre-del-repo/` si va en una subruta; el build crea `404.html` para que funcionen las rutas (`/gantt`, `/team`…) al recargar. En Supabase → Authentication → URL Configuration, pon la URL publicada.
- **API:** cualquier servidor Node 20 (Render, Railway, Fly, VPS).

## Respaldo y datos

Los datos siguen guardados como un solo documento JSON (`app_state`) con control de versión: si dos personas guardan a la vez, gana quien guarda primero y al otro se le cargan los cambios nuevos. Las copias automáticas, el bloqueo de cuentas y los permisos son los mismos del original (scripts 05 y 06).

## Desplegar la API

Incluye `Dockerfile` y `render.yaml` (Render Blueprint). Pasos en Render: *New → Blueprint* → elige este repositorio → completa `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API → `service_role`) y `CORS_ORIGIN` (la URL donde publicas la web). Luego pon la URL del servicio en `VITE_API_URL` de la web y vuelve a compilarla.

- El programador de avisos necesita que el servicio esté siempre encendido: el plan gratis de Render se duerme y no enviaría. Si no quieres pagar, deja `AVISOS_SCHEDULER=0` y usa `07-avisos-pgcron.sql`.
- **Un solo programador:** aunque ambos compartan `avisos_log` y no dupliquen horarios, lo más simple es usar uno. Si pasas de `pg_cron` a la API, desactívalo con `select cron.unschedule('qa-avisos');`.
