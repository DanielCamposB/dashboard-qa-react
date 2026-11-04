import { buildCard, isTeamsUrl, type Fact } from "@qa/core";

export interface PostArgs {
  url: string;
  title: string;
  facts?: Fact[];
  lines?: string[];
  siteUrl?: string;
  to?: string | null;
  name?: string | null;
}
export interface PostResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Publica una tarjeta en un webhook de Teams / Power Automate. A diferencia del navegador (CORS), aquí sí se confirma la entrega. */
export async function postToTeams(a: PostArgs, fetchImpl: typeof fetch = fetch): Promise<PostResult> {
  if (!isTeamsUrl(a.url)) return { ok: false, error: "La URL del webhook no es una dirección https de Microsoft." };
  const who = a.to && a.name ? { name: a.name, email: a.to } : null;
  const body = buildCard({ title: a.title, facts: a.facts, lines: a.lines, url: a.siteUrl || undefined, to: a.to, who });
  try {
    const r = await fetchImpl(a.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    return r.ok || r.status === 202 ? { ok: true, status: r.status } : { ok: false, status: r.status, error: `Teams respondió ${r.status}.` };
  } catch (e) {
    return { ok: false, error: "No se pudo contactar el webhook: " + (e instanceof Error ? e.message : String(e)) };
  }
}
