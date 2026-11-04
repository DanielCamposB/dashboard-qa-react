-- Ejecutar en Supabase → SQL Editor → New query → Run
-- Agrega los datos de perfil a cada usuario y deja que cada uno edite SOLO su propia información.

alter table profiles
  add column if not exists nombres          text,
  add column if not exists apellido_paterno text,
  add column if not exists apellido_materno text,
  add column if not exists cargo            text,   -- rol del empleador / cargo en la empresa
  add column if not exists vertical         text,
  add column if not exists cumpleanos       date,
  add column if not exists telefono         text;

-- Cada usuario solo puede modificar estas columnas (nunca "role" ni "email")
revoke update on profiles from anon, authenticated;
grant update (nombres, apellido_paterno, apellido_materno, cargo, vertical, cumpleanos, telefono)
  on profiles to authenticated;

drop policy if exists "editar mi perfil" on profiles;
create policy "editar mi perfil" on profiles for update to authenticated
  using (email = lower(auth.jwt() ->> 'email'))
  with check (email = lower(auth.jwt() ->> 'email'));

-- Los editores pueden ver los perfiles de todos (directorio del equipo)
drop policy if exists "editores ven perfiles" on profiles;
create policy "editores ven perfiles" on profiles for select to authenticated
  using (public.my_role() = 'editor');
