// Pestañas «Equipo» (responsables QA) y «Responsables de requerimiento»: misma mecánica, distintos textos y listas de roles.
import { useEffect, useState } from "react";
import { cleanStage, EMAIL_RE, norm, setIds, uid, type Member } from "@qa/core";
import { Tip } from "../components/Hint";
import { FormErr, filtered, useFieldErrors } from "../components/forms";
import { MultiPick } from "../components/MultiPick";
import { D } from "../lib/data";
import { useApp, useCalc, useIsAdmin } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { ask, say } from "../state/ui";

type Kind = "member" | "leader";
const EMAIL_MSG = "El correo no tiene un formato válido (ejemplo: nombre@ips.gob.cl).";

const TXT = {
  member: {
    title: "Responsables QA", dup: "Ya existe un integrante con ese nombre.", rolesTitle: "Roles",
    intro: "Aquí se registran todos los integrantes del equipo QA, DevOps, líderes técnicos y otros roles que participan en los requerimientos, con su correo de Teams y sus roles.",
    rolesIntro: "Crea los roles que necesites (QA Funcional, QA Automatizador, Líder, etc.).", rolesHead: ["Rol", "Integrantes"], roleCol: "Rol",
    mailHead: "Correo de Teams (para avisos)", mailPh: "Correo de Teams (para avisos)", empty: "",
  },
  leader: {
    title: "Responsables de requerimiento", dup: "Ya existe un responsable con ese nombre.", rolesTitle: "Roles de los responsables de requerimiento",
    intro: "Las personas que lideran o coordinan los requerimientos: líderes técnicos, jefaturas, coordinadores, DevOps, etc. Cada una puede tener uno o más roles. Se asignan a cada requerimiento desde su ventana, en el campo «Responsables de requerimiento».",
    rolesIntro: "Crea los roles que necesites (Líder técnico, Jefatura, Coordinador, DevOps, etc.). Después se los asignas a cada persona en la tabla de arriba.", rolesHead: ["Rol", "Responsables"], roleCol: "Roles",
    mailHead: "Correo", mailPh: "Correo", empty: "Aún no hay responsables de requerimiento. Agrégalos con el formulario de arriba.",
  },
} as const;

function EmailCell({ m, disabled, onSave }: { m: Member; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(m.email || ""), fe = useFieldErrors();
  useEffect(() => setV(m.email || ""), [m.email]);
  if (disabled) return <>{m.email || <span className="muted">Sin correo</span>}</>;
  const commit = () => {
    const t = v.trim();
    if (t === (m.email || "")) return;
    if (t && !EMAIL_RE.test(t)) return fe.set("e", EMAIL_MSG);
    fe.clear(); onSave(t);
  };
  return <><FormErr msg={fe.errors.e} /><input type="email" value={v} className={fe.errors.e ? "bad" : ""} placeholder="nombre@ips.gob.cl" aria-label={"Correo de " + m.name} onChange={e => { setV(e.target.value); fe.clear("e"); }} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} /></>;
}

