import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { D } from "../lib/data";
import { lsGet, lsSet } from "../lib/storage";
import { THEMES } from "../lib/themes";
import { syncActive } from "../lib/plannerSync";
import { buildReport } from "../lib/report";
import { download } from "../lib/files";
import { authorName, useApp, useCalc, useIsAdmin, useVisible, type View } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { pickReqs, say } from "../state/ui";

const TABS: [View, string][] = [["dash", "Dashboard"], ["hoy", "Hoy"], ["resumen", "Resumen"], ["gantt", "Carta Gantt"], ["team", "Equipo"], ["leaders", "Responsables de requerimiento"], ["clients", "Clientes"], ["avisos", "Avisos"], ["perm", "Permisos"], ["tpl", "Plantilla de actividades"]];

export function Header({ view }: { view: View }) {
  const nav = useNavigate();
  const { store, clientId, setClient, readOnly, setReadOnly } = useApp();
  const isAdm = useIsAdmin();
  const permCount = useDialogs(s => s.permCount);
  return (
    <header className="top">
      <div className="brandbar"><img src={import.meta.env.BASE_URL + "logo-sonda.png"} alt="Sonda" className="logo" /><h1>Dashboard QA</h1></div>
      <label className="clientLbl">Cliente{" "}
        <select id="clientSel" aria-label="Cliente activo" value={clientId} onChange={e => setClient(e.target.value)}>
          <option value="all">Todos los clientes ({store.reqs.length})</option>
          {store.clients.map(c => <option key={c.id} value={c.id}>{c.name} ({store.reqs.filter(r => r.clientId === c.id).length})</option>)}
        </select>
      </label>
      <nav className="tabs" id="tabs">
        {TABS.filter(([v]) => (v === "perm" ? D.isAdmin() : ["clients", "avisos", "tpl"].includes(v) ? isAdm : true)).map(([v, label]) => (
          <button key={v} type="button" className={v === view ? "on" : ""} onClick={() => nav("/" + v)}>
            {label}{v === "perm" && permCount > 0 && <> <span className="cnt" title="Solicitudes pendientes o cuentas bloqueadas">{permCount}</span></>}
          </button>
        ))}
      </nav>
      <div className="spacer" />
      {!D.remote && (
        <label className="modeLbl">Modo{" "}
          <select id="mode" value={readOnly ? "read" : "edit"} onChange={e => setReadOnly(e.target.value === "read")}>
            <option value="edit">Editor</option><option value="read">Solo lectura</option>
          </select>
        </label>
      )}
      <ThemePicker />
      <UserMenu />
    </header>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "sonda");
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { const d = ref.current; if (d?.open && !d.contains(e.target as Node)) d.open = false; };
    document.addEventListener("click", off);
    return () => document.removeEventListener("click", off);
  }, []);
  const cur = THEMES.find(t => t.id === theme) ?? THEMES[0];
  return (
    <details className="themepick" id="themes" ref={ref}>
      <summary aria-label="Cambiar el tema de colores"><span className="tsw" style={{ background: cur.swatch }} /><span>{cur.name}</span></summary>
      <div className="tmenu" role="group" aria-label="Tema de color">
        {THEMES.map(t => (
          <button key={t.id} type="button" className={t.id === theme ? "on" : ""} aria-pressed={t.id === theme}
            onClick={() => { document.documentElement.dataset.theme = t.id; lsSet("qa-theme", t.id); setTheme(t.id); if (ref.current) ref.current.open = false; }}>
            <span className="tsw" style={{ background: t.swatch }} />{t.name}
          </button>
        ))}
      </div>
    </details>
  );
}

