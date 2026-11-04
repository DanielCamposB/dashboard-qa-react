-- Súper usuario (administrador de permisos)
-- Ejecutar en Supabase → SQL Editor → New query → Run  (después de supabase.sql y supabase-perfil.sql)
-- IMPORTANTE: al final cambia TU_CORREO por el correo con el que inicias sesión.

-- 1) Roles permitidos: admin (súper usuario), editor, viewer (solo lectura)
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','editor','viewer'));

-- 2) Nadie salvo un admin puede cambiar un rol (ni el suyo propio). Desde el SQL Editor sí se puede.
create or replace function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and coalesce(public.my_role(), '') <> 'admin' then
    raise exception 'Solo un administrador puede cambiar roles';
  end if;
  if new.email is distinct from old.email then
    raise exception 'No se puede cambiar el correo';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_role on profiles;
create trigger trg_guard_role before update on profiles for each row execute function public.guard_role();

-- 3) Los admin también editan los datos, y ven los perfiles igual que un editor
drop policy if exists "editores escriben" on app_state;
create policy "editores escriben" on app_state for update to authenticated
  using (public.my_role() in ('editor','admin')) with check (public.my_role() in ('editor','admin'));

drop policy if exists "editores ven perfiles" on profiles;
create policy "editores ven perfiles" on profiles for select to authenticated
  using (public.my_role() in ('editor','admin'));

-- 4) Solo el admin agrega, cambia o quita accesos
grant insert (email, role) on profiles to authenticated;
grant update (role)        on profiles to authenticated;
grant delete               on profiles to authenticated;

drop policy if exists "admin agrega" on profiles;
create policy "admin agrega" on profiles for insert to authenticated
  with check (public.my_role() = 'admin');

drop policy if exists "admin cambia" on profiles;
create policy "admin cambia" on profiles for update to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

drop policy if exists "admin quita" on profiles;
create policy "admin quita" on profiles for delete to authenticated
  using (public.my_role() = 'admin' and email <> lower(auth.jwt() ->> 'email'));   -- no puede borrarse a sí mismo

-- 5) Tu súper usuario (correo en minúsculas)
update profiles set role = 'admin' where email = 'tu-correo@empresa.com';
