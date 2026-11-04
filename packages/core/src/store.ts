import { addDays, iso, isIsoDate } from "./dates";
import type { Activity, Client, CustomTemplate, Store, TemplateAct } from "./types";

export const uid = (): string => globalThis.crypto.randomUUID();

export const defaultTemplates = (): { trad: TemplateAct[]; express: TemplateAct[] } => ({
  trad: [
    { name: "Análisis y comprensión del requerimiento", days: 2 },
    { name: "Diseño de casos de prueba", days: 4 },
    { name: "Preparación de ambiente y datos", days: 2 },
    { name: "Ejecución de pruebas ciclo 1", days: 5 },
    { name: "Gestión de defectos / ciclo 2", days: 3 },
    { name: "Regresión", days: 3 },
    { name: "Evidencias y cierre (EVP)", days: 2 },
  ],
  express: [
    { name: "Diseño de casos de prueba", days: 1 },
    { name: "Ejecución", days: 2 },
    { name: "Certificación", days: 1 },
    { name: "Informe final", days: 1 },
  ],
});
export const defaultRoles = (): string[] => ["QA Funcional", "QA Automatizador"];
export const defaultLeaderRoles = (): string[] => ["Líder técnico", "Líder de proyecto", "Coordinador", "Jefatura", "DevOps"];
export const defaultTimes = (): string[] => ["09:00", "12:00", "15:00", "18:00"];

export const newClient = (name: string): Client => ({
  id: uid(),
  name,
  planner: { enabled: false, planId: "", planName: "", lastSync: "" },
  teams: { enabled: false, webhook: "", events: { sync: true, blocked: true } },
});

export const emptyStore = (): Store => ({
  clients: [],
  members: [],
  leaders: [],
  roles: defaultRoles(),
  templates: defaultTemplates(),
  customTpl: [],
  reqs: [],
  leaderRoles: defaultLeaderRoles(),
  notify: { times: defaultTimes(), days: [1, 2, 3, 4, 5], userWebhook: "", siteUrl: "" },
});

