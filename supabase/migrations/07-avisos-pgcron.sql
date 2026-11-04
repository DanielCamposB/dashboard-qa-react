-- Avisos automáticos a Teams (9:00, 12:00, 15:00, 18:00 u otros horarios) desde Supabase.
-- Se ejecuta en Supabase → SQL Editor → New query → Run, DESPUÉS de supabase-acceso.sql y supabase-seguridad.sql (las URLs viven en notify_secrets). Se puede repetir.
-- Los horarios y los días se editan en la pestaña «Avisos» del sitio; las URLs de Teams solo las guarda un administrador (no hay que volver aquí).
--
-- Cómo funciona: cada 5 minutos pg_cron llama a qa_avisos(). La función lee los datos del dashboard
-- (app_state), mira la hora de Chile, y si toca un horario configurado publica en Teams con pg_net:
--   · un resumen al canal de cada cliente que tenga Teams activo, y
--   · (opcional) un mensaje personal a cada responsable con sus actividades atrasadas, bloqueadas, por vencer y pendientes.
-- Solo envía a direcciones de Microsoft (Teams / Power Automate). Un horario se envía una sola vez por día.
-- Ojo: usa los datos tal como están en el dashboard; Planner se actualiza cuando alguien pulsa «Sincronizar».

create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.avisos_log (
  slot    text primary key,                 -- «2026-10-28 09:00»
  sent_at timestamptz not null default now()
);
alter table public.avisos_log enable row level security;   -- sin políticas: nadie la lee por la API

-- Detecta qué requerimientos activos de un cliente tienen algo que avisar.
create or replace function public.qa_avisos_issues(st jsonb, cid text, today date)
returns table(code text, title text, late_d int, blocked boolean, block_txt text, stale_d int, dov_txt text, emails text[])
language sql stable as $$
  select
    r->>'code', r->>'title',
    greatest(
      today - coalesce(nullif((select max(a->>'end') from jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a), ''), r->>'end')::date,
      coalesce((select max(today - (a->>'end')::date) from jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a
                where coalesce((a->>'percent')::numeric, 0) < 100), -9999)
    )::int,
    (coalesce(r->>'status','') = 'Bloqueado' or exists (select 1 from jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a where coalesce((a->>'blocked')::boolean, false))),
    (select string_agg(coalesce(nullif(a->>'blockReason',''), a->>'name'), '; ') from jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a where coalesce((a->>'blocked')::boolean, false)),
    (select count(*)::int from generate_series(coalesce(nullif(left(r->>'lastUpdate',10),'')::date, today) + 1, today, interval '1 day') g where extract(isodow from g) < 6),
    (select string_agg(d->>'name', ', ') from jsonb_array_elements(coalesce(r->'deliverables','[]'::jsonb)) d
       where d->>'state' = 'pendiente' and coalesce(d->>'due','') <> '' and (d->>'due')::date < today),
    array(select distinct lower(m->>'email') from jsonb_array_elements(coalesce(st->'members','[]'::jsonb)) m
          where coalesce(m->>'email','') <> '' and (m->>'id') in (
            select jsonb_array_elements_text(case when jsonb_array_length(coalesce(r->'assigneeIds','[]'::jsonb)) > 0 then r->'assigneeIds'
                                                  when coalesce(r->>'assigneeId','') <> '' then jsonb_build_array(r->>'assigneeId') else '[]'::jsonb end)
            union
            select jsonb_array_elements_text(case when jsonb_array_length(coalesce(a->'assigneeIds','[]'::jsonb)) > 0 then a->'assigneeIds'
                                                  when coalesce(a->>'assigneeId','') <> '' then jsonb_build_array(a->>'assigneeId') else '[]'::jsonb end)
              from jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a where coalesce((a->>'percent')::numeric, 0) < 100))
  from jsonb_array_elements(coalesce(st->'reqs','[]'::jsonb)) r
  where r->>'clientId' = cid and coalesce(r->>'status','') <> 'Completado'
$$;

