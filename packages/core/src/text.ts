// Validaciones y limpieza de texto (idénticas a las del dashboard original).

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const CODE_RE = /^[A-Za-z][0-9]{1,8}$/;
export const TITLE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ()#$/-]+$/;
export const STAGE_RE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/;
export const HTTP_RE = /^https?:\/\//i;

/** Código: 1 letra seguida de hasta 8 números. */
export function cleanCode(v: string): string {
  let out = "";
  for (const ch of v.toUpperCase()) {
    if (!out) {
      if (/[A-Z]/.test(ch)) out = ch;
    } else if (/[0-9]/.test(ch) && out.length < 9) out += ch;
  }
  return out;
}
export const cleanTitle = (v: string): string => v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 ()#$/-]/g, "").replace(/ {2,}/g, " ");
export const cleanStage = (v: string): string => v.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]/g, "").replace(/ {2,}/g, " ");

/** Minúsculas, sin tildes ni signos: para comparar nombres. */
export const norm = (s: unknown): string =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export const csvSafe = (c: unknown): string => {
  const s = String(c ?? "");
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; // evita que Excel ejecute fórmulas escritas en un título o comentario
};

// ---- contraseñas ----
export const PW_RULES = {
  len: (p: string) => p.length >= 8,
  up: (p: string) => /\p{Lu}/u.test(p),
  low: (p: string) => /\p{Ll}/u.test(p),
  num: (p: string) => /\d/.test(p),
  sym: (p: string) => /[^\p{L}\p{N}\s]/u.test(p),
} as const;
export type PwRule = keyof typeof PW_RULES;
export const PW_LABEL: Record<PwRule, string> = { len: "Mínimo 8 caracteres", up: "Una mayúscula", low: "Una minúscula", num: "Un número", sym: "Un símbolo (por ejemplo ! @ # $ %)" };
export const PW_TXT: Record<PwRule, string> = { len: "al menos 8 caracteres", up: "una mayúscula", low: "una minúscula", num: "un número", sym: "un símbolo" };
export const pwMissing = (p: string): PwRule[] => (Object.keys(PW_RULES) as PwRule[]).filter(k => !PW_RULES[k](p));
