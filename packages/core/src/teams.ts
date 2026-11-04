// Avisos a Teams: resúmenes, mensajes personales y tarjeta adaptable. Compartido entre la web (envíos manuales) y la API (envíos programados).
import { makeCalc, type Calc } from "./calc";
import { fd, lvlTxt } from "./dates";
import type { Client, Store } from "./types";

export type Fact = [string, string | number];
export interface Message {
  title: string;
  facts: Fact[];
  lines: string[];
}
export interface OwnerDigest extends Message {
  email: string;
  name: string;
}

const HOST_OK = /(^|\.)(webhook\.office\.com|office\.com|logic\.azure\.com|powerplatform\.com|powerautomate\.com|microsoft\.com|office365\.com)$/i;
/** Solo se envía a direcciones https de Microsoft (Teams / Power Automate). */
export function isTeamsUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && HOST_OK.test(x.hostname);
  } catch {
    return false;
  }
}

/** Tarjeta adaptable. `to` = correo del destinatario (mensajes personales); `who` = saludo con @mención real de Teams. */
export function buildCard(o: { title: string; facts?: Fact[]; lines?: string[]; url?: string; to?: string | null; who?: { name: string; email: string } | null }) {
  const { title, facts = [], lines = [], url, to, who } = o;
  const name = who ? who.name.replace(/[<>&]/g, "") : "";
  return {
    type: "message",
    ...(to ? { to } : {}),
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      contentUrl: null,
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        ...(who ? { msteams: { entities: [{ type: "mention", text: `<at>${name}</at>`, mentioned: { id: who.email, name } }] } } : {}),
        body: [
          { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", wrap: true },
          ...(who ? [{ type: "TextBlock", text: `Hola <at>${name}</at>, estas son tus actividades pendientes:`, wrap: true }] : []),
          ...(facts.length ? [{ type: "FactSet", facts: facts.map(([t, v]) => ({ title: t, value: String(v) })) }] : []),
          ...(lines.length ? [{ type: "TextBlock", text: lines.join("\n\n"), wrap: true }] : []),
        ],
        ...(url ? { actions: [{ type: "Action.OpenUrl", title: "Abrir dashboard", url }] } : {}),
      },
    }],
  };
}

const idsOf = (x: { assigneeId?: string; assigneeIds?: string[] } | undefined) => (x?.assigneeIds?.length ? x.assigneeIds : x?.assigneeId ? [x.assigneeId] : []);