-- Actividades abiertas por persona (responsable de la actividad; si no tiene, el del requerimiento).
create or replace function public.qa_avisos_acts(st jsonb, cid text, today date)
returns table(email text, pname text, code text, title text, act text, act_end date, blocked boolean, reason text)
language sql stable as $$
  select lower(m->>'email'), m->>'name', r->>'code', r->>'title', a->>'name', nullif(a->>'end','')::date,
         coalesce((a->>'blocked')::boolean, false), coalesce(nullif(a->>'blockReason',''), '')
  from jsonb_array_elements(coalesce(st->'reqs','[]'::jsonb)) r
  cross join lateral jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a
  cross join lateral jsonb_array_elements_text(
      case when jsonb_array_length(coalesce(a->'assigneeIds','[]'::jsonb)) > 0 then a->'assigneeIds'
           when coalesce(a->>'assigneeId','') <> '' then jsonb_build_array(a->>'assigneeId')
           when jsonb_array_length(coalesce(r->'assigneeIds','[]'::jsonb)) > 0 then r->'assigneeIds'
           when coalesce(r->>'assigneeId','') <> '' then jsonb_build_array(r->>'assigneeId') else '[]'::jsonb end) as x(v)
  join jsonb_array_elements(coalesce(st->'members','[]'::jsonb)) m on (m->>'id') = x.v and coalesce(m->>'email','') <> ''
  where r->>'clientId' = cid and coalesce(r->>'status','') <> 'Completado' and coalesce((a->>'percent')::numeric, 0) < 100
$$;

-- Actividades abiertas por persona, con o sin correo (para el reporte de carga por responsable del canal).
create or replace function public.qa_avisos_load(st jsonb, cid text, today date)
returns table(pname text, code text, title text, act text, act_end date, blocked boolean)
language sql stable as $$
  select m->>'name', r->>'code', r->>'title', a->>'name', nullif(a->>'end','')::date, coalesce((a->>'blocked')::boolean, false)
  from jsonb_array_elements(coalesce(st->'reqs','[]'::jsonb)) r
  cross join lateral jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a
  cross join lateral jsonb_array_elements_text(
      case when jsonb_array_length(coalesce(a->'assigneeIds','[]'::jsonb)) > 0 then a->'assigneeIds'
           when coalesce(a->>'assigneeId','') <> '' then jsonb_build_array(a->>'assigneeId')
           when jsonb_array_length(coalesce(r->'assigneeIds','[]'::jsonb)) > 0 then r->'assigneeIds'
           when coalesce(r->>'assigneeId','') <> '' then jsonb_build_array(r->>'assigneeId') else '[]'::jsonb end) as x(v)
  join jsonb_array_elements(coalesce(st->'members','[]'::jsonb)) m on (m->>'id') = x.v
  where r->>'clientId' = cid and coalesce(r->>'status','') <> 'Completado' and coalesce((a->>'percent')::numeric, 0) < 100
$$;

-- Bloques opcionales del resumen del canal: todos los requerimientos en curso y/o la carga de cada responsable.
create or replace function public.qa_avisos_report(st jsonb, cid text, today date, p_all boolean, p_owner boolean)
returns text language plpgsql stable as $$
declare v_all text; v_own text; v_n int; v_out text := '';
begin
  if p_all then
    select count(*) into v_n from jsonb_array_elements(coalesce(st->'reqs','[]'::jsonb)) r where r->>'clientId' = cid and coalesce(r->>'status','') <> 'Completado';
    select string_agg('• **' || (z.r->>'code') || '** ' || (z.r->>'title') || ' — ' || coalesce(nullif(z.r->>'status',''), 'Pendiente') || ' · ' || z.pct || '%'
                      || coalesce(' · fin ' || to_char(z.e, 'DD-MM'), '') || coalesce(' · ' || z.who, ''), E'\n\n' order by z.e nulls last)
      into v_all
      from (select r, nullif(r->>'end','')::date as e,
                   (select coalesce(round(avg(coalesce((a->>'percent')::numeric, 0))), 0)::int from jsonb_array_elements(coalesce(r->'acts','[]'::jsonb)) a) as pct,
                   (select string_agg(m->>'name', ', ') from jsonb_array_elements(coalesce(st->'members','[]'::jsonb)) m
                     where (m->>'id') in (select jsonb_array_elements_text(case when jsonb_array_length(coalesce(r->'assigneeIds','[]'::jsonb)) > 0 then r->'assigneeIds'
                                                                                 when coalesce(r->>'assigneeId','') <> '' then jsonb_build_array(r->>'assigneeId') else '[]'::jsonb end))) as who
              from jsonb_array_elements(coalesce(st->'reqs','[]'::jsonb)) r
             where r->>'clientId' = cid and coalesce(r->>'status','') <> 'Completado'
             order by nullif(r->>'end','')::date nulls last limit 25) z;
    if v_all is not null then
      v_out := '**Todos los requerimientos en curso (' || v_n || ')**' || E'\n\n' || v_all || case when v_n > 25 then E'\n\n… y ' || (v_n - 25) || ' más en el dashboard' else '' end;
    end if;
  end if;
  if p_owner then
    select string_agg('**' || g.pname || '** — ' || g.n || ' actividad(es)' || case when g.nl > 0 then ' · ' || g.nl || ' atrasada(s)' else '' end
                      || case when g.nb > 0 then ' · ' || g.nb || ' bloqueada(s)' else '' end || E'\n\n' || g.lst
                      || case when g.n > 6 then E'\n\n  … y ' || (g.n - 6) || ' más' else '' end, E'\n\n' order by g.nl desc, g.nb desc, g.n desc)
      into v_own
      from (select w.pname, count(*) as n, count(*) filter (where w.blocked) as nb, count(*) filter (where not w.blocked and w.act_end < today) as nl,
                   string_agg('  · ' || w.code || ' ' || w.act || ' — ' || case when w.blocked then '🚧 bloqueada' when w.act_end < today then '🔴 atrasada ' || (today - w.act_end) || ' día(s)'
                                                                          when w.act_end <= today + 3 then '🟡 vence ' || to_char(w.act_end, 'DD-MM')
                                                                          else '🔵 termina ' || coalesce(to_char(w.act_end, 'DD-MM'), 's/f') end, E'\n\n' order by w.sev, w.act_end) filter (where w.rn <= 6) as lst
              from (select q.*, row_number() over (partition by q.pname order by q.sev, q.act_end) as rn
                      from (select l.*, case when l.blocked then 0 when l.act_end < today then 1 when l.act_end <= today + 3 then 2 else 3 end as sev
                              from public.qa_avisos_load(st, cid, today) l) q) w
             group by w.pname) g;
    if v_own is not null then
      v_out := concat_ws(E'\n\n', nullif(v_out, ''), '**Carga por responsable**' || E'\n\n' || left(v_own, 9000));
    end if;
  end if;
  return v_out;
