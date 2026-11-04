import { useEffect, useState } from "react";
import { EMAIL_RE, isTeamsUrl, makeCalc, ownerDigests, summaryFor, type Client, type TeamsEvents } from "@qa/core";
import { FormErr, useFieldErrors } from "../components/forms";
import { Hint } from "../components/Hint";
import { D } from "../lib/data";
import { teamsOn } from "../lib/plannerSync";
import { lsGet, lsSet } from "../lib/storage";
import { sendTeams } from "../lib/teamsClient";
import { authorName, useApp, useCalc, useIsAdmin } from "../state/app";
import { ask, say } from "../state/ui";

const REMOTE = D.remote;
const DAYS: [number, string][] = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [7, "Dom"]];
const okT = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
const normTimes = (l: string[]) => [...new Set(l.filter(okT))].sort();
const SECRET_ERR = /row-level|permission|policy|notify_secrets|does not exist/i;
const SECRET_MSG = (e: Error) => (SECRET_ERR.test(String(e.message)) ? "No se pudo guardar: solo un administrador puede, y hay que ejecutar 06-seguridad.sql." : "No se pudo guardar: " + e.message);

const Th = ({ t, tip }: { t: string; tip?: string }) => <th>{t}{tip && <> <Hint tip={tip} /></>}</th>;

