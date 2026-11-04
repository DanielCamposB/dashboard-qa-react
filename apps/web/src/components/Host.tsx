import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Requirement } from "@qa/core";
import { useApp, useCalc } from "../state/app";
import { closeModal, dismissToast, trackAnchor, useUi, type ToastItem } from "../state/ui";
import { Modal } from "./Modal";

// ---------- avisos flotantes ----------
function ToastView({ t }: { t: ToastItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean; ax: number } | null>(null);
  // Si hay una ventana modal abierta, el aviso va dentro de ella (el resto de la página queda tapado).
  const host = (() => { const d = [...document.querySelectorAll("dialog[open]")].pop(); return (d as HTMLElement | undefined) ?? document.body; })();
  useLayoutEffect(() => {
    const el = ref.current, r = t.anchor;
    if (!el || !r || !r.width || r.bottom <= 0 || r.top >= innerHeight) return; // pegado encima del control (o debajo si no hay espacio arriba)
    const w = el.offsetWidth, h = el.offsetHeight, x = Math.min(Math.max(r.left + r.width / 2, w / 2 + 8), innerWidth - w / 2 - 8), above = r.top - h - 12 >= 8;
    setPos({ left: x, top: above ? r.top - h - 12 : r.bottom + 12, up: above, ax: Math.min(Math.max(r.left + r.width / 2 - (x - w / 2), 14), w - 14) });
  }, [t.anchor]);
  const style = pos ? ({ left: pos.left + "px", top: pos.top + "px", bottom: "auto", "--ax": pos.ax + "px" } as React.CSSProperties) : t.anchor ? { left: 0, top: 0, bottom: "auto" } : undefined;
  return createPortal(
    <div ref={ref} className={"toast" + (t.err ? " err" : "") + (pos ? " anch " + (pos.up ? "up" : "down") : t.anchor ? " anch" : "")} role="alert" style={style} onClick={() => dismissToast(t.id)}>{t.msg}</div>,
    host
  );
}

export function ToastHost() {
  const toasts = useUi(s => s.toasts);
  useEffect(() => {
    document.addEventListener("pointerdown", trackAnchor, true);
    document.addEventListener("focusin", trackAnchor, true);
    return () => { document.removeEventListener("pointerdown", trackAnchor, true); document.removeEventListener("focusin", trackAnchor, true); };
  }, []);
  return <>{toasts.map(t => <ToastView key={t.id} t={t} />)}</>;
}

// ---------- confirmaciones y ventanas de texto ----------
function AskDialog() {
  const m = useUi(s => s.modal);
  const open = m?.kind === "ask" || m?.kind === "askText";
  const [val, setVal] = useState(""), [err, setErr] = useState(false), [shake, setShake] = useState(0);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { if (m?.kind === "askText") { setVal(m.def); setErr(false); setTimeout(() => inp.current?.focus(), 30); } }, [m]);
  if (!open) return <Modal open={false} onCancel={() => {}} className="askdlg" formClass="askf" />;
  const o = m!.opts, isText = m!.kind === "askText";
  const done = (v: boolean | string | null) => { closeModal(); (m!.resolve as (x: unknown) => void)(v); };
  const yes = () => {
    if (!isText) return done(true);
    const v = val.trim();
    if (!v && !o.optional) { setErr(true); inp.current?.focus(); return; }
    done(v);
  };
  return (
    <Modal open className={"askdlg" + (shake ? " shake" : "")} formClass="askf" onCancel={() => setShake(s => s + 1)}>
      <h3 className="askT">{o.title || (isText ? "Escribe un valor" : "Confirmar")}</h3>
      <p className="askM">{m!.msg}</p>
      {isText && <input ref={inp} className="askI" maxLength={120} autoComplete="off" value={val} placeholder={o.placeholder || ""} onChange={e => { setVal(e.target.value); setErr(false); }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); yes(); } }} />}
      {err && <div className="askErr">Escribe un valor para continuar.</div>}
      <div className="askB">
        <button type="button" className="askNo" onClick={() => done(isText ? null : false)}>{o.cancel || "Cancelar"}</button>
        <button type="button" className={"askYes " + (o.danger ? "danger" : "primary")} onClick={yes} autoFocus={!isText}>{o.ok || "Aceptar"}</button>
      </div>
    </Modal>
  );
}

