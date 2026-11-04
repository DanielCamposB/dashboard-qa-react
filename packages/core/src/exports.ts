// Exportaciones: CSV de seguimiento y carta Gantt (tabla HTML para Excel / PDF).
import type { Calc } from "./calc";
import { DAY, d2n, fd } from "./dates";
import { csvSafe } from "./text";
import type { Requirement } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function csvRows(list: Requirement[], calc: Calc): string[][] {
  return [["Cliente", "Código", "Título", "Tipo", "Responsable", "Estado", "Prioridad", "Etapa del proyecto", "Avance %", "Inicio", "Fin", "Comentarios"]].concat(
    list.map(r => {
      const [s, e] = calc.span(r);
      return [calc.clientName(r.clientId), r.code, r.title, calc.typeName(r.type), calc.mnames(r), r.status, r.priority || "", r.bucket || "", String(calc.progress(r)), fd(s), fd(e), r.comments.map(c => `${fd(c.at.slice(0, 10))} ${c.by}: ${c.text}`).join(" | ")];
    })
  );
}
export const toCsv = (rows: string[][]): string => "﻿" + rows.map(r => r.map(c => `"${csvSafe(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

const COL: Record<string, string> = { Completado: "#2e9e6a", "En curso": "#2f6fed", Bloqueado: "#e0861b", Atrasado: "#d6394a", Pendiente: "#9aa3b5" };

/** Tabla HTML de la carta Gantt (colores fijos para impresión; no depende del tema). */
export function ganttHtml(list: Requirement[], calc: Calc, scopeName: string, forPrint: boolean): string | null {
  const today = calc.today;
  const sorted = list.slice().sort((x, y) => calc.clientName(x.clientId).localeCompare(calc.clientName(y.clientId)) || x.code.localeCompare(y.code));
  if (!sorted.length) return null;
  const all = sorted.flatMap(r => calc.span(r)).concat(today).map(d2n);
  let min = Math.min(...all) - 1;
  const max = Math.max(...all) + 3;
  const weekly = max - min > 100;
  if (weekly) min -= (new Date(min * DAY).getUTCDay() + 6) % 7; // lunes
  const step = weekly ? 7 : 1, cols: number[] = [];
  for (let n = min; n <= max; n += step) cols.push(n);
  const tint = (c: string) => c + "55";
  const months: { k: string; n: number }[] = [];
  cols.forEach(n => {
    const d = new Date(n * DAY), k = d.toLocaleDateString("es", { month: "short", year: "2-digit", timeZone: "UTC" });
    const l = months[months.length - 1];
    if (l && l.k === k) l.n++; else months.push({ k, n: 1 });
  });
  const today0 = d2n(today);
  const cell = (n: number, s: number, e: number, pct: number, color: string) => {
    const to = n + step - 1, isToday = today0 >= n && today0 <= to;
    const wk = !weekly && [0, 6].includes(new Date(n * DAY).getUTCDay());
    const border = isToday ? "border-left:2px solid #d6394a;" : "";
    if (e < n || s > to) return `<td style="${border}${wk ? "background:#f0f0f0;" : ""}"></td>`;
    const len = e - s + 1, done = Math.round((pct / 100) * len), idx = Math.max(n, s) - s;
    return `<td style="${border}background:${idx < done ? color : tint(color)};"></td>`;
  };
  const th = "background:#0b1220;color:#fff;font-weight:bold;text-align:center;border:1px solid #333;";
  let t = `<table border="1" cellspacing="0" cellpadding="3" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:${forPrint ? 8 : 11}pt">
      <tr><td colspan="${9 + cols.length}" style="font-size:16pt;font-weight:bold;border:0">Carta Gantt QA — ${esc(scopeName)}</td></tr>
      <tr><td colspan="${9 + cols.length}" style="border:0;color:#555">Generada el ${fd(today)} · Vista ${weekly ? "semanal" : "diaria"} · Avance: tono fuerte = completado, tono claro = pendiente · Línea roja = hoy</td></tr>
      <tr>${["Cliente", "Requerimiento", "Actividad", "Responsable", "Inicio", "Fin", "Avance", "Estado", "Tipo"].map(x => `<td rowspan="2" style="${th}">${x}</td>`).join("")}${months.map(m => `<td colspan="${m.n}" style="${th}">${esc(m.k)}</td>`).join("")}</tr>
      <tr>${cols.map(n => { const d = new Date(n * DAY); return `<td style="${th}font-size:${weekly ? 7 : 8}pt">${weekly ? d.getUTCDate() + "/" + (d.getUTCMonth() + 1) : d.getUTCDate()}</td>`; }).join("")}</tr>`;
  const row = (cl: string, req: string, act: string, who: string, s: string, e: string, pct: number, st: string, tipo: string, bold: boolean) =>
    `<tr style="${bold ? "font-weight:bold;background:#eef2fb;" : ""}"><td>${esc(cl)}</td><td>${esc(req)}</td><td>${esc(act)}</td><td>${esc(who)}</td><td>${esc(fd(s))}</td><td>${esc(fd(e))}</td><td style="text-align:center">${esc(pct)}%</td><td style="color:${COL[st]};font-weight:bold">${esc(st)}</td><td>${esc(tipo)}</td>${cols.map(n => cell(n, d2n(s), d2n(e), pct, COL[st])).join("")}</tr>`;
  for (const r of sorted) {
    const [s, e] = calc.span(r), p = calc.progress(r);
    t += row(calc.clientName(r.clientId), `${r.code} · ${r.title}`, r.acts.length ? "(resumen)" : "—", calc.mnames(r), s, e, p, calc.reqStatusLabel(r), calc.typeName(r.type), true);
    r.acts.forEach(a => (t += row("", "", a.name, calc.mnames(a, r), a.start, a.end, a.percent, calc.actState(a), "", false)));
  }
  return t + "</table>";
}

export const ganttXlsDocument = (table: string) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Carta Gantt</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>${table}</body></html>`;

export const ganttPrintDocument = (table: string, today: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Carta Gantt QA ${today}</title><style>@page{size:A3 landscape;margin:10mm}body{margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}table td{padding:2px 4px;white-space:nowrap}</style></head><body>${table}<script>onload=()=>setTimeout(()=>print(),300)</script></body></html>`;
