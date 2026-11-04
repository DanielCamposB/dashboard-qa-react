# Dashboard QA — React (reglas para Claude)

Monorepo npm: `apps/web` (React + Vite + TS), `apps/api` (Fastify), `packages/core` (lógica pura compartida). Es la migración de `D:\dashboard`, que se conserva como base y **no se modifica**.

Comandos: `npm run dev` (web, :5173) · `npm run dev:api` · `npm test` · `npm run typecheck` · `npm run build`.

## Reglas de código
- La lógica de negocio (cálculos, validaciones, mezcla Planner, resúmenes de Teams, importación) va en `packages/core` y con prueba en `core.test.ts`. Los componentes solo la usan.
- TypeScript estricto: sin `any` nuevo salvo en bordes con librerías sin tipos (Graph, docx).
- Textos de la interfaz en español.
- Estado: `state/app.ts` (datos). Cambios pequeños que se pueden reaplicar si otra persona guardó antes → `commit(op)`; el resto → `mutate(fn)`.
- Errores de campo: `useFieldErrors` + `<Field>` (flotan sobre el campo, como en el original).

## Reglas de CSS (heredadas)
- `apps/web/src/legacy.css` usa solo variables de `:root` / `html[data-theme=...]` (`--bg`, `--card`, `--ink`, `--mut`, `--line`, `--acc`, `--acc2`, `--s-*`). No agregar hex sueltos ni `!important`.
- Debe verse bien en todos los temas (sonda, bn, negro, cyberpunk, colocolo, uchile, catolica y los demás) y en claro/oscuro. Mantener el logo y los colores de Sonda.
- Los `id` y clases del HTML original se conservan a propósito: el CSS depende de ellos.

## Reglas generales
- No escribir nunca en Planner (solo lectura). No cambiar `supabase/migrations` al hacer trabajo de UI.
- El Gantt (arrastre y redimensión de barras) debe seguir funcionando: verificarlo en el navegador después de cambios en `Gantt.tsx` o en CSS.
- Después de un cambio visual: levantar `npm run dev`, recorrer las 10 vistas (`/dash /hoy /resumen /gantt /team /leaders /clients /avisos /perm /tpl`) y tomar capturas en un tema claro y uno oscuro.
- La clave `service_role` solo vive en variables de entorno de `apps/api`; jamás en `apps/web` ni en el repositorio.
- Trabajar en una rama nueva, no directo en `main`.
