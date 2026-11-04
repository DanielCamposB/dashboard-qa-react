import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { EMAIL_RE, PW_LABEL, PW_RULES, PW_TXT, pwMissing, type PwRule } from "@qa/core";
import { D, type Boot } from "../lib/data";
import { errEs } from "../lib/errors";
import { FormErr, PwInput, useFieldErrors } from "./forms";

type Mode = "login" | "signup" | "reset" | "code" | "newpw";
const T: Record<Mode, [string, string, string]> = {
  login: ["Ingresar al Dashboard QA", "Usa tu correo y contraseña.", "Ingresar"],
  signup: ["Crear cuenta", "Usa tu correo corporativo. Un administrador debe autorizar tu acceso antes de que puedas entrar.", "Crear cuenta"],
  reset: ["Recuperar contraseña", "Escribe tu correo y te enviaremos un código de verificación.", "Enviar código"],
  code: ["Verifica tu identidad", "", "Verificar código"],
  newpw: ["Nueva contraseña", "Escribe tu nueva contraseña (mínimo 8 caracteres).", "Guardar contraseña"],
};
const LOCKED = "Tu cuenta está bloqueada por superar los 5 intentos permitidos. Pide a un administrador que la desbloquee en Permisos.";
const maskMail = (e: string) => e.replace(/^(.).*(@.*)$/, "$1•••$2");

/** Red de nodos decorativa (generada, sin imágenes externas). */
function heroArt(): string {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 46 }, () => ({ x: rnd() * 600, y: rnd() * 600, r: 1.5 + rnd() * 3, d: rnd() * 4 }));
  let s = '<defs><radialGradient id="gl" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="#00ffff" stop-opacity=".35"/><stop offset="1" stop-color="#00ffff" stop-opacity="0"/></radialGradient></defs><rect width="600" height="600" fill="url(#gl)"/>';
  pts.forEach((p, i) => pts.slice(i + 1).forEach(q => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < 120) s += `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="#00ffff" stroke-opacity="${(0.5 * (1 - d / 120)).toFixed(2)}"/>`;
  }));
  pts.forEach(p => (s += `<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="#00ffff" class="nd" style="animation-delay:${p.d.toFixed(1)}s"/>`));
  return s;
}

