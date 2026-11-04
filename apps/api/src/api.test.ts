import { describe, expect, it, vi } from "vitest";
import { clockIn, dueSlot } from "./avisos";
import { loadEnv } from "./env";
import { postToTeams } from "./teams";

const notify = { times: ["09:00", "15:30"], days: [1, 2, 3, 4, 5], userWebhook: "", siteUrl: "" };

describe("horarios de avisos", () => {
  it("envía dentro de los 15 min del horario", () => {
    expect(dueSlot(notify, { today: "2026-11-04", minutes: 9 * 60 + 10, isoDow: 3 })).toEqual({ slot: "09:00" });
    expect(dueSlot(notify, { today: "2026-11-04", minutes: 9 * 60 + 15, isoDow: 3 })).toEqual({ skip: "fuera de horario" });
  });
  it("respeta días e interruptor general", () => {
    expect(dueSlot(notify, { today: "2026-11-07", minutes: 540, isoDow: 6 })).toEqual({ skip: "día no programado" });
    expect(dueSlot({ ...notify, auto: false }, { today: "2026-11-04", minutes: 540, isoDow: 3 })).toEqual({ skip: "envío automático desactivado" });
  });
  it("calcula la hora de Chile", () => {
    const c = clockIn("America/Santiago", new Date("2026-11-04T12:00:00Z")); // Chile = UTC-3 en noviembre
    expect(c).toEqual({ today: "2026-11-04", minutes: 9 * 60, isoDow: 3 });
  });
});

describe("Teams", () => {
  it("rechaza URLs que no son de Microsoft sin llamar a la red", async () => {
    const f = vi.fn();
    const r = await postToTeams({ url: "https://evil.example.com/x", title: "t" }, f as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("envía la tarjeta y confirma la entrega", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 202 });
    const r = await postToTeams({ url: "https://prod.logic.azure.com/w/1", title: "Hola", to: "a@b.cl", name: "Ana" }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, status: 202 });
    expect(JSON.parse(f.mock.calls[0][1].body).to).toBe("a@b.cl");
  });
});

describe("configuración", () => {
  it("exige las variables de Supabase", () => {
    expect(() => loadEnv({})).toThrow(/SUPABASE_URL/);
    expect(loadEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k".repeat(30) }).PORT).toBe(8787);
  });
});
