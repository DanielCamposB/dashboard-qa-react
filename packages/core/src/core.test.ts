import { describe, expect, it } from "vitest";
import {
  addDays, applyPlanner, buildCard, buildImported, cleanCode, d2n, emptyStore, fd, isTeamsUrl, lvlTxt, makeCalc, normalizeStore, ownerDigests, parseSheet,
  pwMissing, scaleActs, seedStore, setIds, summaryFor, tplDays, toIsoDate, csvSafe, ganttHtml, type PlannerPlanData,
} from "./index";

const TODAY = "2026-11-04";

describe("fechas", () => {
  it("suma días y formatea dd-mm-aaaa", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(fd("2026-11-04")).toBe("04-11-2026");
    expect(d2n("2026-11-05") - d2n("2026-11-04")).toBe(1);
  });
  it("describe el atraso", () => {
    expect(lvlTxt(1)).toBe("1 día");
    expect(lvlTxt(8)).toBe("1 semana y 1 d");
    expect(lvlTxt(15)).toBe("2 semanas");
  });
});

describe("validaciones", () => {
  it("limpia el código", () => expect(cleanCode("r19-03x")).toBe("R1903"));
  it("pide los requisitos de contraseña", () => {
    expect(pwMissing("abc")).toEqual(["len", "up", "num", "sym"]);
    expect(pwMissing("Abcdef1!")).toEqual([]);
  });
  it("neutraliza fórmulas en CSV", () => expect(csvSafe("=1+1")).toBe("'=1+1"));
});

describe("cálculos", () => {
  const store = seedStore(TODAY);
  const calc = makeCalc(store, TODAY);
  it("calcula avance ponderado por duración", () => {
    const r = store.reqs[0];
    expect(calc.progress(r)).toBeGreaterThan(0);
    expect(calc.progress({ acts: [], percent: 40 })).toBe(40);
  });
  it("detecta atrasos y semáforo", () => {
    const r = store.reqs[0];
    r.acts[3].end = addDays(TODAY, -5);
    r.acts[3].percent = 10;
    const c = makeCalc(store, TODAY);
    expect(c.health(r).lvl).toBe("r");
    expect(c.alertsList([r])[0].d).toBeGreaterThanOrEqual(5);
  });
  it("sincroniza estado con las actividades", () => {
    const r = store.reqs[1];
    r.acts.forEach(a => (a.percent = 100));
    calc.statusSync(r, new Date().toISOString());
    expect(r.status).toBe("Completado");
    expect(r.completedAt).toBe(TODAY);
  });
  it("reparte días proporcionalmente", () => {
    const ds = scaleActs([2, 4, 2], 16);
    expect(ds.reduce((a, b) => a + b, 0)).toBe(16);
    expect(tplDays({ name: "x", days: 17, unit: "hh" })).toBe(3);
  });
});

