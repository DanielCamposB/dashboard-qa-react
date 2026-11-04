// Lectura de Microsoft Planner con Microsoft Graph (SOLO LECTURA). Inicio de sesión con MSAL (cuenta de la persona).
import { PublicClientApplication, type AccountInfo } from "@azure/msal-browser";
import type { Comment, PlannerPlanData } from "@qa/core";
import { cfg } from "./config";

const G = "https://graph.microsoft.com/v1.0";
const SCOPES = ["Tasks.Read", "Group.Read.All", "User.ReadBasic.All"];
type GraphMock = (method: string, path: string, body: unknown) => Promise<any>;
const mock = (): GraphMock | undefined => (window as unknown as { QA_PLANNER_MOCK?: GraphMock }).QA_PLANNER_MOCK; // solo para pruebas locales

export const plannerConfigured = (): boolean => !!mock() || !!(cfg.msalClientId && cfg.msalTenantId);

let app: PublicClientApplication | null = null;
let account: AccountInfo | null = null;

async function msalApp(): Promise<PublicClientApplication> {
  if (app) return app;
  app = new PublicClientApplication({
    auth: { clientId: cfg.msalClientId, authority: "https://login.microsoftonline.com/" + cfg.msalTenantId, redirectUri: location.origin + location.pathname },
    cache: { cacheLocation: "sessionStorage" },
  });
  await app.initialize();
  account = app.getAllAccounts()[0] || null;
  return app;
}

async function token(interactive: boolean): Promise<string> {
  const a = await msalApp();
  account = account || a.getAllAccounts()[0] || null;
  if (account) {
    try { return (await a.acquireTokenSilent({ scopes: SCOPES, account })).accessToken; } catch (e) { if (!interactive) throw e; }
  }
  if (!interactive) throw new Error("NO_SESSION");
  const r = await a.loginPopup({ scopes: SCOPES, prompt: "select_account" });
  account = r.account;
  return r.accessToken || (await a.acquireTokenSilent({ scopes: SCOPES, account: r.account! })).accessToken;
}

