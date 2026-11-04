// Fechas: todas se guardan como texto aaaa-mm-dd y se calculan en UTC para evitar corrimientos por zona horaria.

export const DAY = 86400000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Hoy según la hora local del equipo (aaaa-mm-dd). */
export const todayLocal = (now: Date = new Date()): string => iso(new Date(now.getTime() - now.getTimezoneOffset() * 60000));

/** Hoy en una zona horaria IANA (la API usa America/Santiago). */
export function todayIn(tz: string, now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return p; // en-CA ya entrega aaaa-mm-dd
}

export const d2n = (s: string): number => Math.round(Date.parse(s + "T00:00:00Z") / DAY);
export const n2d = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);

export function addDays(s: string, n: number): string {
  const d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Fecha para mostrar en pantalla: dd-mm-aaaa. */
export const fd = (s: string | undefined | null): string => (ISO_RE.test(s || "") ? `${s!.slice(8)}-${s!.slice(5, 7)}-${s!.slice(0, 4)}` : s || "");

export const isIsoDate = (s: string | undefined | null): boolean => ISO_RE.test(s || "");

export function yearsFrom(today: string, k: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + k);
  return d.toISOString().slice(0, 10);
}

/** Rango permitido para cualquier fecha: 10 años atrás y 10 hacia adelante. */
export function dateBounds(today: string) {
  return { min: yearsFrom(today, -10), max: yearsFrom(today, 10) };
}
export const badDate = (v: string, today: string): boolean => {
  if (!v) return false;
  const { min, max } = dateBounds(today);
  return v < min || v > max;
};

/** Fecha local (aaaa-mm-dd) de un instante ISO. */
export const localDate = (s: string, now: Date = new Date()): string =>
  s ? iso(new Date(new Date(s).getTime() - now.getTimezoneOffset() * 60000)) : "";

/** Días hábiles (lun-vie) transcurridos desde `day` hasta `today`. */
export function bizDaysSince(day: string, today: string): number {
  let n = d2n(day), c = 0;
  const t = d2n(today);
  while (n < t) {
    n++;
    const w = new Date(n * DAY).getUTCDay();
    if (w !== 0 && w !== 6) c++;
  }
  return c;
}

/** Texto del tamaño del atraso: «3 días», «1 semana y 2 d», «2 semanas». */
export function lvlTxt(d: number): string {
  return d >= 14 ? Math.floor(d / 7) + " semanas" : d >= 7 ? Math.floor(d / 7) + " semana" + (d % 7 ? " y " + (d % 7) + " d" : "") : d + (d === 1 ? " día" : " días");
}
/** Nivel de alerta por atraso (0-4). */
export const lvl = (d: number): number => (d >= 14 ? 4 : d >= 7 ? 3 : d >= 5 ? 2 : d >= 2 ? 1 : 0);
