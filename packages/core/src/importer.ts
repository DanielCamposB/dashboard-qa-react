// Importación de requerimientos desde una planilla (Excel / CSV ya leída como filas de objetos).
import { makeCalc, scaleActs, setIds, tplDays } from "./calc";
import { addDays, badDate, d2n, iso } from "./dates";
import { norm } from "./text";
import { uid } from "./store";
import type { Activity, Requirement, Store, Client } from "./types";

const HEAD: Record<string, string[]> = {
  code: ["codigo", "cod", "id", "nro", "numero", "n", "ticket", "codigo requerimiento"],
  title: ["titulo", "nombre", "descripcion", "detalle", "requerimiento", "proyecto"],
  client: ["cliente", "empresa"],
  type: ["tipo", "tipo qa", "modalidad"],
  assignee: ["responsable", "analista", "asignado", "qa", "encargado"],
  start: ["inicio", "fecha inicio", "desde", "f inicio", "fecha de inicio"],
  end: ["fin", "termino", "fecha fin", "fecha termino", "fecha compromiso", "compromiso", "plazo", "vencimiento", "fecha de termino", "fecha de fin"],
  status: ["estado"],
  percent: ["avance", "% avance", "progreso"],
};

export interface ImportRow {
  line: number;
  code: string;
  title: string;
  notes: string[];
  err: string;
  clientId: string;
  clientNew: string;
  clientName: string;
  type: "express" | "trad";
  assigneeId: string;
  assigneeName: string;
  start: string;
  end: string;
  status: "" | "Completado" | "Bloqueado" | "En curso";
  percent: number | null;
  ok: boolean;
}

