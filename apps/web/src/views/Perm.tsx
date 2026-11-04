import { useCallback, useEffect, useState } from "react";
import { EMAIL_RE, type Profile } from "@qa/core";
import { FormErr, useFieldErrors } from "../components/forms";
import { Tip } from "../components/Hint";
import { D, type BackupRow } from "../lib/data";
import { permErr } from "../lib/errors";
import { useDialogs } from "../state/dialogs";
import { ask, say } from "../state/ui";
import { ROLE_TXT, resetProfileCache } from "./People";

const BK_KIND: Record<string, string> = { auto: "Automática", manual: "Manual", inicial: "Inicial", "pre-restauracion": "Antes de restaurar" };
const isLocked = (r: Profile) => !!r.locked && (r.role !== "admin" || Date.now() - new Date(r.locked_at || 0).getTime() < 15 * 60e3);

/** Cantidad de solicitudes pendientes + cuentas bloqueadas (globo rojo de la pestaña). */
export const countFlags = (rows: Profile[]) => rows.filter(r => r.role === "pending").length + rows.filter(r => r.locked && r.role !== "admin").length;

function Backups() {
  const [rows, setRows] = useState<BackupRow[] | null>(null), [msg, setMsg] = useState("");
  const load = useCallback(() => {
    D.listBackups().then(r => { setRows(r); setMsg(""); })
      .catch((er: Error) => setMsg(/does not exist|could not find|qa_backup/i.test(String(er.message)) ? "Falta ejecutar 06-seguridad.sql en Supabase." : "No se pudieron cargar las copias: " + er.message));
  }, []);
  useEffect(load, [load]);
  const restore = async (r: BackupRow) => {
    if (!await ask(`¿Restaurar la copia del ${new Date(r.taken_at).toLocaleString("es")} (${r.nreqs} requerimientos)?\n\nLos datos actuales se reemplazan; antes se guarda una copia de ellos.`)) return;
    try { await D.restoreBackup(r.id); say("Copia restaurada ✓ Recargando…"); setTimeout(() => location.reload(), 900); } catch (er) { say(permErr(er), true); }
  };
  return (
    <div className="card" id="backupCard">
      <h2><Tip group="head">Copias de seguridad</Tip></h2>
      <p className="muted">El sistema guarda una copia de todos los datos cada 6 horas (solo si hubo cambios) y conserva 45 días. Si alguien borra o daña información, restaura una copia aquí: antes de restaurar se guarda automáticamente el estado actual, así que puedes volver atrás.</p>
      <div className="crow"><button type="button" className="primary" id="btnBackupNow" onClick={async () => { try { const id = await D.makeBackup(); say(id ? "Copia creada ✓" : "No hay nada nuevo que copiar."); load(); } catch (er) { say(permErr(er), true); } }}>Crear copia ahora</button></div>
      <div className="tablewrap">
        <table id="backupTbl">
          {msg ? <tbody><tr><td className="muted">{msg}</td></tr></tbody> : (
            <>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Requerimientos</th><th>Clientes</th><th>Tamaño</th><th /></tr></thead>
              <tbody>
                {(rows || []).map(r => (
                  <tr key={r.id}>
                    <td>{new Date(r.taken_at).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}</td><td>{BK_KIND[r.kind] || r.kind}</td><td>{r.nreqs}</td><td>{r.nclients}</td><td>{r.kb} KB</td>
                    <td><button type="button" className="ghost" onClick={() => void restore(r)}>Restaurar</button></td>
                  </tr>
                ))}
                {rows && !rows.length && <tr><td colSpan={6} className="muted">Aún no hay copias.</td></tr>}
              </tbody>
            </>)}
        </table>
      </div>
    </div>
  );
}

