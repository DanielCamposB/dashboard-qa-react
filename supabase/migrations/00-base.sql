-- Ejecutar completo en Supabase → SQL Editor → New query → Run

create table if not exists profiles (
  email text primary key,                                   -- siempre en minúsculas
  role  text not null check (role in ('editor','viewer'))
);

create table if not exists app_state (
  id      int primary key,
  data    jsonb not null default '{}'::jsonb,
  version int   not null default 0
);
insert into app_state (id) values (1) on conflict do nothing;

alter table profiles  enable row level security;
alter table app_state enable row level security;

create or replace function public.my_role() returns text
language sql security definer stable set search_path = public as $$
  select role from profiles where email = lower(auth.jwt() ->> 'email')
$$;

drop policy if exists "ver mi perfil" on profiles;
create policy "ver mi perfil" on profiles for select to authenticated
  using (email = lower(auth.jwt() ->> 'email'));

drop policy if exists "miembros leen" on app_state;
create policy "miembros leen" on app_state for select to authenticated
  using (public.my_role() is not null);

drop policy if exists "editores escriben" on app_state;
create policy "editores escriben" on app_state for update to authenticated
  using (public.my_role() = 'editor') with check (public.my_role() = 'editor');

-- Usuarios autorizados (cambia los correos). Editor = puede modificar; viewer = solo lectura.
insert into profiles (email, role) values
  ('correo1@empresa.com',      'editor'),
  ('correo2@empresa.com',  'editor'),
  ('correo3@empresa.com',       'editor')
on conflict (email) do update set role = excluded.role;