describe("normalizar", () => {
  it("completa datos antiguos", () => {
    const s = normalizeStore({ reqs: [{ code: "R1", title: "t", acts: [{ name: "a", percent: 150 }] }], members: [{ name: "Ana", role: "QA" }] });
    expect(s.clients).toHaveLength(1);
    expect(s.reqs[0].acts[0].percent).toBe(100);
    expect(s.members[0].roles).toEqual(["QA"]);
    expect(s.reqs[0].start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Planner", () => {
  const plan = (percent: number, due = "2026-11-20"): PlannerPlanData => ({
    planId: "p1", planName: "Plan", groupId: "g", warnings: [],
    tasks: [{ id: "t1abcdef", title: "R1903 - Aranda SOLFON", percent, priority: "Urgente", start: "2026-11-02", due, created: "2026-11-01", bucket: "Diseño", labels: ["QA Express"], checks: [], assignees: [{ id: "u1", name: "Ana Torres", email: "ana@empresa.com" }], comments: [{ id: "pl-1", at: "2026-11-03T10:00:00Z", by: "Pedro", text: "hola", src: "planner" }] }],
  });
  it("crea, conserva ediciones y actualiza solo lo que cambió en Planner", () => {
    const s = seedStore(TODAY);
    const cid = s.clients[0].id;
    s.clients[0].planner = { enabled: true, planId: "p1", planName: "Plan", lastSync: "" };
    const a = applyPlanner(s, cid, plan(0), TODAY);
    expect(a.created).toBe(1);
    const r = s.reqs.find(x => x.src?.taskId === "t1abcdef")!;
    expect(r.code).toBe("R1903");
    expect(r.type).toBe("express");
    expect(r.priority).toBe("Urgente");
    expect(r.comments).toHaveLength(1);
    r.priority = "Baja"; // edición local
    const b = applyPlanner(s, cid, plan(0), TODAY);
    expect(b.updated).toBe(0);
    expect(r.priority).toBe("Baja");
    const c = applyPlanner(s, cid, plan(0, "2026-11-25"), TODAY);
    expect(c.updated).toBe(1);
    expect(r.dateLog.at(-1)?.reason).toMatch(/Planner/);
    expect(r.comments).toHaveLength(1);
  });
  it("omite tareas ya completadas", () => {
    const s = seedStore(TODAY);
    expect(applyPlanner(s, s.clients[0].id, plan(100), TODAY).skipped).toBe(1);
  });
});

describe("Teams", () => {
  it("valida el origen de la URL", () => {
    expect(isTeamsUrl("https://prod-12.westus.logic.azure.com/workflows/x")).toBe(true);
    expect(isTeamsUrl("http://logic.azure.com/x")).toBe(false);
    expect(isTeamsUrl("https://evil.example.com/x")).toBe(false);
  });
  it("arma resumen y mensajes personales", () => {
    const s = seedStore(TODAY);
    setIds(s.reqs[0], [s.members[0].id]);
    s.reqs[0].acts[2].end = addDays(TODAY, -3);
    s.reqs[0].acts[2].percent = 0;
    const calc = makeCalc(s, TODAY);
    const sum = summaryFor(s, s.clients[0], calc);
    expect(sum.facts[1]).toEqual(["Atrasados", 1]);
    const own = ownerDigests(s, s.clients[0], calc);
    expect(own[0].email).toBe("ana@empresa.com");
    const card = buildCard({ title: own[0].title, facts: own[0].facts, lines: own[0].lines, to: own[0].email, who: { name: own[0].name, email: own[0].email } });
    expect(card.to).toBe("ana@empresa.com");
    expect(JSON.stringify(card)).toContain("<at>Ana Torres</at>");
  });
});

describe("importar y exportar", () => {
  it("lee fechas de planilla", () => {
    expect(toIsoDate("03/11/2026", TODAY)).toBe("2026-11-03");
    expect(toIsoDate("1990-01-01", TODAY)).toBeNull();
    expect(toIsoDate("", TODAY)).toBe("");
  });
  it("detecta duplicados y arma requerimientos", () => {
    const s = seedStore(TODAY);
    const rows = parseSheet([{ Código: "R1903", Título: "Dup", Cliente: "IPS", Tipo: "", Inicio: "", Fin: "", Avance: "" }, { Código: "R9000", Título: "Nuevo", Cliente: "Cliente Nuevo", Tipo: "Express", Inicio: "2026-11-10", Fin: "2026-11-13", Avance: 50 }], s, "all", TODAY);
    expect(rows[0].err).toMatch(/Duplicado/);
    const { reqs, clients } = buildImported(rows, s, TODAY, "Tester");
    expect(reqs).toHaveLength(1);
    expect(clients[0].name).toBe("Cliente Nuevo");
    expect(reqs[0].acts.at(-1)!.end).toBe("2026-11-13");
  });
  it("genera la carta Gantt con barras", () => {
    const s = seedStore(TODAY);
    const html = ganttHtml(s.reqs, makeCalc(s, TODAY), "Todos", false)!;
    expect(html).toContain("Carta Gantt QA");
    expect(html).toMatch(/background:#2f6fed|background:#2f6fed55/);
  });
  it("tienda vacía es válida", () => expect(emptyStore().reqs).toEqual([]));
});