export function Login({ boot }: { boot: Exclude<Boot, { kind: "ready" }> }) {
  const [mode, setModeRaw] = useState<Mode>(boot.kind === "login" && boot.recovery ? "newpw" : "login");
  const [f, setF] = useState({ email: "", password: "", password2: "", code: "" });
  const [resetEmail, setResetEmail] = useState("");
  const [err, setErr] = useState(""), [ok, setOk] = useState(""), [info, setInfo] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [cool, setCool] = useState(0);
  const fe = useFieldErrors();
  const form = useRef<HTMLFormElement>(null);
  const art = useMemo(heroArt, []);

  useEffect(() => { document.body.classList.add("on-login"); document.body.classList.remove("booting"); return () => document.body.classList.remove("on-login"); }, []);
  useEffect(() => { if (cool <= 0) return; const t = setTimeout(() => setCool(c => c - 1), 1000); return () => clearTimeout(t); }, [cool]);
  const initErr = boot.kind === "login" && boot.initError ? errEs(boot.initError) : "";
  useEffect(() => { if (initErr) setErr(initErr); }, [initErr]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF(s => ({ ...s, [k]: e.target.value })); fe.clear(k); };
  // Cada cambio de pantalla deja los campos limpios (salvo al avanzar dentro del mismo trámite: keep)
  const setMode = (m: Mode, keep = false) => {
    setModeRaw(m); setErr(""); setOk(""); setInfo(null); fe.clear(); setCool(0);
    if (!keep) { setF({ email: "", password: "", password2: "", code: "" }); setResetEmail(""); }
  };
  const fail = (t: string, field?: keyof typeof f) => {
    fe.clear(); setErr("");
    if (field && t) { fe.set(field, t); setTimeout(() => form.current?.querySelector<HTMLInputElement>(`[name=${field}]`)?.focus(), 0); } else setErr(t);
  };

  // Pantallas de estado: sin acceso, solicitud pendiente o cuenta bloqueada
  if (boot.kind !== "login") {
    const [title, text] = boot.kind === "denied" ? ["Sin acceso", `Tu correo (${boot.user}) no tiene acceso. Pide a un administrador que te agregue.`]
      : boot.kind === "pending" ? ["Solicitud en revisión", `Tu cuenta (${boot.user}) fue creada y está esperando la autorización de un administrador. Cuando la apruebe podrás ingresar con el mismo correo y contraseña.`]
      : ["Cuenta bloqueada", `La cuenta ${boot.user} fue bloqueada por superar los 5 intentos de contraseña. Un administrador debe desbloquearla en Permisos.`];
    return (
      <LoginShell art={art}>
        <h2>{title}</h2><p className="muted">{text}</p>
        {boot.kind === "pending" && <button onClick={() => location.reload()}>Revisar de nuevo</button>}
        <button onClick={() => void D.logout()}>Cerrar sesión</button>
      </LoginShell>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); fe.clear();
    const email = f.email.trim(), pw = f.password;
    if (["login", "signup", "reset"].includes(mode)) {
      if (!email) return fail("Escribe tu correo.", "email");
      if (!EMAIL_RE.test(email)) return fail("El correo no tiene un formato válido (ejemplo: nombre@ips.gob.cl).", "email");
    }
    if (["login", "signup", "newpw"].includes(mode) && !pw) return fail("Escribe tu contraseña.", "password");
    if (mode === "signup" || mode === "newpw") {
      const miss = pwMissing(pw);
      if (miss.length) return fail("La contraseña debe tener " + miss.map(k => PW_TXT[k]).join(", ") + ".", "password");
      if (pw !== f.password2) return fail("Las contraseñas no coinciden.", "password2");
    }
    const code = f.code.replace(/\s/g, "");
    if (mode === "code" && !/^\d{6,10}$/.test(code)) return fail("Escribe el código que llegó a tu correo (solo números).", "code");
    setBusy(true);
    try {
      if (mode === "login") {
        if ((await D.precheck(email)) === "locked") throw { locked: true };
        try { await D.login(email, pw); }
        catch (er) {
          if (!/invalid login credentials/i.test(String((er as Error)?.message))) throw er;
          const r = await D.loginFailed(email), left = r?.remaining ?? 0;
          throw { custom: r?.locked ? LOCKED : r?.known && left <= 2 ? `Correo o contraseña incorrectos. ${left === 1 ? "Te queda 1 intento" : `Te quedan ${left} intentos`} antes de que la cuenta se bloquee.` : "Correo o contraseña incorrectos." };
        }
        location.reload();
      } else if (mode === "signup") {
        if (await D.signUp(email, pw)) location.reload();
        else { setMode("login"); setOk("✓ Cuenta creada. Falta un paso: confirma tu correo con el enlace que te enviamos (revisa spam). Después, tu acceso quedará en espera hasta que un administrador lo autorice."); }
      } else if (mode === "reset") {
        await D.sendResetCode(email); setResetEmail(email.toLowerCase()); setMode("code", true); setCool(60);
      } else if (mode === "code") {
        await D.verifyResetCode(resetEmail, code); setMode("newpw", true); setInfo("Código verificado ✓ Ahora crea tu nueva contraseña.");
      } else {
        await D.updatePassword(pw); history.replaceState(null, "", location.pathname); location.reload();
      }
    } catch (er) {
      const x = er as { custom?: string; locked?: boolean };
      if (x?.custom) fail(x.custom, "password"); else fail(x?.locked ? LOCKED : errEs(er));
    }
    setBusy(false);
  };

  const resend = async (e: React.MouseEvent) => {
    e.preventDefault(); if (cool > 0) return;
    try { await D.sendResetCode(resetEmail); setErr(""); setCool(60); setInfo(`Enviamos un código nuevo a ${maskMail(resetEmail)}.`); } catch (er) { setErr(errEs(er)); }
  };
  const back = async (e: React.MouseEvent) => { e.preventDefault(); if (mode === "newpw" || mode === "code") await D.signOutQuiet(); setMode("login"); };
  const [title, base, btn] = T[mode];
  const infoText = info ?? (mode === "code" ? `Enviamos un código de verificación a ${maskMail(resetEmail)}. Revisa tu bandeja de entrada (y spam); vence en pocos minutos.` : base);
  const rules = (Object.keys(PW_RULES) as PwRule[]);

  return (
    <LoginShell art={art}>
      <h2 id="loginTitle">{title}</h2>
      <p id="loginInfo" className="muted">{infoText}</p>
      {ok && <div id="loginOk" className="loginOk" role="status">{ok}</div>}
      {err && <div id="loginErr" className="loginErr" role="alert">{err}</div>}
      <form id="loginForm" ref={form} onSubmit={submit} noValidate>
        {["login", "signup", "reset"].includes(mode) && (<>
          <FormErr msg={fe.errors.email} />
          <label>Correo <input type="email" name="email" autoComplete="username" placeholder="tu.correo@empresa.com" className={fe.errors.email ? "bad" : ""} value={f.email} onChange={set("email")} /></label>
        </>)}
        {["login", "signup", "newpw"].includes(mode) && (<>
          <FormErr msg={fe.errors.password} />
          <label id="pwRow">Contraseña <PwInput name="password" autoComplete={mode === "login" ? "current-password" : "new-password"} className={fe.errors.password ? "bad" : ""} value={f.password} onChange={set("password")} /></label>
        </>)}
        {mode === "code" && (<>
          <FormErr msg={fe.errors.code} />
          <label id="codeRow">Código de verificación <input type="text" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} placeholder="••••••" aria-label="Código de verificación" autoFocus className={fe.errors.code ? "bad" : ""} value={f.code} onChange={set("code")} /></label>
        </>)}
        {(mode === "signup" || mode === "newpw") && (<>
          <FormErr msg={fe.errors.password2} />
          <label id="pw2Row">Repite la contraseña <PwInput name="password2" autoComplete="new-password" className={fe.errors.password2 ? "bad" : ""} value={f.password2} onChange={set("password2")} /></label>
          <ul id="pwRules" className="pwRules" aria-live="polite">
            {rules.map(k => { const okk = PW_RULES[k](f.password); return <li key={k} data-r={k} data-s={okk ? "✓" : "✗"} className={okk ? "ok" : ""}>{PW_LABEL[k]}</li>; })}
          </ul>
        </>)}
        <button className="primary" id="loginBtn" disabled={busy}>{btn}</button>
      </form>
      <p className="loginLinks">
        {mode === "login" && <a href="#" onClick={e => { e.preventDefault(); setMode("signup"); }}>Crear cuenta</a>}
        {(mode === "login" || mode === "signup") && <a href="#" onClick={e => { e.preventDefault(); setMode("reset"); }}>Olvidé mi contraseña</a>}
        {mode === "code" && <a href="#" className={cool > 0 ? "off" : ""} onClick={resend}>{cool > 0 ? `Reenviar código (${cool} s)` : "Reenviar código"}</a>}
        {mode !== "login" && <a href="#" onClick={back}>Volver a ingresar</a>}
      </p>
    </LoginShell>
  );
}

function LoginShell({ art, children }: { art: string; children: React.ReactNode }) {
  return (
    <section id="login" className="login-wrap">
      <div className="login-hero">
        <svg id="heroArt" viewBox="0 0 600 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true" dangerouslySetInnerHTML={{ __html: art }} />
        <div className="hero-txt">
          <div className="brand"><span className="mark">QA</span> Control de calidad</div>
          <h1>DASHBOARD <span>QA</span></h1>
          <p>Seguimiento de requerimientos, actividades y avance del equipo de pruebas, en un solo lugar.</p>
          <ul><li>Gantt por requerimiento</li><li>Alertas de atraso</li><li>Seguimiento y comentarios</li></ul>
        </div>
      </div>
      <div className="login-panel">{children}</div>
    </section>
  );
}
