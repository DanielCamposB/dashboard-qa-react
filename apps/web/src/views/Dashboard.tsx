import { useMemo } from "react";
import { BASE_TYPES, csvRows, fd, localDate, lvl, lvlTxt, toCsv } from "@qa/core";
import { Tip } from "../components/Hint";
import { download } from "../lib/files";
import { NO_FILTERS, useApp, useCalc, useScoped, useVisible } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { say } from "../state/ui";

export const Kpi = ({ label, value }: { label: string; value: React.ReactNode }) => <div className="kpi"><b>{value}</b><span><Tip group="kpi">{label}</Tip></span></div>;

export function PrioPill({ p }: { p?: string }) {
  return p ? <span className={"prio p-" + p}>{p}</span> : <>—</>;
}

const COLS = ["Código", "Requerimiento", "Tipo", "Responsables QA", "Estado", "Prioridad", "Etapa del proyecto", "Avance", "Entregables", "Inicio", "Fin", "Último seguimiento"];

export function Dashboard() {
  const { store, clientId, filters, setFilter, clearFilters, alertsOpen, setAlertsOpen } = useApp();
  const openReq = useDialogs(s => s.openReq);
  const calc = useCalc(), scoped = useScoped(), visible = useVisible();
  const al = useMemo(() => calc.alertsList(scoped), [calc, scoped]);
  const st = useMemo(() => calc.staleList(scoped), [calc, scoped]);
  const total = al.length + st.length;
  const c = (f: (r: (typeof scoped)[number]) => boolean) => scoped.filter(f).length;
  const buckets = useMemo(() => [...new Set(scoped.map(r => r.bucket).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [scoped]);
  const rows = useMemo(() => visible.slice().sort((a, b) => calc.span(a)[1].localeCompare(calc.span(b)[1])), [visible, calc]);
  const anyFilter = (Object.keys(NO_FILTERS) as (keyof typeof NO_FILTERS)[]).some(k => k === "text" ? filters.text.trim() : filters[k]);
  const showClient = clientId === "all";
  const head = showClient ? ["Cliente", ...COLS] : COLS;

  return (
    <section id="v-dash" className="view">
      <div id="alerts" className="alerts">
        {total > 0 && (
          <details open={alertsOpen} onToggle={e => setAlertsOpen((e.target as HTMLDetailsElement).open)}>
            <summary><b>{total} alerta{total > 1 ? "s" : ""}</b> · {al.length} de atraso · {st.length} sin actualizar</summary>
            {al.map(x => (
              <div key={x.r.id} className={"al al" + lvl(x.d)} onClick={() => openReq(x.r.id)}>
                <b>{lvlTxt(x.d)} de atraso</b> · {x.r.code} {x.r.title} · <span>{x.what}</span> · {calc.mnames(x.r)}
              </div>
            ))}
            {st.map(r => (
              <div key={r.id} className="al alS" onClick={() => openReq(r.id)}>
                <b>Sin actualizar hace {calc.staleDays(r)} días hábiles</b> · {r.code} {r.title} · <span>Último avance: {fd(localDate(r.lastUpdate))}</span> · {calc.mnames(r)}
              </div>
            ))}
          </details>
        )}
      </div>
      <div className="kpis" id="kpis">
        <Kpi label="Requerimientos" value={scoped.length} />
        <Kpi label="QA Express" value={c(r => r.type === "express")} />
        <Kpi label="QA Tradicional" value={c(r => r.type === "trad")} />
        <Kpi label="En curso" value={c(r => r.status === "En curso")} />
        <Kpi label="Bloqueados" value={c(r => r.status === "Bloqueado")} />
        <Kpi label="Atrasados" value={c(calc.late)} />
        <Kpi label="Sin actualizar" value={st.length} />
        <Kpi label="Entregables vencidos" value={scoped.reduce((n, r) => n + calc.delOverdue(r).length, 0)} />
        <Kpi label="Completados" value={c(r => r.status === "Completado")} />
      </div>
      <div className="toolbar">
        <select id="fType" aria-label="Filtrar por tipo" value={filters.type} onChange={e => setFilter("type", e.target.value)}>
          <option value="">Todos los tipos</option><option value="express">QA Express</option><option value="trad">QA Tradicional</option>
          {store.customTpl.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select id="fRole" aria-label="Filtrar por rol" value={filters.role} onChange={e => setFilter("role", e.target.value)}>
          <option value="">Todos los roles</option>{store.roles.map(r => <option key={r}>{r}</option>)}
        </select>
        <select id="fAssignee" aria-label="Filtrar por integrante" value={filters.assignee} onChange={e => setFilter("assignee", e.target.value)}>
          <option value="">Todo el equipo</option>{store.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select id="fPrio" aria-label="Filtrar por prioridad" value={filters.prio} onChange={e => setFilter("prio", e.target.value)}>
          <option value="">Todas las prioridades</option><option>Urgente</option><option>Importante</option><option>Media</option><option>Baja</option>
        </select>
        <select id="fBucket" aria-label="Filtrar por etapa del proyecto" value={buckets.includes(filters.bucket) ? filters.bucket : ""} onChange={e => setFilter("bucket", e.target.value)}>
          <option value="">Todas las etapas</option>{buckets.map(b => <option key={b}>{b}</option>)}
        </select>
        <select id="fStatus" aria-label="Filtrar por estado" value={filters.status} onChange={e => setFilter("status", e.target.value)}>
          <option value="">Todos los estados</option><option>Pendiente</option><option>En curso</option><option>Bloqueado</option><option>Completado</option>
        </select>
        <input id="fText" type="search" placeholder="Buscar código, título o comentario…" value={filters.text} onChange={e => setFilter("text", e.target.value)} />
        <button type="button" id="btnClearFilters" className="ghost" disabled={!anyFilter} title="Quita todos los filtros aplicados (se activa cuando hay alguno)" onClick={() => { clearFilters(); say("Filtros borrados ✓"); }}>✕ Borrar filtros</button>
        <div className="spacer" />
        <button id="btnCsv" onClick={() => download(new Blob([toCsv(csvRows(visible, calc))], { type: "text/csv" }), `seguimiento-qa-${calc.today}.csv`)}>Exportar CSV</button>
      </div>
      <div className="tablewrap">
        <table id="tbl">
          <thead><tr>{head.map(h => <th key={h}><Tip group="dash">{h}</Tip></th>)}</tr></thead>
          <tbody>
            {rows.map(r => {
              const p = calc.progress(r), [s, e] = calc.span(r), lc = calc.lastComment(r), h = calc.health(r), od = calc.delOverdue(r).length, sl = calc.slip(r);
              const cells: [string, React.ReactNode, string?][] = [
                ...(showClient ? [["Cliente", calc.clientName(r.clientId)] as [string, React.ReactNode]] : []),
                ["Código", <b>{r.code}</b>, "nw"],
                ["Requerimiento", r.title, "rq"],
                ["Tipo", <span className={"pill " + (BASE_TYPES[r.type] ? r.type : "custom")}>{calc.typeName(r.type)}</span>],
                ["Responsables QA", <>{calc.mnames(r)}<br /><small className="muted">{calc.rolesOf(r).join(", ")}</small>{calc.lnames(r) && <><br /><small>Líder: {calc.lnames(r)}</small></>}</>, "rs"],
                ["Estado", (
                  <div className="stk">
                    <span><span className={"dot " + h.lvl} title={h.why.join(" · ") || "En plazo"} /> <span className={"st st-" + r.status.replace(" ", "")}>{r.status}</span></span>
                    {calc.late(r) && <span className={"st al" + lvl(calc.daysLate(e))}>Atrasado {lvlTxt(calc.daysLate(e))}</span>}
                  </div>)],
                ["Prioridad", <PrioPill p={r.priority} />, "nw"],
                ["Etapa del proyecto", r.bucket || "—"],
                ["Avance", <div className="pbar"><i style={{ width: p + "%" }} /><span>{p}%</span></div>],
                ["Entregables", r.deliverables.length ? <>{calc.delDone(r)}/{r.deliverables.length}{od > 0 && <> <span className="st al3">{od} vencido(s)</span></>}</> : "—", "nw"],
                ["Inicio", fd(s), "nw"],
                ["Fin", <>{fd(e)}{sl > 0 && <> <span className="st al1" title={"Comprometida: " + fd(r.committedEnd)}>+{sl} d</span></>}</>, "nw"],
                ["Último seguimiento", <>{lc ? <><small>{fd(lc.at.slice(0, 10))} · {lc.by}</small><br />{lc.text.slice(0, 90)}</> : <small className="muted">Sin comentarios</small>} <small className="muted">({r.comments.length})</small></>, "lc"],
              ];
              return <tr key={r.id} onClick={() => openReq(r.id)}>{cells.map(([l, v, cls]) => <td key={l} data-l={l} className={cls}>{v}</td>)}</tr>;
            })}
            {!rows.length && <tr><td colSpan={head.length} className="muted" style={{ padding: 20 }}>Sin requerimientos. Usa "+ Requerimiento".</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