class GraphError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function gx(path: string, tk: string, init?: RequestInit): Promise<any> {
  const m = mock();
  if (m) return m(init?.method || "GET", path, init?.body ? JSON.parse(init.body as string) : null);
  const res = await fetch(path.startsWith("http") ? path : G + path, { ...init, headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json", ...(init?.headers || {}) } });
  if (!res.ok) throw new GraphError(`Graph ${res.status}: ${(await res.text()).slice(0, 160)}`, res.status);
  return res.status === 204 ? null : res.json();
}
async function page(path: string, tk: string): Promise<any[]> {
  let out: any[] = [], url: string | undefined = path;
  while (url) { const r: any = await gx(url, tk); out = out.concat(r.value || []); url = r["@odata.nextLink"]; }
  return out;
}
async function batch(urls: string[], tk: string): Promise<any[]> { // hasta 20 peticiones GET por llamada
  const out: any[] = new Array(urls.length);
  for (let i = 0; i < urls.length; i += 20) {
    const chunk = urls.slice(i, i + 20);
    const r = await gx("/$batch", tk, { method: "POST", body: JSON.stringify({ requests: chunk.map((u, k) => ({ id: String(k), method: "GET", url: u })) }) });
    (r.responses || []).forEach((x: any) => (out[i + +x.id] = x));
  }
  return out;
}

const pDate = (s?: string): string => {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  if (d.getUTCHours() >= 12) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const prioTxt = (p: number) => (p <= 1 ? "Urgente" : p <= 4 ? "Importante" : p <= 7 ? "Media" : "Baja");
const html2txt = (h?: string): string => {
  try { return (new DOMParser().parseFromString(h || "", "text/html").body.textContent || "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
  catch { return String(h || ""); }
};

export const planner = {
  async signIn(): Promise<string> {
    if (mock()) return "Cuenta de prueba";
    await token(true);
    return account?.name || account?.username || "";
  },
  async session(): Promise<string> {
    if (mock()) return "Cuenta de prueba";
    if (!plannerConfigured()) return "";
    const a = await msalApp();
    account = account || a.getAllAccounts()[0] || null;
    return account ? account.name || account.username : "";
  },
  async signOut() {
    if (!app || !account) return;
    const a = account;
    account = null;
    try { await app.logoutPopup({ account: a, postLogoutRedirectUri: location.href }); } catch { /* ventana cerrada */ }
  },
  async listPlans(): Promise<{ id: string; title: string }[]> {
    const tk = mock() ? "" : await token(false);
    return (await page("/me/planner/plans", tk)).map(p => ({ id: p.id, title: p.title })).sort((a, b) => a.title.localeCompare(b.title));
  },
  async ensureSession() { if (!mock()) await token(true); },

  async loadPlan(planId: string): Promise<PlannerPlanData> {
    const tk = mock() ? "" : await token(false), warnings: string[] = [];
    const [plan, details, buckets, tasks] = await Promise.all([gx(`/planner/plans/${planId}`, tk), gx(`/planner/plans/${planId}/details`, tk), page(`/planner/plans/${planId}/buckets`, tk), page(`/planner/plans/${planId}/tasks`, tk)]);
    const groupId: string = plan.owner || plan.container?.containerId || "", cats: Record<string, string> = details.categoryDescriptions || {};
    const bname: Record<string, string> = Object.fromEntries(buckets.map((b: any) => [b.id, b.name]));
    const users: Record<string, { id: string; name: string; email: string }> = {};
    const uids = [...new Set<string>(tasks.flatMap((t: any) => Object.keys(t.assignments || {})))];
    if (uids.length) {
      try {
        (await batch(uids.map(u => `/users/${u}?$select=displayName,mail,userPrincipalName`), tk)).forEach((x, i) => {
          if (x?.status === 200) users[uids[i]] = { id: uids[i], name: x.body.displayName || "", email: (x.body.mail || x.body.userPrincipalName || "").toLowerCase() };
        });
      } catch { warnings.push("No pude leer los nombres de los responsables (permiso User.ReadBasic.All)."); }
    }
    const checks: Record<string, string[]> = {};
    if (tasks.length) {
      try {
        (await batch(tasks.map((t: any) => `/planner/tasks/${t.id}/details`), tk)).forEach((x, i) => {
          if (x?.status === 200) checks[tasks[i].id] = Object.values<any>(x.body.checklist || {}).map(c => (c.title || "").trim()).filter(Boolean);
        });
      } catch { warnings.push("No pude leer la lista de verificación de las tareas (de ahí sale el tipo QA Tradicional/Express)."); }
    }
    const comments: Record<string, Comment[]> = {};
    const withThread = tasks.filter((t: any) => t.conversationThreadId && groupId);
    if (withThread.length) {
      try {
        (await batch(withThread.map((t: any) => `/groups/${groupId}/threads/${t.conversationThreadId}/posts`), tk)).forEach((x, i) => {
          if (x?.status !== 200) return;
          comments[withThread[i].id] = (x.body.value || [])
            .map((p: any): Comment => ({ id: "pl-" + p.id, at: p.createdDateTime, by: p.from?.emailAddress?.name || p.sender?.emailAddress?.name || "Planner", text: html2txt(p.body?.content), src: "planner" }))
            .filter((c: Comment) => c.text);
        });
      } catch { warnings.push("No pude leer los comentarios (falta el permiso Group.Read.All o el consentimiento de administrador)."); }
      if (!Object.keys(comments).length && !warnings.length) warnings.push("Las tareas no devolvieron comentarios.");
    }
    return {
      planId, planName: plan.title || "", groupId, warnings,
      tasks: tasks.map((t: any) => ({
        id: t.id, title: (t.title || "").trim(), percent: t.percentComplete || 0, priority: prioTxt(t.priority ?? 5), start: pDate(t.startDateTime), due: pDate(t.dueDateTime), created: pDate(t.createdDateTime),
        bucket: bname[t.bucketId] || "", labels: Object.keys(t.appliedCategories || {}).filter(k => t.appliedCategories[k] && cats[k]).map(k => cats[k]),
        checks: checks[t.id] || [], assignees: Object.keys(t.assignments || {}).map(u => users[u]).filter(Boolean),
        comments: (comments[t.id] || []).sort((a, b) => a.at.localeCompare(b.at)),
      })),
    };
  },
};
