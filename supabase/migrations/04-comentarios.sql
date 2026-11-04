-- Comentarios para usuarios de solo lectura.
-- Ejecutar una vez en Supabase → SQL Editor. Permite que cualquier usuario autorizado (lector, editor o administrador)
-- agregue comentarios a un requerimiento SIN poder modificar nada más. El nombre de usuario y el correo los fija el servidor.
create or replace function public.qa_comment(p_req text, p_id text, p_by text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare st jsonb; idx int; v_text text := trim(coalesce(p_text, '')); v_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if coalesce(public.my_role(), '') not in ('viewer', 'editor', 'admin') then raise exception 'No tienes permiso para comentar'; end if;
  if v_text = '' or length(v_text) > 5000 then raise exception 'El comentario debe tener entre 1 y 5000 caracteres'; end if;
  select data into st from public.app_state where id = 1 for update;
  select (t.ord - 1)::int into idx from jsonb_array_elements(st->'reqs') with ordinality as t(v, ord) where t.v->>'id' = p_req;
  if idx is null then raise exception 'Requerimiento no encontrado'; end if;
  st := jsonb_set(st, array['reqs', idx::text, 'comments'],
        coalesce(st->'reqs'->idx->'comments', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', left(coalesce(nullif(p_id, ''), md5(random()::text)), 40), 'at', v_at,
          'by', left(coalesce(nullif(trim(p_by), ''), 'Anónimo'), 80), 'byEmail', lower(coalesce(auth.jwt()->>'email', '')), 'text', v_text)));
  st := jsonb_set(st, array['reqs', idx::text, 'lastUpdate'], to_jsonb(v_at));
  update public.app_state set data = st, version = version + 1 where id = 1;
end $$;
revoke all on function public.qa_comment(text, text, text, text) from public, anon;
grant execute on function public.qa_comment(text, text, text, text) to authenticated;

-- Editar un comentario PROPIO (lectores incluidos). Solo el autor (por correo de la sesión); guarda la versión anterior en el historial.
create or replace function public.qa_comment_edit(p_req text, p_id text, p_by text, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare st jsonb; ri int; ci int; c jsonb; v_text text := trim(coalesce(p_text, ''));
        v_at text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'); v_mail text := lower(coalesce(auth.jwt()->>'email', ''));
begin
  if coalesce(public.my_role(), '') not in ('viewer', 'editor', 'admin') then raise exception 'No tienes permiso para comentar'; end if;
  if v_text = '' or length(v_text) > 5000 then raise exception 'El comentario debe tener entre 1 y 5000 caracteres'; end if;
  select data into st from public.app_state where id = 1 for update;
  select (t.ord - 1)::int into ri from jsonb_array_elements(st->'reqs') with ordinality as t(v, ord) where t.v->>'id' = p_req;
  if ri is null then raise exception 'Requerimiento no encontrado'; end if;
  select (t.ord - 1)::int, t.v into ci, c from jsonb_array_elements(st->'reqs'->ri->'comments') with ordinality as t(v, ord) where t.v->>'id' = p_id;
  if ci is null then raise exception 'Comentario no encontrado'; end if;
  if v_mail = '' or lower(coalesce(c->>'byEmail', '')) <> v_mail then raise exception 'Solo puedes editar tus propios comentarios'; end if;
  c := jsonb_set(c, '{edits}', coalesce(c->'edits', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('text', c->>'text', 'at', v_at, 'by', left(coalesce(nullif(trim(p_by), ''), 'Anónimo'), 80))));
  c := jsonb_set(jsonb_set(c, '{text}', to_jsonb(v_text)), '{editedAt}', to_jsonb(v_at));
  st := jsonb_set(st, array['reqs', ri::text, 'comments', ci::text], c);
  st := jsonb_set(st, array['reqs', ri::text, 'lastUpdate'], to_jsonb(v_at));
  update public.app_state set data = st, version = version + 1 where id = 1;
end $$;
revoke all on function public.qa_comment_edit(text, text, text, text) from public, anon;
grant execute on function public.qa_comment_edit(text, text, text, text) to authenticated;
