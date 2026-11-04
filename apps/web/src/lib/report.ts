// Informe Word (.docx) con el resumen de actividades de uno o varios requerimientos, pensado para jefatura.
// La librería «docx» se carga solo la primera vez que se pide un informe; todo se arma en el navegador.
import type { Calc, Requirement } from "@qa/core";

const FONT = "Calibri", NAVY = "0B1F3A";
const ST: Record<string, { fg: string; bg: string }> = {
  Completado: { fg: "1E7B50", bg: "D9F2E6" }, "En curso": { fg: "1F55C4", bg: "DCE7FD" }, Pendiente: { fg: "5B6478", bg: "E7EAF0" },
  Bloqueado: { fg: "B26A0F", bg: "FCEBD3" }, Atrasado: { fg: "B3202F", bg: "F9D9DD" },
};
const fmt = (d?: string) => (/^\d{4}-\d{2}-\d{2}/.test(d || "") ? d!.slice(8, 10) + "-" + d!.slice(5, 7) + "-" + d!.slice(0, 4) : "—");

export interface ReportOptions { author: string; scope: string }

export async function buildReport(list: Requirement[], calc: Calc, o: ReportOptions): Promise<Blob> {
  const d = await import("docx").catch(() => { throw new Error("No se pudo cargar el generador de Word. Revisa tu conexión a internet e inténtalo de nuevo."); });
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel, BorderStyle, PageNumber, Footer, PageOrientation, VerticalAlign, TableLayoutType } = d;
  type Opt = { size?: number; bold?: boolean; color?: string; italics?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; keepNext?: boolean; pageBreakBefore?: boolean; before?: number; after?: number; bullet?: { level: number }; fill?: string; span?: number };

  const run = (t: unknown, o: Opt = {}) => new TextRun({ text: String(t ?? ""), font: FONT, size: o.size || 20, bold: o.bold, color: o.color, italics: o.italics });
  const para = (t: unknown, o: Opt = {}) => new Paragraph({ children: Array.isArray(t) ? t : [run(t, o)], alignment: o.align, heading: o.heading, bullet: o.bullet, keepNext: o.keepNext, pageBreakBefore: o.pageBreakBefore, spacing: { before: o.before ?? 0, after: o.after ?? 80 } });
  const h = (t: string, level: Opt["heading"], oo: Opt = {}) => para(t, { heading: level, keepNext: true, before: oo.before ?? 200, after: 100, pageBreakBefore: oo.pageBreakBefore, size: oo.size, bold: true, color: NAVY });
  const cell = (content: unknown, w: number, oo: Opt = {}) => new TableCell({
    width: { size: w, type: WidthType.DXA }, columnSpan: oo.span, verticalAlign: VerticalAlign.CENTER, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    shading: oo.fill ? { type: ShadingType.CLEAR, color: "auto", fill: oo.fill } : undefined,
    children: ([] as unknown[]).concat(content).map(c => (c instanceof Paragraph ? c : para(c, { size: oo.size, bold: oo.bold, color: oo.color, align: oo.align, after: 0 }))),
  });
  const line = { style: BorderStyle.SINGLE, size: 4, color: "C9CFDA" };
  const sum = (ws: number[]) => ws.reduce((a, b) => a + b, 0);
  const table = (ws: number[], rows: InstanceType<typeof TableRow>[]) => new Table({ width: { size: sum(ws), type: WidthType.DXA }, columnWidths: ws, layout: TableLayoutType.FIXED, rows, borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line } });
  const head = (ws: number[], labels: string[]) => new TableRow({ tableHeader: true, cantSplit: true, children: labels.map((l, i) => cell(l, ws[i], { fill: NAVY, color: "FFFFFF", bold: true, size: 18 })) });
  const stCell = (s: string, w: number) => cell(s, w, { fill: (ST[s] || ST.Pendiente).bg, color: (ST[s] || ST.Pendiente).fg, bold: true, size: 18, align: AlignmentType.CENTER });

  // ---- cálculos ----
  const today = calc.today, dn = (s: string) => Math.round(Date.parse(s + "T00:00:00Z") / 86400000);
  const reqSt = (r: Requirement) => (r.status !== "Completado" && r.status !== "Bloqueado" && calc.span(r)[1] < today ? "Atrasado" : r.status || "Pendiente");
  const actSt = (a: Requirement["acts"][number]) => (a.blocked ? "Bloqueada" : a.percent >= 100 ? "Completada" : a.end < today ? "Atrasada" : a.percent > 0 ? "En curso" : "Pendiente");
  const actKey = (s: string) => ({ Bloqueada: "Bloqueado", Completada: "Completado", Atrasada: "Atrasado" } as Record<string, string>)[s] || s;
  const days = (s: string, e: string) => (s && e ? dn(e) - dn(s) + 1 : 0);
  const plazo = (r: Requirement) => {
    const e = calc.span(r)[1], st = reqSt(r);
    let t = st === "Completado" ? "Completado" : e < today ? calc.lvlTxt(calc.daysLate(e)) + " de atraso" : dn(e) - dn(today) === 0 ? "Vence hoy" : "Faltan " + (dn(e) - dn(today)) + " d";
    if (r.committedEnd && e > r.committedEnd) t += ` (+${dn(e) - dn(r.committedEnd)} d vs compromiso)`;
    return t;
  };
  const total = list.length, byS: Record<string, number> = {};
  list.forEach(r => { const s = reqSt(r); byS[s] = (byS[s] || 0) + 1; });
  const avg = total ? Math.round(list.reduce((a, r) => a + calc.progress(r), 0) / total) : 0;
  const dels = list.flatMap(r => r.deliverables || []), delOv = list.reduce((a, r) => a + calc.delOverdue(r).length, 0);
  const attention = list.filter(r => ["Atrasado", "Bloqueado"].includes(reqSt(r))).sort((x, y) => (reqSt(x) === reqSt(y) ? 0 : reqSt(x) === "Bloqueado" ? -1 : 1) || calc.span(x)[1].localeCompare(calc.span(y)[1]));

  const kids: unknown[] = [];
  const NONE = { style: BorderStyle.NONE };
  // ---- portada / encabezado ----
  kids.push(new Table({ width: { size: 14400, type: WidthType.DXA }, columnWidths: [14400], layout: TableLayoutType.FIXED, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE }, rows: [new TableRow({ children: [new TableCell({
    width: { size: 14400, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: "auto", fill: NAVY }, margins: { top: 240, bottom: 240, left: 300, right: 300 },
    children: [para("Informe de seguimiento QA", { size: 40, bold: true, color: "FFFFFF", after: 60 }), para(`${o.scope} · ${total} requerimiento${total === 1 ? "" : "s"}`, { size: 24, color: "BFD4F6", after: 40 }), para(`Emitido el ${fmt(today)} · Preparado por ${o.author}`, { size: 20, color: "BFD4F6", after: 0 })] })] })] }));

  // ---- resumen ejecutivo ----
  kids.push(h("1. Resumen ejecutivo", HeadingLevel.HEADING_1, { size: 30 }));
  const kp: [string, string | number, string][] = [["Requerimientos", total, NAVY], ["Completados", byS.Completado || 0, ST.Completado.fg], ["En curso", byS["En curso"] || 0, ST["En curso"].fg], ["Pendientes", byS.Pendiente || 0, ST.Pendiente.fg], ["Bloqueados", byS.Bloqueado || 0, ST.Bloqueado.fg], ["Atrasados", byS.Atrasado || 0, ST.Atrasado.fg], ["Avance promedio", avg + "%", NAVY], ["Entregables vencidos", delOv, delOv ? ST.Atrasado.fg : NAVY]];
  const kw = 1800;
  kids.push(table(kp.map(() => kw), [new TableRow({ cantSplit: true, children: kp.map(([l, v, c]) => cell([para(v, { size: 40, bold: true, color: c, align: AlignmentType.CENTER, after: 0 }), para(l, { size: 16, color: "5B6478", align: AlignmentType.CENTER, after: 0 })], kw, { fill: "F4F6FA" })) })]));
  kids.push(para(`Del conjunto seleccionado, ${byS.Completado || 0} de ${total} están completados y el avance promedio es ${avg}%. ${byS.Atrasado ? byS.Atrasado + " requerimiento(s) están atrasados" : "Ningún requerimiento está atrasado"}${byS.Bloqueado ? " y " + byS.Bloqueado + " bloqueado(s)" : ""}${dels.length ? `; ${dels.filter(x => x.state !== "pendiente").length} de ${dels.length} entregables ya fueron entregados` : ""}.`, { before: 140, after: 100 }));
  kids.push(h("Puntos de atención", HeadingLevel.HEADING_3, { before: 120 }));
  if (attention.length) {
    attention.slice(0, 12).forEach(r => {
      const bl = (r.acts || []).filter(a => a.blocked).map(a => a.blockReason || a.name).filter(Boolean).join("; ");
      kids.push(para([run(`${r.code} · ${r.title}`, { bold: true }), run(` — ${reqSt(r) === "Bloqueado" ? "Bloqueado" + (bl ? ": " + bl : "") : plazo(r)}`, { color: reqSt(r) === "Bloqueado" ? ST.Bloqueado.fg : ST.Atrasado.fg }), run(`  ·  ${calc.mnames(r)}`, { color: "5B6478" })], { bullet: { level: 0 }, after: 40 }));
    });
  } else kids.push(para("Sin requerimientos atrasados ni bloqueados.", { color: ST.Completado.fg, bold: true }));
  if (attention.length > 12) kids.push(para(`… y ${attention.length - 12} más (ver tabla siguiente).`, { italics: true, color: "5B6478" }));

  // ---- vista general ----
  kids.push(h("2. Vista general de requerimientos", HeadingLevel.HEADING_1, { size: 30, pageBreakBefore: true }));
  const ow = [1000, 2700, 1200, 1200, 1200, 800, 1050, 1050, 1500, 1500, 1200];
  kids.push(table(ow, [head(ow, ["Código", "Requerimiento", "Cliente", "Tipo", "Estado", "Avance", "Inicio", "Fin", "Plazo", "Responsables QA", "Resp. de requerimiento"]),
    ...list.map(r => {
      const [s, e] = calc.span(r), st = reqSt(r);
      return new TableRow({ cantSplit: true, children: [cell(r.code, ow[0], { bold: true, size: 18 }), cell(r.title, ow[1], { size: 18 }), cell(calc.clientName(r.clientId), ow[2], { size: 18 }), cell(calc.typeName(r.type), ow[3], { size: 18 }), stCell(st, ow[4]), cell(calc.progress(r) + "%", ow[5], { size: 18, bold: true, align: AlignmentType.CENTER }), cell(fmt(s), ow[6], { size: 18 }), cell(fmt(e), ow[7], { size: 18 }), cell(plazo(r), ow[8], { size: 18, color: st === "Atrasado" ? ST.Atrasado.fg : undefined }), cell(calc.mnames(r), ow[9], { size: 18 }), cell(calc.lnames(r) || "—", ow[10], { size: 18 })] });
    })]));

  // ---- detalle por requerimiento ----
  kids.push(h("3. Detalle por requerimiento", HeadingLevel.HEADING_1, { size: 30, pageBreakBefore: true }));
  list.forEach((r, i) => {
    const [s, e] = calc.span(r), st = reqSt(r), p = calc.progress(r), M = r.metrics || {};
    kids.push(h(`${r.code} · ${r.title}`, HeadingLevel.HEADING_2, { before: i ? 0 : 60, pageBreakBefore: i > 0, size: 26 }));
    const mw = [2000, 5200, 2000, 5200], lab = (t: string, w: number) => cell(t, w, { fill: "EEF2FB", bold: true, size: 18, color: NAVY }), val = (t: string, w: number, oo: Opt = {}) => cell(t, w, { size: 18, ...oo });
    const pair = (a: string, b: string, c: string, dd: string, oo: { b?: Opt; d?: Opt } = {}) => new TableRow({ cantSplit: true, children: [lab(a, mw[0]), val(b, mw[1], oo.b), lab(c, mw[2]), val(dd, mw[3], oo.d)] });
    kids.push(table(mw, [
      pair("Cliente", calc.clientName(r.clientId), "Tipo", calc.typeName(r.type)),
      pair("Estado", st, "Avance", `${p}%`, { b: { bold: true, color: (ST[st] || ST.Pendiente).fg }, d: { bold: true } }),
      pair("Inicio", fmt(s), "Fin", `${fmt(e)}  (${days(s, e)} días en total)`),
      pair("Prioridad", r.priority || "—", "Etapa del proyecto", r.bucket || "—"),
      pair("Responsables QA", calc.mnames(r), "Responsables de requerimiento", calc.lnames(r) || "—"),
      pair("Fecha comprometida", r.committedEnd ? fmt(r.committedEnd) : "—", "Plazo", plazo(r), { d: { color: st === "Atrasado" ? ST.Atrasado.fg : undefined, bold: st === "Atrasado" } }),
      pair("Última actualización", fmt(r.lastUpdate), "ID work item", M.wiId || "—"),
      ...(M.wiUrl ? [pair("Enlace work item", M.wiUrl, "", "")] : []),
    ]));

    // actividades
    kids.push(h(`Actividades (${(r.acts || []).length})`, HeadingLevel.HEADING_3));
    if ((r.acts || []).length) {
      const aw = [500, 3800, 2100, 1200, 1200, 1000, 900, 1300, 2400];
      kids.push(table(aw, [head(aw, ["N°", "Actividad", "Responsable", "Inicio", "Fin", "Duración", "Avance", "Estado", "Observaciones"]),
        ...r.acts.map((a, k) => {
          const as = actSt(a), obs = a.blocked ? "Bloqueada" + (a.blockReason ? ": " + a.blockReason : "") + (a.blockedSince ? ` (desde ${fmt(a.blockedSince)})` : "") : as === "Atrasada" ? calc.lvlTxt(calc.daysLate(a.end)) + " de atraso" : "";
          return new TableRow({ cantSplit: true, children: [cell(k + 1, aw[0], { size: 18, align: AlignmentType.CENTER }), cell(a.name, aw[1], { size: 18, bold: true }), cell(calc.mnames(a, r), aw[2], { size: 18 }), cell(fmt(a.start), aw[3], { size: 18 }), cell(fmt(a.end), aw[4], { size: 18 }), cell(days(a.start, a.end) + " d", aw[5], { size: 18, align: AlignmentType.CENTER }), cell((a.percent || 0) + "%", aw[6], { size: 18, bold: true, align: AlignmentType.CENTER }), stCell(actKey(as), aw[7]), cell(obs, aw[8], { size: 16, color: as === "Atrasada" ? ST.Atrasado.fg : as === "Bloqueada" ? ST.Bloqueado.fg : undefined })] });
        }),
        new TableRow({ cantSplit: true, children: [cell("Avance general del requerimiento", aw[0] + aw[1] + aw[2] + aw[3] + aw[4] + aw[5], { span: 6, fill: "EEF2FB", bold: true, size: 18, color: NAVY }), cell(p + "%", aw[6], { fill: "EEF2FB", bold: true, size: 18, align: AlignmentType.CENTER }), cell(st, aw[7], { fill: (ST[st] || ST.Pendiente).bg, color: (ST[st] || ST.Pendiente).fg, bold: true, size: 18, align: AlignmentType.CENTER }), cell("", aw[8], { fill: "EEF2FB" })] }),
      ]));
    } else kids.push(para("Sin actividades registradas.", { italics: true, color: "5B6478" }));

    // entregables
    if ((r.deliverables || []).length) {
      kids.push(h(`Entregables (${r.deliverables.length})`, HeadingLevel.HEADING_3));
      const dw = [6000, 2000, 2200, 4200], dst = (x: Requirement["deliverables"][number]) => (x.state === "pendiente" ? (x.due && x.due < today ? "Vencido" : "Pendiente") : x.state === "validado" ? "Validado" : "Entregado");
      kids.push(table(dw, [head(dw, ["Entregable", "Fecha comprometida", "Estado", "Enlace"]),
        ...r.deliverables.map(x => {
          const t = dst(x);
          return new TableRow({ cantSplit: true, children: [cell(x.name, dw[0], { size: 18, bold: true }), cell(fmt(x.due), dw[1], { size: 18 }), cell(t, dw[2], { size: 18, bold: true, align: AlignmentType.CENTER, fill: t === "Vencido" ? ST.Atrasado.bg : t === "Pendiente" ? ST.Pendiente.bg : ST.Completado.bg, color: t === "Vencido" ? ST.Atrasado.fg : t === "Pendiente" ? ST.Pendiente.fg : ST.Completado.fg }), cell(x.url || "—", dw[3], { size: 16 })] });
        })]));
    }

    // métricas de calidad
    const n = (k: keyof typeof M) => (M[k] === "" || M[k] == null ? null : +(M[k] as number)), pc = (a: number | null, b: number | null) => (b != null && b > 0 && a != null ? Math.round((a / b) * 100) + "%" : "—");
    if (["designed", "executed", "passed", "failed", "automated", "crit", "high", "med", "low"].some(k => n(k as keyof typeof M) != null)) {
      kids.push(h("Métricas de calidad", HeadingLevel.HEADING_3));
      const cols: [string, string | number][] = [["Diseñados", n("designed") ?? "—"], ["Ejecutados", n("executed") ?? "—"], ["Aprobados", n("passed") ?? "—"], ["Fallidos", n("failed") ?? "—"], ["Automatizados", n("automated") ?? "—"], ["% ejecución", pc(n("executed"), n("designed"))], ["% aprobación", pc(n("passed"), n("executed"))], ["% automatización", pc(n("automated"), n("designed"))], ["Defectos (crít/alto/medio/bajo)", [n("crit"), n("high"), n("med"), n("low")].map(v => v ?? 0).join(" / ")]];
      const w = [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1800];
      kids.push(table(w, [head(w, cols.map(c => c[0])), new TableRow({ cantSplit: true, children: cols.map((c, k) => cell(c[1], w[k], { size: 20, bold: true, align: AlignmentType.CENTER })) })]));
    }

    // comentarios recientes
    const cm = (r.comments || []).slice().sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 5);
    if (cm.length) {
      kids.push(h("Últimos comentarios", HeadingLevel.HEADING_3));
      cm.forEach(c => kids.push(para([run(`${fmt(c.at)} · ${c.by || "—"}: `, { bold: true, size: 18 }), run(String(c.text || "").slice(0, 500), { size: 18 })], { bullet: { level: 0 }, after: 40 })));
    }
  });

  const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`Dashboard QA · ${o.scope} · emitido el ${fmt(today)}   |   Página `, { size: 16, color: "5B6478" }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: "5B6478" }), run(" de ", { size: 16, color: "5B6478" }), new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: "5B6478" })] })] });
  const doc = new Document({
    creator: o.author, title: `Informe de seguimiento QA — ${o.scope}`, description: "Resumen de actividades de requerimientos QA",
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } }, footers: { default: footer }, children: kids as never[] }],
  });
  return Packer.toBlob(doc);
}
