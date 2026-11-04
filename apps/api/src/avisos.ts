// Envío programado de avisos a Teams (equivale a `qa_avisos()` de supabase-avisos.sql, pero con la lógica compartida con la web).
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeCalc, normalizeStore, ownerDigests, summaryFor, hasIssues, isTeamsUrl, todayIn, type Store } from "@qa/core";
import { postToTeams, type PostResult } from "./teams";

export interface Clock {
  today: string; // aaaa-mm-dd en la zona de los avisos
  minutes: number; // minutos desde medianoche
  isoDow: number; // 1 = lunes … 7 = domingo
}

export function clockIn(tz: string, now: Date = new Date()): Clock {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now).map(x => [x.type, x.value])
  );
  const dow = ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[p.weekday] ?? 1;
  return { today: todayIn(tz, now), minutes: +p.hour * 60 + +p.minute, isoDow: dow };
}

/** ¿Toca enviar ahora? Devuelve el horario («09:00») o el motivo por el que no. */
export function dueSlot(notify: Store["notify"], c: Clock): { slot: string } | { skip: string } {
  if (notify.auto === false) return { skip: "envío automático desactivado" };
  if (!(notify.days || [1, 2, 3, 4, 5]).includes(c.isoDow)) return { skip: "día no programado" };
  for (const t of notify.times || []) {
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    const tm = +t.slice(0, 2) * 60 + +t.slice(3);
    if (c.minutes >= tm && c.minutes < tm + 15) return { slot: t }; // ventana de 15 min (el reloj corre cada minuto)
  }
  return { skip: "fuera de horario" };
}

export interface RunResult {
  summary: string;
  sent: number;
  failed: string[];
}

export async function runAvisos(sb: SupabaseClient, opts: { force?: boolean; tz: string; now?: Date; post?: typeof postToTeams }): Promise<RunResult> {
  const post = opts.post ?? postToTeams;
  const { data: row, error } = await sb.from("app_state").select("data").eq("id", 1).single();
  if (error || !row?.data) return { summary: "sin datos", sent: 0, failed: [] };
  const store = normalizeStore(row.data);
  const clock = clockIn(opts.tz, opts.now);
  let slot: string | undefined;
  if (!opts.force) {
    const due = dueSlot(store.notify, clock);
    if ("skip" in due) return { summary: due.skip, sent: 0, failed: [] };
    // Un horario se envía una sola vez por día (compartido con pg_cron mediante la tabla avisos_log).
    const key = `${clock.today} ${due.slot}`;
    const { data: ins } = await sb.from("avisos_log").upsert({ slot: key }, { onConflict: "slot", ignoreDuplicates: true }).select();
    if (!ins?.length) return { summary: "ya enviado", sent: 0, failed: [] };
    slot = due.slot;
  }
  const { data: sec } = await sb.from("notify_secrets").select("key,value");
  const secrets = Object.fromEntries((sec || []).map(s => [s.key as string, s.value as string]));
  const calc = makeCalc(store, clock.today);
  const siteUrl = store.notify.siteUrl || undefined;
  const failed: string[] = [];
  let sent = 0;
  const track = (label: string, r: PostResult) => {
    if (r.ok) sent++;
    else failed.push(`${label}: ${r.error}`);
  };

  for (const c of store.clients) {
    const ev = c.teams?.events || {};
    const hook = secrets["client:" + c.id] || "";
    // 1) resumen al canal del cliente
    if (ev.auto !== false && isTeamsUrl(hook)) {
      const m = summaryFor(store, c, calc);
      const extra = !!(ev.all || ev.byOwner);
      if (opts.force || hasIssues(m) || extra || ev.quiet === false) {
        const sync = c.planner?.lastSync ? new Date(c.planner.lastSync).toLocaleString("es-CL", { timeZone: opts.tz, dateStyle: "short", timeStyle: "short" }) : "";
        track(c.name, await post({ url: hook, title: m.title + (slot ? ` · ${slot}` : ""), facts: [...m.facts, ...(sync ? [["Planner sincronizado", sync] as [string, string]] : [])], lines: m.lines, siteUrl }));
      }
    }
    // 2) mensaje personal a cada responsable con pendientes
    if (ev.owners && isTeamsUrl(secrets.user || "")) {
      for (const d of ownerDigests(store, c, calc)) {
        track(`${c.name} → ${d.email}`, await post({ url: secrets.user, title: d.title, facts: d.facts, lines: d.lines, siteUrl, to: d.email, name: d.name }));
      }
    }
  }
  return { summary: `enviados: ${sent}` + (slot ? ` (horario ${slot})` : " (forzado)") + (failed.length ? ` · fallaron ${failed.length}` : ""), sent, failed };
}
