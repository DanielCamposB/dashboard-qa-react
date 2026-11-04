import { useEffect, useState } from "react";
import { cleanStage, newClient } from "@qa/core";
import { FormErr, filtered, useFieldErrors } from "../components/forms";
import { Tip } from "../components/Hint";
import { D } from "../lib/data";
import { graphErr } from "../lib/errors";
import { planner, plannerConfigured } from "../lib/graph";
import { syncClient, teamsOn } from "../lib/plannerSync";
import { useApp } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { ask, say } from "../state/ui";
import { useNavigate } from "react-router-dom";

const fmtDT = (s?: string) => (s ? new Date(s).toLocaleString("es", { dateStyle: "short", timeStyle: "short" }) : "nunca");

function ClientCard({ id }: { id: string }) {
  const { store, commit, mutate, readOnly } = useApp();
  const acct = useDialogs(s => s.msAccount), setAcct = useDialogs(s => s.setMsAccount);
  const nav = useNavigate();
  const c = store.clients.find(x => x.id === id)!;
  const [name, setName] = useState(c.name), [plans, setPlans] = useState<{ id: string; title: string }[] | null>(null), fe = useFieldErrors();
  useEffect(() => setName(c.name), [c.name]);
  const pl = c.planner, n = store.reqs.filter(r => r.clientId === c.id), nPl = n.filter(r => r.src?.planner).length;
  const dis = readOnly;
  const upd = (fn: (c: typeof pl) => void) => commit(s => { const x = s.clients.find(y => y.id === id); if (x) { x.planner ||= { enabled: false, planId: "", planName: "", lastSync: "" }; fn(x.planner); } });
  const rename = () => { const v = name.trim(); if (!v) return setName(c.name); if (v !== c.name) { commit(s => { const x = s.clients.find(y => y.id === id); if (x) x.name = v; }); } };
  const del = async () => {
    if (n.length) return say(`No se puede eliminar "${c.name}": tiene requerimientos. Elimínalos o muévelos a otro cliente primero.`, true);
    if (!await ask(`¿Eliminar el cliente "${c.name}"?`)) return;
    mutate(s => { s.clients = s.clients.filter(x => x.id !== id); });
  };
  const findPlans = async () => {
    if (!plannerConfigured()) return say("Falta configurar la aplicación de Microsoft (VITE_MSAL_CLIENT_ID y VITE_MSAL_TENANT_ID).", true);
    try {
      if (!acct) { await planner.signIn(); setAcct(await planner.session()); }
      say("Buscando tus planes…");
      const p = await planner.listPlans();
      setPlans(p);
      say(p.length ? `${p.length} plan(es) encontrados. Elige uno.` : "No encontré planes con esta cuenta.");
    } catch (e) { say(graphErr(e), true); }
  };
  return (
    <div className="ccard" data-cid={id}>
      <div className="chead">
        <input value={name} disabled={dis} aria-label="Nombre del cliente" onChange={filtered(cleanStage, setName)} onBlur={rename} onKeyDown={e => { if (e.key === "Enter") rename(); }} />
        <span className="muted">{n.length} requerimiento(s){nPl ? ` · ${nPl} desde Planner` : ""}</span>
        {!dis && <button className="danger" onClick={() => void del()}>Eliminar cliente</button>}
      </div>
      <div className="cint">
        <div className="cbox">
          <label className="switch"><input type="checkbox" checked={!!pl.enabled} disabled={dis} onChange={e => upd(p => (p.enabled = e.target.checked))} /><i /><b>Conectar con Planner</b></label>
          <p className="muted sm">Solo lectura: el dashboard se alimenta de Planner (proyecto, estado, prioridad, fechas, depósito, tipo y comentarios). No escribe nada en Planner.</p>
          {pl.enabled && (
            <div className="cdet">
              {plannerConfigured()
                ? <p className="sm">Cuenta Microsoft: <b>{acct || "sin conectar"}</b> {!acct && <button type="button" disabled={dis} onClick={async () => { try { await planner.signIn(); setAcct(await planner.session()); say("Cuenta Microsoft conectada ✓"); } catch (e) { say(graphErr(e), true); } }}>Conectar cuenta</button>}</p>
                : <p className="warn sm">Falta registrar la aplicación en Microsoft Entra ID y poner <code>VITE_MSAL_CLIENT_ID</code> y <code>VITE_MSAL_TENANT_ID</code> en <code>.env.local</code> (ver README, sección Planner).</p>}
              <label>Plan de Planner
                <select disabled={dis} value="" onChange={e => { const o = e.target.selectedOptions[0]; if (!e.target.value) return; upd(p => { p.planId = e.target.value; p.planName = o.textContent || ""; }); say(`Plan «${o.textContent}» elegido. Pulsa «Sincronizar ahora».`); }}>
                  {plans
                    ? <><option value="">— elige un plan ({plans.length}) —</option>{plans.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</>
                    : <option value="">{pl.planId ? pl.planName || pl.planId : "— elige un plan —"}</option>}
                </select>
              </label>
              <div className="crow">
                <button type="button" disabled={dis} onClick={() => void findPlans()}>Buscar mis planes</button>
                <PlanIdInput value={pl.planId || ""} disabled={dis} onSave={v => upd(p => { p.planId = v; p.planName = v ? p.planName || v : ""; })} />
              </div>
              <div className="crow"><button type="button" className="primary" disabled={dis} onClick={() => void syncClient(id, D.remote)}>↻ Sincronizar ahora</button><span className="muted sm">Última sincronización: {fmtDT(pl.lastSync)}</span></div>
            </div>
          )}
        </div>
        <div className="cbox">
          <b>Avisos a Teams</b>
          <p className="muted sm">Estado del canal: {teamsOn(c, D.remote) ? <span className="badge okb">Conectado</span> : <span className="badge warnb">Sin URL</span>}. La URL del canal, los envíos automáticos, los mensajes personales y los botones «Enviar ahora» se manejan ahora en la pestaña <b>Avisos</b>.</p>
          <div className="crow"><button type="button" onClick={() => nav("/avisos")}>Ir a Avisos</button></div>
        </div>
      </div>
    </div>
  );
}

function PlanIdInput({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input placeholder="o pega el ID del plan" value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={() => v.trim() !== value && onSave(v.trim())} />;
}

export function Clients() {
  const { store, mutate, readOnly, setClient } = useApp();
  const [name, setName] = useState(""), fe = useFieldErrors();
  const add = (e: React.FormEvent) => {
    e.preventDefault(); if (readOnly) return;
    const v = name.trim();
    if (!v) return fe.set("n", "Escribe el nombre del cliente.");
    if (store.clients.some(c => c.name.toLowerCase() === v.toLowerCase())) return fe.set("n", "Ese cliente ya existe.");
    const c = newClient(v);
    mutate(s => { s.clients.push(c); });
    setClient(c.id); setName(""); say("Cliente creado y seleccionado ✓");
  };
  return (
    <section id="v-clients" className="view">
      <div className="card">
        <h2><Tip group="head">Clientes</Tip></h2>
        <p className="muted">Cada cliente tiene sus propios requerimientos. El equipo y las plantillas se comparten entre clientes. Activa <b>Planner</b> para alimentar el dashboard desde el plan del cliente (solo lectura) y <b>Teams</b> para enviar avisos a su canal.</p>
        <FormErr msg={fe.errors.n} />
        <form id="clientForm" className="inline" onSubmit={add} noValidate>
          <input name="name" placeholder="Nuevo cliente (ej: Hites)" required maxLength={60} autoComplete="off" title="Solo letras y espacios" className={fe.errors.n ? "bad" : ""} value={name} onChange={filtered(cleanStage, v => { setName(v); fe.clear("n"); })} />
          {!readOnly && <button className="primary">Agregar cliente</button>}
        </form>
        <div id="clientTbl" className="ccards">{store.clients.map(c => <ClientCard key={c.id} id={c.id} />)}</div>
      </div>
    </section>
  );
}
