import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays, badDate, cleanCode, cleanStage, cleanTitle, CODE_RE, d2n, dateBounds, fd, HTTP_RE, makeCalc, setIds, STAGE_RE, TITLE_RE, tplDays, uid,
  type Activity, type Comment, type Deliverable, type Requirement,
} from "@qa/core";
import { Field, filtered, FormErr, Grow, useFieldErrors } from "../components/forms";
import { Tip } from "../components/Hint";
import { Modal } from "../components/Modal";
import { MultiPick } from "../components/MultiPick";
import { D } from "../lib/data";
import { lsGet, lsSet } from "../lib/storage";
import { authorName, useApp, useCalc } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { ask, askReason, askText, say } from "../state/ui";

const DATE_ERR = "Error: fecha fuera de rango";
const DEL_ST: Record<string, string> = { pendiente: "Pendiente", entregado: "Entregado", validado: "Validado" };
const THREAD_MAX = 5;
const METRICS: [string, string, string][] = [
  ["designed", "Casos diseñados", "Total de casos de prueba escritos para este requerimiento. Es la base de los % de ejecución y automatización."],
  ["executed", "Casos ejecutados", "Cuántos de los casos diseñados ya se corrieron. Con esto se calcula el % de ejecución."],
  ["passed", "Aprobados", "Casos ejecutados cuyo resultado fue el esperado (OK). Se usa para el % de aprobación."],
  ["failed", "Fallidos", "Casos ejecutados cuyo resultado no fue el esperado; normalmente generan un defecto."],
  ["automated", "Automatizados", "Casos que ya tienen script automático (Selenium, etc.). Se usa para el % de automatización."],
  ["crit", "Defectos críticos", "Errores que impiden usar el sistema o el flujo, sin alternativa."],
  ["high", "Defectos altos", "Fallas importantes de una funcionalidad; existe una alternativa pero es difícil."],
  ["med", "Defectos medios", "Fallas parciales que no impiden operar; hay alternativa razonable."],
  ["low", "Defectos bajos", "Detalles menores: textos, formato, estética."],
];
const pctOpts = (cur: number) => { const l = Array.from({ length: 21 }, (_, i) => i * 5); if (!l.includes(cur) && cur >= 0) { l.push(cur); l.sort((x, y) => x - y); } return l; };
const fdt = (s: string) => new Date(s).toLocaleString("es");

const blankReq = (clientId: string, today: string): Requirement => ({
  id: uid(), clientId, code: "", title: "", type: "trad", assigneeId: "", assigneeIds: [], leaderIds: [], status: "Pendiente", percent: 0, start: today, end: today, priority: "", bucket: "",
  acts: [], deliverables: [], metrics: {}, comments: [], dateLog: [], committedEnd: "", lastUpdate: "",
});

export function ReqDialog() {
  const slot = useDialogs(s => s.req), close = useDialogs(s => s.closeReq);
  return <ReqInner key={slot ? (slot.id ?? "new") : "closed"} open={!!slot} id={slot?.id ?? null} onClose={close} />;
}

