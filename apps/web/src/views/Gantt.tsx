import { useRef } from "react";
import { badDate, d2n, dateBounds, DAY, fd, ganttHtml, ganttPrintDocument, ganttXlsDocument, makeCalc, n2d, type Requirement } from "@qa/core";
import { Tip } from "../components/Hint";
import { download } from "../lib/files";
import { authorName, useApp, useCalc, useVisible } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { askReason, pickReqs, say } from "../state/ui";

const ZOOMS: [number, string][] = [[32, "Día"], [14, "Semana"], [5, "Mes"]];

type Kind = "req" | "act" | "sum";
interface BarProps { kind: Kind; reqId: string; actId?: string; start: string; end: string; cls: string; label: string; pct: number; drag: boolean; left: number; width: number; showLabel: boolean }

/** Barra del Gantt: se puede mover (centro) o redimensionar (bordes) arrastrándola, solo en modo Editor. */
function Bar(p: BarProps) {
  const { pxDay, readOnly, commit } = useApp();
  const calc = useCalc(), openReq = useDialogs(s => s.openReq);
  const moved = useRef(false);
  const today = calc.today;
  const down = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || !p.drag) return;
    const bar = ev.currentTarget, target = ev.target as HTMLElement;
    const mode = target.classList.contains("l") ? "l" : target.classList.contains("r") ? "r" : "m";
    const x0 = ev.clientX, s0 = d2n(p.start), e0 = d2n(p.end), l0 = bar.offsetLeft, w0 = bar.offsetWidth;
    let ns = s0, ne = e0;
    moved.current = false;
    bar.setPointerCapture?.(ev.pointerId);
    const reset = () => { bar.style.left = l0 + "px"; bar.style.width = w0 + "px"; };
    const mv = (e: PointerEvent) => {
      const dd = Math.round((e.clientX - x0) / pxDay);
      if (dd) moved.current = true;
      ns = mode === "r" ? s0 : s0 + dd; ne = mode === "l" ? e0 : e0 + dd;
      if (mode === "l") ns = Math.min(ns, e0);
      if (mode === "r") ne = Math.max(ne, s0);
      bar.style.left = l0 + (ns - s0) * pxDay + "px";
      bar.style.width = w0 + (ne - ns - (e0 - s0)) * pxDay + "px";
    };
    const up = async () => {
      bar.removeEventListener("pointermove", mv); bar.removeEventListener("pointerup", up);
      const fin = () => setTimeout(() => (moved.current = false), 0);
      if (!moved.current) return;
      const nsD = n2d(ns), neD = n2d(ne), r = useApp.getState().store.reqs.find(x => x.id === p.reqId);
      if (!r) return reset();
      if (badDate(nsD, today) || badDate(neD, today)) {
        const b = dateBounds(today);
        say("Error: fecha fuera de rango: solo se permiten fechas entre " + fd(b.min) + " y " + fd(b.max) + ".", true);
        reset(); return fin();
      }
      // simulación del nuevo plazo del requerimiento
      const sim = { ...r, start: r.start, end: r.end, acts: r.acts.map(a => (p.kind === "act" && a.id === p.actId ? { ...a, start: nsD, end: neD } : a)) };
      if (p.kind === "req") { sim.start = nsD; sim.end = neD; }
      const oldEnd = calc.span(r)[1], newEnd = calc.span(sim)[1];
      let why: string | null = "";
      if (newEnd !== oldEnd) {
        why = await askReason(`${r.code}: el plazo del requerimiento cambia de ${fd(oldEnd)} a ${fd(newEnd)}.`);
        if (why === null) { reset(); return fin(); }
      }
      const by = authorName(), at = new Date().toISOString(), rid = p.reqId, aid = p.actId, kind = p.kind;
      commit(s => {
        const rr = s.reqs.find(x => x.id === rid); if (!rr) return;
        const tt = kind === "act" ? rr.acts.find(x => x.id === aid) : rr; if (!tt) return;
        const c2 = makeCalc(s, today), before = c2.span(rr)[1];
        tt.start = nsD; tt.end = neD;
        const [s0b, e0b] = c2.span(rr);
        rr.start = s0b; rr.end = e0b; rr.lastUpdate = at;
        if (why && e0b !== before) rr.dateLog.push({ at, by, from: before, to: e0b, reason: why });
      });
      say("Guardado ✓"); fin();
    };
    bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up);
  };
  return (
    <div className={"bar " + p.cls + (p.drag ? "" : " nodrag")} style={{ left: p.left, width: p.width }} title={`${p.label} · ${p.pct}%`} onPointerDown={down} onClick={() => { if (!moved.current) openReq(p.reqId); }}>
      <div className="fill" style={{ width: p.pct + "%" }} /><i className="h l" /><span>{p.showLabel ? p.label : ""}</span><i className="h r" />
    </div>
  );
}

