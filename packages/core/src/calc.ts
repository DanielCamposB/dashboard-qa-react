// Cálculos del dashboard (avance, atrasos, semáforo, alertas…). Funciones puras sobre un `Store` y una fecha de «hoy».
import { bizDaysSince, d2n, lvl, lvlTxt, localDate } from "./dates";
import type { Activity, Deliverable, Member, Requirement, Store, TemplateAct } from "./types";

export const STALE = 2; // días hábiles sin actualizar para alertar
export const HH_DAY = 8; // 8 HH = 1 día
export const BASE_TYPES: Record<string, string> = { trad: "Tradicional", express: "Express" };
export const PRIOS = ["Urgente", "Importante", "Media", "Baja"] as const;
export type Health = { lvl: "g" | "y" | "r" | "d"; why: string[] };
export type AlertItem = { r: Requirement; d: number; what: string };

type WithIds = { assigneeId?: string; assigneeIds?: string[] };

export const tplDays = (t: TemplateAct): number => (t.unit === "hh" ? Math.max(1, Math.ceil((+t.days || 1) / HH_DAY)) : Math.max(1, +t.days || 1));

export const pct = (n: unknown, d: number): number | null => (d > 0 ? Math.round(((+(n as number) || 0) / d) * 100) : null);

/** Reparte `T` días entre actividades en proporción a sus duraciones base. */
export function scaleActs(days: number[], T: number): number[] {
  const tot = days.reduce((x, y) => x + y, 0);
  const ds = days.map(d => Math.max(1, Math.round((d * T) / tot)));
  let diff = T - ds.reduce((x, y) => x + y, 0);
  if (diff > 0) ds[ds.length - 1] += diff;
  // Si el redondeo se pasó, se quita de la actividad más larga (nunca menos de 1 día) para que el total calce con el plazo.
  while (diff < 0) {
    let k = 0;
    for (let i = 1; i < ds.length; i++) if (ds[i] > ds[k]) k = i;
    if (ds[k] <= 1) break; // hay más actividades que días: no se puede acortar más
    ds[k]--;
    diff++;
  }
  return ds;
}