function ReqInner({ open, id, onClose }: { open: boolean; id: string | null; onClose: () => void }) {
  const { store, readOnly, clientId, user, commit, mutate } = useApp();
  const calc = useCalc(), today = calc.today, bounds = dateBounds(today);
  const isNew = id === null;
  const seed = useMemo<Requirement | null>(() => {
    if (!open) return null;
    const src = id ? store.reqs.find(r => r.id === id) : null;
    const d: Requirement = src ? structuredClone(src) : blankReq(clientId !== "all" ? clientId : store.clients[0]?.id || "", today);
    d.deliverables ||= []; d.metrics ||= {};
    const tpl = (type: string, start: string, who: string[]) => { let s = start; return calc.tplFor(type).map(a => { const x: Activity = { id: uid(), name: a.name, start: s, end: addDays(s, tplDays(a) - 1), percent: 0, blocked: false }; setIds(x, who); s = addDays(x.end, 1); return x; }); };
    setIds(d, calc.ids(d));
    if (!src) d.acts = tpl(d.type, today, calc.ids(d));
    if (src && d.type === "express" && !d.acts.length) { // requerimiento express antiguo: pasa a las 4 actividades
      d.acts = tpl(d.type, d.start || today, calc.ids(d));
      const done = Math.round(((d.percent || 0) / 100) * d.acts.length);
      d.acts.forEach((x, i) => (x.percent = i < done ? 100 : 0));
    }
    if (!src && !d.deliverables.length) d.deliverables = (d.type === "express" ? ["Informe final"] : ["Plan de pruebas", "Evidencias (EVP)", "Informe final"]).map(n => ({ id: uid(), name: n, due: calc.span(d)[1], state: "pendiente" as const, url: "" }));
    return d;
  }, [open, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<Requirement | null>(seed);
  const snap = useRef(JSON.stringify(seed));
  useEffect(() => { setDraft(seed); snap.current = JSON.stringify(seed); }, [seed]);
  const fe = useFieldErrors(), bodyRef = useRef<HTMLDivElement>(null);
  const [newComment, setNewComment] = useState(""), [threadAll, setThreadAll] = useState(false), [editCm, setEditCm] = useState<string | null>(null), [editTxt, setEditTxt] = useState(""), [hist, setHist] = useState<Set<string>>(new Set());

  const dirty = !readOnly && !!draft && JSON.stringify(draft) !== snap.current;
  const tryClose = async () => { if (dirty && !await ask("Tienes cambios sin guardar. ¿Descartarlos?", { title: "Cambios sin guardar", ok: "Descartar", danger: true })) return; onClose(); };

  if (!open || !draft) return <Modal open={false} id="dlg" onCancel={() => {}} />;
  const d = draft, set = (p: Partial<Requirement>) => { setDraft(x => ({ ...x!, ...p })); };
  const memberOpts = store.members.map(m => ({ value: m.id, label: m.name, extra: m.roles.join(", ") }));
  const leaderOpts = store.leaders.map(m => ({ value: m.id, label: m.name, extra: m.roles.join(", ") }));
  const setAct = (i: number, p: Partial<Activity>) => setDraft(x => ({ ...x!, acts: x!.acts.map((a, k) => (k === i ? { ...a, ...p } : a)) }));
  const setDel = (i: number, p: Partial<Deliverable>) => setDraft(x => ({ ...x!, deliverables: x!.deliverables.map((a, k) => (k === i ? { ...a, ...p } : a)) }));
  const setMetric = (k: string, v: number | "" | string) => setDraft(x => ({ ...x!, metrics: { ...x!.metrics, [k]: v } }));
  const bucketList = [...new Set(store.reqs.filter(r => r.clientId === d.clientId && r.bucket).map(r => r.bucket))].sort();
  const dis = readOnly;
  const err = (k: string) => fe.errors[k];
  const dateIn = (k: string, v: string, on: (v: string) => void) => (
    <input type="date" min={bounds.min} max={bounds.max} disabled={dis} value={v} className={err(k) ? "bad" : ""} onChange={e => { on(e.target.value); if (badDate(e.target.value, today)) fe.set(k, DATE_ERR); else fe.clear(k); }} />
  );

  // ---------- métricas ----------
  const M = d.metrics, n = (k: string) => (M[k as keyof typeof M] === "" || M[k as keyof typeof M] == null ? null : +(M[k as keyof typeof M] as number));
  const pc = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? Math.round((a / b) * 100) : null);
  const ex = pc(n("executed"), n("designed")), pa = pc(n("passed"), n("executed")), au = pc(n("automated"), n("designed")), od = calc.openDef(d);
  const warns = [(n("designed") ?? 0) > 0 && (n("executed") ?? 0) > (n("designed") ?? 0) ? "ejecutados > diseñados" : "", (n("passed") ?? 0) + (n("failed") ?? 0) > (n("executed") ?? 0) ? "aprobados + fallidos > ejecutados" : "", (n("designed") ?? 0) > 0 && (n("automated") ?? 0) > (n("designed") ?? 0) ? "automatizados > diseñados" : ""].filter(Boolean);
  const metLine = [ex !== null ? `Ejecución: ${ex}%` : "", pa !== null ? `Aprobación: ${pa}%` : "", au !== null ? `Automatizado: ${au}%` : "", od ? `Defectos abiertos: ${od}` : ""].filter(Boolean).join(" · ") + (warns.length ? ((ex !== null || pa !== null || au !== null ? "  " : "") + "⚠ Revisa: " + warns.join("; ") + ".") : "");

  // ---------- tipo ----------
  const changeType = async (type: string) => {
    const prev = d.type, label = "QA " + calc.typeName(type);
    const prevNames = JSON.stringify(calc.tplFor(prev).map(t => t.name)), untouched = JSON.stringify(d.acts.map(t => t.name)) === prevNames;
    if (type === prev) return;
    if (!d.acts.length || untouched || await ask(`Cambiar a ${label} reemplaza las actividades actuales por las de su plantilla. ¿Continuar?`)) {
      let s = d.acts[0]?.start || today;
      const who = calc.ids(d);
      const acts = calc.tplFor(type).map(a => { const x: Activity = { id: uid(), name: a.name, start: s, end: addDays(s, tplDays(a) - 1), percent: 0, blocked: false }; setIds(x, who); s = addDays(x.end, 1); return x; });
      set({ type, acts });
    }
  };

  // ---------- comentarios ----------
  const myC = (c: Comment) => c.src !== "planner" && (c.byEmail ? c.byEmail.toLowerCase() === user.toLowerCase() : c.by === authorName());
  const all = [...d.comments].sort((x, y) => y.at.localeCompare(x.at)), list = threadAll ? all : all.slice(0, THREAD_MAX);
  const addComment = async () => {
    const text = newComment.trim(); if (!text) return;
    let by = lsGet("qa-author", "");
    if (!by) { by = (await askText("¿Con qué nombre quieres firmar tus comentarios?", "", { title: "Firma de tus comentarios", placeholder: "Nombre y apellido" })) || "Anónimo"; lsSet("qa-author", by); }
    const cm: Comment = { id: uid(), at: new Date().toISOString(), by, byEmail: user || "", text };
    setDraft(x => ({ ...x!, comments: [...x!.comments, cm] }));
    setNewComment("");
    if (readOnly) { // lector: solo puede comentar, mediante una función del servidor
      if (isNew) return;
      D.qaComment(d.id, cm).then(() => { mutateLocal(s => { const r = s.reqs.find(x => x.id === d.id); if (r && !r.comments.some(k => k.id === cm.id)) { r.comments.push(cm); r.lastUpdate = cm.at; } }); snap.current = JSON.stringify({ ...d, comments: [...d.comments, cm] }); say("Comentario agregado ✓"); })
        .catch((er: Error) => { setDraft(x => ({ ...x!, comments: x!.comments.filter(k => k.id !== cm.id) })); say(/function .* does not exist|schema cache/i.test(er.message) ? "Falta ejecutar 04-comentarios.sql en Supabase." : "No se pudo comentar: " + er.message, true); });
      return;
    }
    if (!isNew) { const rid = d.id; commit(s => { const r = s.reqs.find(x => x.id === rid); if (r && !r.comments.some(k => k.id === cm.id)) { r.comments.push(cm); r.lastUpdate = cm.at; } }); snap.current = JSON.stringify({ ...d, comments: [...d.comments, cm] }); }
  };
  // el lector no puede guardar el documento: su comentario se refleja solo en memoria
  const mutateLocal = (fn: (s: ReturnType<typeof useApp.getState>["store"]) => void) => { const s = structuredClone(useApp.getState().store); fn(s); useApp.getState().setStore(s); };
  const saveEdit = (c: Comment) => {
    const v = editTxt.trim();
    if (!myC(c)) return say("Solo puedes editar tus propios comentarios.", true);
    if (!v) return fe.set("cm", "El comentario no puede quedar vacío.");
    if (v === c.text) return setEditCm(null);
    const now = new Date().toISOString(), by = authorName(), cid = c.id;
    const apply = (r: Requirement) => { const k = r.comments.find(x => x.id === cid); if (!k || !myC(k)) return; (k.edits ||= []).push({ text: k.text, at: now, by }); k.text = v; k.editedAt = now; r.lastUpdate = now; };
    const finish = () => { setDraft(x => { const y = structuredClone(x!); apply(y); snap.current = JSON.stringify(y); return y; }); setEditCm(null); };
    if (readOnly) {
      if (isNew) return;
      D.qaCommentEdit(d.id, cid, by, v).then(() => { mutateLocal(s => { const r = s.reqs.find(x => x.id === d.id); if (r) apply(r); }); finish(); say("Comentario actualizado ✓"); })
        .catch((er: Error) => say(/function .* does not exist|schema cache/i.test(er.message) ? "Falta ejecutar 04-comentarios.sql (versión nueva) en Supabase." : "No se pudo editar: " + er.message, true));
      return;
    }
    if (!isNew) commit(s => { const r = s.reqs.find(x => x.id === d.id); if (r) apply(r); });
    finish(); say("Comentario actualizado ✓ (la versión anterior quedó en el historial)");
  };

  // ---------- guardar ----------
  const submit = async () => {
    if (readOnly) return say("Estás en modo solo lectura: no tienes permiso para guardar cambios.", true);
    try { await submitInner(); } catch (e) { console.error(e); say("No se pudo guardar: " + ((e as Error).message || e), true); }
  };
  const submitInner = async () => {
    const draftC = structuredClone(d) as Requirement;
    const bad: Record<string, string> = {};
    const mark = (k: string, why: string) => { bad[k] = why; };
    for (const [k, nm] of [["clientId", "Cliente"], ["code", "Código"], ["title", "Título"]] as const) if (!String(draftC[k] || "").trim()) mark(k, `${nm} es obligatorio`);
    const was = store.reqs.find(r => r.id === draftC.id); // un código o título antiguo con símbolos no obliga a cambiarlos mientras no se editen
    if (String(draftC.code || "").trim() && (isNew || draftC.code !== was?.code) && !CODE_RE.test(draftC.code)) mark("code", "El código debe ser 1 letra seguida de hasta 8 números, sin símbolos (ejemplo: R1903)");
    if (String(draftC.title || "").trim() && (isNew || draftC.title !== was?.title) && !TITLE_RE.test(draftC.title)) mark("title", "El título solo admite letras, números, espacios y estos signos: ( ) # $ / -");
    if (String(draftC.bucket || "").trim() && (isNew || draftC.bucket !== was?.bucket) && !STAGE_RE.test(draftC.bucket)) mark("bucket", "La etapa del proyecto solo admite letras y espacios (sin números, símbolos ni caracteres especiales)");
    const wi = String(draftC.metrics.wiUrl || "").trim();
    if (wi && !HTTP_RE.test(wi)) mark("wiUrl", "El enlace al work item debe comenzar con https://");
    draftC.deliverables.forEach((x, i) => { if ((x.url || "").trim() && !HTTP_RE.test(x.url.trim())) mark("del" + i, `Entregable ${i + 1}: el enlace debe comenzar con https://`); });
    { const dsg = n("designed"), exe = n("executed"), pas = n("passed"), fal = n("failed"), aut = n("automated");
      if (dsg != null && exe != null && exe > dsg) mark("m-executed", "Casos ejecutados no puede ser mayor que los diseñados");
      if (exe != null && (pas || 0) + (fal || 0) > exe) mark("m-passed", "Aprobados + fallidos no puede superar los casos ejecutados");
      if (dsg != null && aut != null && aut > dsg) mark("m-automated", "Automatizados no puede ser mayor que los casos diseñados"); }
    if (!draftC.acts.length) mark("acts", "Agrega al menos una actividad");
    // fechas opcionales: si se dejan vacías se completan con la actividad anterior (inicio) o con el inicio (fin)
    draftC.acts.forEach((a, i) => {
      if (badDate(a.start, today)) mark(`a${i}-start`, DATE_ERR);
      if (badDate(a.end, today)) mark(`a${i}-end`, DATE_ERR);
      if (!a.start) a.start = i ? addDays(draftC.acts[i - 1].end || draftC.acts[i - 1].start, 1) : draftC.start || today;
      if (!a.end) a.end = a.start;
      if (a.percent >= 100) { a.blocked = false; a.blockReason = ""; a.blockedSince = ""; } // una actividad terminada no queda bloqueada
      if (!String(a.name || "").trim()) mark(`a${i}-name`, `Actividad ${i + 1}: el nombre es obligatorio`);
      if (String(a.name || "").length > 500) mark(`a${i}-name`, `Actividad ${i + 1}: el nombre no puede superar los 500 caracteres`);
      if (a.end < a.start && !bad[`a${i}-end`]) mark(`a${i}-end`, `Actividad ${i + 1}: la fecha de fin es anterior al inicio`);
    });
    if (Object.keys(bad).length) {
      fe.clear(); Object.entries(bad).forEach(([k, v]) => fe.set(k, v));
      setTimeout(() => { const el = bodyRef.current?.querySelector<HTMLElement>(".ferr, .bad"); el?.scrollIntoView({ block: "center" }); (bodyRef.current?.querySelector(".bad") as HTMLElement | null)?.focus(); }, 30);
      return;
    }
    const c2 = makeCalc({ ...store, reqs: [...store.reqs.filter(r => r.id !== draftC.id), draftC] }, today);
    [draftC.start, draftC.end] = c2.span(draftC);
    const prev = store.reqs.find(r => r.id === draftC.id), manual = !!prev && prev.status !== draftC.status; // si elegiste el estado a mano, se respeta
    { const p = c2.progress(draftC), anyB = draftC.acts.some(a => a.blocked); draftC.percent = p;
      if (!manual) { if (p >= 100) draftC.status = "Completado"; else if (anyB) draftC.status = "Bloqueado"; else if (draftC.status === "Bloqueado") draftC.status = p > 0 ? "En curso" : "Pendiente"; else if (p > 0 && draftC.status === "Pendiente") draftC.status = "En curso"; } }
    if (draftC.status === "Completado" && !draftC.completedAt) draftC.completedAt = today;
    if (draftC.status !== "Completado") draftC.completedAt = "";
    const old = store.reqs.find(r => r.id === draftC.id);
    draftC.dateLog ||= []; draftC.lastUpdate = new Date().toISOString();
    if (!old || !draftC.committedEnd) draftC.committedEnd = draftC.end;
    if (old && old.end !== draftC.end) {
      const why = await askReason(`${draftC.code}: el plazo cambia de ${fd(old.end)} a ${fd(draftC.end)}.`);
      if (why === null) return;
      draftC.dateLog = [...draftC.dateLog, { at: draftC.lastUpdate, by: authorName(), from: old.end, to: draftC.end, reason: why }];
    }
    mutate(s => { const i = s.reqs.findIndex(r => r.id === draftC.id); if (i < 0) s.reqs.push(draftC); else s.reqs[i] = draftC; });
    onClose(); say("Guardado ✓");
  };

  const cur = calc.span(d)[1], dd = d.committedEnd ? d2n(cur) - d2n(d.committedEnd) : 0;
  const src = d.src?.planner ? d.src : null;
  const labels = src ? [...(src.labels || []), ...(src.checks || [])] : [];

  return (
    <Modal open id="dlg" formId="rform" onCancel={() => void tryClose()} onSubmit={e => { e.preventDefault(); void submit(); }}>
      <header><h2 id="rTitle">{isNew ? "Nuevo requerimiento" : `${seed!.code} · ${seed!.title}`}</h2><button type="button" id="rClose" onClick={() => void tryClose()}>✕</button></header>
      <div className="rgrid" ref={bodyRef}>
        <div className="col">
          <p className="hint reqnote"><span className="star">*</span> Campo obligatorio. Los campos con error se marcan en rojo.</p>
          <Field label="Cliente" star error={err("clientId")}>
            <select name="clientId" disabled={dis} className={err("clientId") ? "bad" : ""} value={d.clientId} onChange={e => { set({ clientId: e.target.value }); fe.clear("clientId"); }}>{store.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <div className="row2">
            <Field label="Código" star error={err("code")}><input name="code" placeholder="R1903" maxLength={9} autoComplete="off" spellCheck={false} title="1 letra seguida de hasta 8 números" disabled={dis} className={err("code") ? "bad" : ""} value={d.code} onChange={filtered(cleanCode, v => { set({ code: v }); fe.clear("code"); })} /></Field>
            <Field label="Tipo">
              <select name="type" disabled={dis} value={d.type} onChange={e => void changeType(e.target.value)}>
                <option value="trad">QA Tradicional (Gantt)</option><option value="express">QA Express (rápido)</option>
                {store.customTpl.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Título" star error={err("title")}><input name="title" maxLength={120} autoComplete="off" title="Letras, números, espacios y solo estos signos: ( ) # $ / -" disabled={dis} className={err("title") ? "bad" : ""} value={d.title} onChange={filtered(cleanTitle, v => { set({ title: v }); fe.clear("title"); })} /></Field>
          {src && (
            <div id="srcBox" className="srcBox">
              <b>Origen: Microsoft Planner</b> · sincronizado {src.syncedAt ? new Date(src.syncedAt).toLocaleString("es") : "—"}
              {labels.length > 0 && <> · Etiquetas: {labels.map(l => <span className="badge" key={l}>{l} </span>)}</>}
              {" "}· <a href={"https://tasks.office.com/Home/Task/" + encodeURIComponent(src.taskId)} target="_blank" rel="noopener noreferrer">Abrir en Planner</a><br />
              <small className="muted">Planner manda en estado, prioridad, depósito y fechas solo cuando cambian allá; lo que edites aquí se conserva hasta entonces.</small>
            </div>
          )}
          <div className="row2">
            <Field label="Prioridad"><select name="priority" disabled={dis} value={d.priority} onChange={e => set({ priority: e.target.value })}><option value="">— sin definir —</option><option>Urgente</option><option>Importante</option><option>Media</option><option>Baja</option></select></Field>
            <Field label="Etapa del proyecto" error={err("bucket")}>
              <input name="bucket" list="bucketList" placeholder="Ej: Análisis, Certificación" maxLength={40} autoComplete="off" title="Solo letras y espacios" disabled={dis} className={err("bucket") ? "bad" : ""} value={d.bucket} onChange={filtered(cleanStage, v => { set({ bucket: v }); fe.clear("bucket"); })} />
              <datalist id="bucketList">{bucketList.map(b => <option key={b} value={b} />)}</datalist>
            </Field>
          </div>
          <div className="row2">
            <div className="lbl"><Tip group="form">Responsables QA</Tip><div id="assigneePick"><MultiPick options={memberOpts} selected={calc.ids(d)} disabled={dis} empty="Agrega miembros en Equipo" onChange={v => { const x = { ...d }; setIds(x, v); set({ assigneeIds: x.assigneeIds, assigneeId: x.assigneeId }); }} /></div></div>
            <div className="lbl"><Tip group="form">Responsables de requerimiento</Tip><div id="leaderPick"><MultiPick options={leaderOpts} selected={calc.leaderIds(d)} disabled={dis} empty="Agrega responsables en la solapa «Responsables de requerimiento»" onChange={v => set({ leaderIds: v })} /></div></div>
          </div>
          <div className="row2">
            <Field label="Estado"><select name="status" disabled={dis} value={d.status} onChange={e => set({ status: e.target.value as Requirement["status"] })}><option>Pendiente</option><option>En curso</option><option>Bloqueado</option><option>Completado</option></select></Field>
            <div />
          </div>
          {!isNew && d.committedEnd && (
            <div id="commitBox" className="commitBox">
              <b>Compromiso:</b> {fd(d.committedEnd)} · <b>Plazo actual:</b> {fd(cur)} {dd > 0 ? <span className="st al1">+{dd} días</span> : dd < 0 ? <span className="st st-Completado">{dd} días</span> : <span className="st st-Completado">en plazo</span>}
              {d.dateLog.length > 0 && <details><summary>Historial de cambios de plazo ({d.dateLog.length})</summary>{d.dateLog.map((l, i) => <div className="dl" key={i}><small>{fdt(l.at)} · <b>{l.by}</b></small><br />{fd(l.from)} → {fd(l.to)}: {l.reason}</div>)}</details>}
            </div>
          )}
        </div>

        <div className="col">
          <h3>Seguimiento / comentarios</h3>
          <div id="thread" className="thread">
            {all.length ? list.map(c => {
              const ed = editCm === c.id, h = c.edits || [], mine = (!readOnly || D.remote) && myC(c);
              return (
                <div className={"cm" + (c.src === "planner" ? " plc" : "")} key={c.id}>
                  <small>{fdt(c.at)} · <b>{c.by}</b>{c.src === "planner" && <> <span className="badge pl">Planner</span></>}{h.length > 0 && <> · <i>editado {fdt(c.editedAt || h[h.length - 1].at)}</i></>}</small>
                  {ed
                    ? <><div className={err("cm") ? "ferrhost" : ""}><FormErr msg={err("cm")} /><Grow className="cmEdit" maxLength={5000} aria-label="Editar comentario" value={editTxt} onChange={setEditTxt} /></div>
                      <div className="cmAct"><button type="button" className="primary" onClick={() => saveEdit(c)}>Guardar</button><button type="button" className="ghost" onClick={() => setEditCm(null)}>Cancelar</button></div></>
                    : <p>{c.text}</p>}
                  {!ed && (mine || h.length > 0) && (
                    <div className="cmAct">
                      {mine && <button type="button" className="ghost" title="Editar mi comentario" onClick={() => { setEditCm(c.id); setEditTxt(c.text); }}>✎ Editar</button>}
                      {h.length > 0 && <button type="button" className={"ghost cmEye" + (hist.has(c.id) ? " on" : "")} title={`Ver historial (${h.length} versión/es anterior/es)`} aria-label="Ver historial del comentario" onClick={() => setHist(s => { const n2 = new Set(s); n2.has(c.id) ? n2.delete(c.id) : n2.add(c.id); return n2; })}>👁 <small>{h.length}</small></button>}
                    </div>)}
                  {hist.has(c.id) && h.length > 0 && <div className="cmHist"><b>Versiones anteriores</b>{[...h].reverse().map((x, i) => <div className="cmh" key={i}><small>Reemplazado el {fdt(x.at)}</small><p>{x.text}</p></div>)}</div>}
                </div>
              );
            }) : <p className="muted">Aún no hay comentarios.</p>}
            {all.length > THREAD_MAX && <button type="button" className="ghost" id="thrMore" onClick={() => setThreadAll(a => !a)}>{threadAll ? "Ver menos" : `Ver más (${all.length - THREAD_MAX} anteriores)`}</button>}
          </div>
          <div className="newc">
            <textarea id="newComment" rows={3} maxLength={5000} placeholder="Escribe un avance, bloqueo o acuerdo…" disabled={readOnly && !D.remote} value={newComment} onChange={e => setNewComment(e.target.value)} />
            {(!readOnly || D.remote) && <button type="button" id="btnComment" className="primary" disabled={!newComment.trim()} onClick={() => void addComment()}>Agregar comentario</button>}
          </div>
        </div>

        <div className="col wide">
          <div id="actsBox">
            <h3>Actividades <span className="star">*</span> {!readOnly && <button type="button" id="btnActAdd" className={err("acts") ? "bad" : ""} onClick={() => { const last = d.acts[d.acts.length - 1], s = last ? addDays(last.end, 1) : today; const a: Activity = { id: uid(), name: "Nueva actividad", start: s, end: s, percent: 0, blocked: false }; setIds(a, calc.ids(d)); set({ acts: [...d.acts, a] }); fe.clear("acts"); }}>+</button>} {err("acts") && <span className="ferr" role="alert">{err("acts")}</span>}</h3>
            <table id="actTbl" className={err("acts") ? "bad" : ""}>
              <thead><tr>{["Actividad", "Resp. QA", "Inicio", "Fin", "% Avance", "Bloqueado"].map(h => <th key={h}><Tip group="act" label={h}>{h}{(h === "Actividad") && <> <span className="star">*</span></>}{(h === "Inicio" || h === "Fin" || h === "Bloqueado") && <> <small className="opt">(opcional)</small></>}</Tip></th>)}<th /></tr></thead>
              <tbody>
                {d.acts.map((a, i) => (
                  <tr key={a.id}>
                    <td className={err(`a${i}-name`) ? "ferrhost" : ""}>{err(`a${i}-name`) && <div className="ferr ferrB" role="alert">{err(`a${i}-name`)}</div>}<Grow required maxLength={500} disabled={dis} className={err(`a${i}-name`) ? "bad" : ""} value={a.name} onChange={v => { setAct(i, { name: v }); fe.clear(`a${i}-name`); }} /></td>
                    <td><MultiPick options={memberOpts} selected={calc.ids(a)} disabled={dis} empty="Agrega miembros en Equipo" onChange={v => { const x = { ...a }; setIds(x, v); setAct(i, { assigneeIds: x.assigneeIds, assigneeId: x.assigneeId }); }} /></td>
                    <td className={err(`a${i}-start`) ? "ferrhost" : ""}>{err(`a${i}-start`) && <div className="ferr ferrB" role="alert">{err(`a${i}-start`)}</div>}{dateIn(`a${i}-start`, a.start, v => setAct(i, { start: v }))}</td>
                    <td className={err(`a${i}-end`) ? "ferrhost" : ""}>{err(`a${i}-end`) && <div className="ferr ferrB" role="alert">{err(`a${i}-end`)}</div>}{dateIn(`a${i}-end`, a.end, v => setAct(i, { end: v }))}</td>
                    <td><select title="% de avance de la actividad" disabled={dis} value={a.percent} onChange={e => setAct(i, { percent: +e.target.value })}>{pctOpts(a.percent).map(p => <option key={p} value={p}>{p}</option>)}</select></td>
                    <td><input type="checkbox" disabled={dis} checked={!!a.blocked} onChange={e => setAct(i, { blocked: e.target.checked, blockedSince: e.target.checked ? a.blockedSince || today : "", ...(e.target.checked ? {} : { blockReason: "" }) })} /></td>
                    <td>{!readOnly && <button type="button" className="danger" onClick={() => set({ acts: d.acts.filter((_, k) => k !== i) })}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div id="delBox">
            <h3>Entregables {!readOnly && <button type="button" id="btnDelAdd" onClick={() => set({ deliverables: [...d.deliverables, { id: uid(), name: "Nuevo entregable", due: cur || today, state: "pendiente", url: "" }] })}>+</button>}</h3>
            <table id="delTbl">
              <thead><tr>{["Entregable", "Vence", "Estado", "Enlace (SharePoint / DevOps)"].map(h => <th key={h}><Tip group="act">{h}</Tip></th>)}<th /></tr></thead>
              <tbody>
                {d.deliverables.map((x, i) => (
                  <tr key={x.id}>
                    <td><Grow disabled={dis} value={x.name} onChange={v => setDel(i, { name: v })} /></td>
                    <td><input type="date" min={bounds.min} max={bounds.max} disabled={dis} value={x.due || ""} onChange={e => setDel(i, { due: e.target.value })} /></td>
                    <td><select disabled={dis} value={x.state} onChange={e => setDel(i, { state: e.target.value as Deliverable["state"], deliveredAt: e.target.value === "pendiente" ? "" : x.deliveredAt || today })}>{Object.entries(DEL_ST).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                    <td className={err("del" + i) ? "ferrhost" : ""}>{err("del" + i) && <div className="ferr ferrB" role="alert">{err("del" + i)}</div>}<input type="url" placeholder="https://..." disabled={dis} className={err("del" + i) ? "bad" : ""} value={x.url || ""} onChange={e => { setDel(i, { url: e.target.value }); fe.clear("del" + i); }} /></td>
                    <td>{!readOnly && <button type="button" className="danger" onClick={() => set({ deliverables: d.deliverables.filter((_, k) => k !== i) })}>✕</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div id="metBox">
            <h3>Métricas técnicas y trazabilidad</h3>
            <div className="metGrid">
              {METRICS.map(([k, label, hint]) => (
                <Field key={k} label={label} error={err("m-" + k)} hint={hint} tipLabel="">
                  <input type="number" min={0} max={10000} step={1} inputMode="numeric" disabled={dis} className={err("m-" + k) ? "bad" : ""} value={String(M[k as keyof typeof M] ?? "")}
                    onKeyDown={e => { if (/^[eE+\-.,]$/.test(e.key)) e.preventDefault(); }} // solo números enteros
                    onChange={e => { const raw = e.target.value; if (raw === "") setMetric(k, ""); else setMetric(k, Math.min(10000, Math.max(0, Math.floor(+raw)))); fe.clear("m-" + k); }} />
                </Field>
              ))}
            </div>
            <div className="row2">
              <Field label="ID work item (Azure DevOps / Jira)" tipLabel="" hint="Número del ticket o tarea en Azure DevOps / Jira, para trazabilidad."><input placeholder="Ej: 168002" disabled={dis} value={M.wiId ?? ""} onChange={e => setMetric("wiId", e.target.value.trim())} /></Field>
              <Field label="Enlace al work item" tipLabel="" error={err("wiUrl")} hint="Link directo al ticket (debe comenzar con https://)."><input type="url" placeholder="https://..." disabled={dis} className={err("wiUrl") ? "bad" : ""} value={M.wiUrl ?? ""} onChange={e => { setMetric("wiUrl", e.target.value.trim()); fe.clear("wiUrl"); }} /></Field>
            </div>
            <p className="muted" id="metCalc">{metLine}</p>
          </div>
        </div>
      </div>
      <footer>
        {!readOnly && !isNew && <button type="button" id="rDelete" className="danger" onClick={async () => { if (await ask("¿Eliminar este requerimiento y su seguimiento?")) { mutate(s => { s.reqs = s.reqs.filter(r => r.id !== d.id); }); onClose(); } }}>Eliminar</button>}
        <div className="spacer" />
        <button type="button" id="rCancel" onClick={() => void tryClose()}>Cerrar</button>
        {!readOnly && <button type="submit" id="rSave" className="primary">Guardar</button>}
      </footer>
    </Modal>
  );
}
