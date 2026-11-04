import { fd, pct, STALE } from "@qa/core";
import { Tip } from "../components/Hint";
import { useApp, useCalc, useScoped } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { Kpi } from "./Dashboard";

const sum = (l: number[]) => l.reduce((a, b) => a + b, 0);

export function Resumen() {
  const { store, clientId } = useApp();
  const openReq = useDialogs(s => s.openReq);
  const calc = useCalc(), all = useScoped();
  const act = all.filter(r => r.status !== "Completado"), hs = act.map(r => ({ r, h: calc.health(r) }));
  const cnt = (l: string) => hs.filter(x => x.h.lvl === l).length;
  const M = (r: (typeof all)[number], k: "designed" | "executed" | "automated" | "crit" | "high") => +(r.metrics?.[k] as number) || 0;
  const done = all.filter(r => r.status === "Completado" && r.completedAt), onTime = done.filter(r => r.completedAt! <= (r.committedEnd || r.end)).length;
  const designed = sum(all.map(r => M(r, "designed")));
  const ex = pct(sum(all.map(r => M(r, "executed"))), designed), au = pct(sum(all.map(r => M(r, "automated"))), designed);
  const crit = sum(act.map(r => M(r, "crit") + M(r, "high")));
  const att = hs.filter(x => x.h.lvl !== "g").sort((x, y) => (x.h.lvl === "r" ? 0 : 1) - (y.h.lvl === "r" ? 0 : 1) || calc.span(x.r)[1].localeCompare(calc.span(y.r)[1]));
  const clients = store.clients.filter(c => clientId === "all" || c.id === clientId);
  const P = (v: number | null) => (v !== null ? v + "%" : "—");
  return (
    <section id="v-resumen" className="view">
      <div className="toolbar"><h2 className="vtitle">Resumen ejecutivo</h2><span className="muted">Semáforo: <b className="g">verde</b> en plazo · <b className="y">amarillo</b> riesgo · <b className="r">rojo</b> crítico. Respeta el cliente elegido arriba.</span></div>
      <div className="kpis" id="resKpis">
        <Kpi label="En curso" value={act.length} />
        <Kpi label="🟢 En plazo" value={cnt("g")} />
        <Kpi label="🟡 En riesgo" value={cnt("y")} />
        <Kpi label="🔴 Críticos" value={cnt("r")} />
        <Kpi label="Cumplimiento de plazos" value={done.length ? pct(onTime, done.length) + "%" : "—"} />
        <Kpi label="Entregables vencidos" value={sum(act.map(r => calc.delOverdue(r).length))} />
        <Kpi label="Ejecución de casos" value={P(ex)} />
        <Kpi label="Automatizado" value={P(au)} />
        <Kpi label="Defectos críticos/altos" value={crit} />
      </div>
      <div className="card">
        <h2><Tip group="head">Por cliente</Tip></h2>
        <div className="tablewrap">
          <table id="resCli">
            <thead><tr>{["Cliente", "Total", "En curso", "Verde", "Amarillo", "Rojo", "Atrasados", "Sin actualizar", "Entreg. vencidos", "Ejecución", "Automatizado", "Defectos abiertos"].map(h => <th key={h}><Tip group="res">{h}</Tip></th>)}</tr></thead>
            <tbody>
              {clients.map(c => {
                const rs = store.reqs.filter(r => r.clientId === c.id), ac = rs.filter(r => r.status !== "Completado"), h = ac.map(calc.health);
                const d = sum(rs.map(r => M(r, "designed")));
                return (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td><td>{rs.length}</td><td>{ac.length}</td>
                    <td><span className="dot g" /> {h.filter(x => x.lvl === "g").length}</td><td><span className="dot y" /> {h.filter(x => x.lvl === "y").length}</td><td><span className="dot r" /> {h.filter(x => x.lvl === "r").length}</td>
                    <td>{ac.filter(calc.late).length}</td><td>{ac.filter(r => calc.staleDays(r) >= STALE).length}</td><td>{sum(ac.map(r => calc.delOverdue(r).length))}</td>
                    <td>{P(pct(sum(rs.map(r => M(r, "executed"))), d))}</td><td>{P(pct(sum(rs.map(r => M(r, "automated"))), d))}</td><td>{sum(ac.map(calc.openDef))}</td>
                  </tr>
                );
              })}
              {!clients.length && <tr><td className="muted">Sin clientes</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2><Tip group="head">Requerimientos que necesitan atención</Tip></h2>
        <div id="resAtt">
          {att.length ? att.map(({ r, h }) => (
            <div className="hrow" key={r.id} onClick={() => openReq(r.id)}>
              <div className="hinfo"><span className={"dot " + h.lvl} /> <b>{r.code}</b> · {r.title} <small className="muted">{calc.clientName(r.clientId)} · {calc.mnames(r)} · plazo {fd(calc.span(r)[1])}</small>
                <div className="hact">{h.why.join(" · ")}</div></div>
              <div className="hctl"><button className="ghost">Abrir</button></div>
            </div>
          )) : <p className="muted">Nada en riesgo. Todo en plazo 👌</p>}
        </div>
      </div>
    </section>
  );
}