/** Convierte lo que venga en una celda (fecha de Excel, serial, dd-mm-aaaa, aaaa-mm-dd) a aaaa-mm-dd. "" = vacío, null = inválida. */
export function toIsoDate(v: unknown, today: string): string | null {
  if (v == null || v === "") return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    const d = new Date(v.getTime() + 60000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; // SheetJS: los componentes locales son los de la celda
  }
  if (typeof v === "number") return iso(new Date(Math.round((v - 25569) * 86400000))); // serial de Excel
  const s = String(v).trim();
  let m: RegExpMatchArray | null;
  const real = (x: string) => {
    const d = new Date(x + "T00:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x && !badDate(x, today) ? x : null;
  };
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return real(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) return real(`${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
  return null;
}

export function parseSheet(rows: Record<string, unknown>[], store: Store, clientId: string, today: string): ImportRow[] {
  const keys = Object.keys(rows[0] || {}), map: Record<string, string> = {};
  for (const [f, syn] of Object.entries(HEAD)) {
    const k = keys.find(k => syn.includes(norm(k)) && !Object.values(map).includes(k));
    if (k) map[f] = k;
  }
  if (!map.code && !map.title) throw new Error("No encontré columnas «Código» ni «Título» en la primera hoja.");
  const seen = new Set(store.reqs.map(r => (r.clientId + "|" + r.code).toLowerCase())), out: ImportRow[] = [];
  rows.forEach((row, i) => {
    const g = (f: string) => (map[f] ? row[map[f]] : "");
    const code = String(g("code") || "").trim(), title = String(g("title") || "").trim();
    if (!code && !title) return;
    const it: ImportRow = { line: i + 2, code: code || title.slice(0, 12), title: title || code, notes: [], err: "", clientId: "", clientNew: "", clientName: "", type: "trad", assigneeId: "", assigneeName: "", start: "", end: "", status: "", percent: null, ok: false };
    const cn = String(g("client") || "").trim();
    const cli: Client | undefined = cn ? store.clients.find(c => norm(c.name) === norm(cn)) : clientId !== "all" ? store.clients.find(c => c.id === clientId) : store.clients[0];
    it.clientId = cli?.id || "";
    it.clientNew = cli ? "" : cn || "General";
    it.clientName = cli?.name || it.clientNew;
    it.type = /expr/i.test(String(g("type"))) ? "express" : "trad";
    const an = String(g("assignee") || "").trim();
    const mem = an ? store.members.find(m => norm(m.name) === norm(an) || norm(m.name).includes(norm(an)) || norm(an).includes(norm(m.name))) : null;
    it.assigneeId = mem?.id || "";
    it.assigneeName = mem?.name || an;
    if (an && !mem) it.notes.push("responsable no encontrado");
    const sIso = toIsoDate(g("start"), today), eIso = toIsoDate(g("end"), today);
    it.start = sIso || today;
    it.end = eIso || "";
    if (sIso === null) it.err = "Fecha de inicio inválida";
    else if (eIso === null) it.err = "Fecha de fin inválida";
    else if (it.end && it.end < it.start) it.err = "Fin anterior al inicio";
    const st = norm(g("status"));
    it.status = /complet|termin|cerrad/.test(st) ? "Completado" : /bloq/.test(st) ? "Bloqueado" : /curso|proceso|ejecu/.test(st) ? "En curso" : "";
    const raw = String(g("percent"));
    const pc = parseFloat(raw.replace(",", ".").replace("%", ""));
    it.percent = isNaN(pc) ? null : Math.max(0, Math.min(100, pc <= 1 && raw.indexOf("%") < 0 && pc > 0 && pc < 1 ? pc * 100 : pc));
    const key = ((it.clientId || it.clientNew) + "|" + it.code).toLowerCase();
    if (!it.err && seen.has(key)) it.err = "Duplicado (ya existe)";
    else seen.add(key);
    it.ok = !it.err;
    out.push(it);
  });
  if (!out.length) throw new Error("La planilla no tiene filas con datos.");
  return out;
}

export function buildImported(rows: ImportRow[], store: Store, today: string, by: string): { reqs: Requirement[]; clients: Client[] } {
  const calc = makeCalc(store, today);
  const newClients: Record<string, Client> = {}, at = new Date().toISOString(), reqs: Requirement[] = [];
  for (const r of rows.filter(x => x.ok)) {
    let cid = r.clientId;
    if (!cid) {
      newClients[r.clientNew] ||= { id: uid(), name: r.clientNew, planner: { enabled: false, planId: "", planName: "", lastSync: "" }, teams: { enabled: false, webhook: "", events: { sync: true, blocked: true } } };
      cid = newClients[r.clientNew].id;
    }
    const tpl = calc.tplFor(r.type), base = tpl.map(tplDays), tot = base.reduce((x, y) => x + y, 0);
    const T = r.end ? Math.max(1, d2n(r.end) - d2n(r.start) + 1) : tot, ds = scaleActs(base, T);
    let s = r.start;
    const acts: Activity[] = tpl.map((t, i) => {
      const e = addDays(s, ds[i] - 1);
      const x: Activity = { id: uid(), name: t.name, start: s, end: e, percent: 0, assigneeId: r.assigneeId, blocked: false, blockReason: "", blockedSince: "" };
      setIds(x, r.assigneeId ? [r.assigneeId] : []);
      s = addDays(e, 1);
      return x;
    });
    const p = r.status === "Completado" ? 100 : r.percent ?? 0, done = Math.round((p / 100) * acts.length);
    acts.forEach((x, i) => (x.percent = i < done ? 100 : 0));
    const end = acts[acts.length - 1].end;
    const req: Requirement = {
      id: uid(), clientId: cid, code: r.code, title: r.title, type: r.type, assigneeId: r.assigneeId, assigneeIds: r.assigneeId ? [r.assigneeId] : [], leaderIds: [],
      status: r.status || (done ? "En curso" : "Pendiente"), percent: 0, start: r.start, end, acts, committedEnd: r.end || end, dateLog: [], lastUpdate: at, priority: "", bucket: "",
      deliverables: (r.type === "express" ? ["Informe final"] : ["Plan de pruebas", "Evidencias (EVP)", "Informe final"]).map(n => ({ id: uid(), name: n, due: end, state: "pendiente" as const, url: "" })),
      metrics: {}, comments: [{ id: uid(), at, by, text: "Requerimiento importado desde planilla." }],
    };
    req.percent = calc.progress(req);
    if (req.percent >= 100) { req.status = "Completado"; req.completedAt = today; }
    reqs.push(req);
  }
  return { reqs, clients: Object.values(newClients) };
}

export const IMPORT_TEMPLATE_CSV = "Código,Título,Cliente,Tipo,Responsable,Inicio,Fin,Estado,Avance\r\nR1903,Aranda - SOLFON,IPS,Tradicional,Ana Torres,2026-10-14,2026-11-03,En curso,40\r\nR2044,Ajuste reporte de saldos,Hites,Express,Luis Rojas,2026-10-21,2026-10-24,Pendiente,0\r\n";