/** Resumen de un cliente para su canal. */
export function summaryFor(store: Store, c: Client, calc: Calc): Message {
  const rs = store.reqs.filter(r => r.clientId === c.id && r.status !== "Completado");
  const worstLate = (r: (typeof rs)[number]) => Math.max(calc.daysLate(calc.span(r)[1]), ...r.acts.filter(a => a.percent < 100).map(a => calc.daysLate(a.end)));
  const late = rs.filter(r => worstLate(r) >= 1).sort((x, y) => worstLate(y) - worstLate(x));
  const blocked = rs.filter(r => r.status === "Bloqueado" || r.acts.some(a => a.blocked));
  const stale = rs.filter(r => calc.staleDays(r) >= 2);
  const dov = rs.filter(r => calc.delOverdue(r).length);
  const line = (r: (typeof rs)[number], extra: string) => `• **${r.code}** ${r.title} — ${extra}`;
  const lines: string[] = [];
  if (late.length) lines.push("**Atrasados**\n\n" + late.slice(0, 8).map(r => line(r, lvlTxt(worstLate(r)) + " de atraso")).join("\n\n"));
  if (blocked.length) lines.push("**Bloqueados**\n\n" + blocked.slice(0, 8).map(r => line(r, r.acts.filter(a => a.blocked).map(a => a.blockReason || a.name).join("; ") || "bloqueado")).join("\n\n"));
  if (stale.length) lines.push("**Sin actualizar**\n\n" + stale.slice(0, 8).map(r => line(r, `hace ${calc.staleDays(r)} días hábiles`)).join("\n\n"));
  if (dov.length) lines.push("**Entregables vencidos**\n\n" + dov.slice(0, 8).map(r => line(r, calc.delOverdue(r).map(d => d.name).join(", "))).join("\n\n"));
  const ev = c.teams?.events || {};
  const mem = store.members;
  const whoOf = (r: (typeof rs)[number]) => [...new Set(idsOf(r).map(id => mem.find(m => m.id === id)?.name).filter(Boolean))].join(", ");
  if (ev.all) {
    const list = rs.slice().sort((x, y) => (calc.span(x)[1] < calc.span(y)[1] ? -1 : 1));
    lines.push(`**Todos los requerimientos en curso (${rs.length})**\n\n` + (list.length
      ? list.slice(0, 25).map(r => `• **${r.code}** ${r.title} — ${r.status} · ${calc.progress(r)}% · fin ${fd(calc.span(r)[1])}${whoOf(r) ? " · " + whoOf(r) : ""}`).join("\n\n") + (list.length > 25 ? `\n\n… y ${list.length - 25} más en el dashboard` : "")
      : "Sin requerimientos en curso."));
  }
  if (ev.byOwner) {
    const by: Record<string, { sev: number; end: string; text: string }[]> = {};
    for (const r of rs) {
      for (const act of r.acts.filter(x => x.percent < 100)) {
        const who = idsOf(act).length ? idsOf(act) : idsOf(r), d = calc.daysLate(act.end), sev = act.blocked ? 0 : d >= 1 ? 1 : d >= -3 ? 2 : 3;
        const tag = sev === 0 ? "🚧 bloqueada" : sev === 1 ? "🔴 atrasada " + lvlTxt(d) : sev === 2 ? "🟡 vence " + fd(act.end) : "🔵 termina " + fd(act.end);
        for (const id of new Set(who)) {
          const m = mem.find(x => x.id === id);
          if (m) (by[m.name] ||= []).push({ sev, end: act.end, text: `  · ${r.code} ${act.name} — ${tag}` });
        }
      }
    }
    const people = Object.entries(by).map(([name, rows]) => {
      rows.sort((x, y) => x.sev - y.sev || (x.end < y.end ? -1 : 1));
      return { name, rows, nl: rows.filter(x => x.sev === 1).length, nb: rows.filter(x => x.sev === 0).length };
    }).sort((x, y) => y.nl - x.nl || y.nb - x.nb || y.rows.length - x.rows.length);
    lines.push("**Carga por responsable**\n\n" + (people.length
      ? people.map(p => `**${p.name}** — ${p.rows.length} actividad(es)${p.nl ? " · " + p.nl + " atrasada(s)" : ""}${p.nb ? " · " + p.nb + " bloqueada(s)" : ""}\n\n` + p.rows.slice(0, 6).map(x => x.text).join("\n\n") + (p.rows.length > 6 ? `\n\n  … y ${p.rows.length - 6} más` : "")).join("\n\n")
      : "Nadie con actividades abiertas."));
  }
  return {
    title: `Resumen QA · ${c.name} · ${fd(calc.today)}`,
    facts: [["En curso", rs.length], ["Atrasados", late.length], ["Bloqueados", blocked.length], ["Sin actualizar", stale.length], ["Entregables vencidos", dov.length]],
    lines: lines.length ? lines : ["Todo en orden ✅"],
  };
}

/** ¿Hay algo que avisar? (el envío programado se omite si todo está en orden y «quiet» está activo). */
export function hasIssues(m: Message): boolean {
  return m.facts.slice(1).some(([, v]) => Number(v) > 0);
}

/** Mensajes personales: los pendientes de cada responsable con correo. */
export function ownerDigests(store: Store, c: Client, calc: Calc): OwnerDigest[] {
  const mem = store.members, out: Record<string, { email: string; name: string; rows: { sev: number; end: string; text: string }[] }> = {};
  for (const r of store.reqs.filter(r => r.clientId === c.id && r.status !== "Completado")) {
    for (const act of r.acts.filter(x => x.percent < 100)) {
      const who = idsOf(act).length ? idsOf(act) : idsOf(r), d = calc.daysLate(act.end);
      const [sev, tag] = act.blocked ? [0, "🚧 bloqueada" + (act.blockReason ? ": " + act.blockReason : "")] : d >= 1 ? [1, "🔴 atrasada " + lvlTxt(d)] : d >= -3 ? [2, "🟡 vence " + fd(act.end)] : [3, "🔵 pendiente, termina " + fd(act.end)];
      for (const id of new Set(who)) {
        const m = mem.find(x => x.id === id);
        if (!m || !m.email) continue;
        const k = m.email.toLowerCase();
        (out[k] ||= { email: k, name: m.name, rows: [] }).rows.push({ sev: sev as number, end: act.end, text: `• **${r.code}** ${r.title} · ${act.name} — ${tag}` });
      }
    }
  }
  return Object.values(out).map(p => {
    p.rows.sort((x, y) => x.sev - y.sev || (x.end < y.end ? -1 : 1));
    const cnt = (s: number) => p.rows.filter(x => x.sev === s).length;
    return {
      email: p.email, name: p.name,
      title: `Tus pendientes QA · ${c.name} · ${fd(calc.today)}`,
      facts: [["Atrasadas", cnt(1)], ["Bloqueadas", cnt(0)], ["Por vencer (≤3 días)", cnt(2)], ["Pendientes", cnt(3)]] as Fact[],
      lines: [...p.rows.slice(0, 15).map(x => x.text), ...(p.rows.length > 15 ? [`… y ${p.rows.length - 15} más en el dashboard`] : [])],
    };
  });
}

export const makeSummary = (store: Store, c: Client, today: string) => summaryFor(store, c, makeCalc(store, today));
