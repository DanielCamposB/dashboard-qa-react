# Migración: dónde quedó cada parte

El proyecto original (`D:\dashboard`) no se tocó. Esta tabla sirve para encontrar en el código nuevo lo que antes estaba en cada archivo.

| Original | Nuevo | Notas |
|---|---|---|
| `index.html` (vistas y diálogos) | `apps/web/src/views/*`, `dialogs/*`, `components/*` | Se mantienen los mismos `id` y clases CSS |
| `styles.css` | `apps/web/src/legacy.css` | Sin cambios: mismos 16 temas y modo claro/oscuro |
| `app.js` — cálculos (`progress`, `health`, `alertsList`, `statusSync`…) | `packages/core/src/calc.ts` | Con pruebas |
| `app.js` — Dashboard, Hoy, Resumen | `views/Dashboard.tsx`, `Hoy.tsx`, `Resumen.tsx` | |
| `app.js` — Gantt (arrastre y redimensión) | `views/Gantt.tsx` | Probado con arrastre real |
| `app.js` — Equipo, Responsables, Roles | `views/People.tsx` | Una sola implementación para ambas pestañas |
| `app.js` — Plantillas | `views/Templates.tsx` | |
| `app.js` — Permisos, copias | `views/Perm.tsx` | |
| `app.js` — ventana de requerimiento | `dialogs/ReqDialog.tsx` | |
| `app.js` — login, perfil, contraseña | `components/Login.tsx`, `dialogs/ProfileDialog.tsx` | |
| `app.js` — importar Excel/CSV | `core/src/importer.ts` + `dialogs/ImportDialog.tsx` | `xlsx` ya no viene de CDN |
| `app.js` — CSV y carta Gantt (Excel/PDF) | `core/src/exports.ts` | |
| `data.js` | `packages/core/src/store.ts` (modelo) + `apps/web/src/lib/data.ts` (Supabase/local) | |
| `planner.js` — Graph | `apps/web/src/lib/graph.ts` | |
| `planner.js` — mezcla Planner → dashboard | `packages/core/src/planner.ts` | Con pruebas |
| `planner.js` — resúmenes y mensajes de Teams | `packages/core/src/teams.ts` | Compartido con la API |
| `planner.js` — pestaña Avisos | `views/Avisos.tsx` | |
| `report.js` (Word) | `apps/web/src/lib/report.ts` | `docx` por npm, carga diferida |
| `tips.js` (iconos «!») | `lib/tips.ts` + `components/Hint.tsx` | Sin `MutationObserver`: los iconos son componentes |
| `dialogs.js` | `state/ui.ts` + `components/Host.tsx` | Mismas ventanas, con promesas |
| `config.js` | `.env.local` | `VITE_*` |
| `supabase-*.sql` | `supabase/migrations/00…07` | Idénticos; solo cambió el nombre y el orden |
| `qa_avisos()` (SQL, `pg_cron`) | `apps/api/src/avisos.ts` | Opcional: el SQL sigue disponible |

## Cambios de comportamiento (intencionales)

- **Carta Gantt exportada (Excel/PDF):** en el original las barras no se pintaban porque se calculaban a partir de fechas ya formateadas (`dd-mm-aaaa`). Ahora se calculan con las fechas reales.
- **Informe Word:** el color del estado de las actividades «Bloqueada», «Completada» y «Atrasada» caía siempre en el gris de «Pendiente». Ahora usa su color.
- **Reparto de duración** (importar Excel, Planner): si el redondeo se pasaba, el fin quedaba un día después de la fecha pedida. Ahora el total calza con el plazo.
- **Avisos a Teams:** las fechas en los mensajes salen como `dd-mm-aaaa`, igual que en pantalla.
- **Avisos programados con la API:** usan el mismo resumen que los botones manuales (en el SQL el cálculo era distinto en detalles menores, p. ej. el avance de la lista completa).
- El título de la ventana de un requerimiento ya no cambia mientras escribes; se actualiza al guardar.

## Pendiente de verificar con datos reales

No se pudo probar contra el Supabase de producción ni contra Microsoft Graph / Teams desde aquí. Probado en modo local (datos de ejemplo) con navegador real y con pruebas automáticas. Antes de dejar de usar el original, conviene recorrer: login y recuperación de contraseña, Permisos y copias, sincronizar un plan de Planner y un envío de prueba a Teams.