export function Gantt() {
  const { pxDay, setPxDay, readOnly, clientId } = useApp();
  const openReq = useDialogs(s => s.openReq);
  const calc = useCalc(), list = useVisible();
  const today = calc.today;

  const exportXls = async () => {
    const pick = await pickReqs({ title: "Exportar Gantt (Excel)", ok: "Exportar Excel", list, hint: "Elige los requerimientos que quieres incluir en la carta Gantt." });
    if (!pick) return;
    const t = ganttHtml(pick, calc, clientId === "all" ? "Todos los clientes" : calc.clientName(clientId), false);
    if (!t) return say("No hay requerimientos para exportar.", true);
    download(new Blob(["﻿" + ganttXlsDocument(t)], { type: "application/vnd.ms-excel" }), `carta-gantt-qa-${today}.xls`);
    say("Gantt exportado ✓");
  };
  const exportPdf = async () => {
    const pick = await pickReqs({ title: "Exportar Gantt (PDF)", ok: "Exportar PDF", list, hint: "Elige los requerimientos que quieres incluir en la carta Gantt." });
    if (!pick) return;
    const t = ganttHtml(pick, calc, clientId === "all" ? "Todos los clientes" : calc.clientName(clientId), true);
    if (!t) return say("No hay requerimientos para exportar.", true);
    const w = window.open("", "_blank");
    if (!w) return say("El navegador bloqueó la ventana del PDF. Permite ventanas emergentes para este sitio y vuelve a intentarlo.", true);
    w.document.open(); w.document.write(ganttPrintDocument(t, today)); w.document.close();
  };

  let body: React.ReactNode;
  if (!list.length) body = <p className="muted" style={{ padding: 20 }}>Sin requerimientos para mostrar.</p>;
  else {
    const all = list.flatMap(r => calc.span(r)).map(d2n);
    const min = Math.min(...all, d2n(today)) - 5, max = Math.max(...all, d2n(today)) + 15, W = (max - min + 1) * pxDay, x = (n: number) => (n - min) * pxDay;
    const ticks: React.ReactNode[] = [];
    for (let n = min; n <= max; n++) {
      const d = new Date(n * DAY), dd = d.getUTCDate();
      if (dd === 1 || n === min) ticks.push(<div key={"m" + n} className="g-tick m" style={{ left: x(n) }}>{d.toLocaleDateString("es", { month: "short", year: "2-digit", timeZone: "UTC" })}</div>);
      if (pxDay >= 28 || (pxDay >= 10 && d.getUTCDay() === 1)) ticks.push(<div key={"d" + n} className="g-tick d" style={{ left: x(n) }}>{dd}</div>);
    }
    const bar = (kind: Kind, r: Requirement, a: { start: string; end: string }, cls: string, label: string, pct: number, drag: boolean, actId?: string) => {
      const s = d2n(a.start), e = Math.max(d2n(a.end), s);
      return <Bar key={kind + r.id + (actId || "")} kind={kind} reqId={r.id} actId={actId} start={a.start} end={a.end} cls={cls} label={label} pct={pct} drag={drag} left={x(s)} width={(e - s + 1) * pxDay} showLabel={pxDay >= 14} />;
    };
    body = (
      <div className="g-inner" style={{ width: `calc(var(--lw) + ${W}px)` }}>
        <div className="g-head"><div className="g-row" style={{ height: 46, border: 0 }}><div className="g-label" style={{ cursor: "default" }}><Tip group="gantt">Requerimiento / actividad</Tip></div><div className="g-track" style={{ width: W }}>{ticks}</div></div></div>
        {list.map(r => {
          const [s, e] = calc.span(r), p = calc.progress(r), st = "st-" + (calc.late(r) && r.status !== "Bloqueado" ? "Atrasado" : r.status.replace(" ", "")), exp = !r.acts.length;
          return (
            <div key={r.id}>
              <div className="g-row grp">
                <div className="g-label" onClick={() => openReq(r.id)}>{r.code} · {r.title}<small>{r.type !== "trad" ? calc.typeName(r.type) + " · " : ""}{calc.mnames(r)} · {p}%</small></div>
                <div className="g-track" style={{ width: W }}>
                  {r.committedEnd && r.committedEnd !== e && <i className="cmark" style={{ left: x(d2n(r.committedEnd) + 1) }} title={"Fecha comprometida " + fd(r.committedEnd)} />}
                  {exp ? bar("req", r, r, st, r.code, p, true) : bar("sum", r, { start: s, end: e }, "st-sum", "", p, false)}
                </div>
              </div>
              {!exp && r.acts.map(a => {
                const ast = a.blocked ? "st-Bloqueado" : a.percent >= 100 ? "st-Completado" : a.end < today ? "st-Atrasado" : a.percent > 0 ? "st-Encurso" : "st-Pendiente";
                return (
                  <div className="g-row" key={a.id}>
                    <div className="g-label" onClick={() => openReq(r.id)}>&nbsp;&nbsp;{a.name}<small>{calc.mnames(a, r)}</small></div>
                    <div className="g-track" style={{ width: W }}>{bar("act", r, a, ast, a.percent + "%", a.percent, true, a.id)}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
        <div style={{ position: "absolute", left: "var(--lw)", top: 46, bottom: 0, width: W, pointerEvents: "none" }}><div className="today" style={{ left: x(d2n(today)) + pxDay / 2 }} /></div>
      </div>
    );
  }
  return (
    <section id="v-gantt" className="view">
      <div className="toolbar gtoolbar">
        <span className="muted gdesc">Muestra los requerimientos que dejes filtrados en la solapa Dashboard: cualquier filtro que apliques allá (tipo, rol, equipo, estado, prioridad, etapa o texto) se refleja aquí. Arrastra una barra para mover fechas (modo Editor).</span>
        <div className="gtools">
          <div className="seg" id="zoom">{ZOOMS.map(([z, l]) => <button key={z} className={z === pxDay ? "on" : ""} onClick={() => setPxDay(z)}>{l}</button>)}</div>
          <button id="btnGanttXls" className="ghost" onClick={exportXls}>Exportar Gantt (Excel)</button>
          <button id="btnGanttPdf" className="ghost" onClick={exportPdf}>Exportar Gantt (PDF)</button>
        </div>
      </div>
      <main id="gantt" className={"gantt" + (readOnly ? " read" : "")}>{body}</main>
    </section>
  );
}
