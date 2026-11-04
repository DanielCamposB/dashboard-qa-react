// Mezcla Planner → dashboard. Solo lectura: nunca escribe en Planner.
// Lo que se edita en el dashboard se conserva; un campo vuelve a tomar el valor de Planner solo cuando cambió allá desde la última sincronización.
import { makeCalc, scaleActs, setIds } from "./calc";
import { addDays, d2n } from "./dates";
import { norm } from "./text";
import { uid } from "./store";
import type { Activity, Client, Comment, Requirement, Status, Store } from "./types";

export interface PlannerTask {
  id: string;
  title: string;
  percent: number;
  priority: string;
  start: string;
  due: string;
  created: string;
  bucket: string;
  labels: string[];
  checks: string[];
  assignees: { id: string; name: string; email: string }[];
  comments: Comment[];
}
export interface PlannerPlanData {
  planId: string;
  planName: string;
  groupId: string;
  warnings: string[];
  tasks: PlannerTask[];
}
export interface SyncSummary {
  created: number;
  updated: number;
  completed: number;
  comments: number;
  skipped: number;
  changes: string[];
  newReqs: Requirement[];
}

const mapStatus = (p: number): Status => (p >= 100 ? "Completado" : p > 0 ? "En curso" : "Pendiente");

function typeFrom(s: Store, labels: string[]): string {
  for (const l of labels) {
    const n = norm(l);
    if (/express/.test(n)) return "express";
    const c = s.customTpl.find(x => norm(x.name) === n || n.includes(norm(x.name)));
    if (c) return c.id;
    if (/tradic/.test(n)) return "trad";
  }
  return "";
}

/** «R1903 - Título» → { code: "R1903", title: "Título" }; si no trae código se genera PL-xxxxx. */
export function splitCode(t: Pick<PlannerTask, "id" | "title">) {
  const m = t.title.match(/^\s*([A-Za-z]{1,6}[-_ ]?\d{2,7})\s*[-–—:·|]?\s*(.*)$/);
  return m && m[2] ? { code: m[1].toUpperCase().replace(/\s+/g, ""), title: m[2] } : { code: "PL-" + t.id.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase(), title: t.title };
}

function memberIds(s: Store, t: PlannerTask): string[] {
  const out: string[] = [];
  for (const u of t.assignees) {
    const m = s.members.find(x => (x.email && u.email && x.email.toLowerCase() === u.email) || norm(x.name) === norm(u.name));
    if (m && !out.includes(m.id)) out.push(m.id);
  }
  return out;
}

/** El depósito marca la etapa: las actividades anteriores quedan completas. */
function applyStage(r: Requirement, bucket: string): boolean {
  const nb = norm(bucket);
  if (!nb || !r.acts.length) return false;
  const i = r.acts.findIndex(a => {
    const na = norm(a.name);
    return na.includes(nb) || nb.split(" ").some(w => w.length >= 6 && na.includes(w));
  });
  if (i < 0) return false;
  let ch = false;
  r.acts.forEach((a, k) => {
    if (k < i && a.percent < 100) { a.percent = 100; ch = true; }
    if (k === i && a.percent === 0) { a.percent = 50; ch = true; }
  });
  return ch;
}

/** Reparte las actividades entre las fechas de Planner. */
function fitActs(r: Requirement, start: string, end: string) {
  if (!start || !end || end < start || !r.acts.length) return;
  const T = d2n(end) - d2n(start) + 1;
  const base = r.acts.map(a => Math.max(1, d2n(a.end || a.start || start) - d2n(a.start || start) + 1));
  const ds = scaleActs(base, T);
  let s = start;
  r.acts.forEach((a, i) => { a.start = s; a.end = addDays(s, ds[i] - 1); s = addDays(a.end, 1); });
}

function newReq(s: Store, c: Client, t: PlannerTask, now: string, today: string): Requirement {
  const calc = makeCalc(s, today);
  const { code, title } = splitCode(t);
  const type = typeFrom(s, [...t.labels, ...t.checks]) || "trad";
  const tpl = calc.tplFor(type);
  const start = t.start || t.created || today;
  const base = tpl.map(x => x.days), tot = base.reduce((x, y) => x + y, 0);
  const end = t.due && t.due >= start ? t.due : addDays(start, tot - 1);
  const ds = scaleActs(base, d2n(end) - d2n(start) + 1);
  let cur = start;
  const mem = memberIds(s, t);
  const acts: Activity[] = tpl.map((x, i) => {
    const e = addDays(cur, ds[i] - 1);
    const a: Activity = { id: uid(), name: x.name, start: cur, end: e, percent: 0, blocked: false, blockReason: "", blockedSince: "" };
    setIds(a, mem);
    cur = addDays(e, 1);
    return a;
  });
  const r: Requirement = {
    id: uid(), clientId: c.id, code, title, type, status: mapStatus(t.percent), percent: 0, start, end, acts, committedEnd: end, dateLog: [], lastUpdate: now,
    priority: t.priority, bucket: t.bucket, leaderIds: [],
    deliverables: (type === "express" ? ["Informe final"] : ["Plan de pruebas", "Evidencias (EVP)", "Informe final"]).map(n => ({ id: uid(), name: n, due: end, state: "pendiente" as const, url: "" })),
    metrics: {}, comments: [],
    src: { planner: true, taskId: t.id, planId: c.planner.planId, labels: t.labels, checks: t.checks, syncedAt: now, snap: {} },
  };
  setIds(r, mem);
  applyStage(r, t.bucket);
  r.percent = calc.progress(r);
  if (r.percent > 0 && r.status === "Pendiente") r.status = "En curso";
  return r;
}

