import { useEffect, useState } from "react";
import { PW_LABEL, PW_RULES, PW_TXT, PW_RULES as RULES, type PwRule } from "@qa/core";
import { Field, FormErr, PwInput, useFieldErrors } from "../components/forms";
import { Modal } from "../components/Modal";
import { D, PROFILE_FIELDS } from "../lib/data";
import { todayLocal } from "@qa/core";
import { useDialogs } from "../state/dialogs";
import { say } from "../state/ui";

const empty = () => Object.fromEntries(PROFILE_FIELDS.map(k => [k, ""])) as Record<(typeof PROFILE_FIELDS)[number], string>;

export function ProfileDialog() {
  const slot = useDialogs(s => s.profile), close = useDialogs(s => s.closeProfile), bump = useDialogs(s => s.bumpProfile);
  const [f, setF] = useState(empty()), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ cur: "", cur2: "", n1: "", n2: "" }), fe = useFieldErrors();
  const [acctOpen, setAcctOpen] = useState(false);
  useEffect(() => {
    if (!slot) return;
    const p = D.getProfile();
    setF(Object.fromEntries(PROFILE_FIELDS.map(k => [k, (p[k] as string | null | undefined) ?? ""])) as ReturnType<typeof empty>);
    setErr(""); setPw({ cur: "", cur2: "", n1: "", n2: "" }); setAcctOpen(false); fe.clear();
  }, [slot]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    if (!f.nombres.trim()) return setErr("Escribe tus nombres.");
    if (!f.apellido_paterno.trim()) return setErr("Escribe tu apellido paterno.");
    if (f.cumpleanos && f.cumpleanos > todayLocal()) return setErr("La fecha de cumpleaños no puede ser futura.");
    setBusy(true);
    try { await D.saveProfile(f); close(); bump(); say("Perfil guardado ✓"); }
    catch (er) {
      const m = String((er as Error).message || er);
      setErr(/column .* does not exist|schema cache/i.test(m) ? "Falta ejecutar el SQL de perfiles en Supabase (archivo 02-perfil.sql)." : /permission denied|row-level/i.test(m) ? "No tienes permiso para guardar este perfil." : /failed to fetch|network/i.test(m) ? "No hay conexión con el servidor. Inténtalo de nuevo." : "No se pudo guardar: " + m);
    }
    setBusy(false);
  };
  const changePw = async () => {
    const { cur, cur2, n1, n2 } = pw;
    if (!cur) return fe.set("cur", "Escribe tu contraseña actual.");
    if (cur2 !== cur) return fe.set("cur2", "Las contraseñas actuales no coinciden.");
    const miss = (Object.keys(RULES) as PwRule[]).filter(k => !RULES[k](n1));
    if (miss.length) return fe.set("n1", "La contraseña debe tener " + miss.map(k => PW_TXT[k]).join(", ") + ".");
    if (n1 === cur) return fe.set("n1", "La nueva contraseña debe ser distinta de la actual.");
    if (n1 !== n2) return fe.set("n2", "Las contraseñas no coinciden.");
    setBusy(true);
    try { await D.changePassword(cur, n1); setPw({ cur: "", cur2: "", n1: "", n2: "" }); setAcctOpen(false); say("Contraseña actualizada ✓"); }
    catch (er) {
      const m = String((er as Error).message || er);
      if (m === "current") fe.set("cur", "La contraseña actual no es correcta.");
      else fe.set("n1", /same|different/i.test(m) ? "La nueva contraseña debe ser distinta de la actual." : /failed to fetch|network/i.test(m) ? "No hay conexión con el servidor. Inténtalo de nuevo." : "No se pudo cambiar: " + m);
    }
    setBusy(false);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const sp = (k: keyof typeof pw) => (e: React.ChangeEvent<HTMLInputElement>) => { setPw(s => ({ ...s, [k]: e.target.value })); fe.clear(k); };
  return (
    <Modal open={!!slot} id="pdlg" formId="pform" className="pdlg" onCancel={close} onSubmit={e => void submit(e)}>
      <header><h2>Mi perfil</h2>{D.isAdmin() && <span className="badge admin">★ Administrador</span>}<button type="button" id="pClose" onClick={close} aria-label="Cerrar">✕</button></header>
      <div className="pbody">
        <p className="muted">{slot?.first ? "Bienvenido/a. Completa tu perfil para que el equipo te identifique. Puedes editarlo después desde «Mi perfil»." : "Esta información identifica a cada integrante del equipo."}</p>
        {err && <div className="loginErr">{err}</div>}
        <Field label="Correo de acceso"><input name="email" disabled value={D.myEmail() || "(modo local)"} readOnly /></Field>
        <div className="row3">
          <Field label="Nombres"><input name="nombres" required autoComplete="given-name" value={f.nombres} onChange={set("nombres")} /></Field>
          <Field label="Apellido paterno"><input name="apellido_paterno" required autoComplete="family-name" value={f.apellido_paterno} onChange={set("apellido_paterno")} /></Field>
          <Field label="Apellido materno"><input name="apellido_materno" value={f.apellido_materno} onChange={set("apellido_materno")} /></Field>
        </div>
        <div className="row2">
          <Field label="Rol / cargo en la empresa"><input name="cargo" placeholder="Ej: Analista QA, Líder QA" value={f.cargo} onChange={set("cargo")} /></Field>
          <Field label="Vertical donde trabaja"><input name="vertical" placeholder="Ej: Banca, Retail, Gobierno" value={f.vertical} onChange={set("vertical")} /></Field>
        </div>
        <div className="row2">
          <Field label="Cumpleaños"><input type="date" name="cumpleanos" value={f.cumpleanos} onChange={set("cumpleanos")} /></Field>
          <Field label="Teléfono"><input name="telefono" type="tel" autoComplete="tel" placeholder="+56 9 ..." value={f.telefono} onChange={set("telefono")} /></Field>
        </div>
        {D.remote && (
          <details className="acct" id="pAccount" open={acctOpen} onToggle={e => setAcctOpen((e.target as HTMLDetailsElement).open)}>
            <summary>Cuenta · Cambiar contraseña</summary>
            <div className="acctBody">
              <Field label="Contraseña actual" error={fe.errors.cur}><PwInput autoComplete="current-password" className={fe.errors.cur ? "bad" : ""} value={pw.cur} onChange={sp("cur")} /></Field>
              <Field label="Repite la contraseña actual" error={fe.errors.cur2}><PwInput autoComplete="current-password" className={fe.errors.cur2 ? "bad" : ""} value={pw.cur2} onChange={sp("cur2")} /></Field>
              <Field label="Nueva contraseña" error={fe.errors.n1}><PwInput autoComplete="new-password" className={fe.errors.n1 ? "bad" : ""} value={pw.n1} onChange={sp("n1")} /></Field>
              <Field label="Repite la nueva contraseña" error={fe.errors.n2}><PwInput autoComplete="new-password" className={fe.errors.n2 ? "bad" : ""} value={pw.n2} onChange={sp("n2")} /></Field>
              <ul id="cpRules" className="pwRules" aria-live="polite">
                {(Object.keys(PW_RULES) as PwRule[]).map(k => { const ok = PW_RULES[k](pw.n1); return <li key={k} data-r={k} data-s={ok ? "✓" : "✗"} className={ok ? "ok" : ""}>{PW_LABEL[k]}</li>; })}
              </ul>
              <FormErr />
              <div className="acctAct"><button type="button" className="primary" id="cpSave" disabled={busy} onClick={() => void changePw()}>Cambiar contraseña</button></div>
            </div>
          </details>
        )}
      </div>
      <footer><div className="spacer" /><button type="button" id="pCancel" onClick={close}>Cerrar</button><button type="submit" className="primary" id="pSave" disabled={busy}>Guardar perfil</button></footer>
    </Modal>
  );
}
