# Base de datos (Supabase)

Son los mismos scripts del dashboard original. **Si reutilizas el mismo proyecto de Supabase, no hay que ejecutar nada.**

Para un proyecto nuevo, en Supabase → SQL Editor → New query, pega y ejecuta **en este orden** (todos se pueden repetir):

1. `00-base.sql` — tablas `profiles` y `app_state`, políticas RLS (cambia los correos del final por los reales)
2. `02-admin.sql` — rol administrador
3. `03-perfil.sql` — datos de «Mi perfil»
4. `04-comentarios.sql` — lectores pueden comentar
5. `05-acceso.sql` — cuentas pendientes, bloqueo a los 5 intentos, recuperación con código
6. `06-seguridad.sql` — URLs de Teams solo para administradores (`notify_secrets`) y copias de seguridad
7. `07-avisos-pgcron.sql` — **opcional**: envío programado desde Supabase. No lo ejecutes si usas el programador de la API (`AVISOS_SCHEDULER=1`).

La plantilla del correo «Reset Password» debe llevar el código (`{{ .Token }}`): ver el README del proyecto original, sección «Acceso».

`00-base.sql` es el script inicial del original; los correos que trae son de ejemplo.