export function Avisos() {
  const { store, commit, readOnly, clientId, user } = useApp();
  const calc = useCalc(), canSecret = !REMOTE || useIsAdmin();
  const ro = readOnly, dis = ro;
  const n = store.notify, cur = store.clients.find(c => c.id === clientId);
  const selTxt = clientId === "all" ? "todos los clientes" : cur?.name || "cliente";
  const [busy, setBusy] = useState<string | null>(null);
  const [newTime, setNewTime] = useState("10:00");
  const [testTo, setTestTo] = useState(() => lsGet("qa-test-to", "") || store.members.find(m => m.email)?.email || user || "");
  const fe = useFieldErrors();
  const userUrlOn = REMOTE ? !!n.hasUserUrl : !!(n.userWebhook || "").trim();
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => setUrls({}), [store.clients.length]);

  const upd = (fn: (n: typeof store.notify) => void) => commit(s => {
    s.notify ||= { times: [], days: [], userWebhook: "", siteUrl: "" }; s.notify.times ||= []; s.notify.days ||= [];
    fn(s.notify);
    if (!/^(localhost|127\.)/.test(location.hostname)) s.notify.siteUrl = location.href.split("#")[0];
  });
  const setEvent = (cid: string, k: keyof TeamsEvents, v: boolean) => { commit(s => { const c = s.clients.find(x => x.id === cid); if (c) { c.teams ||= { enabled: false, webhook: "", events: {} }; (c.teams.events ||= {})[k] = v; } }); say("Guardado ✓"); };

  // Guarda/borra una URL: en línea va a la tabla de secretos (solo admin); local queda en el navegador
  const saveClientUrl = async (cid: string, v: string) => {
    try {
      if (REMOTE) { await D.setSecret("client:" + cid, v); commit(s => { const c = s.clients.find(y => y.id === cid); if (c) { c.teams ||= { enabled: false, webhook: "", events: {} }; c.teams.hasUrl = !!v; delete (c.teams as { webhook?: string }).webhook; c.teams.webhook = ""; } }); }
      else commit(s => { const c = s.clients.find(y => y.id === cid); if (c) { c.teams ||= { enabled: false, webhook: "", events: {} }; c.teams.webhook = v; } });
      commit(s => { const c = s.clients.find(y => y.id === cid); if (c && v) { c.teams ||= { enabled: false, webhook: "", events: {} }; c.teams.enabled = true; } });
      say(v ? "URL guardada ✓" + (REMOTE ? " (solo administradores pueden verla)." : "") : "URL quitada.");
    } catch (e) { say(SECRET_MSG(e as Error), true); }
  };
  const saveUserUrl = async (v: string) => {
    try {
      if (REMOTE) { await D.setSecret("user", v); upd(x => { x.hasUserUrl = !!v; x.userWebhook = ""; }); } else upd(x => { x.userWebhook = v; });
      say(v ? "URL guardada ✓" : "URL quitada.");
    } catch (e) { say(SECRET_MSG(e as Error), true); }
  };
  const urlCell = (c: Client) => {
    const has = REMOTE ? !!c.teams?.hasUrl : !!c.teams?.webhook, key = "c" + c.id, val = urls[key] ?? (REMOTE ? "" : c.teams?.webhook || "");
    if (!canSecret) return <span className="muted sm">{has ? "✓ Guardada por un administrador" : "Sin URL: la guarda un administrador"}</span>;
    return (
      <>
        <FormErr msg={fe.errors[key]} />
        <input type="text" className={"secret" + (fe.errors[key] ? " bad" : "")} name={"qa-hook-" + c.id} spellCheck={false} autoComplete="off" disabled={ro} aria-label={"URL del canal de " + c.name}
          placeholder={REMOTE && has ? "✓ URL guardada: pega otra para reemplazarla" : "Pega aquí la URL del canal"} value={val}
          onChange={e => { setUrls(u => ({ ...u, [key]: e.target.value })); fe.clear(key); }}
          onBlur={() => { const v = (urls[key] ?? "").trim(); if (urls[key] === undefined || (!REMOTE && v === (c.teams?.webhook || ""))) return; if (v && !isTeamsUrl(v)) return fe.set(key, "La URL no parece un webhook de Teams / Power Automate (debe ser https y de Microsoft)."); void saveClientUrl(c.id, v).then(() => setUrls(u => { const x = { ...u }; delete x[key]; return x; })); }} />
        {REMOTE && has && !ro && <> <button type="button" className="ghost" onClick={async () => { if (await ask("¿Quitar la URL de este cliente? Dejará de recibir avisos.")) void saveClientUrl(c.id, ""); }}>Quitar</button></>}
      </>
    );
  };

  // Envíos manuales: cada uno devuelve un texto con el resultado
  const channelNow = async (c: Client) => {
    if (!teamsOn(c, REMOTE)) return `${c.name}: sin URL de canal`;
    const m = summaryFor(store, c, makeCalc(store, calc.today)), r = await sendTeams(store, c, m);
    return `${c.name}: ` + (r.ok ? (r.unconfirmed ? "resumen enviado al canal (revisa Teams)" : "resumen enviado al canal ✓") : "no se pudo enviar al canal: " + r.err);
  };
  const ownersNow = async (c: Client) => {
    if (!userUrlOn) return `${c.name}: falta la URL del flujo de mensajes personales`;
    const ds = ownerDigests(store, c, calc);
    if (!ds.length) return `${c.name}: ningún responsable con pendientes o con correo en Equipo`;
    let ok = 0;
    for (const d of ds) if ((await sendTeams(store, "user", { ...d, title: d.title, to: d.email, who: { name: d.name, email: d.email } })).ok) ok++;
    return `${c.name}: mensajes personales ${ok}/${ds.length}`;
  };
  const run = async (key: string, fn: () => Promise<string>) => { setBusy(key); try { say(await fn()); } finally { setBusy(null); } };
  const selList = (pred: (c: Client) => boolean) => store.clients.filter(c => (clientId === "all" || c.id === clientId) && pred(c));

  const sendTest = async () => {
    const em = testTo.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) return fe.set("test", "Escribe un correo válido de Teams, por ejemplo nombre@tu-organizacion.cl.");
    fe.clear(); lsSet("qa-test-to", em);
    const r = await sendTeams(store, "user", { title: "Prueba · mensajes personales Dashboard QA", facts: [["Para", em]], lines: ["Si ves este mensaje, el flujo de mensajes personales funciona ✅"], to: em });
    say(r.ok ? (r.unconfirmed ? "Enviado. Revisa tu chat de Teams (no se puede confirmar desde el navegador)." : "Enviado ✓") : r.err || "", !r.ok);
  };

  return (
    <section id="v-avisos" className="view">
      <div id="avisosBox">
        <div className="card">
          <h2>Avisos automáticos a Teams</h2>
          <p className="muted">Hay dos tipos de aviso, independientes entre sí: el <b>resumen al grupo «QA - Avisos»</b> (un canal por cliente) y el <b>mensaje personal</b> a cada responsable (su chat privado). Los dos se envían solos en los horarios de abajo, hora de Chile, aunque nadie tenga el sitio abierto. Los botones «Enviar ahora» sirven para enviar cuando quieras, sin esperar al horario.</p>
          <label className="switch"><input type="checkbox" id="avMaster" checked={n.auto !== false} disabled={dis} onChange={e => { upd(x => { x.auto = e.target.checked; }); say(e.target.checked ? "Envío automático activado ✓" : "Envío automático apagado: no saldrá ningún aviso programado."); }} /><i /><b>Envío automático activado</b></label>
          <p className="muted sm">Si lo apagas no sale ningún aviso programado, ni al canal ni personal. Los botones «Enviar ahora» siguen funcionando.</p>
          <h3>Horarios</h3>
          <div className="crow" id="avTimes">
            {(n.times || []).map(t => (
              <span className="tchip" key={t}>
                <input type="time" defaultValue={t} disabled={dis} aria-label="Horario de envío" onBlur={e => { const v = e.target.value; if (v === t) return; if (!okT(v)) { e.target.value = t; return; } upd(x => { x.times = normTimes(x.times.map(y => (y === t ? v : y))); }); }} />
                <button type="button" className="ghost" disabled={dis} title="Quitar horario" aria-label={"Quitar horario " + t} onClick={() => upd(x => { x.times = x.times.filter(y => y !== t); })}>×</button>
              </span>
            ))}
            {!(n.times || []).length && <span className="muted">Sin horarios: no se enviará nada automático.</span>}
          </div>
          <div className="crow">
            <input type="time" id="avNew" value={newTime} disabled={dis} aria-label="Nuevo horario" onChange={e => setNewTime(e.target.value)} />
            <button type="button" id="avAdd" disabled={dis} onClick={() => { if (!okT(newTime)) return say("Elige una hora válida.", true); upd(x => { x.times = normTimes([...x.times, newTime]); }); }}>+ Agregar horario</button>
            <button type="button" id="avDef" disabled={dis} onClick={() => upd(x => { x.times = ["09:00", "12:00", "15:00", "18:00"]; })}>Restablecer 9, 12, 15 y 18 h</button>
          </div>
          <h3>Días</h3>
          <div className="crow">{DAYS.map(([d, l]) => <label className="chk" key={d}><input type="checkbox" checked={(n.days || []).includes(d)} disabled={dis} onChange={e => upd(x => { x.days = e.target.checked ? [...new Set([...x.days, d])].sort() : x.days.filter(y => y !== d); })} /> {l}</label>)}</div>
        </div>

        <div className="card">
          <h2>1 · Resumen al grupo «QA - Avisos»</h2>
          <p className="muted">Un mensaje por cliente, en el canal de Teams de ese cliente, con sus requerimientos atrasados, bloqueados, sin actualizar y entregables vencidos. Opcionalmente puede incluir la lista completa de requerimientos y la carga de cada responsable. Cada cliente tiene su propia URL de webhook (la que entrega Teams al crear el flujo del canal).</p>
          <div className="tablewrap">
            <table className="avtbl">
              <thead><tr>
                <Th t="Cliente" />
                <Th t="Canal" tip="Estado de la conexión: «Conectado» si ya hay una URL de webhook guardada para el canal de este cliente; «Sin URL» si falta." />
                <Th t="URL del canal (webhook)" tip="La dirección que entrega Teams al crear el flujo «Cuando se recibe una solicitud de webhook» del canal de este cliente. La guarda un administrador y no se vuelve a mostrar." />
                <Th t="Programado" tip="Si está marcada, este cliente recibe el resumen solo, en los horarios de arriba. Si no, nunca sale solo y solo se envía con el botón «Enviar ahora». Además debe estar encendido el interruptor «Envío automático activado» de arriba." />
                <Th t="Incluir todos los requerimientos" tip="Agrega al resumen la lista completa de requerimientos en curso del cliente, con estado, avance, fecha de fin y responsables." />
                <Th t="Incluir carga por responsable" tip="Agrega al resumen un bloque por persona con todas sus actividades abiertas: atrasadas, bloqueadas, por vencer y pendientes." />
                <Th t="Omitir si no hay atrasos ni bloqueos" tip="Solo afecta al envío programado: si no hay nada atrasado, bloqueado, sin actualizar ni entregables vencidos, ese resumen no se envía. Si arriba incluyes la lista completa o la carga por responsable, el resumen sale siempre." />
                <Th t="Aviso inmediato al bloquear" tip="Aviso corto al canal en el momento en que alguien marca una actividad como bloqueada en el dashboard. No depende de los horarios." />
                <Th t="Aviso al sincronizar Planner" tip="Aviso al canal cada vez que alguien sincroniza Planner de este cliente." />
                <Th t="Envío manual" tip="«Prueba» manda un mensaje corto para verificar que el canal funciona. «Enviar ahora» manda el resumen real ahora mismo, sin esperar al horario y sin importar la casilla «Programado»." />
              </tr></thead>
              <tbody>
                {store.clients.map(c => {
                  const ev = c.teams?.events || {}, hook = teamsOn(c, REMOTE), d = ro || !hook;
                  const chk = (k: keyof TeamsEvents, on: boolean, label: string, off = false) => <input type="checkbox" checked={on} disabled={d || off} aria-label={label} onChange={e => setEvent(c.id, k, e.target.checked)} />;
                  return (
                    <tr key={c.id}>
                      <td><b>{c.name}</b></td>
                      <td>{hook ? <span className="badge okb">Conectado</span> : <span className="badge warnb">Sin URL</span>}</td>
                      <td>{urlCell(c)}</td>
                      <td><label className="chk">{chk("auto", ev.auto !== false, "Resumen automático al canal de " + c.name)} Automático</label></td>
                      <td>{chk("all", ev.all === true, "Incluir todos los requerimientos de " + c.name + " en el resumen")}</td>
                      <td>{chk("byOwner", ev.byOwner === true, "Incluir la carga por responsable de " + c.name + " en el resumen")}</td>
                      <td>{chk("quiet", ev.quiet !== false, "Omitir el resumen automático de " + c.name + " si no hay atrasos ni bloqueos", ev.auto === false)}</td>
                      <td>{chk("blocked", ev.blocked !== false, "Aviso inmediato al canal cuando se bloquea una actividad de " + c.name)}</td>
                      <td>{chk("sync", ev.sync !== false, "Avisar al canal al sincronizar Planner de " + c.name)}</td>
                      <td><div className="crow">
                        <button type="button" disabled={ro || !hook || busy === "t" + c.id} onClick={() => run("t" + c.id, async () => { const r = await sendTeams(store, c, { title: `Prueba · Dashboard QA · ${c.name}`, facts: [["Enviado por", authorName()]], lines: ["Si ves este mensaje, la conexión con el canal funciona ✅"] }); return `${c.name}: ` + (r.ok ? (r.unconfirmed ? "prueba enviada, revisa el canal de Teams" : "prueba enviada ✓") : r.err); })}>Prueba</button>
                        <button type="button" disabled={ro || !hook || busy === "n" + c.id} onClick={async () => { if (await ask(`¿Enviar ahora el resumen de ${c.name} a su canal?`)) void run("n" + c.id, () => channelNow(c)); }}>Enviar ahora</button>
                      </div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="crow">
            <button type="button" className="primary" id="avSel" disabled={dis || busy === "sel"} onClick={async () => { const list = selList(c => teamsOn(c, REMOTE)); if (!list.length) return say("El cliente elegido no tiene URL de canal.", true); if (await ask(`¿Enviar ahora el resumen al canal de: ${list.map(c => c.name).join(", ")}?`)) void run("sel", async () => { const res: string[] = []; for (const c of list) res.push(await channelNow(c)); return res.join("  |  "); }); }}>Enviar resumen ahora: {selTxt}</button>
            <span className="muted sm">Usa el cliente elegido arriba, en el selector «Cliente». Si eliges uno solo, solo sale ese.</span>
          </div>
        </div>

        <div className="card">
          <h2>2 · Mensaje personal a cada responsable</h2>
          <p className="muted"><b>Para qué sirve:</b> cada responsable recibe en su propio chat de Teams (aparece como «Flujos de trabajo») la lista de <b>sus</b> actividades atrasadas, bloqueadas o por vencer, con su nombre mencionado. Es distinto del canal: el webhook del canal no puede escribirle a una persona, por eso hace falta un segundo flujo de Power Automate que recibe el correo de la persona y le entrega el mensaje. Es <b>una sola URL para todos los clientes</b>, y los correos salen de <b>Equipo → Correo de Teams</b>.</p>
          <label>URL del flujo de mensajes personales
            {canSecret
              ? <><input type="text" className="secret" name="qa-hook-user" id="avUser" spellCheck={false} autoComplete="off" disabled={dis} placeholder={REMOTE && n.hasUserUrl ? "✓ URL guardada: pega otra para reemplazarla" : "https://prod-…logic.azure.com/…"} value={urls.user ?? (REMOTE ? "" : n.userWebhook || "")}
                onChange={e => { setUrls(u => ({ ...u, user: e.target.value })); fe.clear("user"); }}
                onBlur={() => { const v = (urls.user ?? "").trim(); if (urls.user === undefined) return; if (v && !isTeamsUrl(v)) return fe.set("user", "La URL no parece un webhook de Teams / Power Automate (https de Microsoft)."); void saveUserUrl(v).then(() => setUrls(u => { const x = { ...u }; delete x.user; return x; })); }} />
                {REMOTE && n.hasUserUrl && !dis && <> <button type="button" className="ghost" onClick={async () => { if (await ask("¿Quitar la URL de mensajes personales?")) void saveUserUrl(""); }}>Quitar</button></>}
                <FormErr msg={fe.errors.user} /></>
              : <span className="muted sm">{n.hasUserUrl ? "✓ Guardada por un administrador" : "Sin URL: la guarda un administrador"}</span>}
          </label>
          <div className="tablewrap">
            <table className="avtbl">
              <thead><tr>
                <Th t="Cliente" />
                <Th t="Responsables con aviso" tip="Personas de este cliente que recibirían un mensaje: tienen actividades abiertas y un correo de Teams cargado en la pestaña Equipo." />
                <Th t="Programado" tip="Si está marcada, cada responsable de este cliente recibe su mensaje personal solo, en los horarios de arriba. Además debe estar encendido el interruptor «Envío automático activado»." />
                <Th t="Envío manual" tip="«Enviar ahora» manda ahora mismo el mensaje personal a cada responsable de este cliente, sin esperar al horario." />
              </tr></thead>
              <tbody>
                {store.clients.map(c => {
                  const ev = c.teams?.events || {}, ds = ownerDigests(store, c, calc), d = ro || !userUrlOn;
                  return (
                    <tr key={c.id}>
                      <td><b>{c.name}</b></td>
                      <td className="sm">{ds.length ? ds.map(x => x.name).join(", ") : <span className="muted">Nadie con pendientes o sin correo en Equipo</span>}</td>
                      <td><label className="chk"><input type="checkbox" checked={ev.owners === true} disabled={d} aria-label={"Mensaje personal automático a los responsables de " + c.name} onChange={e => setEvent(c.id, "owners", e.target.checked)} /> Automático</label></td>
                      <td><button type="button" disabled={d || busy === "o" + c.id} onClick={async () => { if (!ds.length) return say(`${c.name}: ningún responsable con pendientes o con correo en Equipo.`, true); if (await ask(`Se enviará un mensaje personal a ${ds.length} persona(s) de ${c.name}. ¿Continuar?`)) void run("o" + c.id, () => ownersNow(c)); }}>Enviar ahora</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="crow">
            <button type="button" className="primary" id="avSelOwn" disabled={ro || !userUrlOn || busy === "selo"} onClick={async () => { const list = selList(c => ownerDigests(store, c, calc).length > 0); if (!list.length) return say("El cliente elegido no tiene responsables con pendientes y correo en Equipo.", true); if (await ask(`¿Enviar ahora mensajes personales de: ${list.map(c => c.name).join(", ")}?`)) void run("selo", async () => { const res: string[] = []; for (const c of list) res.push(await ownersNow(c)); return res.join("  |  "); }); }}>Enviar mensajes personales ahora: {selTxt}</button>
          </div>
          <h3>Probar el flujo</h3>
          <div className="crow">
            <label>Correo de Teams para la prueba<FormErr msg={fe.errors.test} /><input type="text" id="avTestTo" value={testTo} className={fe.errors.test ? "bad" : ""} placeholder="nombre@tu-organizacion.cl" autoComplete="off" spellCheck={false} onChange={e => { setTestTo(e.target.value); fe.clear("test"); }} /></label>
            <button type="button" id="avTest" disabled={dis} onClick={() => void sendTest()}>Enviarme un mensaje de prueba</button>
          </div>
          <p className="muted sm">Debe ser el correo con que entras a Teams (el de tu organización), no un Gmail personal: Teams solo puede escribirle a cuentas de la organización.</p>
          <details><summary>Cómo crear el flujo (una vez)</summary>
            <ol className="sm">
              <li>Entra a <b>make.powerautomate.com</b> → <b>Crear</b> → <b>Flujo de nube instantáneo</b> y omite la elección de desencadenador.</li>
              <li>Desencadenador: <b>Cuando se recibe una solicitud de webhook de Teams</b> (<i>When a Teams webhook request is received</i>). En «Quién puede desencadenar» elige <b>Cualquiera</b>.</li>
              <li>Acción: <b>Publicar tarjeta en un chat o canal</b> (<i>Post card in a chat or channel</i>), publicando como <b>Usuario del flujo</b>, en <b>Chat con el usuario del flujo</b> (o «Chat»).</li>
              <li><b>Destinatario</b>: contenido dinámico → expresión <code>triggerBody()?['to']</code>.</li>
              <li><b>Tarjeta adaptable</b>: expresión <code>triggerBody()?['attachments']?[0]?['content']</code>.</li>
              <li>Guarda, abre el desencadenador, copia la <b>URL HTTP POST</b> y pégala arriba. Prueba con el botón.</li>
            </ol>
            <p className="muted sm">Si IPS no permite este tipo de flujo, los avisos al canal siguen funcionando; los personales no se enviarán.</p>
          </details>
        </div>

        <div className="card">
          <h2>Instalar el envío automático (una sola vez)</h2>
          <p className="muted sm">Elige <b>una</b> de las dos formas (si activas ambas no se duplica nada: comparten el registro <code>avisos_log</code>):</p>
          <ol className="sm">
            <li><b>API Node (recomendado):</b> despliega <code>apps/api</code> con <code>AVISOS_SCHEDULER=1</code>. Revisa los horarios cada minuto, confirma la entrega en Teams y los errores quedan en su log.</li>
            <li><b>Supabase pg_cron:</b> en Supabase, <b>SQL Editor → New query</b>, pega <code>supabase/migrations/07-avisos-pgcron.sql</code> y pulsa <b>Run</b>. Prueba con <code>select public.qa_avisos(true);</code>.</li>
            <li>Desde ahí, los cambios de horario se hacen en esta pestaña; no hay que tocar Supabase de nuevo.</li>
          </ol>
          <p className="warn sm">⚠ El envío automático usa los datos tal como están en el dashboard. Planner se lee con la sesión de quien pulsa «Sincronizar»: si nadie sincroniza, los avisos reflejan la última sincronización (se indica en el mensaje).</p>
        </div>
      </div>
    </section>
  );
}
