import type { FastifyReply, FastifyRequest } from "fastify";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "@qa/core";

export interface AuthUser {
  email: string;
  role: Role;
}
declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/** Valida el token de Supabase del encabezado Authorization y busca el permiso de la persona en `profiles`. */
export function requireRole(sb: SupabaseClient, allowed: Role[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = /^Bearer (.+)$/i.exec(req.headers.authorization || "")?.[1];
    if (!token) return reply.code(401).send({ error: "Falta iniciar sesión." });
    const { data, error } = await sb.auth.getUser(token);
    const email = data.user?.email?.toLowerCase();
    if (error || !email) return reply.code(401).send({ error: "La sesión expiró. Vuelve a ingresar." });
    const { data: prof } = await sb.from("profiles").select("role,locked").eq("email", email).maybeSingle();
    if (!prof || prof.locked || !allowed.includes(prof.role as Role)) return reply.code(403).send({ error: "No tienes permiso para esta acción." });
    req.user = { email, role: prof.role as Role };
  };
}
