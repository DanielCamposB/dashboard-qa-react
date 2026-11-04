// Almacenamiento: Supabase (compartido, con login) o localStorage (si no hay VITE_SUPABASE_*).
// Traducción de data.js: el estado completo sigue siendo un solo documento JSON (`app_state`) con control de versión optimista.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { emptyStore, iso, normalizeStore, seedStore, todayLocal, type Comment, type Op, type Profile, type Store } from "@qa/core";
import { cfg, REMOTE } from "./config";

const KEY = "qa-dashboard-v2";
export const PROFILE_FIELDS = ["nombres", "apellido_paterno", "apellido_materno", "cargo", "vertical", "cumpleanos", "telefono"] as const;
type ProfileField = (typeof PROFILE_FIELDS)[number];

export type Boot =
  | { kind: "ready"; store: Store; forceRead: boolean | null; user: string; role?: Profile["role"] }
  | { kind: "login"; recovery?: boolean; initError?: unknown }
  | { kind: "denied" | "pending" | "locked"; user: string };

export interface BackupRow { id: number; taken_at: string; kind: string; version: number; nreqs: number; nclients: number; kb: number }

class DataService {
  readonly remote = REMOTE;
  onError: (m: string) => void = () => {};
  onRemoteChange: (s: Store) => void = () => {};

  private sb!: SupabaseClient;
  private version = 0;
  private canEdit = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Store | null = null;
  private ops: Op[] = []; // cambios pequeños (check-ins, comentarios) que se pueden re-aplicar sobre la última versión
  private userEmail = "";
  private profile: Partial<Profile> = {};
  private poll: ReturnType<typeof setInterval> | null = null;

