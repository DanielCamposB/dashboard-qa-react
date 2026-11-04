# Base de datos (Supabase)

Son los mismos scripts del dashboard original. **Si reutilizas el mismo proyecto de Supabase, no hay que ejecutar nada.**

Para un proyecto nuevo, en Supabase → SQL Editor → New query, pega y ejecuta **en este orden** (todos se pueden repetir). Antes, en Database → Extensions, activa `pg_cron` y `pg_net`:

1. `00-base.sql` — tablas `profiles` y `app_state`, políticas RLS (los correos del final son de ejemplo; no hace falta editarlos)
2. `02-perfil.sql` — datos de «Mi perfil» (debe ir **antes** del 03: revoca permisos de actualización que el 03 vuelve a dar)
3. `03-admin.sql` — rol administrador
4. `04-comentarios.sql` — lectores pueden comentar
5. `05-acceso.sql` — cuentas pendientes, bloqueo a los 5 intentos, recuperación con código
6. `06-seguridad.sql` — URLs de Teams solo para administradores (`notify_secrets`), copias de seguridad, `avisos_log` y `qa_post`
7. `07-avisos-pgcron.sql` — **opcional**: envío programado desde Supabase. No lo ejecutes si usas el programador de la API (`AVISOS_SCHEDULER=1`).

La plantilla del correo «Reset Password» debe llevar el código (`{{ .Token }}`): ver el README del proyecto original, sección «Acceso».

`00-base.sql` trae correos de ejemplo (`@empresa.com`). Después de ejecutarlo todo, deja tu cuenta como administrador:

```sql
insert into profiles (email, role) values ('tu-correo@dominio.com', 'admin')
on conflict (email) do update set role = 'admin';
delete from profiles where email like '%@empresa.com';
```
