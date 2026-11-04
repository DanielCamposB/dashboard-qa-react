-- Seguridad: URLs de webhook solo para administradores + copias de seguridad automáticas.
-- Ejecutar en Supabase → SQL Editor → New query → Run  (después de supabase-acceso.sql). Luego vuelve a ejecutar supabase-avisos.sql, que ahora lee las URLs de aquí.
-- Se puede ejecutar más de una vez.
--
-- 1) Las URLs de los webhooks de Teams dejan de guardarse en los datos compartidos (que leen todos los usuarios).
--    Pasan a la tabla notify_secrets, que solo un administrador puede leer o escribir.
--    Los editores siguen enviando avisos desde el sitio, pero es el servidor quien usa la URL (qa_post): nunca la ven.
-- 2) Copia automática de los datos cada 6 horas (solo si cambiaron), 45 días de historial, y restauración por un administrador.

-- ---------- URLs de webhook ----------
create or replace function public.qa_ok_url(u text) returns boolean language sql immutable as $$
  select coalesce(u ~* '^https://([a-z0-9-]+\.)*(webhook\.office\.com|office\.com|logic\.azure\.com|powerplatform\.com|powerautomate\.com|microsoft\.com|office365\.com)(:443)?/', false)
$$;

create table if not exists public.notify_secrets (
  key        text primary key,                       -- 'user' (mensajes personales) o 'client:<id del cliente>'
  value      text not null check (public.qa_ok_url(value)),
  updated_at timestamptz not null default now()
);
alter table public.notify_secrets enable row level security;
grant select, insert, update, delete on public.notify_secrets to authenticated;
drop policy if exists "admin lee secretos"   on public.notify_secrets;
drop policy if exists "admin crea secretos"  on public.notify_secrets;
drop policy if exists "admin edita secretos" on public.notify_secrets;
drop policy if exists "admin borra secretos" on public.notify_secrets;
create policy "admin lee secretos"   on public.notify_secrets for select to authenticated using (public.my_role() = 'admin');
create policy "admin crea secretos"  on public.notify_secrets for insert to authenticated with check (public.my_role() = 'admin');
create policy "admin edita secretos" on public.notify_secrets for update to authenticated using (public.my_role() = 'admin') with check (public.my_role() = 'admin');
create policy "admin borra secretos" on public.notify_secrets for delete to authenticated using (public.my_role() = 'admin');

-- Migración: pasa a notify_secrets las URLs que hoy están dentro de los datos compartidos y las borra de ahí
-- (deja solo un indicador «hasUrl» para que el sitio sepa que hay una URL guardada).
do $$
declare st jsonb; c jsonb; c2 jsonb; u text; newc jsonb := '[]'::jsonb; has boolean;
begin
  select data into st from public.app_state where id = 1;
  if st is null then return; end if;
  for c in select value from jsonb_array_elements(coalesce(st->'clients', '[]'::jsonb)) loop
    u := nullif(trim(coalesce(c->'teams'->>'webhook', '')), '');
    if u is not null and public.qa_ok_url(u) then
      insert into public.notify_secrets (key, value) values ('client:' || (c->>'id'), u)
        on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
    has := exists (select 1 from public.notify_secrets where key = 'client:' || (c->>'id'));
    c2 := jsonb_set(c, '{teams}', coalesce(c->'teams', '{}'::jsonb) || jsonb_build_object('webhook', '', 'hasUrl', has));
    newc := newc || jsonb_build_array(c2);
  end loop;
  u := nullif(trim(coalesce(st->'notify'->>'userWebhook', '')), '');
  if u is not null and public.qa_ok_url(u) then
    insert into public.notify_secrets (key, value) values ('user', u) on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  st := jsonb_set(st, '{clients}', newc);
  st := jsonb_set(st, '{notify}', coalesce(st->'notify', '{}'::jsonb) || jsonb_build_object('userWebhook', '', 'hasUserUrl', exists (select 1 from public.notify_secrets where key = 'user')));
  update public.app_state set data = st, version = version + 1 where id = 1;
end $$;

