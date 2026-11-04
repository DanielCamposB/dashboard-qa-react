import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Hint } from "./Hint";
import { tipFor, type TipGroup } from "../lib/tips";

/**
 * Errores de campo que aparecen pegados justo ENCIMA del campo (y lo marcan en rojo).
 * Se quitan al editar el campo, al tocar cualquier otra cosa o a los 10 segundos.
 */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const clear = useCallback((name?: string) => {
    if (name === undefined) { Object.values(timers.current).forEach(clearTimeout); timers.current = {}; setErrors({}); return; }
    clearTimeout(timers.current[name]);
    setErrors(e => { if (!(name in e)) return e; const n = { ...e }; delete n[name]; return n; });
  }, []);
  const set = useCallback((name: string, msg: string) => {
    if (!msg) return clear(name);
    clearTimeout(timers.current[name]);
    timers.current[name] = setTimeout(() => clear(name), 10000);
    setErrors(e => ({ ...e, [name]: msg }));
  }, [clear]);
  const any = Object.keys(errors).length > 0;
  useEffect(() => { // cualquier otra interacción lo quita (después del evento actual, para no borrarse a sí mismo)
    if (!any) return;
    let on = false;
    const t = setTimeout(() => (on = true), 0);
    const off = () => { if (on) clear(); };
    document.addEventListener("pointerdown", off);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", off); };
  }, [any, clear]);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);
  /** Pone el foco en el primer campo con error dentro de `root`. */
  const focusFirst = useCallback((root: HTMLElement | null) => (root?.querySelector(".bad") as HTMLElement | null)?.focus(), []);
  return { errors, set, clear, focusFirst, any };
}
export type FieldErrors = ReturnType<typeof useFieldErrors>;

/** Etiqueta de un campo de formulario con su error flotante, asterisco de obligatorio e icono de ayuda. */
export function Field({ label, star, error, group = "form", tipLabel, children, className, hint }: {
  label: ReactNode; star?: boolean; error?: string; group?: TipGroup; tipLabel?: string; children: ReactNode; className?: string; hint?: ReactNode;
}) {
  const text = tipLabel ?? (typeof label === "string" ? label : "");
  const tip = text ? tipFor(group, text) : undefined;
  return (
    <label className={[className, error ? "ferrhost" : ""].filter(Boolean).join(" ")}>
      {error && <div className="ferr ferrB" role="alert">{error}</div>}
      <span className="lcap">{label}{star && <> <span className="star">*</span></>}{tip && <> <Hint tip={tip} /></>}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

/** Bloque de error encima de un formulario en línea (los que no son ventanas). */
export const FormErr = ({ msg }: { msg?: string }) => (msg ? <div className="ferr" role="alert">{msg}</div> : null);

/** Campo de contraseña con el ojo para mostrarla u ocultarla. */
export function PwInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw">
      <input {...props} type={show ? "text" : "password"} />
      <button type="button" className={"eye" + (show ? " on" : "")} title="Mostrar/ocultar" aria-label="Mostrar u ocultar contraseña" onClick={() => setShow(s => !s)}>👁</button>
    </span>
  );
}

/** Texto filtrado mientras se escribe (solo letras, solo código, etc.), conservando la posición del cursor. */
export function filtered(fn: (v: string) => string, set: (v: string) => void) {
  return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.target, clean = fn(el.value);
    if (clean !== el.value) {
      const pos = Math.max(0, (el.selectionStart ?? clean.length) - (el.value.length - clean.length));
      el.value = clean;
      try { el.setSelectionRange(pos, pos); } catch { /* tipo sin selección */ }
    }
    set(clean);
  };
}

/** Caja de texto que crece según lo escrito. */
export function Grow({ value, onChange, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const t = ref.current!; t.style.height = "auto"; t.style.height = t.scrollHeight + 2 + "px"; }, [value]);
  return <textarea ref={ref} className="grow" rows={1} value={value} onChange={e => onChange(e.target.value)} {...rest} />;
}