  // ---------- local ----------
  private localLoad(): Store {
    try {
      const r = localStorage.getItem(KEY);
      if (r) return normalizeStore(JSON.parse(r));
    } catch { /* datos dañados: se parte de cero */ }
    const s = seedStore(todayLocal());
    this.localSave(s);
    return s;
  }
  private localSave(s: Store) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* sin espacio */ }
  }

  // ---------- Supabase ----------
  private async fetchState(): Promise<Store | null> {
    const { data, error } = await this.sb.from("app_state").select("data,version").eq("id", 1).single();
    if (error) throw error;
    this.version = data.version;
    return data.data && data.data.reqs ? normalizeStore(data.data) : null;
  }

  queueOp = (op: Op) => { if (this.remote && this.canEdit) this.ops.push(op); };

  private async pushNow(retry = 0): Promise<void> {
    const s = this.pending;
    this.pending = null;
    if (!s) return;
    const mine = this.ops;
    this.ops = [];
    let res;
    try { res = await this.sb.from("app_state").update({ data: s, version: this.version + 1 }).eq("id", 1).eq("version", this.version).select("version"); }
    catch (e) { this.ops = mine.concat(this.ops); return this.onError("No se pudo guardar (sin conexión): " + ((e as Error).message || e)); }
    const { data, error } = res;
    if (error) { this.ops = mine.concat(this.ops); return this.onError("No se pudo guardar: " + error.message); }
    if (!data.length) {
      const fresh = await this.fetchState();
      if (fresh && mine.length && retry < 3) { // re-aplica mis cambios sobre la versión más nueva y reintenta
        mine.forEach(op => op(fresh));
        this.ops = mine.concat(this.ops);
        this.pending = fresh;
        this.onRemoteChange(fresh);
        return this.pushNow(retry + 1);
      }
      this.onError("Otra persona guardó cambios antes que tú. Se cargó la versión más reciente; repite tu cambio.");
      if (fresh) this.onRemoteChange(fresh);
      return;
    }
    this.version = data[0].version;
  }

  async init(): Promise<Boot> {
    if (!this.remote) {
      try { this.profile = JSON.parse(localStorage.getItem("qa-profile") || "{}"); } catch { this.profile = {}; }
      return { kind: "ready", store: this.localLoad(), forceRead: null, user: "" };
    }
    this.sb = createClient(cfg.supabaseUrl, cfg.supabaseKey);
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return { kind: "login" };
    if (/type=recovery/.test(location.hash)) return { kind: "login", recovery: true };
    this.userEmail = (session.user.email || "").toLowerCase();
    let { data: prof, error } = await this.sb.from("profiles").select("*").eq("email", this.userEmail).maybeSingle();
    if (error) throw error;
    if (!prof) { // primera vez: queda como solicitud pendiente hasta que un administrador la autorice
      const { error: e2 } = await this.sb.rpc("request_access");
      if (e2) return { kind: "denied", user: this.userEmail };
      ({ data: prof } = await this.sb.from("profiles").select("*").eq("email", this.userEmail).maybeSingle());
      if (!prof) return { kind: "denied", user: this.userEmail };
    }
    if (prof.role === "pending") return { kind: "pending", user: this.userEmail };
    if (prof.locked && (prof.role !== "admin" || Date.now() - new Date(prof.locked_at || 0).getTime() < 15 * 60e3)) return { kind: "locked", user: this.userEmail };
    this.sb.rpc("login_ok").then(() => {}, () => {}); // ingreso correcto: reinicia el contador de intentos
    this.canEdit = prof.role === "editor" || prof.role === "admin";
    this.profile = prof;
    let store = await this.fetchState();
    if (!store) {
      store = emptyStore(); // el sistema compartido arranca vacío (sin datos de ejemplo)
      if (this.canEdit) { this.pending = store; await this.pushNow(); }
    }
    this.poll = setInterval(async () => { // refresco cada 30 s si no hay cambios por guardar
      if (this.pending) return;
      try {
        const { data } = await this.sb.from("app_state").select("version").eq("id", 1).single();
        if (data && data.version !== this.version) { const f = await this.fetchState(); if (f) this.onRemoteChange(f); }
      } catch { /* sin conexión: se reintenta */ }
    }, 30000);
    return { kind: "ready", store, forceRead: !this.canEdit, user: this.userEmail, role: prof.role };
  }

  save = (s: Store) => {
    if (!this.remote) return this.localSave(s);
    if (!this.canEdit) return this.onError("Tu cuenta no tiene permiso de edición: los cambios no se guardaron.");
    this.pending = s;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.pushNow(), 400);
  };

  getProfile = (): Partial<Profile> => this.profile;
  isAdmin = () => this.remote && this.profile.role === "admin";
  myEmail = () => this.userEmail;

  /** Token de la sesión actual (para llamar a la API Node). */
  async accessToken(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    return (data.session as Session | null)?.access_token || "";
  }

  setRole = async (email: string, role: string) => {
    const { data, error } = await this.sb.from("profiles").update({ role }).eq("email", email).select("email");
    if (error) throw error;
    if (!data.length) throw new Error("No se pudo cambiar (sin permiso)");
  };
  addUser = async (email: string, role: string) => { const { error } = await this.sb.from("profiles").insert({ email, role }); if (error) throw error; };
  removeUser = async (email: string) => {
    const { data, error } = await this.sb.from("profiles").delete().eq("email", email).select("email");
    if (error) throw error;
    if (!data.length) throw new Error("No se pudo quitar (sin permiso)");
  };
  saveProfile = async (p: Partial<Record<ProfileField, string>>) => {
    const clean: Partial<Record<ProfileField, string | null>> = {};
    PROFILE_FIELDS.forEach(k => (clean[k] = (p[k] ?? "").toString().trim() || null));
    if (!this.remote) {
      this.profile = { ...this.profile, ...clean };
      try { localStorage.setItem("qa-profile", JSON.stringify(this.profile)); } catch { /* sin espacio */ }
      return;
    }
    const { error } = await this.sb.from("profiles").update(clean).eq("email", this.userEmail);
    if (error) throw error;
    this.profile = { ...this.profile, ...clean };
  };
  listProfiles = async (): Promise<Profile[]> => {
    const { data, error } = await this.sb.from("profiles").select("*").order("email");
    if (error) throw error;
    return data as Profile[];
  };

  login = async (email: string, password: string) => { const { error } = await this.sb.auth.signInWithPassword({ email, password }); if (error) throw error; };
  signUp = async (email: string, password: string): Promise<boolean> => {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return !!data.session; // true si no requiere confirmar correo
  };
  private rpc = async <T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await this.sb.rpc(fn, args);
    if (error) throw error;
    return data as T;
  };
  precheck = async (email: string): Promise<string> => { try { return await this.rpc<string>("login_precheck", { p_email: email }); } catch { return "ok"; } }; // sin el SQL de acceso, no bloquea
  loginFailed = async (email: string): Promise<{ locked?: boolean; known?: boolean; remaining?: number } | null> => { try { return await this.rpc("login_failed", { p_email: email }); } catch { return null; } };
  unlock = async (email: string) => { await this.rpc("admin_unlock", { p_email: email }); };

  // Webhooks de Teams: las URLs viven en la tabla notify_secrets (solo administradores). Los avisos los publica el servidor.
  setSecret = async (key: string, value: string) => {
    const { error } = value
      ? await this.sb.from("notify_secrets").upsert({ key, value, updated_at: new Date().toISOString() })
      : await this.sb.from("notify_secrets").delete().eq("key", key);
    if (error) throw error;
  };
  qaPost = (a: { target: string; title: string; facts: { title: string; value: string }[]; lines: string; to?: string | null; name?: string | null }) =>
    this.rpc("qa_post", { p_target: a.target, p_title: a.title, p_facts: a.facts, p_lines: a.lines, p_to: a.to || null, p_name: a.name || null });
  listBackups = () => this.rpc<BackupRow[]>("qa_backups_list");
  makeBackup = () => this.rpc<number | null>("qa_backup_now");
  restoreBackup = (id: number) => this.rpc("qa_restore_backup", { p_id: id });

  signOutQuiet = async () => { try { await this.sb.auth.signOut(); } catch { /* ya estaba cerrada */ } };
  sendResetCode = async (email: string) => { const { error } = await this.sb.auth.resetPasswordForEmail(email); if (error) throw error; }; // el correo lleva un código (plantilla «Reset Password» con {{ .Token }})
  verifyResetCode = async (email: string, token: string) => { const { error } = await this.sb.auth.verifyOtp({ email, token, type: "recovery" }); if (error) throw error; };
  updatePassword = async (password: string) => { const { error } = await this.sb.auth.updateUser({ password }); if (error) throw error; };
  changePassword = async (current: string, password: string) => { // confirma la contraseña actual antes de cambiarla
    const { error: e1 } = await this.sb.auth.signInWithPassword({ email: this.userEmail, password: current });
    if (e1) throw new Error("current");
    await this.updatePassword(password);
  };
  qaComment = (rid: string, c: Comment) => this.rpc("qa_comment", { p_req: rid, p_id: c.id, p_by: c.by, p_text: c.text });
  qaCommentEdit = (rid: string, id: string, by: string, text: string) => this.rpc("qa_comment_edit", { p_req: rid, p_id: id, p_by: by, p_text: text });
  logout = async () => { if (this.poll) clearInterval(this.poll); await this.sb.auth.signOut(); location.reload(); };

  exportJson(store: Store) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(store, null, 2)], { type: "application/json" }));
    a.download = `qa-dashboard-${iso(new Date())}.json`;
    a.click();
  }
}

export const D = new DataService();
