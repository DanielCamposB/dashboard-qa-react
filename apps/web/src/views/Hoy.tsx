import { useMemo, useState } from "react";
import { d2n, fd, localDate, lvlTxt, makeCalc, STALE, uid, type Activity, type Requirement } from "@qa/core";
import { Hint, Tip } from "../components/Hint";
import { FormErr, useFieldErrors } from "../components/forms";
import { notifyBlocked } from "../lib/plannerSync";
import { D } from "../lib/data";
import { lsGet, lsSet } from "../lib/storage";
import { authorName, useApp, useCalc, useScoped } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { say } from "../state/ui";

const pctOpts = (cur: number) => { const l = Array.from({ length: 21 }, (_, i) => i * 5); if (!l.includes(cur) && cur >= 0) { l.push(cur); l.sort((x, y) => x - y); } return l; };

function HoyRow({ r, a }: { r: Requirement; a: Activity }) {
  const calc = useCalc(), readOnly = useApp(s => s.readOnly), commit = useApp(s => s.commit);
  const [pct, setPct] = useState(a.percent), [text, setText] = useState(""), [blocked, setBlocked] = useState(!!a.blocked);
  const fe = useFieldErrors();
  const today = calc.today;
  const late = a.end < today ? <> · <b className="red">{lvlTxt(calc.daysLate(a.end))} de atraso</b></> : null;
  const blk = a.blocked ? <> · <b className="orange">Bloqueada {a.blockedSince ? lvlTxt(d2n(today) - d2n(a.blockedSince)) : ""}</b> {a.blockReason ? "— " + a.blockReason : ""}</> : null;
  const register = () => {
    const isBlocked = blocked && pct < 100, t = text.trim();
    if (isBlocked && !t && !a.blockReason) return fe.set("c", "Indica el motivo del bloqueo en el comentario.");
    const wasBlocked0 = !!a.blocked, by = authorName(), at = new Date().toISOString(), cid = uid(), rid = r.id, aid = a.id;
    commit(s => {
      const rr = s.reqs.find(x => x.id === rid), x = rr?.acts.find(y => y.id === aid);
      if (!rr || !x) return;
      const before = x.percent, wasB = x.blocked;
      x.percent = pct; x.blocked = isBlocked;
      if (isBlocked) { if (!wasB || !x.blockedSince) x.blockedSince = today; if (t) x.blockReason = t; } else { x.blockReason = ""; x.blockedSince = ""; }
      const msg = t || (before !== pct ? `Avance ${before}% → ${pct}%` : isBlocked !== wasB ? (isBlocked ? "Bloqueada" : "Desbloqueada") : "");
      if (msg && !rr.comments.some(k => k.id === cid)) rr.comments.push({ id: cid, at, by, text: `[${x.name} · ${pct}%${isBlocked ? " · BLOQUEADA" : ""}] ${msg}` });
      makeCalc(s, today).statusSync(rr, at);
    });
    say("Registrado ✓");
    setText("");
    if (isBlocked && !wasBlocked0) notifyBlocked(rid, aid, t || a.blockReason || "", D.remote);
  };
  return (
    <div className="hrow">
      <div className="hinfo">
        <b>{r.code}</b> · {r.title} <small className="muted">{calc.clientName(r.clientId)}</small>
        <div className="hact">{a.name} · {calc.mnames(a, r)} · vence {fd(a.end)}{late}{blk}</div>
      </div>
      {readOnly
        ? <div className="hctl"><span className="pbar"><i style={{ width: a.percent + "%" }} /><span>{a.percent}%</span></span></div>
        : (
          <div className="hctl">
            <select className="hp" aria-label="Avance" value={pct} onChange={e => setPct(+e.target.value)}>{pctOpts(a.percent).map(p => <option key={p} value={p}>{p}</option>)}</select>
            <span className="ferrhost">
              <FormErr msg={fe.errors.c} />
              <input className={"hc" + (fe.errors.c ? " bad" : "")} placeholder="Comentario (obligatorio si bloqueas)" aria-label="Comentario" value={text} onChange={e => { setText(e.target.value); fe.clear("c"); }} />
            </span>
            <label className="hb"><input type="checkbox" className="hbk" checked={blocked} onChange={e => setBlocked(e.target.checked)} /> Bloqueada</label>
            <button className="primary hs" onClick={register}>Registrar</button>
          </div>
        )}
    </div>
  );
}

