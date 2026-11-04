import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";
import { Login } from "./components/Login";
import { Header, ActionBar } from "./components/Shell";
import { ModalHost, ToastHost } from "./components/Host";
import { TipHost } from "./components/Hint";
import { installPickGlobals } from "./components/MultiPick";
import { D, type Boot } from "./lib/data";
import { ImportDialog } from "./dialogs/ImportDialog";
import { ProfileDialog } from "./dialogs/ProfileDialog";
import { ReqDialog } from "./dialogs/ReqDialog";
import { useApp, useIsAdmin, VIEWS, type View } from "./state/app";
import { useDialogs } from "./state/dialogs";
import { errText } from "./lib/errors";
import { say } from "./state/ui";
import { Avisos } from "./views/Avisos";
import { Clients } from "./views/Clients";
import { Dashboard } from "./views/Dashboard";
import { Gantt } from "./views/Gantt";
import { Hoy } from "./views/Hoy";
import { countFlags, Perm } from "./views/Perm";
import { Leaders, Team } from "./views/People";
import { Resumen } from "./views/Resumen";
import { Templates } from "./views/Templates";

function ViewSwitch() {
  const { view } = useParams();
  const isAdm = useIsAdmin();
  const v = (VIEWS as readonly string[]).includes(view || "") ? (view as View) : null;
  // Clientes, Avisos y Plantillas son del administrador; Permisos solo del rol admin
  if (!v || (["clients", "avisos", "tpl"].includes(v) && !isAdm) || (v === "perm" && !D.isAdmin())) return <Navigate to="/dash" replace />;
  return (
    <>
      <Header view={v} />
      <ActionBar />
      {v === "dash" && <Dashboard />}
      {v === "hoy" && <Hoy />}
      {v === "resumen" && <Resumen />}
      {v === "gantt" && <Gantt />}
      {v === "team" && <Team />}
      {v === "leaders" && <Leaders />}
      {v === "clients" && <Clients />}
      {v === "avisos" && <Avisos />}
      {v === "perm" && <Perm />}
      {v === "tpl" && <Templates />}
    </>
  );
}

function Main({ user }: { user: string }) {
  const setPermCount = useDialogs(s => s.setPermCount), openProfile = useDialogs(s => s.openProfile);
  useEffect(() => {
    document.body.classList.remove("booting");
    const off = installPickGlobals();
    const onErr = (ev: ErrorEvent) => { console.error(ev.error || ev.message); say("Error: " + (ev.message || errText(ev.error)), true); };
    const onRej = (ev: PromiseRejectionEvent) => { console.error(ev.reason); say("Error: " + errText(ev.reason), true); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onRej);
    if (D.isAdmin()) D.listProfiles().then(rows => { const k = countFlags(rows); setPermCount(k); if (k) say(`Tienes ${k} solicitud(es) de acceso o cuenta(s) bloqueada(s) en Permisos.`); }).catch(() => {});
    const t = D.remote && !D.getProfile().nombres ? setTimeout(() => openProfile(true), 400) : undefined;
    return () => { off(); window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onRej); if (t) clearTimeout(t); };
  }, [setPermCount, openProfile, user]);
  return (
    <>
      <Routes>
        <Route path="/:view" element={<ViewSwitch />} />
        <Route path="*" element={<Navigate to="/dash" replace />} />
      </Routes>
      <ReqDialog /><ProfileDialog /><ImportDialog />
    </>
  );
}

export function App() {
  const [boot, setBoot] = useState<Boot | null>(null);
  useEffect(() => {
    D.onError = m => say(m, true);
    D.onRemoteChange = s => useApp.getState().setStore(s);
    D.init()
      .then(b => { if (b.kind === "ready") useApp.getState().init(b.store, b.user, b.forceRead); setBoot(b); })
      .catch(e => setBoot({ kind: "login", initError: e }));
  }, []);
  return (
    <>
      {boot && (boot.kind === "ready"
        ? <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}><Main user={boot.user} /></BrowserRouter>
        : <Login boot={boot} />)}
      <ToastHost /><ModalHost /><TipHost />
    </>
  );
}