export function makeCalc(store: Store, today: string, now: Date = new Date()) {
  const memberById = new Map(store.members.map(m => [m.id, m] as const));
  const leaderById = new Map(store.leaders.map(l => [l.id, l] as const));

  const clientName = (id: string) => store.clients.find(c => c.id === id)?.name || "—";
  const mname = (id: string) => memberById.get(id)?.name || "—";
  const memberRoles = (id: string): string[] => memberById.get(id)?.roles || [];

  // Responsables: lista (assigneeIds); assigneeId se mantiene como el primero por compatibilidad con datos antiguos
  const ids = (x?: WithIds | null): string[] => (x?.assigneeIds?.length ? x.assigneeIds : x?.assigneeId ? [x.assigneeId] : []).filter(i => memberById.has(i));
  const effIds = (a: WithIds, r: WithIds): string[] => (ids(a).length ? ids(a) : ids(r));
  const mnames = (x: WithIds, fb?: WithIds): string => {
    const l = fb ? effIds(x, fb) : ids(x);
    return l.length ? l.map(mname).join(", ") : "—";
  };
  const rolesOf = (x: WithIds): string[] => [...new Set(ids(x).flatMap(memberRoles))];
  const leaderIds = (r: Requirement): string[] => (r.leaderIds || []).filter(i => leaderById.has(i));
  const lnames = (r: Requirement): string => leaderIds(r).map(i => leaderById.get(i)!.name).join(", ");

  // Tipos de requerimiento = plantillas de actividades: "trad", "express" y las personalizadas
  const typeName = (t: string) => BASE_TYPES[t] || store.customTpl.find(c => c.id === t)?.name || "Tipo eliminado";
  const tplFor = (t: string): TemplateAct[] => (t === "trad" || t === "express" ? store.templates[t] : store.customTpl.find(c => c.id === t)?.acts) || store.templates.trad;

  const span = (r: Pick<Requirement, "acts" | "start" | "end">): [string, string] =>
    r.acts.length ? [r.acts.map(a => a.start).sort()[0], r.acts.map(a => a.end).sort().pop()!] : [r.start, r.end];

  const progress = (r: Pick<Requirement, "acts" | "percent">): number => {
    if (!r.acts.length) return +r.percent || 0;
    const w = r.acts.map(a => d2n(a.end) - d2n(a.start) + 1), tot = w.reduce((s, x) => s + x, 0);
    return Math.round(r.acts.reduce((s, a, i) => s + a.percent * w[i], 0) / tot);
  };

  const daysLate = (end: string) => d2n(today) - d2n(end);
  const late = (r: Requirement) => r.status !== "Completado" && span(r)[1] < today;
  const lastComment = (r: Requirement) => (r.comments.length ? r.comments.reduce((m, c) => (c.at > m.at ? c : m)) : null);
  const staleDays = (r: Requirement) => (r.status === "Completado" ? 0 : bizDaysSince(localDate(r.lastUpdate, now) || today, today));
  const slip = (r: Requirement) => (r.committedEnd && span(r)[1] > r.committedEnd ? d2n(span(r)[1]) - d2n(r.committedEnd) : 0);
  const delOverdue = (r: Pick<Requirement, "deliverables">): Deliverable[] => r.deliverables.filter(d => d.state === "pendiente" && d.due && d.due < today);
  const delDone = (r: Requirement) => r.deliverables.filter(d => d.state !== "pendiente").length;
  const openDef = (r: Requirement) => (["crit", "high", "med", "low"] as const).reduce((s, k) => s + (+(r.metrics?.[k] as number) || 0), 0);

  function alertsList(list: Requirement[]): AlertItem[] {
    const out: AlertItem[] = [];
    for (const r of list) {
      if (r.status === "Completado") continue;
      let worst = { d: daysLate(span(r)[1]), what: "Requerimiento" };
      for (const a of r.acts) if (a.percent < 100 && daysLate(a.end) > worst.d) worst = { d: daysLate(a.end), what: "Actividad: " + a.name };
      if (worst.d >= 1) out.push({ r, ...worst });
    }
    return out.sort((a, b) => b.d - a.d);
  }
  const staleList = (list: Requirement[]) => list.filter(r => staleDays(r) >= STALE).sort((x, y) => staleDays(y) - staleDays(x));

  /** Semáforo por requerimiento. */
  function health(r: Requirement): Health {
    if (r.status === "Completado") return { lvl: "d", why: ["Completado"] };
    const why: string[] = [];
    let red = false, yel = false;
    const worstLate = Math.max(daysLate(span(r)[1]), ...r.acts.filter(x => x.percent < 100).map(x => daysLate(x.end)));
    if (worstLate >= 3) { red = true; why.push("atraso de " + lvlTxt(worstLate)); } else if (worstLate >= 1) { yel = true; why.push("atraso de " + lvlTxt(worstLate)); }
    const bd = Math.max(0, ...r.acts.filter(x => x.blocked).map(x => (x.blockedSince ? d2n(today) - d2n(x.blockedSince) : 0)));
    if (r.acts.some(x => x.blocked) || r.status === "Bloqueado") {
      if (bd >= 3) { red = true; why.push("bloqueado hace " + lvlTxt(bd)); } else { yel = true; why.push("bloqueado"); }
    }
    const od = delOverdue(r);
    if (od.length) {
      const dd = Math.max(...od.map(x => daysLate(x.due)));
      if (dd >= 3) red = true; else yel = true;
      why.push(od.length + " entregable(s) vencido(s)");
    }
    const sl = slip(r);
    if (sl >= 5) { red = true; why.push("plazo +" + sl + " d vs compromiso"); } else if (sl >= 1) { yel = true; why.push("plazo +" + sl + " d vs compromiso"); }
    if (staleDays(r) >= STALE) { yel = true; why.push("sin actualizar " + staleDays(r) + " días hábiles"); }
    return { lvl: red ? "r" : yel ? "y" : "g", why };
  }

  /** Recalcula avance, estado y última actualización después de cambiar una actividad (muta `r`). */
  function statusSync(r: Requirement, nowIso: string) {
    const p = progress(r), anyB = r.acts.some(x => x.blocked);
    r.percent = p;
    r.lastUpdate = nowIso;
    if (p >= 100) {
      if (r.status !== "Completado") { r.status = "Completado"; r.completedAt = today; }
      return;
    }
    if (r.status === "Completado") r.status = "En curso";
    if (anyB) r.status = "Bloqueado";
    else if (r.status === "Bloqueado") r.status = "En curso";
    else if (p > 0 && r.status === "Pendiente") r.status = "En curso";
  }

  const reqStatusLabel = (r: Requirement) => (late(r) && r.status !== "Bloqueado" && r.status !== "Completado" ? "Atrasado" : r.status);
  const actState = (a: Activity) => (a.blocked ? "Bloqueado" : a.percent >= 100 ? "Completado" : a.end < today ? "Atrasado" : a.percent > 0 ? "En curso" : "Pendiente");

  /** Plazo de entrega según las fechas de las actividades; `isNew` evita la pregunta de motivo. */
  const myMemberId = (email: string): string => {
    const em = (email || "").toLowerCase();
    return em ? store.members.find((m: Member) => m.email && m.email.toLowerCase() === em)?.id || "" : "";
  };

  return {
    store, today, clientName, mname, memberRoles, ids, effIds, mnames, rolesOf, leaderIds, lnames, typeName, tplFor, span, progress,
    daysLate, late, lastComment, staleDays, slip, delOverdue, delDone, openDef, alertsList, staleList, health, statusSync, reqStatusLabel,
    actState, myMemberId, lvl, lvlTxt,
  };
}
export type Calc = ReturnType<typeof makeCalc>;

/** Pone la lista de responsables conservando `assigneeId` como el primero. */
export function setIds(x: WithIds, list: string[]) {
  x.assigneeIds = list;
  x.assigneeId = list[0] || "";
}
