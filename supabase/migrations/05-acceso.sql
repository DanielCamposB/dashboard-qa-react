-- Acceso: solicitudes pendientes, bloqueo a los 5 intentos fallidos y desbloqueo por el administrador.
-- Ejecutar en Supabase → SQL Editor → New query → Run  (después de supabase-admin.sql). Se puede ejecutar más de una vez.
--
-- Qué hace:
--  1) «Crear cuenta»: la persona queda como 'pending' y NO ve nada hasta que un administrador la autorice en Permisos.
--  2) 5 contraseñas incorrectas seguidas bloquean la cuenta; solo un administrador la desbloquea en Permisos.
--     (Un administrador bloqueado se libera solo a los 15 minutos, para que nadie pueda dejar sin acceso al único admin.)
--  3) El bloqueo y la espera se aplican en la base de datos: una cuenta pendiente o bloqueada no puede leer ni escribir datos.

-- 1) Nuevo estado 'pending' y columnas de control
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin','editor','viewer','pending'));
alter table profiles
  add column if not exists fails        int         not null default 0,
  add column if not exists locked       boolean     not null default false,
  add column if not exists locked_at    timestamptz,
  add column if not exists requested_at timestamptz not null default now();
-- (estas columnas NO se agregan a los permisos de actualización: nadie puede desbloquearse a sí mismo)

-- 2) my_role(): pendiente o bloqueado = sin rol = sin acceso a los datos (las políticas RLS ya usan esta función)
create or replace function public.my_role() returns text
language sql security definer stable set search_path = public as $$
  select role from profiles
   where email = lower(auth.jwt() ->> 'email')
     and role <> 'pending'
     and not (locked and (role <> 'admin' or locked_at > now() - interval '15 minutes'))
$$;

-- 3) Solicitud de acceso: la llama la propia persona al ingresar sin tener perfil
create or replace function public.request_access() returns text
language plpgsql security definer set search_path = public as $$
declare em text := lower(auth.jwt() ->> 'email');
begin
  if em is null then raise exception 'Sin sesión'; end if;
  insert into profiles (email, role) values (em, 'pending') on conflict (email) do nothing;
  return (select role from profiles where email = em);
end $$;

-- 4) Antes de ingresar: ¿la cuenta está bloqueada?  (se llama sin sesión)
create or replace function public.login_precheck(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare p profiles%rowtype;
begin
  select * into p from profiles where email = lower(trim(p_email));
  if not found then return 'ok'; end if;
  if p.locked and p.role = 'admin' and p.locked_at <= now() - interval '15 minutes' then
    update profiles set locked = false, fails = 0, locked_at = null where email = p.email;
    return 'ok';
  end if;
  return case when p.locked then 'locked' else 'ok' end;
end $$;

-- 5) Contraseña incorrecta: suma un intento y bloquea al quinto  (se llama sin sesión)
create or replace function public.login_failed(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles%rowtype; n int;
begin
  select * into p from profiles where email = lower(trim(p_email));
  if not found then return jsonb_build_object('known', false); end if;
  if p.locked then return jsonb_build_object('known', true, 'locked', true, 'remaining', 0); end if;
  n := p.fails + 1;
  update profiles set fails = n, locked = (n >= 5), locked_at = case when n >= 5 then now() end where email = p.email;
  return jsonb_build_object('known', true, 'locked', n >= 5, 'remaining', greatest(5 - n, 0));
end $$;

-- 6) Ingreso correcto: vuelve el contador a cero
create or replace function public.login_ok() returns void
language sql security definer set search_path = public as $$
  update profiles set fails = 0 where email = lower(auth.jwt() ->> 'email') and not locked
$$;

-- 7) Solo un administrador desbloquea
create or replace function public.admin_unlock(p_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo un administrador puede desbloquear'; end if;
  update profiles set locked = false, fails = 0, locked_at = null where email = lower(trim(p_email));
end $$;

-- 8) Permisos de ejecución: cada función solo para quien corresponde
revoke execute on function public.request_access()        from public, anon, authenticated;
revoke execute on function public.login_precheck(text)    from public, anon, authenticated;
revoke execute on function public.login_failed(text)      from public, anon, authenticated;
revoke execute on function public.login_ok()              from public, anon, authenticated;
revoke execute on function public.admin_unlock(text)      from public, anon, authenticated;
grant  execute on function public.login_precheck(text), public.login_failed(text) to anon, authenticated;
grant  execute on function public.request_access(), public.login_ok(), public.admin_unlock(text) to authenticated;

-- Para desbloquear a mano si hiciera falta:  update profiles set locked = false, fails = 0, locked_at = null where email = 'correo@empresa.com';