/**
 * Completa y sanea un documento (datos antiguos, importados o restaurados). Muta y devuelve el mismo objeto.
 * Es una traducción 1:1 de `normalize` del dashboard original.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeStore(input: any, now: Date = new Date()): Store {
  const o = input;
  o.roles ||= defaultRoles();
  o.templates ||= defaultTemplates();
  o.templates.express ||= defaultTemplates().express;
  o.templates.trad ||= defaultTemplates().trad;
  o.customTpl ||= [];
  for (const k of ["trad", "express"] as const) o.templates[k].forEach((t: TemplateAct) => { t.unit ||= "d"; });
  o.customTpl.forEach((c: CustomTemplate) => (c.acts ||= []).forEach(t => { t.unit ||= "d"; }));
  o.members ||= [];
  o.leaders ||= [];
  if (!Array.isArray(o.leaderRoles)) o.leaderRoles = defaultLeaderRoles();
  o.reqs ||= [];
  o.clients ||= [];
  if (!o.clients.length) o.clients.push({ id: uid(), name: "General" });
  const t0 = iso(now);
  for (const r of o.reqs) {
    if (!o.clients.some((c: Client) => c.id === r.clientId)) r.clientId = o.clients[0].id;
    r.comments ||= [];
    r.leaderIds ||= [];
    r.acts ||= [];
    r.deliverables ||= [];
    r.metrics ||= {};
    r.dateLog ||= [];
    r.committedEnd ||= r.end;
    r.lastUpdate ||= r.comments.length ? r.comments[r.comments.length - 1].at : now.toISOString();
    r.acts.forEach((a: Activity) => { a.blockReason ||= ""; a.blockedSince ||= ""; });
  }
  o.members.forEach((m: any) => { m.roles ||= m.role ? [m.role] : []; delete m.role; });
  o.notify ||= {};
  o.notify.times ||= defaultTimes();
  o.notify.days ||= [1, 2, 3, 4, 5];
  o.notify.userWebhook ||= "";
  o.notify.siteUrl ||= "";
  o.clients.forEach((c: any) => {
    c.planner ||= { enabled: false, planId: "", planName: "", lastSync: "" };
    c.teams ||= { enabled: false, webhook: "", events: { sync: true, blocked: true } };
  });
  for (const r of o.reqs) {
    r.priority ||= "";
    r.bucket ||= "";
    r.id ||= uid();
    r.type ||= "trad";
    r.status ||= "Pendiente";
    r.code = String(r.code ?? "");
    r.title = String(r.title ?? "");
    r.acts.forEach((a: Activity) => {
      a.id ||= uid();
      a.name = String(a.name ?? "");
      a.percent = Math.max(0, Math.min(100, +a.percent || 0));
    });
    const dates = (k: "start" | "end") => r.acts.map((a: Activity) => a[k]).filter(isIsoDate).sort();
    if (!isIsoDate(r.start)) r.start = dates("start")[0] || t0;
    if (!isIsoDate(r.end)) r.end = dates("end").pop() || r.start;
    r.acts.forEach((a: Activity) => {
      if (!isIsoDate(a.start)) a.start = r.start;
      if (!isIsoDate(a.end)) a.end = a.start;
    });
  }
  o.members.forEach((m: any) => { m.id ||= uid(); m.name = String(m.name ?? ""); m.email = String(m.email ?? ""); });
  o.clients.forEach((c: any) => { c.id ||= uid(); c.teams.events ||= { sync: true, blocked: true }; });
  o.leaders.forEach((l: any) => { l.id ||= uid(); l.name = String(l.name ?? ""); l.email = String(l.email ?? ""); l.roles ||= []; });
  return o as Store;
}

/** Datos de ejemplo para el modo local (sin Supabase). */
export function seedStore(today: string): Store {
  const m = [
    { id: uid(), name: "Ana Torres", email: "ana@empresa.com", roles: ["QA Funcional"] },
    { id: uid(), name: "Luis Rojas", email: "luis@empresa.com", roles: ["QA Automatizador", "QA Funcional"] },
    { id: uid(), name: "Marta Díaz", email: "marta@empresa.com", roles: ["QA Funcional"] },
  ];
  const tpl = defaultTemplates();
  const mkActs = (list: TemplateAct[], start: string, pcts: number[], who: string): Activity[] => {
    let s = start;
    return list.map((a, i) => {
      const x: Activity = { id: uid(), name: a.name, start: s, end: addDays(s, a.days - 1), percent: pcts[i] ?? 0, assigneeId: who, blocked: false };
      s = addDays(x.end, 1);
      return x;
    });
  };
  const acts = mkActs(tpl.trad, addDays(today, -9), [100, 100, 100, 50], m[0].id);
  const ex1 = mkActs(tpl.express, addDays(today, -2), [100, 50, 0, 0], m[1].id);
  const ex2 = mkActs(tpl.express, addDays(today, 2), [], m[2].id);
  const cl = [newClient("IPS"), newClient("Hites"), newClient("PDI")];
  const now = new Date().toISOString();
  const base = { priority: "", bucket: "", leaderIds: [], deliverables: [], metrics: {}, dateLog: [], percent: 0, lastUpdate: now };
  const store = emptyStore();
  store.clients = cl;
  store.members = m;
  store.reqs = [
    { ...base, id: uid(), clientId: cl[0].id, code: "R1903", title: "Aranda - SOLFON", type: "trad", assigneeId: m[0].id, status: "En curso", start: acts[0].start, end: acts[acts.length - 1].end, committedEnd: acts[acts.length - 1].end, acts, comments: [{ id: uid(), at: now, by: "Ana Torres", text: "Casos aprobados por el analista. Iniciando ciclo 1." }] },
    { ...base, id: uid(), clientId: cl[1].id, code: "R2044", title: "Ajuste de reporte de saldos", type: "express", assigneeId: m[1].id, status: "En curso", start: ex1[0].start, end: ex1[3].end, committedEnd: ex1[3].end, acts: ex1, comments: [{ id: uid(), at: now, by: "Luis Rojas", text: "Probado 60%, falta validar con datos de producción." }] },
    { ...base, id: uid(), clientId: cl[2].id, code: "R2051", title: "Validación campo teléfono", type: "express", assigneeId: m[2].id, status: "Pendiente", start: ex2[0].start, end: ex2[3].end, committedEnd: ex2[3].end, acts: ex2, comments: [] },
  ];
  return normalizeStore(store);
}