/** Aplica los datos de un plan de Planner al documento (muta `s`). */
export function applyPlanner(s: Store, cid: string, data: PlannerPlanData, today: string): SyncSummary {
  const sum: SyncSummary = { created: 0, updated: 0, completed: 0, comments: 0, skipped: 0, changes: [], newReqs: [] };
  const c = s.clients.find(x => x.id === cid);
  if (!c) return sum;
  const now = new Date().toISOString();
  const calc = makeCalc(s, today);
  for (const t of data.tasks) {
    let r = s.reqs.find(x => x.src?.taskId === t.id && x.clientId === cid);
    const cur = { title: t.title, status: mapStatus(t.percent), start: t.start, end: t.due, priority: t.priority, bucket: t.bucket, labels: [...t.labels, ...t.checks].join("|"), who: t.assignees.map(a => a.id).join("|") };
    if (!r) {
      if (t.percent >= 100) { sum.skipped++; continue; } // solo proyectos activos
      r = newReq(s, c, t, now, today);
      r.src!.snap = cur;
      s.reqs.push(r);
      sum.created++;
      sum.newReqs.push(r);
    } else {
      const src = r.src!;
      const sn = src.snap || {}, ch: string[] = [];
      if (cur.title !== sn.title) {
        const sp = splitCode(t);
        r.title = sp.title;
        if (!r.code || /^PL-/.test(r.code)) r.code = sp.code;
        ch.push("nombre");
      }
      if (cur.status !== sn.status) {
        if (cur.status === "Completado") { r.status = "Completado"; r.completedAt = today; r.acts.forEach(a => (a.percent = 100)); r.percent = 100; sum.completed++; }
        else { r.status = r.status === "Completado" ? "En curso" : r.status === "Bloqueado" ? "Bloqueado" : cur.status; r.completedAt = ""; }
        ch.push("estado");
      }
      if (cur.priority !== sn.priority) { r.priority = cur.priority; ch.push("prioridad " + cur.priority); }
      if (cur.bucket !== sn.bucket) {
        r.bucket = cur.bucket;
        if (applyStage(r, cur.bucket)) { r.percent = calc.progress(r); if (r.percent > 0 && r.status === "Pendiente") r.status = "En curso"; }
        ch.push("depósito → " + (cur.bucket || "—"));
      }
      if (cur.start !== sn.start || cur.end !== sn.end) {
        const from = calc.span(r)[1];
        fitActs(r, cur.start || calc.span(r)[0], cur.end || from);
        const to = calc.span(r)[1];
        r.start = calc.span(r)[0];
        r.end = to;
        if (from !== to) { (r.dateLog ||= []).push({ at: now, by: "Planner", from, to, reason: "Cambio de fecha de vencimiento en Planner" }); ch.push("vencimiento " + to); }
        else ch.push("fechas");
      }
      if (cur.labels !== sn.labels) {
        const ty = typeFrom(s, [...t.labels, ...t.checks]);
        if (ty && ty !== r.type) { r.type = ty; ch.push("tipo"); }
        src.labels = t.labels;
        src.checks = t.checks;
      }
      if (cur.who !== sn.who) {
        const mem = memberIds(s, t);
        if (mem.length) { setIds(r, mem); ch.push("responsables"); }
      }
      if (ch.length) { r.lastUpdate = now; sum.updated++; sum.changes.push(`${r.code}: ${ch.join(", ")}`); }
      src.snap = cur;
      src.syncedAt = now;
    }
    const have = new Set(r.comments.map(x => x.id));
    let added = 0;
    for (const cm of t.comments) {
      if (!have.has(cm.id)) {
        r.comments.push(cm);
        added++;
        if (!r.lastUpdate || cm.at > r.lastUpdate) r.lastUpdate = cm.at;
      }
    }
    sum.comments += added;
  }
  c.planner.lastSync = now;
  return sum;
}
