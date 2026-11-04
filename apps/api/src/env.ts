// Variables de entorno de la API (ver .env.example en la raíz del proyecto).
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default("0.0.0.0"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** Orígenes permitidos (separados por coma). Ej: https://usuario.github.io,http://localhost:5173 */
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  /** Zona horaria de los horarios de avisos. */
  AVISOS_TZ: z.string().default("America/Santiago"),
  /** 1 = esta API envía los avisos programados. Si usas pg_cron (07-avisos-pgcron.sql) déjalo en 0 o desactiva el cron: ambos comparten `avisos_log`, así que nunca se duplica un horario. */
  AVISOS_SCHEDULER: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof schema>;
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const miss = r.error.issues.map(i => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error("Configuración inválida de la API:\n" + miss);
  }
  return r.data;
}
