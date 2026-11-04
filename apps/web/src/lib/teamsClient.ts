// Envío de avisos a Teams desde el navegador.
//  · Con API Node (VITE_API_URL): la API usa la URL guardada y confirma la entrega.
//  · Con Supabase sin API: función `qa_post` (el servidor publica; no se puede confirmar la entrega).
//  · Modo local: se publica directo desde el navegador (la URL queda en este equipo).
import { buildCard, isTeamsUrl, type Client, type Fact, type Store } from "@qa/core";
import { cfg, REMOTE } from "./config";
import { D } from "./data";

export interface SendResult { ok: boolean; unconfirmed?: boolean; err?: string }

export interface TeamsMessage { title: string; facts: Fact[]; lines: string[]; to?: string; who?: { name: string; email: string } | null }

export async function sendTeams(store: Store, target: Client | "user", m: TeamsMessage): Promise<SendResult> {
  if (REMOTE) {
    const body = {
      target: target === "user" ? "user" : "client:" + target.id,
      title: m.title,
      facts: m.facts.map(([title, value]) => ({ title, value: String(value) })),
      lines: m.lines.join("\n\n"),
      to: m.to || null,
      name: m.who?.name || null,
    };
    try {
      if (cfg.apiUrl) {
        const r = await fetch(cfg.apiUrl + "/api/teams/post", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (await D.accessToken()) }, body: JSON.stringify(body) });
        if (r.ok) return { ok: true };
        const e = await r.json().catch(() => ({}));
        return { ok: false, err: (e as { error?: string }).error || `La API respondió ${r.status}.` };
      }
      await D.qaPost(body);
      return { ok: true, unconfirmed: true };
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      return { ok: false, err: /Solo editores/i.test(msg) ? "No tienes permiso para enviar avisos." : /URL no configurada/i.test(msg) ? "Falta la URL del webhook: pide a un administrador que la guarde." : /could not find the function|qa_post/i.test(msg) ? "Falta ejecutar 06-seguridad.sql en Supabase." : /failed to fetch|network/i.test(msg) ? "No se pudo contactar el servidor." : "No se pudo enviar: " + msg };
    }
  }
  const url = String((target === "user" ? store.notify?.userWebhook : target.teams?.webhook) || "").trim();
  if (!isTeamsUrl(url)) return { ok: false, err: "La URL no parece un webhook de Teams / Power Automate (debe ser https y de Microsoft)." };
  const body = JSON.stringify(buildCard({ title: m.title, facts: m.facts, lines: m.lines, url: location.href.split("#")[0], to: m.to, who: m.who }));
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    return r.ok || r.status === 202 ? { ok: true } : { ok: false, err: `Teams respondió ${r.status}.` };
  } catch { // el navegador suele bloquear la respuesta (CORS): se envía igual, sin poder confirmar
    try { await fetch(url, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body }); return { ok: true, unconfirmed: true }; }
    catch { return { ok: false, err: "No se pudo contactar el webhook (¿sin internet?)." }; }
  }
}