end $$;

-- Arma la tarjeta (Adaptive Card) igual que la del sitio. p_to = correo del destinatario (mensajes personales);
-- p_name = nombre para el saludo con @mención real de Teams (se identifica a la persona por su correo).
drop function if exists public.qa_avisos_card(text, jsonb, text, text, text);
create or replace function public.qa_avisos_card(p_title text, p_facts jsonb, p_lines text, p_url text, p_to text default null, p_name text default null)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'type', 'message', 'to', p_to,
    'attachments', jsonb_build_array(jsonb_build_object(
      'contentType', 'application/vnd.microsoft.card.adaptive', 'contentUrl', null,
      'content', jsonb_build_object(
        '$schema', 'http://adaptivecards.io/schemas/adaptive-card.json', 'type', 'AdaptiveCard', 'version', '1.4',
        'body', jsonb_build_array(jsonb_build_object('type','TextBlock','text',p_title,'weight','Bolder','size','Medium','wrap',true))
                || case when p_name is not null then jsonb_build_array(jsonb_build_object('type','TextBlock','text','Hola <at>' || p_name || '</at>, estas son tus actividades pendientes:','wrap',true)) else '[]'::jsonb end
                || jsonb_build_array(jsonb_build_object('type','FactSet','facts',p_facts), jsonb_build_object('type','TextBlock','text',p_lines,'wrap',true)),
        'actions', case when coalesce(p_url,'') <> '' then jsonb_build_array(jsonb_build_object('type','Action.OpenUrl','title','Abrir dashboard','url',p_url)) else null end)
        || case when p_name is not null and p_to is not null
                then jsonb_build_object('msteams', jsonb_build_object('entities', jsonb_build_array(jsonb_build_object('type','mention','text','<at>' || p_name || '</at>','mentioned',jsonb_build_object('id',p_to,'name',p_name)))))
                else '{}'::jsonb end)))
  )
$$;

create or replace function public.qa_avisos(p_force boolean default false)
returns text language plpgsql security definer set search_path = public, extensions, net as $$
declare
  st jsonb; nt jsonb; c jsonb; ev jsonb;
  nowl timestamp := now() at time zone 'America/Santiago';
  today date := (now() at time zone 'America/Santiago')::date;
  dow int := extract(isodow from (now() at time zone 'America/Santiago'))::int;
  nm int; tm int; t text; v_slot text;
  v_site text; v_userhook text; v_hook text; v_cname text; v_sync text;
  n_all int; n_late int; n_blk int; n_stale int; n_dov int;
  s_late text; s_blk text; s_stale text; s_dov text; v_lines text; v_rep text;
  v_em text; v_name text; v_own text; v_sent int := 0;
