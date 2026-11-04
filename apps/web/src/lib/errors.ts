// Mensajes de error en español.
export const errText = (e: unknown): string => {
  const x = e as { message?: string; error_description?: string; details?: string } | null;
  return (x && (x.message || x.error_description || x.details)) || String(e);
};

/** Errores de Supabase Auth. */
export function errEs(e: unknown): string {
  const m = String((e as { message?: string })?.message || e || ""), s = (e as { status?: number })?.status;
  if (/invalid login credentials/i.test(m)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(m)) return "Aún no confirmas tu correo. Abre el enlace que te enviamos (revisa spam).";
  if (/already registered|already been registered/i.test(m)) return "Ese correo ya tiene una cuenta. Usa «Ingresar» u «Olvidé mi contraseña».";
  if (/password should be at least|weak password/i.test(m)) return "La contraseña es muy débil o corta (mínimo 8 caracteres).";
  if (/should be different/i.test(m)) return "La nueva contraseña debe ser distinta a la anterior.";
  if (/rate limit|too many|security purposes/i.test(m) || s === 429) return "Demasiados intentos o correos enviados. Espera unos minutos e inténtalo de nuevo.";
  if (/signups? not allowed|signup is disabled/i.test(m)) return "El registro de cuentas está deshabilitado. Pide al administrador que te cree el usuario.";
  if (/invalid email|unable to validate email/i.test(m)) return "El correo no tiene un formato válido.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  if (/token has expired|otp|token.*(invalid|expired)|invalid.*token/i.test(m)) return "El código es incorrecto o ya venció. Revísalo o pide uno nuevo.";
  if (/jwt|session|expired/i.test(m)) return "El enlace expiró o ya fue usado. Solicita uno nuevo.";
  return "Error: " + m;
}

/** Errores de la pestaña Permisos. */
export function permErr(er: unknown): string {
  const m = String((er as { message?: string })?.message || er);
  return /duplicate key|already exists/i.test(m) ? "Ese correo ya tiene acceso."
    : /row-level|permission denied|Solo un administrador|sin permiso/i.test(m) ? "No tienes permiso de administrador para hacer esto."
    : /check constraint|profiles_role_check/i.test(m) ? "Falta ejecutar 02-admin.sql y 05-acceso.sql en Supabase."
    : /could not find the function|admin_unlock/i.test(m) ? "Falta ejecutar 05-acceso.sql en Supabase."
    : /failed to fetch|network/i.test(m) ? "No hay conexión con el servidor."
    : "Error: " + m;
}

/** Errores de Microsoft Graph / MSAL. */
export function graphErr(e: unknown): string {
  const m = String((e as { message?: string })?.message || e || ""), st = (e as { status?: number })?.status;
  if (/NO_SESSION/.test(m)) return "Conecta tu cuenta Microsoft primero.";
  if (/user_cancelled|popup_window_error|empty_window|BrowserAuthError.*popup/i.test(m)) return "No se completó el inicio de sesión de Microsoft (¿ventana emergente bloqueada o cancelada?).";
  if (/interaction_in_progress/.test(m)) return "Ya hay un inicio de sesión en curso. Termínalo e inténtalo de nuevo.";
  if (/AADSTS65001|consent_required|admin.?consent/i.test(m)) return "Falta el consentimiento de administrador para los permisos de Planner (Tasks.Read, Group.Read.All, User.ReadBasic.All). Pídeselo a TI.";
  if (/AADSTS50011|redirect_uri/i.test(m)) return "La dirección de esta página no está registrada como «redirect URI» (SPA) en la aplicación de Entra ID.";
  if (/AADSTS700016|AADSTS900023|unauthorized_client/i.test(m)) return "El clientId/tenantId configurado no corresponde a una aplicación válida de Entra ID.";
  if (st === 401) return "La sesión de Microsoft expiró. Vuelve a conectar la cuenta.";
  if (st === 403) return "Sin permiso en Microsoft 365 para leer ese plan (¿eres miembro del grupo del plan?) o falta consentimiento de administrador.";
  if (st === 404) return "No se encontró el plan. Revisa el ID o que tu cuenta tenga acceso.";
  if (st === 429) return "Microsoft pide esperar unos segundos (demasiadas consultas). Reintenta en un minuto.";
  if (/failed to fetch|networkerror|load failed/i.test(m)) return "No hay conexión con Microsoft Graph. Revisa tu internet.";
  return "Error: " + m;
}