export function Hoy() {
  const calc = useCalc(), scoped = useScoped(), user = useApp(s => s.user);
  const openReq = useDialogs(s => s.openReq);
  const [mineOn, setMine] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(() => { try { return new Set<string>(JSON.parse(lsGet("qa-hoy-closed", "[]"))); } catch { return new Set(); } });
  const me = calc.myMemberId(user), mine = mineOn && !!me, today = calc.today;
  const items = useMemo(() => {
    const out: { r: Requirement; a: Activity }[] = [];
    scoped.forEach(r => { if (r.status === "Completado") return; r.acts.forEach(a => { if (a.percent >= 100) return; if (mine && !calc.effIds(a, r).includes(me)) return; out.push({ r, a }); }); });
    return out;
  }, [scoped, calc, mine, me]);
  const t0 = d2n(today), within = (i: { a: Activity }, n: number) => d2n(i.a.end) > t0 && d2n(i.a.end) <= t0 + n;
  const groups: [string, string, typeof items][] = [
    ["Atrasadas", "al3", items.filter(i => i.a.end < today && !i.a.blocked)],
    ["Vencen hoy", "al1", items.filter(i => i.a.end === today && !i.a.blocked)],
    ["Bloqueadas", "al2", items.filter(i => i.a.blocked)],
    ["En ejecución hoy", "", items.filter(i => i.a.start <= today && i.a.end > today && !within(i, 3) && !i.a.blocked)],
    ["Vencen en los próximos 3 días", "al0", items.filter(i => within(i, 3) && !i.a.blocked)],
  ];
  const stale = calc.staleList(scoped).filter(r => !mine || calc.ids(r).includes(me));
  const keys = [...groups.map(g => g[0]), "stale"];
  const save = (s: Set<string>) => { setClosed(s); lsSet("qa-hoy-closed", JSON.stringify([...s])); };
  const toggle = (k: string) => { const n = new Set(closed); n.has(k) ? n.delete(k) : n.add(k); save(n); };
  const grp = (key: string, cls: string, n: number, title: string, body: React.ReactNode) => (
    <div className={"card hgroup" + (closed.has(key) ? " closed" : "")} key={key}>
      <h3 className={cls + " htog"} role="button" tabIndex={0} aria-expanded={!closed.has(key)} title="Clic para expandir o minimizar" onClick={() => toggle(key)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(key); } }}>
        <span className="hcount">{n}</span> {title}<span className="hchev">▾</span>
      </h3>
      <div className="hbody">{body}</div>
    </div>
  );
  return (
    <section id="v-hoy" className="view">
      <div className="toolbar">
        <h2 className="vtitle"><Tip group="head">Seguimiento de hoy</Tip></h2>
        <label className="chk"><input type="checkbox" id="hoyMine" checked={mineOn} onChange={e => setMine(e.target.checked)} /> Solo mis actividades <Hint tip="Muestra únicamente las actividades asignadas a ti." /></label>
        <span className="muted" id="hoyMineNote">{mineOn && !me ? "No encontré tu correo en la pestaña Equipo; se muestran todas." : ""}</span>
        <div className="spacer" />
        <button type="button" id="hoyExpand" className="ghost" onClick={() => save(new Set())}>Expandir todo</button>
        <button type="button" id="hoyCollapse" className="ghost" onClick={() => save(new Set(keys))}>Minimizar todo</button>
        <span className="muted" id="hoyDate">{new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>
      <div id="hoyBody" className="hoy">
        {groups.map(([t, cls, list]) => grp(t, cls, list.length, t, list.length ? list.slice().sort((x, y) => x.a.end.localeCompare(y.a.end)).map(i => <HoyRow key={i.r.id + i.a.id} r={i.r} a={i.a} />) : <p className="muted">Nada por aquí 👌</p>))}
        {grp("stale", "alS", stale.length, `Requerimientos sin actualizar (≥ ${STALE} días hábiles)`, stale.length
          ? stale.map(r => (
            <div className="hrow stale" key={r.id} onClick={() => openReq(r.id)}>
              <div className="hinfo"><b>{r.code}</b> · {r.title} <small className="muted">{calc.clientName(r.clientId)}</small>
                <div className="hact">{calc.mnames(r)} · último avance {fd(localDate(r.lastUpdate))} (hace {calc.staleDays(r)} días hábiles)</div></div>
              <div className="hctl"><button className="ghost">Abrir</button></div>
            </div>))
          : <p className="muted">Todo al día 👌</p>)}
      </div>
    </section>
  );
}