export function Perm() {
  const [rows, setRows] = useState<Profile[] | null>(null), [msg, setMsg] = useState("");
  const [form, setForm] = useState({ email: "", role: "viewer" }), fe = useFieldErrors();
  const setPermCount = useDialogs(s => s.setPermCount);
  const me = D.myEmail();
  const load = useCallback(async () => {
    try {
      const r = await D.listProfiles();
      r.sort((x, y) => Number(y.role === "pending") - Number(x.role === "pending") || Number(isLocked(y)) - Number(isLocked(x)) || (x.email < y.email ? -1 : 1));
      setRows(r); setMsg(""); setPermCount(countFlags(r));
    } catch (er) { setMsg(permErr(er)); }
  }, [setPermCount]);
  useEffect(() => { void load(); }, [load]);
  const after = (okMsg: string) => { say(okMsg); resetProfileCache(); void load(); };

  if (!D.isAdmin()) return null;
  return (
    <section id="v-perm" className="view">
      <div className="card">
        <h2><Tip group="head">Permisos de acceso</Tip></h2>
        <p className="muted">Solo el administrador ve esta pantalla. <b>Administrador</b>: edita todo y gestiona permisos. <b>Editor</b>: crea y modifica requerimientos. <b>Solo lectura</b>: únicamente ve. Quien no esté en la lista no puede ver nada.</p>
        <FormErr msg={fe.errors.email} />
        <form id="permForm" className="inline" noValidate onSubmit={async e => {
          e.preventDefault();
          const email = form.email.trim().toLowerCase();
          if (!email) return fe.set("email", "Escribe el correo de la persona.");
          if (!EMAIL_RE.test(email)) return fe.set("email", "El correo no tiene un formato válido (ejemplo: nombre@ips.gob.cl).");
          try { await D.addUser(email, form.role); setForm({ email: "", role: "viewer" }); after("Acceso otorgado ✓"); } catch (er) { fe.set("email", permErr(er)); }
        }}>
          <input name="email" type="email" placeholder="correo@empresa.com" required className={fe.errors.email ? "bad" : ""} value={form.email} onChange={e => { setForm(f => ({ ...f, email: e.target.value })); fe.clear("email"); }} />
          <select name="role" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}><option value="viewer">Solo lectura</option><option value="editor">Editor</option><option value="admin">Administrador</option></select>
          <button className="primary">Dar acceso</button>
        </form>
        <p className="muted" id="permHint">Quien pulsa «Crear cuenta» queda <b>Pendiente</b> y aparece primero en la lista: tú la autorizas (eligiendo su permiso) o la rechazas. También puedes darle acceso por adelantado con este formulario. A los 5 intentos fallidos de contraseña la cuenta se <b>bloquea</b> y solo tú puedes desbloquearla aquí.</p>
        <div className="tablewrap">
          <table id="permTbl">
            {msg ? <tbody><tr><td className="muted">{msg}</td></tr></tbody> : (
              <>
                <thead><tr>{["Correo", "Nombre", "Estado", "Permiso"].map(h => <th key={h}><Tip group="acc">{h}</Tip></th>)}<th /></tr></thead>
                <tbody>
                  {(rows || []).map(r => {
                    const self = r.email === me, nm = [r.nombres, r.apellido_paterno, r.apellido_materno].filter(Boolean).join(" "), pend = r.role === "pending", lk = isLocked(r);
                    return (
                      <tr key={r.email} className={pend || lk ? "rowflag" : undefined}>
                        <td>{r.email}{self && <> <span className="badge">tú</span></>}</td>
                        <td>{nm || <span className="muted">Sin completar</span>}</td>
                        <td>{pend ? <span className="badge warnb">Pendiente de autorización</span> : lk ? <span className="badge dangerb">Bloqueada ({r.fails || 5} intentos)</span> : <span className="badge okb">Activa</span>}</td>
                        <td>
                          <select value={r.role} disabled={self} title={self ? "No puedes cambiar tu propio permiso" : undefined}
                            onChange={async e => { try { await D.setRole(r.email, e.target.value); after("Permiso actualizado ✓"); } catch (er) { say(permErr(er), true); void load(); } }}>
                            {Object.entries(ROLE_TXT).filter(([k]) => k !== "pending" || pend).map(([k, v]) => <option key={k} value={k} disabled={k === "pending"}>{pend && k !== "pending" ? "Autorizar como " + v.toLowerCase() : v}</option>)}
                          </select>
                        </td>
                        <td>
                          {lk && <><button className="primary" onClick={async () => { try { await D.unlock(r.email); after("Cuenta desbloqueada ✓"); } catch (er) { say(permErr(er), true); } }}>Desbloquear</button>{" "}</>}
                          {!self && <button className="danger" onClick={async () => { if (!await ask(`¿Quitar el acceso a ${r.email}? Ya no podrá ver el dashboard.`)) return; try { await D.removeUser(r.email); after("Acceso quitado ✓"); } catch (er) { say(permErr(er), true); } }}>{pend ? "Rechazar" : "Quitar acceso"}</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>)}
          </table>
        </div>
      </div>
      <Backups />
    </section>
  );
}