function PeopleCard({ kind }: { kind: Kind }) {
  const { store, mutate, readOnly } = useApp();
  const calc = useCalc(), canMod = useIsAdmin(), t = TXT[kind];
  const list = kind === "member" ? store.members : store.leaders;
  const roles = kind === "member" ? store.roles : store.leaderRoles;
  const [editing, setEditing] = useState<string | null>(null), [editName, setEditName] = useState("");
  const [form, setForm] = useState({ name: "", email: "", roles: [] as string[] });
  const fe = useFieldErrors(), fn = useFieldErrors();
  const key = kind === "member" ? "members" : "leaders";
  const active = (m: Member) => store.reqs.filter(r => (kind === "member" ? calc.ids(r) : calc.leaderIds(r)).includes(m.id) && r.status !== "Completado").length;

  const add = (e: React.FormEvent) => {
    e.preventDefault(); if (readOnly) return; fe.clear();
    const name = form.name.trim(), email = form.email.trim();
    if (!name) return fe.set("name", "Escribe el nombre de la persona.");
    if (email && !EMAIL_RE.test(email)) return fe.set("email", EMAIL_MSG);
    if (list.some(m => norm(m.name) === norm(name))) return fe.set("name", t.dup);
    if (email && list.some(m => (m.email || "").toLowerCase() === email.toLowerCase())) return fe.set("email", kind === "member" ? "Ese correo ya pertenece a otro integrante." : "Ese correo ya está registrado en otro responsable.");
    mutate(s => { s[key].push({ id: uid(), name, email, roles: form.roles }); });
    setForm({ name: "", email: "", roles: [] });
    if (kind === "leader") say("Responsable agregado ✓");
  };
  const saveName = (id: string) => {
    const v = editName.trim();
    if (!v) return fn.set("n", "El nombre no puede quedar vacío.");
    if (list.some(x => x.id !== id && norm(x.name) === norm(v))) return fn.set("n", t.dup);
    mutate(s => { const m = s[key].find(x => x.id === id); if (m) m.name = v; });
    setEditing(null); say("Nombre actualizado ✓");
  };
  const remove = async (m: Member) => {
    const n = active(m);
    const msg = kind === "member" ? `¿Quitar a ${m.name}? Sus requerimientos quedarán sin responsable.` : `¿Quitar a ${m.name}?${n ? ` Está asignado a ${n} requerimiento(s) activo(s); quedarán sin ese responsable.` : ""}`;
    if (!await ask(msg)) return;
    mutate(s => {
      s[key] = s[key].filter(x => x.id !== m.id);
      if (kind === "member") { const drop = (x: { assigneeId?: string; assigneeIds?: string[] }) => { const cur = (x.assigneeIds?.length ? x.assigneeIds : x.assigneeId ? [x.assigneeId] : []); if (cur.includes(m.id)) setIds(x, cur.filter(i => i !== m.id)); }; s.reqs.forEach(r => { drop(r); r.acts.forEach(drop); }); }
      else s.reqs.forEach(r => { r.leaderIds = (r.leaderIds || []).filter(i => i !== m.id); });
    });
  };
  const roleLabel = kind === "member" ? "Rol" : "Roles";
  return (
    <div className="card">
      <h2><Tip group="head">{t.title}</Tip></h2>
      <p className="muted">{t.intro}</p>
      <FormErr msg={fe.errors.name || fe.errors.email} />
      <form id={kind === "member" ? "memberForm" : "leaderForm"} className="inline" noValidate onSubmit={add}>
        <input name="name" placeholder="Nombre" required maxLength={60} autoComplete="off" title="Solo letras y espacios" className={fe.errors.name ? "bad" : ""} value={form.name} onChange={filtered(cleanStage, v => { setForm(f => ({ ...f, name: v })); fe.clear("name"); })} />
        <input name="email" type="email" placeholder={kind === "member" ? "Correo de Teams (para avisos)" : "Correo"} className={fe.errors.email ? "bad" : ""} value={form.email} onChange={e => { setForm(f => ({ ...f, email: e.target.value })); fe.clear("email"); }} />
        <div><MultiPick options={roles.map(r => ({ value: r, label: r }))} selected={form.roles} onChange={v => setForm(f => ({ ...f, roles: v }))} disabled={readOnly} empty="Crea un rol primero" placeholder="Roles…" /></div>
        {!readOnly && <button className="primary">Agregar</button>}
      </form>
      <div className="tablewrap" style={kind === "leader" ? { margin: 0 } : undefined}>
        <table id={kind === "member" ? "memberTbl" : "leaderTbl"}>
          <thead><tr>
            <th><Tip group="team">Nombre</Tip></th><th><Tip group="team">{t.mailHead}</Tip></th><th><Tip group="team">{roleLabel}</Tip></th><th><Tip group="team">Requerimientos activos</Tip></th><th />
          </tr></thead>
          <tbody>
            {list.map(m => (
              <tr key={m.id}>
                <td className={fn.errors.n && editing === m.id ? "ferrhost" : ""}>
                  {editing === m.id
                    ? <><FormErr msg={fn.errors.n} /><input value={editName} maxLength={80} aria-label="Nombre" autoFocus onChange={filtered(cleanStage, v => { setEditName(v); fn.clear("n"); })} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); saveName(m.id); } else if (e.key === "Escape") setEditing(null); }} /></>
                    : kind === "leader" ? <b>{m.name}</b> : m.name}
                </td>
                <td><EmailCell m={m} disabled={!canMod} onSave={v => { mutate(s => { const x = s[key].find(y => y.id === m.id); if (x) x.email = v; }); say(v ? "Correo guardado ✓" : kind === "member" ? "Correo quitado: esta persona no recibirá avisos personales." : "Correo quitado."); }} /></td>
                <td><MultiPick options={roles.map(r => ({ value: r, label: r }))} selected={m.roles} disabled={!canMod} empty="Crea un rol primero" placeholder="Sin rol" onChange={v => mutate(s => { const x = s[key].find(y => y.id === m.id); if (x) x.roles = v; })} /></td>
                <td>{active(m)}</td>
                <td>{canMod && (editing === m.id
                  ? <><button className="primary" onClick={() => saveName(m.id)}>Guardar</button> <button className="ghost" onClick={() => { setEditing(null); fn.clear(); }}>Cancelar</button></>
                  : <><button className="ghost" onClick={() => { setEditing(m.id); setEditName(m.name); }}>Editar</button> <button className="danger" onClick={() => void remove(m)}>Quitar</button></>)}</td>
              </tr>
            ))}
            {!list.length && t.empty && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>{t.empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RolesCard({ kind }: { kind: Kind }) {
  const { store, mutate, readOnly } = useApp();
  const canMod = useIsAdmin(), t = TXT[kind];
  const roles = kind === "member" ? store.roles : store.leaderRoles, people = kind === "member" ? store.members : store.leaders;
  const [v, setV] = useState(""), fe = useFieldErrors();
  const add = (e: React.FormEvent) => {
    e.preventDefault(); if (readOnly) return;
    const name = v.trim();
    if (!name) return fe.set("r", "Escribe el nombre del rol.");
    if (roles.some(x => norm(x) === norm(name))) return fe.set("r", "Ese rol ya existe.");
    mutate(s => { (kind === "member" ? s.roles : s.leaderRoles).push(name); });
    setV(""); if (kind === "leader") say("Rol creado ✓");
  };
  const del = async (i: number) => {
    const r = roles[i];
    if (!await ask(kind === "member" ? `¿Eliminar el rol "${r}"? Sus integrantes quedarán sin rol.` : `¿Eliminar el rol "${r}"? Quienes lo tengan quedarán sin ese rol.`)) return;
    mutate(s => {
      (kind === "member" ? s.roles : s.leaderRoles).splice(i, 1);
      (kind === "member" ? s.members : s.leaders).forEach(m => { m.roles = m.roles.filter(x => x !== r); });
    });
  };
  return (
    <div className="card">
      <h2><Tip group="head">{t.rolesTitle}</Tip></h2>
      <p className="muted">{t.rolesIntro}</p>
      <FormErr msg={fe.errors.r} />
      <form id={kind === "member" ? "roleForm" : "leaderRoleForm"} className="inline" onSubmit={add} noValidate>
        <input name="role" placeholder="Nuevo rol" required maxLength={40} autoComplete="off" title="Solo letras y espacios" className={fe.errors.r ? "bad" : ""} value={v} onChange={filtered(cleanStage, x => { setV(x); fe.clear("r"); })} />
        {!readOnly && <button className="primary">Crear rol</button>}
      </form>
      <div className={kind === "leader" ? "tablewrap" : undefined} style={kind === "leader" ? { margin: 0 } : undefined}>
        <table id={kind === "member" ? "roleTbl" : "leaderRoleTbl"}>
          <thead><tr><th><Tip group="team">{t.rolesHead[0]}</Tip></th><th><Tip group="team">{t.rolesHead[1]}</Tip></th><th /></tr></thead>
          <tbody>
            {roles.map((r, i) => {
              const who = people.filter(m => m.roles.includes(r));
              return (
                <tr key={r}>
                  <td>{kind === "leader" ? <b>{r}</b> : r}</td>
                  <td>{who.length ? (kind === "member" ? who.map(m => m.name).join(", ") : who.map(m => <span className="chip" key={m.id}>{m.name} </span>)) : <span className="muted">—</span>}</td>
                  <td>{canMod && <button className="danger" onClick={() => void del(i)}>Eliminar</button>}</td>
                </tr>
              );
            })}
            {!roles.length && kind === "leader" && <tr><td colSpan={3} className="muted" style={{ padding: 16 }}>Aún no hay roles. Crea el primero arriba.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ROLE_TXT: Record<string, string> = { admin: "Administrador", editor: "Editor", viewer: "Solo lectura", pending: "Pendiente de autorización" };
let profCache: { at: number; rows: Awaited<ReturnType<typeof D.listProfiles>> } = { at: 0, rows: [] };
export const resetProfileCache = () => { profCache = { at: 0, rows: [] }; };

/** Directorio de perfiles (solo editores con Supabase). */
function ProfilesCard() {
  const [rows, setRows] = useState(profCache.rows), [msg, setMsg] = useState("");
  useDialogs(s => s.profileRev); // se redibuja al guardar un perfil
  useEffect(() => {
    setRows(profCache.rows);
    if (Date.now() - profCache.at < 20000) return;
    profCache.at = Date.now();
    D.listProfiles().then(r => { profCache.rows = r; setRows(r); setMsg(""); })
      .catch((er: Error) => setMsg(/does not exist|schema/i.test(er.message) ? "Falta ejecutar 02-perfil.sql en Supabase." : "No se pudieron cargar los perfiles: " + er.message));
  }, []);
  const bd = (c?: string | null) => (c ? new Date(c + "T00:00:00Z").toLocaleDateString("es", { day: "numeric", month: "long", timeZone: "UTC" }) : "—");
  return (
    <div className="card" id="profCard">
      <h2><Tip group="head">Perfiles de usuarios</Tip></h2>
      <p className="muted">Información que cada usuario completó en «Mi perfil». Solo la ven los editores.</p>
      <div className="tablewrap">
        <table id="profTbl">
          {msg ? <tbody><tr><td className="muted">{msg}</td></tr></tbody> : <>
            <thead><tr>{["Nombre", "Cargo", "Vertical", "Cumpleaños", "Teléfono", "Correo", "Acceso"].map(h => <th key={h}><Tip group="acc">{h}</Tip></th>)}</tr></thead>
            <tbody>{rows.map(r => {
              const nm = [r.nombres, r.apellido_paterno, r.apellido_materno].filter(Boolean).join(" ");
              return <tr key={r.email}><td>{nm || <span className="muted">Sin completar</span>}</td><td>{r.cargo || "—"}</td><td>{r.vertical || "—"}</td><td>{bd(r.cumpleanos)}</td><td>{r.telefono || "—"}</td><td>{r.email}</td><td>{ROLE_TXT[r.role] || r.role}</td></tr>;
            })}</tbody></>}
        </table>
      </div>
    </div>
  );
}

export function Team() {
  const readOnly = useApp(s => s.readOnly);
  return (
    <section id="v-team" className="view">
      <PeopleCard kind="member" />
      {D.remote && !readOnly && <ProfilesCard />}
      <RolesCard kind="member" />
    </section>
  );
}

export function Leaders() {
  return (
    <section id="v-leaders" className="view">
      <PeopleCard kind="leader" />
      <RolesCard kind="leader" />
    </section>
  );
}

export { ROLE_TXT };