// ---------- motivo del cambio de plazo ----------
function ReasonDialog() {
  const m = useUi(s => s.modal);
  const [text, setText] = useState(""), [err, setErr] = useState(false);
  useEffect(() => { setText(""); setErr(false); }, [m]);
  const open = m?.kind === "reason";
  const done = (v: string | null) => { closeModal(); (m as { resolve: (x: string | null) => void }).resolve(v); };
  return (
    <Modal open={open} className="pdlg" onCancel={() => open && done(null)}>
      <header><h2>Motivo del cambio de plazo</h2></header>
      <div className="pbody">
        <p className="muted">{open ? m.msg : ""}</p>
        <label>Motivo <textarea rows={3} autoFocus value={text} placeholder="Ej: el cliente entregó el ambiente 3 días tarde" onChange={e => { setText(e.target.value); setErr(false); }} /></label>
        {err && <div className="loginErr">Escribe el motivo para registrar el cambio.</div>}
      </div>
      <footer>
        <div className="spacer" />
        <button type="button" onClick={() => done(null)}>Cancelar</button>
        <button type="button" className="primary" onClick={() => { const v = text.trim(); if (!v) return setErr(true); done(v); }}>Registrar cambio</button>
      </footer>
    </Modal>
  );
}

// ---------- elegir requerimientos (informe Word y exportar Gantt) ----------
function PickDialog() {
  const m = useUi(s => s.modal);
  const open = m?.kind === "pick";
  const calc = useCalc();
  const clientId = useApp(s => s.clientId);
  const list = useMemo<Requirement[]>(() => (open ? m.list.slice().sort((x, y) => calc.clientName(x.clientId).localeCompare(calc.clientName(y.clientId)) || x.code.localeCompare(y.code)) : []), [open, m, calc]);
  const [sel, setSel] = useState<Set<string>>(new Set()), [q, setQ] = useState("");
  useEffect(() => { setSel(new Set(list.map(r => r.id))); setQ(""); }, [list]);
  const shown = list.filter(r => !q.trim() || (r.code + " " + r.title + " " + calc.clientName(r.clientId)).toLowerCase().includes(q.trim().toLowerCase()));
  const done = (v: Requirement[] | null) => { closeModal(); (m as { resolve: (x: Requirement[] | null) => void }).resolve(v); };
  const mark = (ids: string[], on: boolean) => setSel(s => { const n = new Set(s); ids.forEach(i => (on ? n.add(i) : n.delete(i))); return n; });
  return (
    <Modal open={open} id="pickdlg" className="imdlg" onCancel={() => open && done(null)}>
      <header><h2>{open ? m.title : ""}</h2><button type="button" onClick={() => done(null)} aria-label="Cerrar">✕</button></header>
      <div className="pbody">
        <p className="muted sm">{open ? m.hint : ""}</p>
        <div className="crow">
          <input type="search" placeholder="Buscar por código, título o cliente" aria-label="Buscar requerimiento" value={q} onChange={e => setQ(e.target.value)} />
          <button type="button" onClick={() => mark(shown.map(r => r.id), true)}>Marcar todos</button>
          <button type="button" onClick={() => mark(shown.map(r => r.id), false)}>Desmarcar todos</button>
        </div>
        <div id="pickList">
          {shown.map(r => (
            <label className="pickrow" key={r.id}>
              <input type="checkbox" checked={sel.has(r.id)} onChange={e => mark([r.id], e.target.checked)} />
              <span className="pk-main"><b>{r.code}</b> {r.title}</span>
              <span className="pk-meta">{clientId === "all" ? calc.clientName(r.clientId) + " · " : ""}{calc.reqStatusLabel(r)} · {calc.progress(r)}%</span>
            </label>
          ))}
          {!shown.length && <p className="muted" style={{ padding: 10 }}>Ningún requerimiento coincide con la búsqueda.</p>}
        </div>
      </div>
      <footer>
        <span className="muted">{sel.size} de {list.length} seleccionados</span><div className="spacer" />
        <button type="button" onClick={() => done(null)}>Cancelar</button>
        <button type="button" className="primary" disabled={!sel.size} onClick={() => done(list.filter(r => sel.has(r.id)))}>{open ? m.ok : ""}</button>
      </footer>
    </Modal>
  );
}

export function ModalHost() {
  return <><AskDialog /><ReasonDialog /><PickDialog /></>;
}
