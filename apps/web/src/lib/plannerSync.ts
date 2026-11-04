// Sincronización con Planner (lectura) y avisos a Teams asociados. Une graph.ts + @qa/core + el estado de la app.
import { applyPlanner, todayLocal } from "@qa/core";
import { graphErr } from "./errors";
import { plannerConfigured, planner } from "./graph";
import { sendTeams } from "./teamsClient";
import { authorName, useApp } from "../state/app";
import { useDialogs } from "../state/dialogs";
import { say } from "../state/ui";

export const teamsOn = (c: { teams?: { hasUrl?: boolean; webhook?: string } }, remote: boolean) => !!(remote ? c.teams?.hasUrl : c.teams?.webhook);

export async function syncClient(cid: string, remote: boolean) {
  const { store, commit } = useApp.getState();
  const c = store.clients.find(x => x.id === cid);
  if (!c) return;
  const pl = c.planner || { enabled: false, planId: "", planName: "", lastSync: "" };
  if (!pl.enabled) return say(`«${c.name}» no tiene Planner activado.`, true);
  if (!pl.planId) return say(`Elige el plan de Planner de «${c.name}» antes de sincronizar.`, true);
  if (!plannerConfigured()) return say("Falta configurar la aplicación de Microsoft (VITE_MSAL_CLIENT_ID y VITE_MSAL_TENANT_ID).", true);
  try {
    say(`Leyendo Planner de ${c.name}…`);
    await planner.ensureSession();
    useDialogs.getState().setMsAccount(await planner.session());
    const data = await planner.loadPlan(pl.planId);
    const today = todayLocal();
    let sum: ReturnType<typeof applyPlanner> | undefined;
    commit(s => { sum = applyPlanner(s, cid, data, today); });
    const r = sum!;
    say(`Planner · ${c.name}: ${r.created} nuevo(s), ${r.updated} actualizado(s), ${r.comments} comentario(s) nuevo(s)` + (r.skipped ? ` · ${r.skipped} ya completado(s) omitido(s)` : "") + (data.warnings.length ? ` · ⚠ ${data.warnings.join(" ")}` : ""));
    const fresh = useApp.getState().store.clients.find(x => x.id === cid)!;
    if (teamsOn(fresh, remote) && fresh.teams.events?.sync !== false && (r.created || r.updated)) {
      void sendTeams(useApp.getState().store, fresh, {
        title: `Planner sincronizado · ${c.name}`,
        facts: [["Nuevos", r.created], ["Actualizados", r.updated], ["Comentarios nuevos", r.comments]],
        lines: [...r.newReqs.slice(0, 6).map(q => `🆕 **${q.code}** ${q.title}`), ...r.changes.slice(0, 10).map(x => `🔄 ${x}`)],
      });
    }
  } catch (e) { say(graphErr(e), true); }
}

export async function syncActive(remote: boolean) {
  const { store, clientId } = useApp.getState();
  const list = store.clients.filter(c => c.planner?.enabled && c.planner.planId && (clientId === "all" || clientId === c.id));
  if (!list.length) return say("No hay clientes con Planner activado y plan elegido (pestaña Clientes).", true);
  for (const c of list) await syncClient(c.id, remote);
}

/** Aviso inmediato cuando alguien bloquea una actividad. */
export function notifyBlocked(reqId: string, actId: string, reason: string, remote: boolean) {
  const { store } = useApp.getState();
  const r = store.reqs.find(x => x.id === reqId), a = r?.acts.find(x => x.id === actId), c = store.clients.find(x => x.id === r?.clientId);
  if (!r || !a || !c || !teamsOn(c, remote) || c.teams.events?.blocked === false) return;
  void sendTeams(store, c, { title: `🚧 Bloqueo · ${c.name}`, facts: [["Requerimiento", `${r.code} ${r.title}`], ["Actividad", a.name], ["Reportado por", authorName()]], lines: [reason || "Sin motivo indicado"] });
}