-- Publicar en Teams desde el sitio sin exponer la URL: la usa el servidor. Solo editores y administradores.
create or replace function public.qa_post(p_target text, p_title text, p_facts jsonb, p_lines text, p_to text default null, p_name text default null)
returns void language plpgsql security definer set search_path = public, extensions, net as $$
declare v_url text; v_site text;
begin
  if coalesce(public.my_role(), '') not in ('editor', 'admin') then raise exception 'Solo editores o administradores pueden enviar avisos'; end if;
  if p_target = 'user' or p_target like 'client:%' then
    select value into v_url from public.notify_secrets where key = p_target;
  else raise exception 'Destino inválido'; end if;
  if v_url is null or not public.qa_ok_url(v_url) then raise exception 'URL no configurada: pide a un administrador que la guarde'; end if;
  if p_to is not null and p_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo de destino inválido'; end if;
  select nullif(data->'notify'->>'siteUrl', '') into v_site from public.app_state where id = 1;
  perform net.http_post(url := v_url, body := public.qa_avisos_card(left(coalesce(p_title, ''), 200), coalesce(p_facts, '[]'::jsonb),
          left(coalesce(p_lines, ''), 12000), v_site, p_to, nullif(regexp_replace(left(coalesce(p_name, ''), 80), '[<>&]', '', 'g'), '')));
end $$;
revoke execute on function public.qa_post(text, text, jsonb, text, text, text) from public, anon, authenticated;
grant  execute on function public.qa_post(text, text, jsonb, text, text, text) to authenticated;

-- ---------- Copias de seguridad ----------
create table if not exists public.app_state_backups (
  id       bigserial primary key,
  taken_at timestamptz not null default now(),
  kind     text not null default 'auto',          -- auto | manual | pre-restauracion | inicial
  version  int,
  data     jsonb not null
);
alter table public.app_state_backups enable row level security;   -- sin políticas: solo se accede con las funciones de abajo

create or replace function public.qa_backup(p_kind text default 'auto') returns bigint
language plpgsql security definer set search_path = public as $$
declare d jsonb; v int; last_d jsonb; new_id bigint;
begin
  select data, version into d, v from public.app_state where id = 1;
  if d is null then return null; end if;
  select data into last_d from public.app_state_backups order by id desc limit 1;
  if p_kind = 'auto' and last_d is not distinct from d then return null; end if;            -- sin cambios desde la última copia
  insert into public.app_state_backups (kind, version, data) values (p_kind, v, d) returning id into new_id;
  delete from public.app_state_backups
   where taken_at < now() - interval '45 days' and id not in (select id from public.app_state_backups order by id desc limit 20);
  return new_id;
end $$;

create or replace function public.qa_backup_now() returns bigint language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo un administrador puede crear copias'; end if;
  return public.qa_backup('manual');
end $$;

create or replace function public.qa_backups_list()
returns table(id bigint, taken_at timestamptz, kind text, version int, nreqs int, nclients int, kb int)
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo un administrador puede ver las copias'; end if;
  return query select b.id, b.taken_at, b.kind, b.version, jsonb_array_length(coalesce(b.data->'reqs', '[]'::jsonb)),
                      jsonb_array_length(coalesce(b.data->'clients', '[]'::jsonb)), (pg_column_size(b.data) / 1024)::int
                 from public.app_state_backups b order by b.id desc limit 40;
end $$;

create or replace function public.qa_restore_backup(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if coalesce(public.my_role(), '') <> 'admin' then raise exception 'Solo un administrador puede restaurar'; end if;
  select data into d from public.app_state_backups where id = p_id;
  if d is null then raise exception 'La copia no existe'; end if;
  perform public.qa_backup('pre-restauracion');                       -- antes de pisar nada, guarda el estado actual
  update public.app_state set data = d, version = version + 1 where id = 1;
end $$;

revoke execute on function public.qa_backup(text)            from public, anon, authenticated;
revoke execute on function public.qa_backup_now()            from public, anon, authenticated;
revoke execute on function public.qa_backups_list()          from public, anon, authenticated;
revoke execute on function public.qa_restore_backup(bigint)  from public, anon, authenticated;
grant  execute on function public.qa_backup_now(), public.qa_backups_list(), public.qa_restore_backup(bigint) to authenticated;

-- Primera copia ahora, y una cada 6 horas (solo si hubo cambios)
select public.qa_backup('inicial');
do $$ begin perform cron.unschedule('qa-backup'); exception when others then null; end $$;
select cron.schedule('qa-backup', '0 */6 * * *', $$select public.qa_backup('auto');$$);

-- Restaurar a mano si hiciera falta:  select public.qa_restore_backup(<id>);   (ver ids: select id, taken_at, kind from app_state_backups order by id desc;)