begin
  select data into st from public.app_state where id = 1;
  if st is null then return 'sin datos'; end if;
  nt := coalesce(st->'notify', '{}'::jsonb);
  nm := extract(hour from nowl)::int * 60 + extract(minute from nowl)::int;

  if not p_force and coalesce(nt->>'auto', 'true') = 'false' then return 'envío automático desactivado'; end if;   -- interruptor general de la pestaña Avisos
  if not p_force then
    if not coalesce(nt->'days', '[1,2,3,4,5]'::jsonb) @> to_jsonb(dow) then return 'día no programado'; end if;
    for t in select jsonb_array_elements_text(coalesce(nt->'times', '["09:00","12:00","15:00","18:00"]'::jsonb)) loop
      if t !~ '^\d{2}:\d{2}$' then continue; end if;
      tm := split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int;
      if nm >= tm and nm < tm + 15 then                         -- ventana de 15 min (el cron corre cada 5)
        insert into public.avisos_log(slot) values (today::text || ' ' || t) on conflict do nothing;
        if found then v_slot := t; exit; end if;                -- ya enviado hoy → no se repite
      end if;
    end loop;
    if v_slot is null then return 'fuera de horario'; end if;
  end if;

  v_site := nullif(nt->>'siteUrl', '');
  v_userhook := coalesce((select value from public.notify_secrets where key = 'user'), '');       -- las URLs viven en notify_secrets (solo administradores)

  for c in select value from jsonb_array_elements(coalesce(st->'clients', '[]'::jsonb)) loop
    ev := coalesce(c->'teams'->'events', '{}'::jsonb);
    v_cname := c->>'name';
    v_hook := coalesce((select value from public.notify_secrets where key = 'client:' || (c->>'id')), '');

    with i as materialized (select * from public.qa_avisos_issues(st, c->>'id', today))
    select count(*), count(*) filter (where late_d >= 1), count(*) filter (where blocked), count(*) filter (where stale_d >= 2), count(*) filter (where dov_txt is not null),
      (select string_agg('• **' || code || '** ' || title || ' — ' || late_d || ' día(s) de atraso', E'\n\n' order by late_d desc) from (select * from i where late_d >= 1 order by late_d desc limit 8) x),
      (select string_agg('• **' || code || '** ' || title || ' — ' || coalesce(block_txt, 'bloqueado'), E'\n\n') from (select * from i where blocked limit 8) x),
      (select string_agg('• **' || code || '** ' || title || ' — hace ' || stale_d || ' días hábiles', E'\n\n' order by stale_d desc) from (select * from i where stale_d >= 2 order by stale_d desc limit 8) x),
      (select string_agg('• **' || code || '** ' || title || ' — ' || dov_txt, E'\n\n') from (select * from i where dov_txt is not null limit 8) x)
    from i
    into n_all, n_late, n_blk, n_stale, n_dov, s_late, s_blk, s_stale, s_dov;

    v_rep := public.qa_avisos_report(st, c->>'id', today, coalesce(ev->>'all', 'false') = 'true', coalesce(ev->>'byOwner', 'false') = 'true');

    v_sync := (select to_char((nullif(c->'planner'->>'lastSync', '')::timestamptz) at time zone 'America/Santiago', 'DD-MM HH24:MI'));

    -- 1) resumen al canal del cliente
    if coalesce(ev->>'auto', 'true') <> 'false' and public.qa_ok_url(v_hook) and (p_force or (n_late + n_blk + n_stale + n_dov) > 0 or v_rep <> '' or coalesce((ev->>'quiet')::boolean, true) = false) then
      v_lines := concat_ws(E'\n\n',
        case when s_late  is not null then '**Atrasados**' || E'\n\n' || s_late end,
        case when s_blk   is not null then '**Bloqueados**' || E'\n\n' || s_blk end,
        case when s_stale is not null then '**Sin actualizar**' || E'\n\n' || s_stale end,
        case when s_dov   is not null then '**Entregables vencidos**' || E'\n\n' || s_dov end,
        nullif(v_rep, ''));
      perform net.http_post(url := v_hook, body := public.qa_avisos_card(
        'Resumen QA · ' || v_cname || ' · ' || to_char(today, 'DD-MM-YYYY') || coalesce(' · ' || v_slot, ''),
        jsonb_build_array(jsonb_build_object('title','En curso','value',n_all::text), jsonb_build_object('title','Atrasados','value',n_late::text),
                          jsonb_build_object('title','Bloqueados','value',n_blk::text), jsonb_build_object('title','Sin actualizar','value',n_stale::text),
                          jsonb_build_object('title','Entregables vencidos','value',n_dov::text))
          || case when v_sync is not null then jsonb_build_array(jsonb_build_object('title','Planner sincronizado','value',v_sync)) else '[]'::jsonb end,
        coalesce(nullif(v_lines, ''), 'Todo en orden ✅'), v_site));
      v_sent := v_sent + 1;
    end if;

    -- 2) mensaje personal a cada responsable con pendientes
    if coalesce((ev->>'owners')::boolean, false) and public.qa_ok_url(v_userhook) then
      for v_em in select distinct email from public.qa_avisos_acts(st, c->>'id', today) loop
        select count(*) filter (where blocked), count(*) filter (where not blocked and act_end < today),
               count(*) filter (where not blocked and act_end >= today and act_end <= today + 3), count(*) filter (where not blocked and (act_end is null or act_end > today + 3)),
               count(*)
          into n_blk, n_late, n_stale, n_dov, n_all
          from public.qa_avisos_acts(st, c->>'id', today) where email = v_em;
        select string_agg('• **' || code || '** ' || title || ' · ' || act || ' — ' ||
                 case when blocked then '🚧 bloqueada' || case when reason <> '' then ': ' || reason else '' end
                      when act_end < today then '🔴 atrasada ' || (today - act_end) || ' día(s)'
                      when act_end <= today + 3 then '🟡 vence ' || to_char(act_end, 'DD-MM')
                      else '🔵 pendiente, termina ' || coalesce(to_char(act_end, 'DD-MM'), 's/f') end, E'\n\n' order by sev, act_end)
          into v_own
          from (select *, case when blocked then 0 when act_end < today then 1 when act_end <= today + 3 then 2 else 3 end as sev
                  from public.qa_avisos_acts(st, c->>'id', today) where email = v_em
                 order by sev, act_end limit 15) z;
        if n_all > 15 then v_own := v_own || E'\n\n… y ' || (n_all - 15) || ' más en el dashboard'; end if;
        v_name := (select m->>'name' from jsonb_array_elements(coalesce(st->'members','[]'::jsonb)) m where lower(m->>'email') = v_em limit 1);
        perform net.http_post(url := v_userhook, body := public.qa_avisos_card(
          'Tus pendientes QA · ' || v_cname || ' · ' || to_char(today, 'DD-MM-YYYY'),
          jsonb_build_array(jsonb_build_object('title','Atrasadas','value',n_late::text), jsonb_build_object('title','Bloqueadas','value',n_blk::text), jsonb_build_object('title','Por vencer (≤3 días)','value',n_stale::text), jsonb_build_object('title','Pendientes','value',n_dov::text)), v_own, v_site, v_em, regexp_replace(coalesce(v_name, v_em), '[<>&]', '', 'g')));
        v_sent := v_sent + 1;
      end loop;
    end if;
  end loop;
  return 'enviados: ' || v_sent || coalesce(' (horario ' || v_slot || ')', ' (forzado)');
