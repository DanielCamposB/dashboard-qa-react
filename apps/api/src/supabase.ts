import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./env";

/** Cliente con la clave de servicio: salta las políticas RLS. Nunca debe salir de este servidor. */
export const serviceClient = (env: Env): SupabaseClient =>
  createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
