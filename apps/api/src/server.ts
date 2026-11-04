import cors from "@fastify/cors";
import Fastify from "fastify";
import cron from "node-cron";
import { z } from "zod";
import { requireRole } from "./auth";
import { runAvisos } from "./avisos";
import { loadEnv } from "./env";
import { serviceClient } from "./supabase";
import { postToTeams } from "./teams";

const env = loadEnv();
const sb = serviceClient(env);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });

await app.register(cors, {
  origin: env.CORS_ORIGIN.split(",").map(s => s.trim()).filter(Boolean),
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});

app.get("/api/health", async () => ({ ok: true, scheduler: env.AVISOS_SCHEDULER === "1" }));

const postSchema = z.object({
  target: z.string().regex(/^(user|client:[\w-]{1,64})$/),
  title: z.string().max(200),
  facts: z.array(z.object({ title: z.string().max(80), value: z.string().max(200) })).max(20).default([]),
  lines: z.string().max(12000).default(""),
  to: z.string().email().nullish(),
  name: z.string().max(80).nullish(),
});

// Publicar en Teams sin exponer la URL: la lee el servidor de `notify_secrets`. Solo editores y administradores.
app.post("/api/teams/post", { preHandler: requireRole(sb, ["editor", "admin"]) }, async (req, reply) => {
  const body = postSchema.safeParse(req.body);
  if (!body.success) return reply.code(400).send({ error: "Datos inválidos." });
  const b = body.data;
  const { data: sec } = await sb.from("notify_secrets").select("value").eq("key", b.target).maybeSingle();
  if (!sec?.value) return reply.code(409).send({ error: "URL no configurada: pide a un administrador que la guarde." });
  const { data: st } = await sb.from("app_state").select("data").eq("id", 1).single();
  const r = await postToTeams({
    url: sec.value as string,
    title: b.title,
    facts: b.facts.map(f => [f.title, f.value] as [string, string]),
    lines: b.lines ? [b.lines] : [],
    siteUrl: (st?.data as { notify?: { siteUrl?: string } } | null)?.notify?.siteUrl,
    to: b.to,
    name: b.name,
  });
  return r.ok ? { ok: true, status: r.status } : reply.code(502).send({ error: r.error });
});

// Ejecutar los avisos ahora (equivale a `select public.qa_avisos(true)`). Solo administradores.
app.post("/api/avisos/run", { preHandler: requireRole(sb, ["admin"]) }, async () => runAvisos(sb, { force: true, tz: env.AVISOS_TZ }));

if (env.AVISOS_SCHEDULER === "1") {
  cron.schedule(
    "* * * * *",
    () => {
      runAvisos(sb, { tz: env.AVISOS_TZ })
        .then(r => { if (r.sent || r.failed.length) app.log.info(r, "avisos"); })
        .catch(e => app.log.error(e, "avisos falló"));
    },
    { timezone: env.AVISOS_TZ }
  );
  app.log.info("Programador de avisos activo (cada minuto, horarios de la pestaña Avisos).");
}

await app.listen({ port: env.PORT, host: env.HOST });