function UserMenu() {
  const user = useApp(s => s.user), readOnly = useApp(s => s.readOnly);
  const openProfile = useDialogs(s => s.openProfile);
  useDialogs(s => s.profileRev); // se redibuja al guardar el perfil
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const click = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", click); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("click", click); document.removeEventListener("keydown", key); };
  }, []);
  const p = D.getProfile(), em = user || "";
  const full = [p.nombres, p.apellido_paterno, p.apellido_materno].filter(Boolean).join(" ");
  const nm = full || (em ? em.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Usuario local");
  const ini = (p.nombres ? (p.nombres[0] || "") + (p.apellido_paterno?.[0] || "") : nm.split(" ").slice(0, 2).map(w => w[0]).join("")).toUpperCase() || "?";
  const adm = D.isAdmin();
  const roleTxt = adm ? "★ Administrador" : readOnly ? "Solo lectura" : "Editor";
  useEffect(() => { if (full) lsSet("qa-author", full); else if (em && !lsGet("qa-author", "")) lsSet("qa-author", em.split("@")[0]); }, [full, em]);
  const cargo = [p.cargo, p.vertical].filter(Boolean).join(" · ");
  return (
    <div className="usermenu" id="userMenu" ref={ref}>
      <button type="button" className={"avatarBtn" + (adm ? " isAdmin" : "")} aria-haspopup="true" aria-expanded={open} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <span className="avatar" title={adm ? "Administrador" : ""}>{ini}</span>
        <span className="uname">{p.nombres ? p.nombres.split(" ")[0] : nm}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="umenu">
          <div className="uhead"><span className="avatar big">{ini}</span><div><b>{nm}</b><small>{em}</small><span className={"badge " + (adm ? "admin" : readOnly ? "read" : "edit")}>{roleTxt}</span></div></div>
          {cargo && <small className="ucargo">{cargo}</small>}
          <hr />
          <button type="button" className="uitem uprofile" onClick={() => { setOpen(false); openProfile(false); }}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Mi perfil
          </button>
          {D.remote && (
            <button type="button" className="uitem" onClick={() => void D.logout()}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>Cerrar sesión
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const I = (d: string, w = 16) => <svg width={w} height={w} viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function ActionBar() {
  const readOnly = useApp(s => s.readOnly), store = useApp(s => s.store), clientId = useApp(s => s.clientId);
  const openReq = useDialogs(s => s.openReq), setImporting = useDialogs(s => s.setImporting);
  const calc = useCalc(), visible = useVisible();
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const planner = store.clients.some(c => c.planner?.enabled && c.planner.planId);
  const report = async () => {
    const list = await pickReqs({ title: "Descargar resumen de actividades (Word)", ok: "Descargar Word", list: visible, hint: "Elige uno o varios requerimientos. El documento incluye resumen ejecutivo, y por cada requerimiento sus actividades con responsable, fechas, duración, avance y estado, más entregables, métricas y comentarios." });
    if (!list) return;
    setBusy(true); say("Generando el documento…");
    try {
      const blob = await buildReport(list, calc, { author: authorName(), scope: clientId === "all" ? "Todos los clientes" : calc.clientName(clientId) });
      download(blob, `resumen-actividades-qa-${calc.today}.docx`);
      say(`Resumen descargado ✓ (${list.length} requerimiento${list.length === 1 ? "" : "s"})`);
    } catch (er) { say((er as Error).message || "No se pudo generar el documento.", true); }
    setBusy(false);
  };
  return (
    <div className={"actionbar" + (readOnly ? " ro" : "")} id="actionbar">
      {!readOnly && <button id="btnNew" className="primary big" onClick={() => { nav("/dash"); openReq(null); }}>{I("M12 5v14M5 12h14", 18)}Nuevo requerimiento</button>}
      <div className="spacer" />
      {planner && <button id="btnSync" className="ghost" onClick={() => void syncActive(D.remote)}>{I("M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M18 2v4h-4M6 22v-4h4")}Sincronizar Planner</button>}
      {!readOnly && <button id="btnImportXls" className="ghost" onClick={() => setImporting(true)}>{I("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13l4 4M13 13l-4 4")}Importar requerimientos Excel/CSV</button>}
      <button id="btnReport" className="ghost" disabled={busy} onClick={report}>{I("M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6M9 9h2")}Descargar resumen de actividades (Word)</button>
    </div>
  );
}
