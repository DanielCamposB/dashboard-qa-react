// Configuración en tiempo de compilación (archivo .env.local, ver .env.example). Reemplaza al antiguo config.js.
const env = import.meta.env;

export const cfg = {
  supabaseUrl: (env.VITE_SUPABASE_URL as string | undefined) || "",
  supabaseKey: (env.VITE_SUPABASE_ANON_KEY as string | undefined) || "",
  msalClientId: (env.VITE_MSAL_CLIENT_ID as string | undefined) || "",
  msalTenantId: (env.VITE_MSAL_TENANT_ID as string | undefined) || "",
  /** URL de la API Node (opcional). Si falta, los avisos manuales usan la función `qa_post` de Supabase. */
  apiUrl: ((env.VITE_API_URL as string | undefined) || "").replace(/\/$/, ""),
};

/** Con Supabase configurado la app es multiusuario; sin él funciona en modo local (datos en este navegador). */
export const REMOTE = !!(cfg.supabaseUrl && cfg.supabaseKey);