end $$;

-- Solo el cron (y tú desde el SQL Editor) pueden ejecutarla; ni anon ni usuarios del sitio.
revoke all on function public.qa_avisos(boolean) from public, anon, authenticated;
revoke all on function public.qa_avisos_issues(jsonb, text, date) from public, anon, authenticated;
revoke all on function public.qa_avisos_acts(jsonb, text, date) from public, anon, authenticated;
revoke all on function public.qa_avisos_load(jsonb, text, date) from public, anon, authenticated;
revoke all on function public.qa_avisos_report(jsonb, text, date, boolean, boolean) from public, anon, authenticated;

-- Programación: cada 5 minutos (la función decide si toca enviar según los horarios de la pestaña «Avisos»).
do $$ begin perform cron.unschedule('qa-avisos'); exception when others then null; end $$;
select cron.schedule('qa-avisos', '*/5 * * * *', $$select public.qa_avisos();$$);

-- Prueba inmediata (envía ahora, ignorando horario): descomenta y ejecuta.
-- select public.qa_avisos(true);
-- Ver cuándo se envió:  select * from public.avisos_log order by sent_at desc limit 20;
-- Ver respuestas de Teams:  select id, status_code, content from net._http_response order by created desc limit 10;
-- Apagar:  select cron.unschedule('qa-avisos');
